import sharp from 'sharp';
import { join } from 'path';

const ASSETS = 'apps/web/public/assets/ui';

async function fixFile(srcPath, outPath, threshold) {
  const { data, info } = await sharp(srcPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = Buffer.from(data);
  const { width, height, channels } = info;

  // Flood-fill from edges: only make black pixels transparent if they are
  // connected to the border (i.e. actual background, not interior darks)
  const isBackground = new Uint8Array(width * height);
  const queue = [];

  function idx(x, y) { return y * width + x; }
  function isBlack(x, y) {
    const off = idx(x, y) * channels;
    const r = pixels[off], g = pixels[off+1], b = pixels[off+2];
    return (r + g + b) / 3 < threshold;
  }

  // Seed from all 4 borders
  for (let x = 0; x < width; x++) {
    if (isBlack(x, 0)) { isBackground[idx(x, 0)] = 1; queue.push([x, 0]); }
    if (isBlack(x, height-1)) { isBackground[idx(x, height-1)] = 1; queue.push([x, height-1]); }
  }
  for (let y = 0; y < height; y++) {
    if (isBlack(0, y)) { isBackground[idx(0, y)] = 1; queue.push([0, y]); }
    if (isBlack(width-1, y)) { isBackground[idx(width-1, y)] = 1; queue.push([width-1, y]); }
  }

  // BFS flood fill
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  while (queue.length > 0) {
    const [cx, cy] = queue.shift();
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const ni = idx(nx, ny);
      if (isBackground[ni]) continue;
      if (isBlack(nx, ny)) {
        isBackground[ni] = 1;
        queue.push([nx, ny]);
      }
    }
  }

  // Apply transparency only to background-connected black pixels
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = idx(x, y);
      const off = i * channels;
      if (isBackground[i]) {
        pixels[off + 3] = 0; // fully transparent
      } else {
        // Check border pixels near background for smooth edges
        let nearBg = false;
        for (const [dx, dy] of dirs) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height && isBackground[idx(nx, ny)]) {
            nearBg = true;
            break;
          }
        }
        if (nearBg) {
          const r = pixels[off], g = pixels[off+1], b = pixels[off+2];
          const brightness = (r + g + b) / 3;
          if (brightness < threshold + 15) {
            const alpha = Math.round(((brightness - threshold + 15) / 30) * 255);
            pixels[off + 3] = Math.max(0, Math.min(255, alpha));
          }
        }
      }
    }
  }

  await sharp(pixels, { raw: { width, height, channels } })
    .png()
    .toFile(outPath);

  console.log(`Fixed: ${outPath} (${width}x${height})`);
}

// Re-process from the ORIGINAL JPEG sources
const origDir = 'C:/Users/w2/.cursor/projects/c-Users-w2-Downloads-Kauche/assets';
const files = [
  { orig: 'c__Users_w2_AppData_Roaming_Cursor_User_workspaceStorage_628ab5c548130fbdab105878544739f0_images_ui-bucket.png-c64b203e-9a90-411e-84ef-67b81888ddff.png', out: 'bucket.png', threshold: 30 },
  { orig: 'c__Users_w2_AppData_Roaming_Cursor_User_workspaceStorage_628ab5c548130fbdab105878544739f0_images_ui-watering-can.png-3b1d90a5-17c9-4c28-b92d-f7dd40ab5ad0.png', out: 'watering-can.png', threshold: 30 },
  { orig: 'c__Users_w2_AppData_Roaming_Cursor_User_workspaceStorage_628ab5c548130fbdab105878544739f0_images_ui-well.png-05f90306-c7ef-4cc3-a155-23147686148c.png', out: 'well.png', threshold: 30 },
];

for (const f of files) {
  const src = join(origDir, f.orig);
  const out = join(ASSETS, f.out);
  await fixFile(src, out, f.threshold);
}

console.log('Done — flood-fill approach preserves interior darks!');
