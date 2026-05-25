#!/usr/bin/env node
/**
 * 将页面 URL 推送到必应 IndexNow
 *
 * 环境变量:
 *   SITE_DOMAIN, INDEXNOW_KEY  必填（推送时）
 *   INDEXNOW_HOST              可选，覆盖 host（与 Bing 站长工具已验证域名一致）
 *   PUSH_NEW_ONLY=1            仅推送当天新发文（默认全站）
 *   TZ                         建议 Asia/Hong_Kong
 */
import fs from "fs";
import path from "path";
import https from "https";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "_site");
const POSTS_DIR = path.join(ROOT, "src/posts");
const MANIFEST = path.join(__dirname, ".indexnow-pending.json");

const DOMAIN = process.env.SITE_DOMAIN || process.env.DOMAIN || "";
const BING_KEY = process.env.INDEXNOW_KEY || "";
const PUSH_NEW_ONLY =
  process.env.PUSH_NEW_ONLY === "1" || process.env.PUSH_NEW_ONLY === "true";

function todayDateString() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.TZ || "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function siteHost() {
  const override = (process.env.INDEXNOW_HOST || "").trim();
  if (override) {
    return override.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
  return DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/** 主域名 + 可选 www 变体（403 常见于站长工具属性与 SITE_DOMAIN 不一致） */
function hostVariants() {
  const primary = siteHost();
  const seen = new Set();
  const list = [];
  for (const h of [primary]) {
    if (!h || seen.has(h)) continue;
    seen.add(h);
    list.push(h);
  }
  const alt = primary.startsWith("www.")
    ? primary.slice(4)
    : `www.${primary}`;
  if (alt && !seen.has(alt)) {
    seen.add(alt);
    list.push(alt);
  }
  return list;
}

function rewriteUrlsForHost(urlList, host) {
  return urlList.map((u) => {
    try {
      const parsed = new URL(u);
      parsed.host = host;
      return normalizeUrl(parsed.href);
    } catch {
      return u;
    }
  });
}

function fetchKeyFile(host) {
  const keyUrl = `https://${host}/${BING_KEY}.txt`;
  return new Promise((resolve, reject) => {
    https
      .get(keyUrl, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () =>
          resolve({ host, keyUrl, code: res.statusCode, data: data.trim() })
        );
      })
      .on("error", reject);
  });
}

function print403Help(primaryHost) {
  console.error(`
IndexNow 403（UserForbiddedToAccessSite）说明：
  验证文件已可访问，但必应 API 仍拒绝推送。通常不是代码问题。

必做（按顺序）：
  1. 打开 https://www.bing.com/webmasters → 添加站点
  2. 站点 URL 必须与推送 host 完全一致（当前 SITE_DOMAIN=${primaryHost}）
     - 网站用 www 打开 → SITE_DOMAIN 填 www.xxx.com
     - 网站用裸域打开 → SITE_DOMAIN 填 xxx.com（不要带 www）
  3. 在站长工具完成「验证」并显示已验证（仅部署 txt 不够）
  4. INDEXNOW_KEY 使用站长工具里为该站点生成的密钥（与 {key}.txt 一致）
  5. 验证通过后等 10–30 分钟再重跑 workflow

可选：若站长工具里添加的是另一 host，设置 GitHub Secret INDEXNOW_HOST=已验证的域名
`);
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.pathname = u.pathname.replace(/\/{2,}/g, "/");
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.href;
  } catch {
    return url.replace(/([^:]\/)\/+/g, "$1").replace(/\/$/, "");
  }
}

