/**
 * 生成 sitemap.xml
 * 构建时可用环境变量 SITE_DOMAIN 覆盖站点域名
 */
module.exports = class {
  data() {
    return {
      permalink: "/sitemap.xml",
      eleventyExcludeFromCollections: true
    };
  }

  render(data) {
    const base = (data.siteUrl || "").replace(/\/$/, "");
    const posts = data.collections.posts || [];
    const tagList = data.collections.tagList || [];
    const lines = [];

    const push = (loc, lastmod, priority, changefreq) => {
      const esc = (s) =>
        String(s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
      lines.push("  <url>");
      lines.push(`    <loc>${esc(loc)}</loc>`);
      if (lastmod) lines.push(`    <lastmod>${lastmod}</lastmod>`);
      if (changefreq) lines.push(`    <changefreq>${changefreq}</changefreq>`);
      if (priority) lines.push(`    <priority>${priority}</priority>`);
      lines.push("  </url>");
    };

    const slug = (str) =>
      String(str || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^\w\u4e00-\u9fff-]/g, "");

    push(`${base}/`, null, "1.0", "daily");
    push(`${base}/blog/`, null, "0.9", "daily");
    push(`${base}/download.html`, null, "0.9", "weekly");
    push(`${base}/dows.html`, null, "0.8", "weekly");

    for (const post of posts) {
      const d = post.date instanceof Date ? post.date : new Date(post.date);
      const lastmod = isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
      const path = post.url.endsWith("/") ? post.url : `${post.url}/`;
      push(`${base}${path}`, lastmod, "0.7", "monthly");
    }

    for (const tag of tagList) {
      push(`${base}/tags/${slug(tag)}/`, null, "0.5", "weekly");
    }

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...lines,
      "</urlset>",
      ""
    ].join("\n");
  }
};
