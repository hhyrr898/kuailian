const fs = require("fs");
const path = require("path");
const SYSTEM_TAGS = new Set(["posts", "all", "post", "blog"]);
const siteData = require("./src/_data/site.json");

function resolveSiteUrl() {
  const raw = process.env.SITE_DOMAIN || siteData.domain || "your-domain.com";
  const host = String(raw).replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${host}`;
}

module.exports = function (eleventyConfig) {
  eleventyConfig.addGlobalData("siteUrl", resolveSiteUrl());
  eleventyConfig.ignores.add("src/dows.html");

  eleventyConfig.on("eleventy.after", () => {
    const key = process.env.INDEXNOW_KEY;
    if (!key) return;
    const outDir = path.join(__dirname, "_site");
    fs.writeFileSync(path.join(outDir, `${key}.txt`), key, "utf8");
  });

  eleventyConfig.addPassthroughCopy("src/css");
  eleventyConfig.addPassthroughCopy("src/images");
  eleventyConfig.addPassthroughCopy({ "src/favicon.ico": "favicon.ico" });
  eleventyConfig.addPassthroughCopy("src/robots.txt");
  eleventyConfig.addPassthroughCopy({ "src/dows.html": "dows.html" });
  eleventyConfig.addPassthroughCopy({ "src/*.txt": "/" });

  eleventyConfig.addCollection("posts", (api) =>
    api.getFilteredByGlob("src/posts/*.md").sort((a, b) => b.date - a.date)
  );

  eleventyConfig.addCollection("categories", (api) => {
    const map = new Map();
    api.getFilteredByGlob("src/posts/*.md").forEach((item) => {
      const cat = item.data.category || "资源动态";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat).push(item);
    });
    return [...map.entries()].map(([name, items]) => ({ name, items }));
  });

  eleventyConfig.addCollection("tagList", (api) => {
    const set = new Set();
    api.getFilteredByGlob("src/posts/*.md").forEach((item) => {
      (item.data.tags || [])
        .filter((t) => t && !SYSTEM_TAGS.has(String(t).toLowerCase()))
        .forEach((t) => set.add(String(t)));
    });
    return [...set].sort();
  });

  eleventyConfig.addFilter("yearNow", () => new Date().getFullYear());

  eleventyConfig.addFilter("dateZh", (v) => {
    if (!v) return "";
    const d = v instanceof Date ? v : new Date(v);
    return d.toISOString().slice(0, 10);
  });

  eleventyConfig.addFilter("bingImg", (q) =>
    `https://tse-mm.bing.com/th?q=${encodeURIComponent(q)}`
  );

  eleventyConfig.addFilter("slug", (str) =>
    String(str || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^\w\u4e00-\u9fff-]/g, "")
  );

  return {
    dir: {
      input: "src",
      includes: "_includes",
      data: "_data",
      output: "_site"
    },
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
    templateFormats: ["md", "njk", "html", "11ty.js"]
  };
};
