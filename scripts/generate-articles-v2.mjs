/**
 * generate-articles-v2.mjs — 统一文章生成器（五站通用）
 * 由 scripts/site-config.json 驱动：
 * { brand, product, locale, blogDir, slugPrefix, keywordsPath, linkPool[],
 *   fm: { layout, hasCategory, tagsStyle: "json"|"yaml", permalink, coverKey: "cover"|"heroImage"|null, coverDir },
 *   minChars, maxChars }
 * 优先级：DeepSeek 正文 → 校验 → OpenRouter 重写开头 200 字 → Gemini 兜底
 * 选题：keywords.json 队列消费；slug：模型给英文 slug，不合格回退日期 slug
 * 图片：自动生成本地 SVG 封面（替代 Bing 热链）
 */
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const cfgPath = path.join(root, "scripts", "site-config.json");
const cfg = JSON.parse(await fs.readFile(cfgPath, "utf-8"));

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "z-ai/glm-4.6";
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";

const MAX_ATTEMPTS = 5;
const blogDir = path.join(root, cfg.blogDir);

const bannedPatterns = [
  /seo/gi, /关键词/g, /排名/g, /收录/g, /曝光/g,
  /综上所述/g, /毋庸置疑/g, /在当今数字化时代/g, /业界领先/g,
  /全方位/g, /深度融合/g, /极致/g, /深入探讨/g, /详细介绍/g,
  /全面解析/g, /助力您/g, /显著提升/g, /至关重要/g, /完美支持/g
];
const bannedTitlePatterns = [/白皮书/, /完整指南/, /全面指南/, /深度解析/, /技术详解/, /实用指南$/, /高效.*指南/];

function today() {
  return new Date().toISOString().slice(0, 10);
}
function getCount() {
  const arg = process.argv.find((a) => a.startsWith("--count="));
  const raw = arg ? arg.split("=")[1] : process.env.GENERATE_COUNT || "1";
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > 9) throw new Error("Count must be 1-9");
  return n;
}
function cleanText(t) {
  let s = String(t || "");
  for (const p of bannedPatterns) s = s.replace(p, "");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}
function countChineseChars(t) {
  return (String(t || "").match(/[\u4e00-\u9fa5]/g) || []).length;
}
function hasVersionOrDate(t) {
  return /\d+\.\d+(\.\d+)?/.test(t) || /20\d{2}[-年/]\d{1,2}/.test(t) || /Windows\s*(10|11)/i.test(t) || /macOS/i.test(t);
}
function hasSteps(t) {
  return ((t.match(/第[一二三四五六七八九十\d]+步/g) || []).length + (t.match(/^\s*\d+\.\s+/gm) || []).length) >= 3;
}
function hasFaq(t) {
  return /##\s*常见问题/.test(t);
}
function hasFirstPerson(t) {
  return /我[^们]|上周|昨天|前几天|测试时|实测/.test(t);
}
function titleOk(t) {
  return !bannedTitlePatterns.some((p) => p.test(t)) && t.length <= 42;
}
function validateArticle({ title, body }) {
  const issues = [];
  const n = countChineseChars(body);
  if (!titleOk(title)) issues.push("标题太官腔或过长");
  if (n < cfg.minChars || n > cfg.maxChars) issues.push(`正文字数 ${n}，应在 ${cfg.minChars}-${cfg.maxChars} 之间`);
  if (!hasVersionOrDate(body)) issues.push("正文缺少具体版本号或日期");
  if (!hasSteps(body)) issues.push("正文缺少至少 3 个操作步骤");
  if (!hasFaq(body)) issues.push("缺少「## 常见问题」小节");
  if (!hasFirstPerson(body)) issues.push("缺少第一人称叙述");
  for (const p of bannedPatterns) if (p.test(body) || p.test(title)) issues.push("含有禁用词：" + p);
  return issues;
}

function buildPrompt(topic, retryNote) {
  const links = cfg.linkPool.length ? `\n【内链要求】正文里自然插入 2-4 条站内链接，只能从这些真实页面里按主题相关选（锚文本自然，别堆砌）：\n${cfg.linkPool.map((u) => "- " + u).join("\n")}` : "";
  return [
    `你是技术博客的兼职作者，给普通用户写实操帖。写一篇关于 ${cfg.brand} 的原创简体中文（zh-CN）markdown 文章。`,
    `只返回严格 JSON，字段：title, description, slug, category, body。`,
    "",
    "【标题】",
    `- 必须以 ${cfg.brand} 开头，像博客标题（例如「${cfg.brand} 连不上服务器？我试了这三种办法」）。`,
    "- 禁止：白皮书、完整指南、全面指南、深度解析、技术详解 这类官腔标题。",
    "",
    "【slug】",
    "- 把主题翻译成纯小写英文短语，单词用连字符分隔（例如 " + cfg.slugPrefix + "-getting-started）。",
    "- 只用 a-z、0-9 和连字符，不超过 8 个单词，禁止中文。",
    "",
    `【正文】本次为实操教程型，中文字数（仅计汉字）必须 ${cfg.minChars}-${cfg.maxChars}：`,
    "- 只用 h2/h3，不要 h1。",
    "- 必须包含：①一个具体版本号或日期 ②至少 3 步带序号操作 ③「## 常见问题」小节。",
    "- 至少一段第一人称（如「我测试时发现…」）。",
    "- 段落长短错落。",
    "- 技术断言只允许基于该软件官方公开信息，严禁编造版本与功能；不确定的写「以官方文档为准」。",
    "- 禁止用词：综上所述、毋庸置疑、在当今数字化时代、业界领先、全方位、深度融合、极致。",
    "- 禁止：seo、关键词、排名、收录。不要外链，不要促销话术。",
    links,
    `【主题方向】${topic}`,
    "",
    "【description】80-120 字，像搜索摘要，直接说能帮读者解决什么。"
  ].join("\n") + (retryNote || "");
}