function permalinkToUrl(permalink) {
  const host = siteHost();
  let p = String(permalink || "").trim();
  if (!p.startsWith("/")) p = `/${p}`;
  p = p.replace(/\/{2,}/g, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return normalizeUrl(`https://${host}${p}`);
}

function parsePostFrontMatter(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const block = m[1];
  const date = block.match(/^date:\s*(\S+)/m)?.[1]?.trim();
  const permalink = block.match(/^permalink:\s*(\S+)/m)?.[1]?.trim();
  const slug = path.basename(filePath, ".md");
  return {
    date,
    permalink: permalink || `/posts/${slug}/`,
    slug
  };
}

function htmlPathForPermalink(permalink) {
  let rel = permalink.replace(/^\/+/, "");
  if (rel.endsWith("/")) rel = rel.slice(0, -1);
  const candidates = [
    path.join(OUTPUT_DIR, rel, "index.html"),
    path.join(OUTPUT_DIR, `${rel}.html`)
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function loadManifestPermalinks() {
  if (!fs.existsSync(MANIFEST)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
    if (data.date && data.date !== todayDateString()) return [];
    return Array.isArray(data.permalinks) ? data.permalinks : [];
  } catch {
    return [];
  }
}

function getTodayPostsFromMarkdown() {
  const today = todayDateString();
  if (!fs.existsSync(POSTS_DIR)) return [];
  const links = [];
  for (const name of fs.readdirSync(POSTS_DIR)) {
    if (!name.endsWith(".md")) continue;
    const meta = parsePostFrontMatter(path.join(POSTS_DIR, name));
    if (meta?.date === today) links.push(meta.permalink);
  }
  return links;
}

function getNewPostsFromGit() {
  try {
    const out = execSync(
      "git diff --name-only --diff-filter=A HEAD~1 HEAD -- src/posts/",
      { cwd: ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }
    ).trim();
    if (!out) return [];
    return out
      .split(/\r?\n/)
      .filter((f) => f.endsWith(".md"))
      .map((f) => parsePostFrontMatter(path.join(ROOT, f))?.permalink)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function collectNewOnlyPermalinks() {
  const sets = [
    loadManifestPermalinks(),
    getTodayPostsFromMarkdown(),
    getNewPostsFromGit()
  ];
  const merged = [...new Set(sets.flat())];
  return merged;
}

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
  const base = `https://${siteHost()}`;
  return relativePath ? `${base}/${relativePath}/` : `${base}/`;
}

function resolveUrlListFromPermalinks(permalinks) {
  const urlList = [];
  for (const link of permalinks) {
    const html = htmlPathForPermalink(link);
    if (html) {
      urlList.push(normalizeUrl(toPublicUrl(html)));
    } else {
      urlList.push(permalinkToUrl(link));
    }
  }
  return [...new Set(urlList)].filter(
    (u) => !u.includes("404") && !u.includes("admin") && !u.endsWith(".txt")
  );
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
  const validationUrl = `https://${siteHost()}/${BING_KEY}.txt`;
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

  const validationOk = await waitForValidationFile();
  const keyUrl = `https://${siteHost()}/${BING_KEY}.txt`;
  try {
    const keyBody = await new Promise((resolve, reject) => {
      https
        .get(keyUrl, (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => resolve({ code: res.statusCode, data: data.trim() }));
        })
        .on("error", reject);
    });
    if (keyBody.code !== 200) {
      console.error(`验证文件不可访问: ${keyUrl} (HTTP ${keyBody.code})`);
      process.exit(1);
    }
    if (keyBody.data !== BING_KEY) {
      const hint =
        keyBody.data.length > 200 || /^<!DOCTYPE|<html/i.test(keyBody.data)
          ? "\n原因：该 URL 返回的是 HTML 首页，不是密钥文件。请在 Cloudflare Pages 环境变量添加 INDEXNOW_KEY，重新部署后确认 txt 只有 32 位字符。"
          : "";
      console.error(
        `验证文件内容必须与 INDEXNOW_KEY 完全一致。\n` +
          `当前文件长度 ${keyBody.data.length}，密钥长度 ${BING_KEY.length}` +
          hint
      );
      process.exit(1);
    }
    console.log("验证文件内容与密钥一致");
  } catch (e) {
    console.error(`无法读取验证文件 ${keyUrl}: ${e.message}`);
    process.exit(1);
  }

  if (!validationOk) {
    console.log("提示: 验证文件探测曾超时，若推送 403 请在 Bing 站长工具完成站点验证");
  }

  let urlList;

  if (PUSH_NEW_ONLY) {
    const today = todayDateString();
    console.log(`PUSH_NEW_ONLY 模式：仅推送 ${today} 新发文`);
    const permalinks = collectNewOnlyPermalinks();
    if (permalinks.length === 0) {
      console.log("今日无新文章 URL，跳过 IndexNow 推送");
      process.exit(0);
    }
    urlList = resolveUrlListFromPermalinks(permalinks);
    console.log(`识别到 ${permalinks.length} 篇新文，将推送 ${urlList.length} 个 URL：`);
    urlList.forEach((u) => console.log(`  - ${u}`));
  } else {
    const htmlFiles = getAllHtmlFiles(OUTPUT_DIR);
    urlList = [...new Set(htmlFiles.map((f) => normalizeUrl(toPublicUrl(f))))].filter(
      (url) =>
        !url.includes("404") &&
        !url.includes("admin") &&
        !url.endsWith(".txt")
    );
    console.log(`全站模式：正在推送 ${urlList.length} 个 URL 到 IndexNow...`);
  }

  if (urlList.length === 0) {
    console.log("无有效 URL，跳过推送");
    process.exit(0);
  }

  if (PUSH_NEW_ONLY) {
    console.log(`正在推送 ${urlList.length} 个新文 URL 到 IndexNow...`);
  }

  const hosts = hostVariants();
  let lastStatus = 0;
  let lastBody = "";

  for (const host of hosts) {
    let keyOk = false;
    try {
      const keyBody = await fetchKeyFile(host);
      keyOk =
        keyBody.code === 200 &&
        keyBody.data === BING_KEY &&
        keyBody.data.length < 100;
      if (!keyOk && hosts.length > 1) {
        console.log(
          `host=${host} 验证文件不可用或内容不符 (HTTP ${keyBody.code})，跳过该 host`
        );
        continue;
      }
    } catch (e) {
      if (hosts.length > 1) {
        console.log(`host=${host} 无法读取验证文件: ${e.message}，跳过`);
        continue;
      }
    }

    const hostUrls = rewriteUrlsForHost(urlList, host);
    const payload = {
      host,
      key: BING_KEY,
      keyLocation: `https://${host}/${BING_KEY}.txt`,
      urlList: hostUrls
    };

    console.log(
      `IndexNow 请求: host=${host}, keyLocation=${payload.keyLocation}, URLs=${hostUrls.length}`
    );

    const { statusCode, body } = await postIndexNow(payload);
    lastStatus = statusCode;
    lastBody = body;

    if (statusCode === 200 || statusCode === 202) {
      console.log(`IndexNow 接收成功 (host=${host})，状态码: ${statusCode}`);
      if (PUSH_NEW_ONLY && fs.existsSync(MANIFEST)) {
        fs.unlinkSync(MANIFEST);
        console.log("已清除本次待推送清单");
      }
      if (host !== siteHost()) {
        console.log(
          `提示: 推送成功使用的是 host=${host}，请将 SITE_DOMAIN 或 INDEXNOW_HOST 改为该值以固定配置`
        );
      }
      process.exit(0);
    }

    if (statusCode === 403) {
      console.log(`host=${host} 返回 403，${hosts.length > 1 ? "尝试下一 host..." : ""}`);
    } else {
      console.error(`推送失败 (host=${host})，状态码: ${statusCode}，响应: ${body}`);
      process.exit(1);
    }
  }

  console.error(`推送失败，状态码: ${lastStatus}，响应: ${lastBody}`);
  if (lastStatus === 403) {
    print403Help(siteHost());
  }
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
