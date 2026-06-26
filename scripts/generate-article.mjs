#!/usr/bin/env node
/**
 * Gemini 自动发文脚本
 * 用法:
 *   GEMINI_API_KEY=xxx node scripts/generate-article.mjs
 *   node scripts/generate-article.mjs --count=3
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenerativeAI } from "@google/generative-ai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const postsDir = path.join(__dirname, "../src/posts");
const indexNowManifest = path.join(__dirname, ".indexnow-pending.json");

const TAG_POOL = [
  "快连下载", "Windows", "macOS", "Android", "iOS", "安装教程", "连接",
  "节点", "延迟", "更新", "排错", "账号", "隐私", "企业", "平板", "游戏"
];
const CATEGORY_POOL = ["使用教程", "版本动态", "常见问题", "资源百科"];
const BANNED_PATTERNS = [
  /seo/gi,
  /关键词/g,
  /优化/g,
  /排名/g,
  /收录/g,
  /曝光/g,
  /爬虫/g,
  /算法/g,
  /综上所述/g,
  /毋庸置疑/g,
  /在当今数字化时代/g,
  /在当今[^，。]*时代/g,
  /随着[^，。]*的快速发展/g,
  /业界领先/g,
  /全方位/g,
  /深度融合/g,
  /极致/g
];

function parseArgs() {
  const countArg = process.argv.find((a) => a.startsWith("--count="));
  const positional = process.argv[2];
  let count = countArg
    ? parseInt(countArg.split("=")[1], 10)
    : positional && !positional.startsWith("-")
      ? parseInt(positional, 10)
      : 1;
  if (Number.isNaN(count) || count < 1) count = 1;
  if (count > 9) count = 9;
  return count;
}

function slugify(str) {
  const base =
    String(str)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/[\u4e00-\u9fff]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "kuailian";
  return `${base}-${Date.now().toString(36)}`;
}

function pickTags(n = 3) {
  const shuffled = [...TAG_POOL].sort(() => Math.random() - 0.5);
  const tags = new Set(["快连下载"]);
  for (const t of shuffled) {
    if (tags.size >= n) break;
    tags.add(t);
  }
  return [...tags];
}

function imgUrl(q) {
  return `https://tse-mm.bing.com/th?q=${encodeURIComponent(q)}`;
}

function cleanText(value) {
  let text = String(value || "");
  for (const pattern of BANNED_PATTERNS) {
    text = text.replace(pattern, "");
  }
  return text.trim();
}

function stripJsonFence(value) {
  return String(value || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractJsonObject(value) {
  const text = stripJsonFence(value);
  const start = text.indexOf("{");
  if (start === -1) return text;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (depth === 0) return text.slice(start, i + 1);
  }

  return text.slice(start);
}

function normalizeJsonText(value) {
  return extractJsonObject(value)
    .replace(/^\uFEFF/, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1");
}

function isEscaped(value, index) {
  let count = 0;
  for (let i = index - 1; i >= 0 && value[i] === "\\"; i -= 1) {
    count += 1;
  }
  return count % 2 === 1;
}

function decodeLooseJsonString(value) {
  const escapedQuotes = String(value || "")
    .replace(/[\u0000-\u001f]/g, (ch) => {
      if (ch === "\n") return "\\n";
      if (ch === "\r") return "\\r";
      if (ch === "\t") return "\\t";
      return "";
    })
    .replace(/"/g, (match, offset, input) => (isEscaped(input, offset) ? match : '\\"'));
  return JSON.parse(`"${escapedQuotes}"`);
}

function parseLooseArticleJson(value) {
  const json = normalizeJsonText(value);
  const fields = ["title", "description", "imageKeyword1", "imageKeyword2", "bodyMarkdown"];
  const parsed = {};

  for (const field of fields) {
    const nextFields = fields.filter((item) => item !== field).join("|");
    const pattern = new RegExp(`"${field}"\\s*:\\s*"([\\s\\S]*?)"\\s*(?=,\\s*"(${nextFields})"\\s*:|\\s*})`);
    const match = json.match(pattern);
    if (!match) return null;
    try {
      parsed[field] = decodeLooseJsonString(match[1]);
    } catch {
      return null;
    }
  }

  return parsed;
}

function parseArticleJson(value) {
  const json = normalizeJsonText(value);
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    parsed = parseLooseArticleJson(json);
    if (!parsed) {
      const preview = json.slice(0, 600);
      throw new Error(`Gemini returned invalid JSON: ${error.message}\nJSON preview: ${preview}`);
    }
  }
  return {
    title: cleanText(parsed.title),
    description: cleanText(parsed.description),
    bodyMarkdown: cleanText(parsed.bodyMarkdown),
    imageKeyword1: cleanText(parsed.imageKeyword1),
    imageKeyword2: cleanText(parsed.imageKeyword2)
  };
}

async function generateOne(genAI) {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      responseMimeType: "application/json"
    }
  });
  const category = CATEGORY_POOL[Math.floor(Math.random() * CATEGORY_POOL.length)];
  const tags = pickTags(3 + Math.floor(Math.random() * 2));

  const prompt = `【角色】你是某技术博客的兼职作者，给普通用户写实操帖，不是写白皮书。

请写一篇关于「快连下载」的中文原创文章，适合发布在客户端下载指南网站。

要求：
1. 标题自然包含「快连下载」，15-30字，像博客标题，不要「XXX技术白皮书」「XXX完整指南」这种官腔
2. 正文 800-1500 字，段落长短错落，使用 Markdown，只用 ##/###，不要 h1
3. 内容围绕：${category}，并延伸快连下载相关场景
4. 正文必须包含：一个具体版本号或日期、至少3步操作步骤、一个「常见问题」小节、至少一段第一人称（如「我测试时发现…」「上周升级后…」）
5. 随机选一种结构：
   A. 教程型（步骤+截图描述）
   B. 评测型（3个维度打分+表格感描述）
   C. 问答型（5个FAQ）
   D. 快讯型（短，300-600字）
6. 禁止出现：seo、关键词、优化、排名、收录、曝光、爬虫、算法、综上所述、毋庸置疑、在当今数字化时代、业界领先、全方位、深度融合、极致
7. 禁止外链，文末延伸阅读只用站内链接文字：快连下载教程大全(/blog/)、快连官方下载中心(/download.html)、快连下载首页(/)
8. 提供 description 字段 80-120 字
9. 提供 imageKeyword1 和 imageKeyword2（用于配图，各 4-8 字，与快连下载相关）
10. 只输出 JSON，格式：
{"title":"","description":"","imageKeyword1":"","imageKeyword2":"","bodyMarkdown":"## 小节\\n\\n段落..."}
11. JSON 字段值内部不要使用英文双引号 "，需要强调时改用中文引号或书名号

bodyMarkdown 中在合适位置插入两行图片占位：
![描述](IMAGE1)
![描述](IMAGE2)
不要写其他字段。`;

  const result = await model.generateContent(prompt);
  const draft = parseArticleJson(result.response.text());

  const polishPrompt = `把下面文章改写成贴吧/知乎网友风格，输出 strict JSON only，字段仍然是 title, description, imageKeyword1, imageKeyword2, bodyMarkdown。

要求：
- 缩短约20%官话，加1-2处自然口语，保留技术信息，随机替换部分连接词
- 删掉「在当今」「随着…的快速发展」这类开头
- 标题像博客标题，不要「XXX技术白皮书」「XXX完整指南」这种官腔
- 正文必须包含：一个具体版本号或日期、至少3步操作步骤、一个「常见问题」小节
- 至少一段用第一人称（「我测试时发现…」「上周升级后…」）
- 禁止用词：综上所述、毋庸置疑、在当今数字化时代、业界领先、全方位、深度融合、极致
- 结构保留或随机调整为：教程型、评测型、问答型、快讯型之一
- 长度 800-1500 字，段落长短错落，不要每段都3-4句
- 保留 IMAGE1 和 IMAGE2 图片占位，不要新增外链
- JSON 字段值内部不要使用英文双引号 "，需要强调时改用中文引号或书名号

输入 JSON：
${JSON.stringify(draft)}`;

  const polishedResult = await model.generateContent(polishPrompt);
  const data = parseArticleJson(polishedResult.response.text());

  const img1 = data.imageKeyword1 || "快连下载 教程";
  const img2 = data.imageKeyword2 || "快连下载 客户端";
  let body = data.bodyMarkdown
    .replace("IMAGE1", imgUrl(img1))
    .replace("IMAGE2", imgUrl(img2));

  if (!body.includes("![")) {
    body = `![${img1}](${imgUrl(img1)})\n\n${body}\n\n![${img2}](${imgUrl(img2)})`;
  }

  const title = data.title.includes("快连下载") ? data.title : `快连下载：${data.title}`;
  const description = data.description || `${title} 的实操记录，包含版本、步骤和常见问题。`;
  const slug = slugify(title);
  const date = new Date().toISOString().slice(0, 10);
  const fm = `---
layout: layouts/post.njk
title: ${title.replace(/"/g, '\\"')}
description: ${description.replace(/"/g, '\\"')}
category: ${category}
tags:
${tags.map((t) => `  - ${t}`).join("\n")}
date: ${date}
permalink: /posts/${slug}/
autoGenerated: true
---

${body}
`;

  const file = path.join(postsDir, `${slug}.md`);
  fs.mkdirSync(postsDir, { recursive: true });
  fs.writeFileSync(file, fm, "utf8");
  return { file, permalink: `/posts/${slug}/`, date };
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("请设置环境变量 GEMINI_API_KEY");
    process.exit(1);
  }
  const count = parseArgs();
  const genAI = new GoogleGenerativeAI(apiKey);
  const created = [];
  for (let i = 0; i < count; i++) {
    console.log(`生成第 ${i + 1}/${count} 篇...`);
    created.push(await generateOne(genAI));
    if (i < count - 1) await new Promise((r) => setTimeout(r, 2000));
  }

  const today = new Date().toISOString().slice(0, 10);
  let manifest = { date: today, permalinks: [] };
  if (fs.existsSync(indexNowManifest)) {
    try {
      const old = JSON.parse(fs.readFileSync(indexNowManifest, "utf8"));
      if (old.date === today && Array.isArray(old.permalinks)) {
        manifest.permalinks = old.permalinks;
      }
    } catch {}
  }
  for (const item of created) {
    if (!manifest.permalinks.includes(item.permalink)) {
      manifest.permalinks.push(item.permalink);
    }
  }
  fs.writeFileSync(indexNowManifest, JSON.stringify(manifest, null, 2), "utf8");
  console.log("IndexNow 待推送:", manifest.permalinks.join(", "));
  console.log(
    "完成:",
    created.map((x) => x.file).join("\n")
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