async function chatDeepSeek(prompt) {
  const resp = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${DEEPSEEK_KEY}` },
    body: JSON.stringify({ model: DEEPSEEK_MODEL, messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" } })
  });
  if (!resp.ok) throw new Error(`DeepSeek ${resp.status}: ${(await resp.text()).slice(0, 180)}`);
  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("DeepSeek 返回内容为空");
  return text;
}

async function chatGemini(prompt) {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });
  const r = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt });
  if (!r?.text) throw new Error("Gemini 返回内容为空");
  return r.text;
}

async function generateJson(prompt) {
  if (DEEPSEEK_KEY) {
    for (let i = 1; i <= 2; i++) {
      try { return JSON.parse((await chatDeepSeek(prompt)).replace(/^```json\s*|```$/g, "").trim()); }
      catch (e) { console.warn(`DeepSeek 尝试 ${i} 失败: ${e.message}`); }
    }
    if (!GEMINI_KEY) throw new Error("DeepSeek 两次失败且无 Gemini 兜底");
    console.warn("DeepSeek 失败，回退 Gemini");
  }
  return JSON.parse((await chatGemini(prompt)).replace(/^```json\s*|```$/g, "").trim());
}

function buildOpeningPrompt(title, body) {
  const paras = String(body || "").split(/\n\s*\n/);
  return [
    `你是资深技术编辑。为文章《${title}》重写开头两段（合计 150-220 字），要求：`,
    "1. 第一句必须含具体对象＋具体数字/日期/版本（只能使用原文已有的信息，严禁编造新数据）。",
    "2. 第二句直接说明「这篇文章解决什么问题、看完能做到什么」。",
    "3. 禁止：综上所述、在当今数字化时代、随着AI的发展、任何感叹号、空话套话。",
    `4. 使用${cfg.locale === "zh-HK" ? "香港繁體中文（zh-HK）" : "简体中文（zh-CN）"}，语气像博客作者。`,
    "只输出重写后的两段正文，不要标题、不要解释。",
    "",
    "原文开头：",
    paras.slice(0, 2).join("\n\n")
  ].join("\n");
}

function spliceOpening(body, newOpening) {
  const paras = String(body || "").split(/\n\s*\n/);
  return newOpening + (paras.slice(2).length ? "\n\n" + paras.slice(2).join("\n\n") : "");
}

async function rewriteOpening(title, body) {
  if (OPENROUTER_KEY) {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENROUTER_KEY}` },
      body: JSON.stringify({ model: OPENROUTER_MODEL, max_tokens: 3000, messages: [{ role: "user", content: buildOpeningPrompt(title, body) }] })
    });
    if (!resp.ok) throw new Error(`OpenRouter ${resp.status}`);
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text || text.length < 60) throw new Error("开头重写结果过短");
    return spliceOpening(body, text.trim());
  }
  if (GEMINI_KEY) {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });
    const r = await ai.models.generateContent({ model: "gemini-2.5-pro", contents: buildOpeningPrompt(title, body) });
    const text = (r?.text || "").trim();
    if (text.length < 60) throw new Error("Gemini Pro 开头过短");
    return spliceOpening(body, text.trim());
  }
  throw new Error("无可用重写通道");
}

