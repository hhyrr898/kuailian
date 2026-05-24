#!/usr/bin/env node
/**
 * 批量初始化文章（首次部署用）
 * node scripts/seed-posts.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const postsDir = path.join(__dirname, "../src/posts");

const posts = [
  { slug: "windows-kuailian-download", title: "Windows 版快连下载安装全流程", category: "使用教程", tags: ["快连下载", "Windows", "安装教程"], img: "快连下载 Windows 安装" },
  { slug: "macos-kuailian-download", title: "macOS 版快连下载与权限配置", category: "使用教程", tags: ["快连下载", "macOS", "安装教程"], img: "快连下载 macOS 安装" },
  { slug: "android-kuailian-download", title: "Android 版快连下载与安装", category: "使用教程", tags: ["快连下载", "Android", "移动端"], img: "快连下载 Android 安装" },
  { slug: "ios-kuailian-download", title: "iOS 版快连下载与描述文件", category: "使用教程", tags: ["快连下载", "iOS", "移动端"], img: "快连下载 iOS 配置" },
  { slug: "first-connect-checklist", title: "快连下载后首次连接检查清单", category: "使用教程", tags: ["快连下载", "连接", "入门"], img: "快连下载 首次连接" },
  { slug: "error-codes-guide", title: "快连下载常见报错代码说明", category: "常见问题", tags: ["快连下载", "报错", "排错"], img: "快连下载 错误提示" },
  { slug: "home-network-tips", title: "家庭宽带下的快连下载体验", category: "资源百科", tags: ["快连下载", "家庭网络", "路由器"], img: "快连下载 家庭宽带" },
  { slug: "office-network-deploy", title: "办公网络快连下载部署建议", category: "资源百科", tags: ["快连下载", "办公", "企业"], img: "快连下载 办公网络" },
  { slug: "multi-device-login", title: "快连下载后多设备同时在线", category: "使用教程", tags: ["快连下载", "多设备", "账号"], img: "快连下载 多设备" },
  { slug: "battery-data-usage", title: "快连下载流量与电量消耗", category: "资源百科", tags: ["快连下载", "电量", "Android"], img: "快连下载 省电" },
  { slug: "cannot-open-fix", title: "快连下载无法打开解决方案", category: "常见问题", tags: ["快连下载", "无法打开", "排错"], img: "快连下载 修复" },
  { slug: "upgrade-migration", title: "快连下载更新后配置迁移", category: "版本动态", tags: ["快连下载", "更新", "迁移"], img: "快连下载 升级" },
  { slug: "tablet-experience", title: "平板设备快连下载横屏体验", category: "使用教程", tags: ["快连下载", "平板", "iPad"], img: "快连下载 平板" },
  { slug: "node-selection", title: "快连下载节点选择入门", category: "使用教程", tags: ["快连下载", "节点", "延迟"], img: "快连下载 节点选择" },
  { slug: "log-export", title: "快连下载日志导出与分析", category: "常见问题", tags: ["快连下载", "日志", "反馈"], img: "快连下载 日志" },
  { slug: "privacy-local-data", title: "快连下载隐私与本地数据", category: "资源百科", tags: ["快连下载", "隐私", "数据"], img: "快连下载 隐私" },
  { slug: "gaming-latency", title: "游戏场景快连下载延迟", category: "资源百科", tags: ["快连下载", "游戏", "延迟"], img: "快连下载 游戏加速" },
  { slug: "streaming-tips", title: "视频流媒体快连下载体验", category: "资源百科", tags: ["快连下载", "视频", "流媒体"], img: "快连下载 视频" },
  { slug: "uninstall-clean", title: "快连下载卸载与残留清理", category: "常见问题", tags: ["快连下载", "卸载", "清理"], img: "快连下载 卸载" },
  { slug: "account-security", title: "快连下载账号安全建议", category: "常见问题", tags: ["快连下载", "账号", "安全"], img: "快连下载 账号安全" },
  { slug: "auto-reconnect", title: "快连下载夜间自动重连", category: "使用教程", tags: ["快连下载", "重连", "休眠"], img: "快连下载 自动重连" },
  { slug: "split-rules-intro", title: "快连下载分应用规则简介", category: "资源百科", tags: ["快连下载", "分流", "规则"], img: "快连下载 分流" },
  { slug: "enterprise-deploy", title: "快连下载企业批量部署思路", category: "资源百科", tags: ["快连下载", "企业", "部署"], img: "快连下载 企业部署" }
];

const imgUrl = (q) => `https://tse-mm.bing.com/th?q=${encodeURIComponent(q)}`;

function body(post) {
  return `本文围绕 **${post.title}** 展开，帮助用户在完成快连下载后快速上手并解决常见疑问。

![${post.img}](${imgUrl(post.img)})

## 适用场景

无论您是首次接触快连下载，还是需要在新的设备上重新安装，本文提供的步骤均基于常见使用环境整理，便于对照操作。

## 操作要点

1. 前往本站 [下载中心](/download.html) 确认与您设备匹配的平台版本。  
2. 按照页面说明完成安装或配置，注意系统权限提示。  
3. 首次启动后检查网络连接与账号登录状态。  
4. 若遇异常，可参考 [博客列表](/blog/) 中的同类教程。

## 细节说明

在实际使用中，网络环境、系统版本与设备性能都会影响体验。建议在快连下载完成后，先使用默认推荐设置进行连接测试，再根据个人需求调整节点或分流规则。

对于 ${post.category} 类问题，保持客户端为最新稳定版本往往能解决大部分兼容性问题。若问题持续，可尝试重启设备、切换网络或导出日志以便进一步排查。

## 延伸阅读

- [快连下载教程大全](/blog/)  
- [快连官方下载中心](/download.html)  
- [快连下载首页](/)

> 以上内容基于公开资料与用户反馈整理，仅供学习交流。`;
}

fs.mkdirSync(postsDir, { recursive: true });
let day = 1;
for (const p of posts) {
  const date = `2026-05-${String(day).padStart(2, "0")}`;
  day = Math.min(day + 1, 23);
  const fm = `---
layout: layouts/post.njk
title: ${p.title}
description: ${p.title}详细说明，涵盖快连下载后的配置步骤与注意事项。
category: ${p.category}
tags:
${p.tags.map((t) => `  - ${t}`).join("\n")}
date: ${date}
permalink: /posts/${p.slug}/
---

${body(p)}
`;
  fs.writeFileSync(path.join(postsDir, `${p.slug}.md`), fm, "utf8");
}
console.log(`已生成 ${posts.length} 篇文章`);
