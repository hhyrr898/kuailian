#!/usr/bin/env node
/**
 * Gemini 内容生成入口（供 GitHub Actions 调用）
 * 用法: node autobot.js [1-9]
 */
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let count = parseInt(process.argv[2] || "1", 10);
if (Number.isNaN(count) || count < 1) count = 1;
if (count > 9) count = 9;

const script = path.join(__dirname, "scripts", "generate-article.mjs");
const child = spawn(process.execPath, [script, `--count=${count}`], {
  stdio: "inherit",
  env: process.env
});

child.on("close", (code) => process.exit(code ?? 1));
