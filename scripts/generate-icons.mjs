import sharp from "sharp";
import { mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, "..", "src-tauri", "icons");

// 麦克风+声波 SVG（深色填充，适合做图标）
const svg = `<svg viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- 背景圆角矩形 -->
  <rect width="512" height="512" rx="96" fill="#171717"/>
  <!-- 麦克风主体 -->
  <rect x="192" y="64" width="128" height="234" rx="64" fill="#f5f5f5"/>
  <!-- 麦克风支架弧线 -->
  <path d="M112 234a144 144 0 0 0 288 0" stroke="#f5f5f5" stroke-width="36" stroke-linecap="round" fill="none"/>
  <!-- 麦克风底座竖线 -->
  <line x1="256" y1="378" x2="256" y2="448" stroke="#f5f5f5" stroke-width="36" stroke-linecap="round"/>
  <!-- 声波 - 右侧 -->
  <path d="M416 170a90 90 0 0 1 0 108" stroke="#f5f5f5" stroke-width="28" stroke-linecap="round" fill="none" opacity="0.6"/>
  <path d="M460 120a160 160 0 0 1 0 196" stroke="#f5f5f5" stroke-width="28" stroke-linecap="round" fill="none" opacity="0.35"/>
</svg>`;

const svgBuffer = Buffer.from(svg);

// 需要生成的尺寸
const sizes = [
  { name: "32x32.png", size: 32 },
  { name: "128x128.png", size: 128 },
  { name: "128x128@2x.png", size: 256 },
  { name: "icon.png", size: 512 },
  { name: "Square30x30Logo.png", size: 30 },
  { name: "Square44x44Logo.png", size: 44 },
  { name: "Square71x71Logo.png", size: 71 },
  { name: "Square89x89Logo.png", size: 89 },
  { name: "Square107x107Logo.png", size: 107 },
  { name: "Square142x142Logo.png", size: 142 },
  { name: "Square150x150Logo.png", size: 150 },
  { name: "Square284x284Logo.png", size: 284 },
  { name: "Square310x310Logo.png", size: 310 },
  { name: "StoreLogo.png", size: 50 },
];

mkdirSync(iconsDir, { recursive: true });

for (const { name, size } of sizes) {
  const outPath = join(iconsDir, name);
  await sharp(svgBuffer)
    .resize(size, size)
    .png()
    .toFile(outPath);
  console.log(`Generated ${name} (${size}x${size})`);
}

// 生成 ICO (包含 16, 32, 48, 256 尺寸)
// sharp 不直接支持 ICO，用 PNG 数据手动构造 ICO 格式
const icoSizes = [16, 32, 48, 256];
const pngBuffers = [];
for (const size of icoSizes) {
  const buf = await sharp(svgBuffer).resize(size, size).png().toBuffer();
  pngBuffers.push({ size, buf });
}

// ICO 文件格式
function buildIco(entries) {
  // ICO header: 6 bytes
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = ICO
  header.writeUInt16LE(entries.length, 4); // image count

  // 每个 entry 的目录项: 16 bytes
  const dirSize = entries.length * 16;
  let dataOffset = 6 + dirSize;

  const dirEntries = [];
  for (const { size, buf } of entries) {
    const dir = Buffer.alloc(16);
    dir.writeUInt8(size < 256 ? size : 0, 0); // width (0 = 256)
    dir.writeUInt8(size < 256 ? size : 0, 1); // height
    dir.writeUInt8(0, 2); // color palette
    dir.writeUInt8(0, 3); // reserved
    dir.writeUInt16LE(1, 4); // color planes
    dir.writeUInt16LE(32, 6); // bits per pixel
    dir.writeUInt32LE(buf.length, 8); // data size
    dir.writeUInt32LE(dataOffset, 12); // data offset
    dirEntries.push(dir);
    dataOffset += buf.length;
  }

  return Buffer.concat([header, ...dirEntries, ...entries.map((e) => e.buf)]);
}

const icoBuffer = buildIco(pngBuffers);
writeFileSync(join(iconsDir, "icon.ico"), icoBuffer);
console.log("Generated icon.ico");

console.log("Done!");
