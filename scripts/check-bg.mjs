import sharp from 'sharp';

const src = 'C:/Users/w2/.cursor/projects/c-Users-w2-Downloads-Kauche/assets/c__Users_w2_AppData_Roaming_Cursor_User_workspaceStorage_628ab5c548130fbdab105878544739f0_images_Gemini_Generated_Image_iytox3iytox3iyto-removebg-preview-55eef05e-2b8e-4976-bb1d-752f4c1f0058.png';

const { data, info } = await sharp(src).raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;

let opaqueCorners = 0;
const corners = [[0,0], [width-1,0], [0,height-1], [width-1,height-1]];
for (const [x, y] of corners) {
  const off = (y * width + x) * channels;
  const a = data[off + 3];
  if (a > 10) opaqueCorners++;
  console.log(`Corner (${x},${y}): rgba(${data[off]},${data[off+1]},${data[off+2]},${a})`);
}

let transparentPixels = 0;
for (let i = 0; i < width * height; i++) {
  if (data[i * channels + 3] < 10) transparentPixels++;
}
console.log(`\nTotal: ${width}x${height}, transparent: ${transparentPixels}/${width*height} (${(transparentPixels/(width*height)*100).toFixed(1)}%)`);
console.log(`Opaque corners: ${opaqueCorners}/4`);
console.log(opaqueCorners === 0 ? '\n✅ Background is transparent!' : '\n⚠️ Some corners are opaque — may need cleanup');
