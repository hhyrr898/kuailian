#!/usr/bin/env node
/** 从 src/images/logo.png 生成 favicon.ico 与常用尺寸 PNG */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import toIco from "to-ico";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SRC_LOGO = path.join(ROOT, "src/images/logo.png");
const OUT_DIR = path.join(ROOT, "src");

async function main() {
  if (!fs.existsSync(SRC_LOGO)) {
    console.error("缺少 src/images/logo.png");
    process.exit(1);
  }

  const sizes = [16, 32, 48];
  const pngBuffers = [];
  for (const size of sizes) {
    const buf = await sharp(SRC_LOGO)
      .resize(size, size, { fit: "cover" })
      .png()
      .toBuffer();
    pngBuffers.push(buf);
    const name = size === 32 ? "favicon-32.png" : `icon-${size}.png`;
    fs.writeFileSync(path.join(OUT_DIR, "images", name), buf);
  }

  const ico = await toIco(pngBuffers);
  fs.writeFileSync(path.join(OUT_DIR, "favicon.ico"), ico);

  const apple = await sharp(SRC_LOGO).resize(180, 180, { fit: "cover" }).png().toBuffer();
  fs.writeFileSync(path.join(OUT_DIR, "images", "apple-touch-icon.png"), apple);

  console.log("已生成 favicon.ico 与 src/images/*.png");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
