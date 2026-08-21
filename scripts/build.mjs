import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";

const root = process.cwd();
const outDir = path.join(root, "public");
const siteTitle = "Grayson Shen的个人博客";
const siteTagline = "move fast and break things";
const siteUrl = "https://shen005.vercel.app";
const idAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789";

const newId = () => {
  const bytes = randomBytes(8);
  let id = "";
  for (let index = 0; index < 8; index += 1) {
    id += idAlphabet[bytes[index] % idAlphabet.length];
  }
  return id;
};

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const escapeXml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const stripEntities = (value) =>
  value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"');

const stripDatePrefix = (value = "") =>
  String(value).replace(/^(20\d{6}|20\d{2}年\d{1,2}月\d{1,2}日)\s*/, "");

const excerptFrom = (html, title) => {
  const paragraphs = [...html.matchAll(/<p>(.*?)<\/p>/g)]
    .map((match) => stripEntities(match[1]).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
    .filter((text) => text && text !== title && !/^(20\d{6}|\d{4}年\d{1,2}月\d{1,2}日)$/.test(text));
  const first = paragraphs[0] || title;
  return first.length > 80 ? `${first.slice(0, 80)}…` : first;
};

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = crcTable[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const pngChunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

const encodePng = (width, height, pixels) => {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([signature, pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
};

const makeOgImage = () => {
  const width = 1200;
  const height = 630;
  const pixels = Buffer.alloc(width * height * 4);
  const cx = width / 2;
  const cy = height / 2;
  const put = (x, y, color, alpha) => {
    const index = (Math.round(y) * width + Math.round(x)) * 4;
    if (index < 0 || index >= pixels.length) return;
    pixels[index] = Math.round(color[0] * alpha + pixels[index] * (1 - alpha));
    pixels[index + 1] = Math.round(color[1] * alpha + pixels[index + 1] * (1 - alpha));
    pixels[index + 2] = Math.round(color[2] * alpha + pixels[index + 2] * (1 - alpha));
    pixels[index + 3] = 255;
  };
  const ring = (radius, halfWidth, color) => {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const distance = Math.hypot(x - cx, y - cy);
        const coverage = Math.min(1, Math.max(0, halfWidth - Math.abs(distance - radius)));
        if (coverage > 0) put(x, y, color, coverage);
      }
    }
  };
  const segment = (x1, y1, x2, y2, halfWidth, color) => {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const t = Math.min(1, Math.max(0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
        const distance = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
        const coverage = Math.min(1, Math.max(0, halfWidth - distance));
        if (coverage > 0) put(x, y, color, coverage);
      }
    }
  };
  const dot = (radius, color) => {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const coverage = Math.min(1, radius - Math.hypot(x - cx, y - cy) + 0.5);
        if (coverage > 0) put(x, y, color, Math.min(1, coverage));
      }
    }
  };

  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 0x12;
    pixels[i + 1] = 0x12;
    pixels[i + 2] = 0x12;
    pixels[i + 3] = 255;
  }
  segment(cx, 100, cx, 190, 1.5, [0x3a, 0x38, 0x35]);
  segment(cx, 440, cx, 530, 1.5, [0x3a, 0x38, 0x35]);
  segment(100, cy, 190, cy, 1.5, [0x3a, 0x38, 0x35]);
  segment(1010, cy, 1100, cy, 1.5, [0x3a, 0x38, 0x35]);
  ring(150, 1.5, [0x3a, 0x38, 0x35]);
  ring(105, 1.5, [0xe8, 0xe6, 0xe3]);
  dot(5, [0xe8, 0xe6, 0xe3]);
  return encodePng(width, height, pixels);
};

const inlineMarkdown = (value = "") => {
  let html = escapeHtml(value);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');
  return html;
};

const titleFrom = (filename) => stripDatePrefix(path.basename(filename, ".md"));

