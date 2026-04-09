import sharp from 'sharp';
import { join } from 'path';

// Use the NEWEST bucket upload
const src = 'C:/Users/w2/.cursor/projects/c-Users-w2-Downloads-Kauche/assets/c__Users_w2_AppData_Roaming_Cursor_User_workspaceStorage_628ab5c548130fbdab105878544739f0_images_ui-bucket.png-71fc779c-9413-4d75-a414-a601bea2568e.png';
const out = 'apps/web/public/assets/ui/bucket.png';

const THRESHOLD = 25; // very conservative — only truly black

const { data, info } = await sharp(src)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const pixels = Buffer.from(data);
const { width, height, channels } = info;

const isBackground = new Uint8Array(width * height);
const queue = [];

function idx(x, y) { return y * width + x; }
function isBlack(x, y) {
  const off = idx(x, y) * channels;
  return pixels[off] < THRESHOLD && pixels[off+1] < THRESHOLD && pixels[off+2] < THRESHOLD;
}

// Seed from borders only
for (let x = 0; x < width; x++) {
  if (isBlack(x, 0)) { isBackground[idx(x, 0)] = 1; queue.push([x, 0]); }
  if (isBlack(x, height-1)) { isBackground[idx(x, height-1)] = 1; queue.push([x, height-1]); }
}
for (let y = 0; y < height; y++) {
  if (isBlack(0, y)) { isBackground[idx(0, y)] = 1; queue.push([0, y]); }
  if (isBlack(width-1, y)) { isBackground[idx(width-1, y)] = 1; queue.push([width-1, y]); }
}

// BFS
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

// Apply: only background -> transparent, leave everything else alone
for (let i = 0; i < width * height; i++) {
  if (isBackground[i]) {
    pixels[i * channels + 3] = 0;
  }
}

await sharp(pixels, { raw: { width, height, channels } })
  .png()
  .toFile(out);

console.log(`Bucket fixed: ${out} (${width}x${height}), bg pixels removed: ${isBackground.reduce((a,b)=>a+b, 0)}`);
