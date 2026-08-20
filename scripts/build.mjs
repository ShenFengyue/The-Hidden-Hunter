import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "public");
const siteTitle = "Grayson Shen的个人博客";

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const inlineMarkdown = (value = "") => {
  let html = escapeHtml(value);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');
  return html;
};

const slugFor = (index) => `post-${String(index + 1).padStart(2, "0")}`;

const titleFrom = (filename, markdown) => {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : path.basename(filename, ".md");
};

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

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
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

const layout = ({ title, description = "", body }) => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(description || siteTitle)}">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/style.css">
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
    posts.push({
      slug: slugFor(index),
      file: entry.name,
      title: titleFrom(entry.name, markdown),
      date: dateFrom(entry.name, markdown, fileStat.mtime),
      html: renderBlocks(markdown)
    });
  }

  return posts.sort((a, b) => b.date.localeCompare(a.date) || b.file.localeCompare(a.file, "zh-CN"));
};

const writeSite = async () => {
  const posts = await readPosts();
  await rm(outDir, { recursive: true, force: true });
  await mkdir(path.join(outDir, "posts"), { recursive: true });

  const indexBody = `<main class="home">
    <header>
      <h1>${escapeHtml(siteTitle)}</h1>
    </header>
    <ol class="post-list">
      ${posts
        .map(
          (post) => `<li>
        <a href="/posts/${post.slug}/">${escapeHtml(post.title)}</a>
        <time datetime="${post.date}">${post.date}</time>
      </li>`
        )
        .join("\n")}
    </ol>
  </main>`;

  await writeFile(
    path.join(outDir, "index.html"),
    layout({ title: siteTitle, description: siteTitle, body: indexBody }),
    "utf8"
  );

  for (const post of posts) {
    const postDir = path.join(outDir, "posts", post.slug);
    await mkdir(postDir, { recursive: true });
    const postBody = `<main class="post">
      <nav><a href="/">← 返回</a></nav>
      <article>
        ${post.html}
      </article>
    </main>`;
    await writeFile(
      path.join(postDir, "index.html"),
      layout({ title: `${post.title} - ${siteTitle}`, description: post.title, body: postBody }),
      "utf8"
    );
  }

  await writeFile(
    path.join(outDir, "style.css"),
    `:root {
  color-scheme: light;
  --text: #111;
  --muted: #777;
  --line: #e8e8e8;
  --bg: #fff;
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

.home,
.post {
  width: min(680px, calc(100% - 40px));
  margin: 0 auto;
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
  font-size: 22px;
  font-weight: 400;
  line-height: 1.5;
}

h2 {
  margin-top: 42px;
  font-size: 18px;
  font-weight: 400;
}

h3 {
  margin-top: 32px;
  font-size: 16px;
  font-weight: 400;
}

.post-list {
  display: grid;
  gap: 18px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.post-list li {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  border-top: 1px solid var(--line);
  padding-top: 18px;
}

.post-list a {
  text-decoration: none;
}

.post-list a:hover {
  text-decoration: underline;
}

time,
nav {
  color: var(--muted);
  font-size: 14px;
  white-space: nowrap;
}

nav {
  margin-bottom: 48px;
}

article h1:first-child {
  margin-bottom: 8px;
}

article p,
article li,
blockquote {
  font-size: 17px;
}

ul {
  padding-left: 1.25em;
}

blockquote {
  border-left: 1px solid var(--line);
  color: #444;
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

@media (max-width: 560px) {
  .home,
  .post {
    width: min(100% - 28px, 680px);
  }

  .home {
    padding-top: 96px;
  }

  .post-list li {
    display: grid;
    gap: 4px;
  }
}
`,
    "utf8"
  );
};

await writeSite();
