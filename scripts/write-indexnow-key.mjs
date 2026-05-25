#!/usr/bin/env node
/** 构建前写入 IndexNow 验证 txt（内容仅一行密钥） */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const key = process.env.INDEXNOW_KEY;

if (!key) {
  console.log("未设置 INDEXNOW_KEY，跳过验证文件生成");
  process.exit(0);
}

const srcFile = path.join(root, "src", `${key}.txt`);
fs.writeFileSync(srcFile, key, "utf8");
console.log(`已写入验证文件: src/${key}.txt`);