function escYaml(v) {
  return String(v || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
}

function writeCover(slug, title) {
  if (!cfg.fm.coverKey) return null;
  const dir = path.join(root, "src", "static", "posts");
  const rel = (cfg.fm.coverDir || "/static/posts/") + slug + "-cover.svg";
  const safeTitle = String(title).replace(/[<>&]/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="560" viewBox="0 0 960 560">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e3a8a"/><stop offset="1" stop-color="#3b82f6"/></linearGradient></defs>
<rect width="960" height="560" fill="url(#g)"/>
<text x="60" y="120" fill="#bfdbfe" font-size="34" font-family="sans-serif">${cfg.brand} 教程</text>
<text x="60" y="300" fill="#ffffff" font-size="52" font-weight="bold" font-family="sans-serif">${safeTitle}</text>
<text x="60" y="480" fill="#93c5fd" font-size="24" font-family="sans-serif">${cfg.domain} · 实操指南</text>
</svg>`;
  return fs.writeFile(path.join(root, "src", "static", "posts", slug + "-cover.svg"), svg, "utf-8").then(() => rel).catch(() => null);
}

function frontMatter(a, coverRel) {
  const tags = cfg.fm.tagsStyle === "yaml"
    ? a.tags.map((t) => "  - " + t).join("\n")
    : JSON.stringify(a.tags);
  const lines = ["---", `layout: ${cfg.fm.layout}`, `title: "${escYaml(a.title)}"`, `description: "${escYaml(a.description)}"`, `date: ${a.date}`];
  if (cfg.fm.hasCategory) lines.push(`category: "${escYaml(a.category)}"`);
  if (cfg.fm.tagsStyle === "yaml") lines.push("tags:", tags); else lines.push(`tags: ${tags}`);
  if (coverRel && cfg.fm.coverKey) lines.push(`${cfg.fm.coverKey}: "${coverRel}"`, `${cfg.fm.coverKey === "heroImage" ? "heroAlt" : "coverAlt"}: "${escYaml(a.title)} 封面图"`);
  if (cfg.fm.permalink) lines.push(`permalink: /${cfg.blogDir.replace(/^src\//, "")}/${a.slug}/`);
  lines.push("generated: true", "---", "", a.body, "");
  return lines.join("\n");
}

async function main() {
  if (!DEEPSEEK_KEY && !GEMINI_KEY) throw new Error("需要 DEEPSEEK_API_KEY 或 GEMINI_API_KEY");
  const count = getCount();

  let keywords = [];
  try {
    keywords = JSON.parse(await fs.readFile(path.join(root, cfg.keywordsPath), "utf-8"));
  } catch (e) {
    console.warn("读取词库失败:", e.message);
  }
  if (!Array.isArray(keywords)) keywords = [];

  const urls = [];
  for (let i = 0; i < count; i += 1) {
    const topic = keywords.length > 0 ? String(keywords.shift()) : `${cfg.brand} 常见问题排查 ${today()}-${i}`;
    console.log(`本篇选题: ${topic}`);
    const date = today();
    let parsed = null, title = "", body = "", lastIssues = [];
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const retryNote = attempt > 0 ? `\n\n上次生成不合格，请修正：${lastIssues.join("；")}。重新输出完整 JSON。` : "";
      try {
        parsed = await generateJson(buildPrompt(topic, retryNote));
      } catch (e) {
        console.warn("生成请求失败:", e.message);
        continue;
      }
      title = cleanText(parsed.title || topic);
      if (!title.startsWith(cfg.brand)) title = `${cfg.brand} ${title}`;
      body = cleanText(parsed.body || "");
      lastIssues = validateArticle({ title, body });
      if (lastIssues.length === 0) break;
      console.warn(`校验未过(${attempt + 1}/${MAX_ATTEMPTS}):`, lastIssues.join("；"));
    }
    if (lastIssues.length > 0) {
      console.error(`第 ${i + 1} 篇 ${MAX_ATTEMPTS} 次未达标，跳过（选题退回词库）`);
      keywords.unshift(topic);
      continue;
    }
    if (OPENROUTER_KEY || GEMINI_KEY) {
      try {
        const nb = await rewriteOpening(title, body);
        if (validateArticle({ title, body: nb }).length === 0) {
          body = nb;
          console.log("✅ 开头已重写并通过校验");
        } else console.warn("开头重写后校验未过，保留原文");
      } catch (e) {
        console.warn("开头重写失败，保留原文:", e.message);
      }
    }
    const slugEn = String(parsed.slug || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "");
    const slug = (slugEn && /[a-z]/.test(slugEn)) ? slugEn : `${cfg.slugPrefix}-${Date.now()}-${i}`;
    const coverRel = await writeCover(slug, title);
    const article = {
      title,
      description: cleanText(parsed.description || "").slice(0, 120),
      date,
      category: cleanText(parsed.category || "使用教程"),
      tags: Array.isArray(parsed.tags) && parsed.tags.length ? parsed.tags.map((t) => String(t).slice(0, 12)).slice(0, 4) : ["教程"],
      slug,
      body
    };
    await fs.writeFile(path.join(blogDir, slug + ".md"), frontMatter(article, coverRel), "utf-8");
    urls.push(`/blog/${slug}/`);
    console.log(`✅ 已写入 ${slug}.md`);
  }

  if (keywords.length > 0) {
    await fs.writeFile(path.join(root, cfg.keywordsPath), JSON.stringify(keywords, null, 2), "utf-8");
    console.log(`词库剩余: ${keywords.length}`);
  }
  await fs.writeFile(path.join(root, ".generated-urls.json"), JSON.stringify({ urls }, null, 2), "utf-8");
  console.log(`Generated ${urls.length} article(s).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