const dateFrom = (filename, markdown, modifiedAt) => {
  const name = path.basename(filename, ".md");
  const compact = name.match(/(20\d{6})/);
  if (compact) return `${compact[1].slice(0, 4)}-${compact[1].slice(4, 6)}-${compact[1].slice(6, 8)}`;

  const zhDate = `${name}\n${markdown}`.match(/(20\d{2})年(\d{1,2})月(\d{1,2})日/);
  if (zhDate) {
    const [, year, month, day] = zhDate;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const bodyCompact = markdown.match(/^20\d{6}$/m);
  if (bodyCompact) return `${bodyCompact[0].slice(0, 4)}-${bodyCompact[0].slice(4, 6)}-${bodyCompact[0].slice(6, 8)}`;

  return modifiedAt.toISOString().slice(0, 10);
};

const renderBlocks = (markdown) => {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let list = [];
  let inCode = false;
  let code = [];
  let paragraphEmitted = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.join(" ");
    if (!paragraphEmitted && /^(20\d{6}|\d{4}年\d{1,2}月\d{1,2}日)$/.test(text)) {
      paragraph = [];
      return;
    }
    html.push(`<p>${inlineMarkdown(text)}</p>`);
    paragraph = [];
    paragraphEmitted = true;
  };

  const flushList = () => {
    if (!list.length) return;
    html.push(`<ul>${list.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`);
    list = [];
  };

  const flushCode = () => {
    html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
    code = [];
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      flushParagraph();
      flushList();
      if (inCode) flushCode();
      inCode = !inCode;
      continue;
    }

    if (inCode) {
      code.push(line);
      continue;
    }

    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    if (/^-{3,}$/.test(trimmed)) {
      flushParagraph();
      flushList();
      html.push("<hr>");
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      html.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`);
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  if (inCode || code.length) flushCode();
  return html.join("\n");
};

const stripTitleBlocks = (html, title) => {
  let cleaned = html.replace(/^\s*<h1>.*?<\/h1>\s*/, "");
  const match = cleaned.match(/^\s*<p>(.*?)<\/p>/);
  if (match && stripDatePrefix(stripEntities(match[1]).replace(/<[^>]+>/g, "").trim()) === title) {
    cleaned = cleaned.slice(match.index + match[0].length).trimStart();
  }
  return cleaned;
};

const layout = ({ title, description = "", body, ogTitle = title, path = "/", type = "website" }) => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(description || siteTitle)}">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/style.css">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="alternate" type="application/rss+xml" title="${escapeHtml(siteTitle)}" href="/feed.xml">
  <link rel="canonical" href="${siteUrl}${path}">
  <meta property="og:site_name" content="${escapeHtml(siteTitle)}">
  <meta property="og:title" content="${escapeHtml(ogTitle)}">
  <meta property="og:description" content="${escapeHtml(description || siteTitle)}">
  <meta property="og:type" content="${type}">
  <meta property="og:url" content="${siteUrl}${path}">
  <meta property="og:image" content="${siteUrl}/og-image.png">
  <meta name="twitter:card" content="summary_large_image">
  <script>
    (function () {
      try {
        var theme = localStorage.getItem("theme");
        if (theme === "light" || theme === "dark") {
          document.documentElement.setAttribute("data-theme", theme);
        }
      } catch (e) {}
    })();
  </script>
  <script src="/main.js" defer></script>
</head>
<body>
  ${body}
</body>
</html>
`;

const readPosts = async () => {
  const entries = await readdir(root, { withFileTypes: true });
  const rootMarkdown = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

  const posts = [];
  for (let index = 0; index < rootMarkdown.length; index += 1) {
    const entry = rootMarkdown[index];
    const file = path.join(root, entry.name);
    const [markdown, fileStat] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    const title = titleFrom(entry.name);
    posts.push({
      file: entry.name,
      title,
      date: dateFrom(entry.name, markdown, fileStat.mtime),
      html: stripTitleBlocks(renderBlocks(markdown), title)
    });
  }

  return posts.sort((a, b) => b.date.localeCompare(a.date) || b.file.localeCompare(a.file, "zh-CN"));
};

const writeSite = async () => {
  const posts = await readPosts();

  const idsFile = path.join(root, "post-ids.json");
  let ids = {};
  try {
    ids = JSON.parse(await readFile(idsFile, "utf8"));
  } catch {
    ids = {};
  }

  const usedIds = new Set(Object.values(ids));
  for (const post of posts) {
    const current = ids[post.file];
    const valid = current && /^[a-z0-9]{8}$/.test(current);
    const duplicate = valid && Object.values(ids).filter((value) => value === current).length > 1;
    if (!valid || duplicate) {
      let id;
      do {
        id = newId();
      } while (usedIds.has(id));
      ids[post.file] = id;
      usedIds.add(id);
    }
  }

  for (const file of Object.keys(ids)) {
    if (!posts.some((post) => post.file === file)) delete ids[file];
  }

  await writeFile(idsFile, `${JSON.stringify(ids, null, 2)}\n`, "utf8");

  const legacyFiles = {
    "post-01": "20260819 夜晚.md",
    "post-02": "怎么把电脑桌面的文件Git到Github去？.md",
    "post-03": "未来有多精彩？.md"
  };
  const redirects = Object.entries(legacyFiles)
    .filter(([, file]) => ids[file])
    .map(([oldSlug, file]) => ({
      source: `/posts/${oldSlug}/:path*`,
      destination: `/posts/${ids[file]}/:path*`,
      permanent: true
    }));

  const vercelFile = path.join(root, "vercel.json");
  let vercelConfig = {};
  try {
    vercelConfig = JSON.parse(await readFile(vercelFile, "utf8"));
  } catch {
    vercelConfig = {};
  }
  vercelConfig.redirects = redirects;
  await writeFile(vercelFile, `${JSON.stringify(vercelConfig, null, 2)}\n`, "utf8");

  await rm(outDir, { recursive: true, force: true });
  await mkdir(path.join(outDir, "posts"), { recursive: true });

  for (const post of posts) {
    post.slug = ids[post.file];
  }

  const indexBody = `<main class="home">
    <header>
      <h1>${escapeHtml(siteTitle)}</h1>
      <p class="site-tagline">${escapeHtml(siteTagline)}</p>
    </header>
    <ol class="post-list">
      ${posts
        .map(
          (post) => `<li>
        <a href="/posts/${post.slug}/">
          <span>${escapeHtml(post.title)}</span>
          <time datetime="${post.date}">${post.date}</time>
        </a>
      </li>`
        )
        .join("\n")}
    </ol>
  </main>`;

  await writeFile(
    path.join(outDir, "index.html"),
    layout({ title: siteTitle, description: siteTagline, body: indexBody, ogTitle: siteTitle }),
    "utf8"
  );

  await copyFile(path.join(root, "scripts", "main.js"), path.join(outDir, "main.js"));
  await copyFile(path.join(root, "scripts", "favicon.svg"), path.join(outDir, "favicon.svg"));
  await writeFile(path.join(outDir, "og-image.png"), makeOgImage());

  for (let index = 0; index < posts.length; index += 1) {
    const post = posts[index];
    const newer = posts[index - 1];
    const older = posts[index + 1];
    const navLinks = [];
    if (older) navLinks.push(`<a class="prev" href="/posts/${older.slug}/">← 上一篇：${escapeHtml(older.title)}</a>`);
    if (newer) navLinks.push(`<a class="next" href="/posts/${newer.slug}/">下一篇：${escapeHtml(newer.title)} →</a>`);

    const postDir = path.join(outDir, "posts", post.slug);
    await mkdir(postDir, { recursive: true });
    const postBody = `<main class="post">
      <nav><a href="/">← 返回</a></nav>
      <article>
        <h1>${escapeHtml(post.title)}</h1>
        <p class="post-date"><time datetime="${post.date}">${post.date}</time></p>
        ${post.html}
      </article>
      <nav class="post-nav">
        ${navLinks.join("\n")}
      </nav>
    </main>`;
    await writeFile(
      path.join(postDir, "index.html"),
      layout({
        title: `${post.title} - ${siteTitle}`,
        description: excerptFrom(post.html, post.title),
        body: postBody,
        path: `/posts/${post.slug}/`,
        ogTitle: post.title,
        type: "article"
      }),
      "utf8"
    );
  }

  const feedBody = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(siteTitle)}</title>
    <link>${siteUrl}/</link>
    <description>${escapeXml(siteTagline)}</description>
    <language>zh-CN</language>
    ${posts
      .map(
        (post) => `<item>
      <title>${escapeXml(post.title)}</title>
      <link>${siteUrl}/posts/${post.slug}/</link>
      <guid isPermaLink="true">${siteUrl}/posts/${post.slug}/</guid>
      <pubDate>${new Date(`${post.date}T00:00:00Z`).toUTCString()}</pubDate>
      <description><![CDATA[${post.html.replaceAll("]]>", "]]]]><![CDATA[>")}]]></description>
    </item>`
      )
      .join("\n")}
  </channel>
</rss>
`;
  await writeFile(path.join(outDir, "feed.xml"), feedBody, "utf8");

  const sitemapBody = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${siteUrl}/</loc>
    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>
  </url>
  ${posts
    .map(
      (post) => `<url>
    <loc>${siteUrl}/posts/${post.slug}/</loc>
    <lastmod>${post.date}</lastmod>
  </url>`
    )
    .join("\n")}
</urlset>
`;
  await writeFile(path.join(outDir, "sitemap.xml"), sitemapBody, "utf8");

  const notFoundBody = `<main class="post">
    <nav><a href="/">← 返回</a></nav>
    <article>
      <h1>页面不存在</h1>
      <p>你访问的页面可能已被移动或删除。</p>
      <p><a href="/">回到首页</a></p>
    </article>
  </main>`;
  await writeFile(
    path.join(outDir, "404.html"),
    layout({ title: `页面不存在 - ${siteTitle}`, description: "页面不存在", body: notFoundBody, ogTitle: "页面不存在" }),
    "utf8"
  );

  await writeFile(
    path.join(outDir, "style.css"),
    `:root {
  color-scheme: light dark;
  --text: #111;
  --muted: #777;
  --line: #e8e8e8;
  --bg: #fff;
  --quote: #444;
  --sans: ui-sans-serif, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
  --accent: #a84b32;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: ui-serif, Georgia, "Times New Roman", "Noto Serif SC", "Songti SC", serif;
  line-height: 1.78;
}

a {
  color: inherit;
  text-decoration-thickness: 1px;
  text-underline-offset: 4px;
}

a:focus-visible,
button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

.home,
.post {
  width: min(680px, calc(100% - 40px));
  margin: 0 auto;
}

@keyframes fade-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.home,
.post {
  animation: fade-in 0.35s ease-out both;
}

.home {
  padding: 18vh 0 12vh;
}

.post {
  padding: 56px 0 96px;
}

header {
  margin-bottom: 52px;
}

h1,
h2,
h3,
p,
ul,
pre,
blockquote {
  margin: 0 0 24px;
}

h1 {
  font-family: var(--sans);
  font-size: 26px;
  font-weight: 500;
  line-height: 1.45;
}

.home h1 {
  font-size: 28px;
}

h2 {
  margin-top: 42px;
  font-family: var(--sans);
  font-size: 20px;
  font-weight: 500;
}

h3 {
  margin-top: 32px;
  font-family: var(--sans);
  font-size: 18px;
  font-weight: 500;
}

.site-tagline {
  margin: -12px 0 0;
  color: var(--muted);
  font-size: 15px;
  font-family: var(--sans);
}

.post-list {
  display: grid;
  gap: 18px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.post-list li {
  border-top: 1px solid var(--line);
}

.post-list a {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 0 0;
  text-decoration: none;
}

.post-list a:hover {
  text-decoration: underline;
}

.post-list a span {
  transition: transform 0.18s ease, color 0.18s ease;
}

.post-list a:hover span {
  transform: translateX(5px);
  color: var(--text);
}

.post-list a:active span {
  transform: translateX(3px);
}

.post-list a:hover time {
  color: var(--accent);
}

time,
nav {
  color: var(--muted);
  font-size: 14px;
  white-space: nowrap;
  font-family: var(--sans);
}

nav {
  margin-bottom: 48px;
}

.post-nav {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  margin-top: 64px;
  padding-top: 20px;
  border-top: 1px solid var(--line);
  white-space: normal;
}

.post-nav a {
  max-width: 50%;
  text-decoration: none;
}

.post-nav a:hover {
  text-decoration: underline;
  color: var(--accent);
}

.post-nav .next {
  margin-left: auto;
  text-align: right;
}

article h1:first-child {
  margin-bottom: 8px;
}

article p,
article li,
blockquote {
  font-size: 17px;
}

.post-date {
  color: var(--accent);
  font-size: 14px;
  font-family: var(--sans);
}

ul {
  padding-left: 1.25em;
}

blockquote {
  border-left: 2px solid var(--accent);
  color: var(--quote);
  padding-left: 18px;
}

hr {
  border: 0;
  border-top: 1px solid var(--line);
  margin: 36px 0;
}

code {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 0.9em;
}

pre {
  overflow-x: auto;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  padding: 18px 0;
}

.progress {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--accent);
  transform: scaleX(0);
  transform-origin: 0 50%;
  z-index: 20;
  pointer-events: none;
}

.theme-toggle {
  position: fixed;
  top: 14px;
  right: 14px;
  z-index: 10;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: var(--bg);
  color: var(--muted);
  cursor: pointer;
  font-family: var(--sans);
  transition: color 0.18s ease, border-color 0.18s ease;
}

.theme-toggle:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.theme-toggle svg {
  width: 16px;
  height: 16px;
}

.back-to-top {
  position: fixed;
  right: 14px;
  bottom: 20px;
  z-index: 10;
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: var(--bg);
  color: var(--muted);
  cursor: pointer;
  font-family: var(--sans);
  opacity: 0;
  transform: translateY(6px);
  pointer-events: none;
  transition: opacity 0.18s ease, transform 0.18s ease, color 0.18s ease;
}

.back-to-top.show {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

.back-to-top:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.back-to-top svg {
  width: 16px;
  height: 16px;
}

@media (prefers-reduced-motion: reduce) {
  .home,
  .post {
    animation: none;
  }

  .post-list a span,
  .theme-toggle,
  .back-to-top {
    transition: none;
  }
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --text: #e8e6e3;
    --muted: #9b9996;
    --line: #2a2927;
    --bg: #121212;
    --quote: #b8b5b0;
    --accent: #d97757;
  }
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --text: #e8e6e3;
  --muted: #9b9996;
  --line: #2a2927;
  --bg: #121212;
  --quote: #b8b5b0;
  --accent: #d97757;
}

:root[data-theme="light"] {
  color-scheme: light;
  --text: #111;
  --muted: #777;
  --line: #e8e8e8;
  --bg: #fff;
  --quote: #444;
}

@media (max-width: 560px) {
  .home,
  .post {
    width: min(100% - 28px, 680px);
  }

  .home {
    padding-top: 96px;
  }

  .post-list a {
    display: grid;
    gap: 4px;
  }

  .post-nav {
    display: grid;
    gap: 10px;
  }

  .post-nav a {
    max-width: 100%;
  }

  .post-nav .next {
    margin-left: 0;
    text-align: left;
  }
}
`,
    "utf8"
  );
};

await writeSite();
