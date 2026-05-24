#!/usr/bin/env node
/**
 * 将 _site 下 HTML 页面 URL 推送到必应 IndexNow
 * 环境变量: SITE_DOMAIN, INDEXNOW_KEY
 */
import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../_site");
const DOMAIN = process.env.SITE_DOMAIN || process.env.DOMAIN || "";
const BING_KEY = process.env.INDEXNOW_KEY || "";

function getAllHtmlFiles(dirPath, arrayOfFiles = []) {
  if (!fs.existsSync(dirPath)) return arrayOfFiles;
  for (const file of fs.readdirSync(dirPath)) {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      getAllHtmlFiles(fullPath, arrayOfFiles);
    } else if (file.endsWith(".html")) {
      arrayOfFiles.push(fullPath);
    }
  }
  return arrayOfFiles;
}

function toPublicUrl(filePath) {
  let relativePath = path.relative(OUTPUT_DIR, filePath).replace(/\\/g, "/");
  if (relativePath.endsWith("/index.html")) {
    relativePath = relativePath.slice(0, -10);
  } else if (relativePath === "index.html") {
    relativePath = "";
  } else if (relativePath.endsWith(".html")) {
    relativePath = relativePath.slice(0, -5);
  }
  const base = `https://${DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  return relativePath ? `${base}/${relativePath}` : `${base}/`;
}

function postIndexNow(payload) {
  return new Promise((resolve, reject) => {
    const requestData = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: "api.indexnow.org",
        path: "/IndexNow",
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": Buffer.byteLength(requestData)
        }
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ statusCode: res.statusCode, body }));
      }
    );
    req.on("error", reject);
    req.write(requestData);
    req.end();
  });
}

async function waitForValidationFile(maxAttempts = 30, intervalMs = 5000) {
  const host = DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const validationUrl = `https://${host}/${BING_KEY}.txt`;
  console.log(`检测线上验证文件: ${validationUrl}`);

  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const statusCode = await new Promise((resolve, reject) => {
        https
          .get(validationUrl, (res) => {
            res.resume();
            resolve(res.statusCode);
          })
          .on("error", reject);
      });
      if (statusCode === 200) {
        console.log("线上验证文件已生效 (HTTP 200)");
        return true;
      }
      console.log(`等待 CDN 同步 (${statusCode})，${i}/${maxAttempts}...`);
    } catch (e) {
      console.log(`探测失败: ${e.message}，${i}/${maxAttempts}...`);
    }
    if (i < maxAttempts) await new Promise((r) => setTimeout(r, intervalMs));
  }
  console.log("验证文件等待超时，仍将尝试推送");
  return false;
}

async function main() {
  if (!DOMAIN || !BING_KEY) {
    console.log("未配置 SITE_DOMAIN 或 INDEXNOW_KEY，跳过 IndexNow 推送");
    process.exit(0);
  }

  if (!fs.existsSync(OUTPUT_DIR)) {
    console.error("未找到 _site 目录，请先执行 npm run build");
    process.exit(1);
  }

  await waitForValidationFile();

  const htmlFiles = getAllHtmlFiles(OUTPUT_DIR);
  let urlList = htmlFiles.map(toPublicUrl);
  urlList = [...new Set(urlList)].filter(
    (url) =>
      !url.includes("404") &&
      !url.includes("admin") &&
      !url.endsWith(".txt")
  );

  if (urlList.length === 0) {
    console.log("未发现有效页面，无需推送");
    process.exit(0);
  }

  const host = DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const payload = {
    host,
    key: BING_KEY,
    keyLocation: `https://${host}/${BING_KEY}.txt`,
    urlList
  };

  console.log(`正在推送 ${urlList.length} 个 URL 到 IndexNow...`);
  const { statusCode, body } = await postIndexNow(payload);

  if (statusCode === 200 || statusCode === 202) {
    console.log(`IndexNow 接收成功，状态码: ${statusCode}`);
    process.exit(0);
  }
  console.error(`推送失败，状态码: ${statusCode}，响应: ${body}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
