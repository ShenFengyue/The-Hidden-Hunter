import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFile, cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();

const prepare = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "thh-build-"));
  const markdown = (await readdir(repoRoot)).filter((name) => name.toLowerCase().endsWith(".md"));
  for (const name of markdown) {
    await copyFile(path.join(repoRoot, name), path.join(dir, name));
  }
  await cp(path.join(repoRoot, "scripts"), path.join(dir, "scripts"), { recursive: true });
  try {
    await copyFile(path.join(repoRoot, "post-ids.json"), path.join(dir, "post-ids.json"));
  } catch {
    // no ids yet — the first build creates them
  }
  try {
    await copyFile(path.join(repoRoot, "vercel.json"), path.join(dir, "vercel.json"));
  } catch {
    // no config yet — the build writes one
  }
  return dir;
};

const buildIn = async (dir) => {
  await execFileAsync(process.execPath, ["scripts/build.mjs"], { cwd: dir });
};

const cleanup = async (dir) => rm(dir, { recursive: true, force: true });

test("assigns every post a stable unique random id persisted in post-ids.json", async () => {
  const dir = await prepare();
  try {
    await buildIn(dir);
    const first = JSON.parse(await readFile(path.join(dir, "post-ids.json"), "utf8"));
    const entries = Object.entries(first);
    const markdownCount = (await readdir(repoRoot)).filter((name) => name.toLowerCase().endsWith(".md")).length;

    assert.equal(entries.length, markdownCount);
    for (const [, id] of entries) assert.match(id, /^[a-z0-9]{8}$/);
    assert.equal(new Set(entries.map(([, id]) => id)).size, entries.length);

    await buildIn(dir);
    const second = JSON.parse(await readFile(path.join(dir, "post-ids.json"), "utf8"));
    assert.deepEqual(second, first);
  } finally {
    await cleanup(dir);
  }
});

test("homepage shows the site subtitle under the title", async () => {
  const dir = await prepare();
  try {
    await buildIn(dir);
    const html = await readFile(path.join(dir, "public", "index.html"), "utf8");
    assert.match(html, /class="site-tagline"/);
    assert.match(html, /move fast and break things/);
  } finally {
    await cleanup(dir);
  }
});

test("each post page links to the adjacent posts in homepage order", async () => {
  const dir = await prepare();
  try {
    await buildIn(dir);
    const home = await readFile(path.join(dir, "public", "index.html"), "utf8");
    const links = [...home.matchAll(/<a href="(\/posts\/[a-z0-9]{8}\/)">\s*<span>([^<]+)<\/span>/g)].map((m) => ({
      href: m[1],
      title: m[2]
    }));
    assert.ok(links.length >= 3, "expected at least 3 posts");

    for (let i = 0; i < links.length; i++) {
      const postHtml = await readFile(path.join(dir, "public", links[i].href, "index.html"), "utf8");
      const prevHref = links[i + 1] ? links[i + 1].href : null;
      const nextHref = links[i - 1] ? links[i - 1].href : null;

      assert.equal(postHtml.includes("上一篇"), Boolean(prevHref), `${links[i].title}: 上一篇 presence`);
      assert.equal(postHtml.includes("下一篇"), Boolean(nextHref), `${links[i].title}: 下一篇 presence`);
      if (prevHref) assert.ok(postHtml.includes(prevHref), `${links[i].title}: 上一篇 link`);
      if (nextHref) assert.ok(postHtml.includes(nextHref), `${links[i].title}: 下一篇 link`);
    }
  } finally {
    await cleanup(dir);
  }
});

test("styles define a dark scheme that follows the system", async () => {
  const dir = await prepare();
  try {
    await buildIn(dir);
    const css = await readFile(path.join(dir, "public", "style.css"), "utf8");
    assert.match(css, /prefers-color-scheme:\s*dark/);
    assert.match(css, /color-scheme:\s*light dark/);
  } finally {
    await cleanup(dir);
  }
});

test("legacy post-01/02/03 links redirect to the new random ids", async () => {
  const dir = await prepare();
  try {
    await buildIn(dir);
    const ids = JSON.parse(await readFile(path.join(dir, "post-ids.json"), "utf8"));
    const vercel = JSON.parse(await readFile(path.join(dir, "vercel.json"), "utf8"));

    assert.ok(Array.isArray(vercel.redirects));
    assert.equal(vercel.buildCommand, "npm run build");
    assert.equal(vercel.outputDirectory, "public");

    const legacy = {
      "post-01": "20260819 夜晚.md",
      "post-02": "怎么把电脑桌面的文件Git到Github去？.md",
      "post-03": "未来有多精彩？.md"
    };
    for (const [oldSlug, file] of Object.entries(legacy)) {
      const rule = vercel.redirects.find((entry) => entry.source.includes(oldSlug));
      assert.ok(rule, `redirect for ${oldSlug} missing`);
      assert.match(rule.destination, new RegExp(`^/posts/${ids[file]}/`));
      assert.equal(rule.permanent, true);
    }
  } finally {
    await cleanup(dir);
  }
});

test("every page loads main.js and the theme bootstrap script", async () => {
  const dir = await prepare();
  try {
    await buildIn(dir);
    const home = await readFile(path.join(dir, "public", "index.html"), "utf8");
    assert.match(home, /<script src="\/main\.js" defer><\/script>/);
    assert.match(home, /localStorage\.getItem\("theme"\)/);
    assert.match(home, /data-theme/);

    const href = home.match(/href="(\/posts\/[a-z0-9]{8}\/)"/)[1];
    const postHtml = await readFile(path.join(dir, "public", href, "index.html"), "utf8");
    assert.match(postHtml, /<script src="\/main\.js" defer><\/script>/);
  } finally {
    await cleanup(dir);
  }
});

test("main.js implements theme toggle, progress, back-to-top and keyboard navigation", async () => {
  const dir = await prepare();
  try {
    await buildIn(dir);
    const js = await readFile(path.join(dir, "public", "main.js"), "utf8");
    for (const needle of ["theme-toggle", "back-to-top", "progress", "ArrowLeft", "ArrowRight"]) {
      assert.ok(js.includes(needle), `main.js missing ${needle}`);
    }
  } finally {
    await cleanup(dir);
  }
});

test("styles support a manual light/dark override in addition to following the system", async () => {
  const dir = await prepare();
  try {
    await buildIn(dir);
    const css = await readFile(path.join(dir, "public", "style.css"), "utf8");
    assert.match(css, /\[data-theme="dark"\]/);
    assert.match(css, /\[data-theme="light"\]/);
    assert.match(css, /prefers-color-scheme:\s*dark/);
  } finally {
    await cleanup(dir);
  }
});

test("styles include keyboard focus, reduced-motion, entrance and scroll helper styles", async () => {
  const dir = await prepare();
  try {
    await buildIn(dir);
    const css = await readFile(path.join(dir, "public", "style.css"), "utf8");
    assert.match(css, /:focus-visible/);
    assert.match(css, /prefers-reduced-motion/);
    assert.match(css, /@keyframes/);
    assert.match(css, /\.back-to-top/);
    assert.match(css, /\.theme-toggle/);
    assert.match(css, /\.progress/);
    assert.match(css, /\.post-list a span/);
  } finally {
    await cleanup(dir);
  }
});

test("post pages do not annotate the keyboard shortcut in the navigation", async () => {
  const dir = await prepare();
  try {
    await buildIn(dir);
    const home = await readFile(path.join(dir, "public", "index.html"), "utf8");
    const href = home.match(/href="(\/posts\/[a-z0-9]{8}\/)"/)[1];
    const postHtml = await readFile(path.join(dir, "public", href, "index.html"), "utf8");
    assert.ok(!postHtml.includes("键盘"), "post page must not mention the keyboard shortcut");
  } finally {
    await cleanup(dir);
  }
});

test("every page includes favicon, canonical and open graph tags", async () => {
  const dir = await prepare();
  try {
    await buildIn(dir);
    const home = await readFile(path.join(dir, "public", "index.html"), "utf8");
    assert.match(home, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg">/);
    assert.match(home, /<link rel="alternate" type="application\/rss\+xml"[^>]*href="\/feed\.xml">/);
    assert.match(home, /<link rel="canonical" href="https:\/\/shen005\.vercel\.app\/">/);
    assert.match(home, /<meta property="og:site_name" content="Grayson Shen的个人博客">/);
    assert.match(home, /<meta property="og:title" content="Grayson Shen的个人博客">/);
    assert.match(home, /<meta property="og:type" content="website">/);
    assert.match(home, /<meta property="og:url" content="https:\/\/shen005\.vercel\.app\/">/);
    assert.match(home, /<meta property="og:image" content="https:\/\/shen005\.vercel\.app\/og-image\.png">/);
    assert.match(home, /<meta name="twitter:card" content="summary_large_image">/);

    const href = home.match(/href="(\/posts\/[a-z0-9]{8}\/)"/)[1];
    const postHtml = await readFile(path.join(dir, "public", href, "index.html"), "utf8");
    assert.match(postHtml, new RegExp(`<link rel="canonical" href="https://shen005\\.vercel\\.app${href}">`));
    assert.match(postHtml, /<meta property="og:type" content="article">/);
    assert.match(postHtml, /<meta property="og:description" content="[^"]+">/);
  } finally {
    await cleanup(dir);
  }
});

test("build ships favicon, cover image, feed, sitemap and 404 page", async () => {
  const dir = await prepare();
  try {
    await buildIn(dir);
    for (const file of ["favicon.svg", "og-image.png", "feed.xml", "sitemap.xml", "404.html"]) {
      const content = await readFile(path.join(dir, "public", file));
      assert.ok(content.length > 0, `${file} is empty`);
    }
    const notFound = await readFile(path.join(dir, "public", "404.html"), "utf8");
    assert.match(notFound, /页面不存在/);
    assert.match(notFound, /href="\/"/);
  } finally {
    await cleanup(dir);
  }
});

test("feed.xml lists every post with absolute links and dates", async () => {
  const dir = await prepare();
  try {
    await buildIn(dir);
    const feed = await readFile(path.join(dir, "public", "feed.xml"), "utf8");
    const markdownCount = (await readdir(repoRoot)).filter((name) => name.toLowerCase().endsWith(".md")).length;
    assert.match(feed, /<rss version="2\.0">/);
    assert.equal((feed.match(/<item>/g) || []).length, markdownCount);
    assert.equal((feed.match(/<link>https:\/\/shen005\.vercel\.app\/posts\/[a-z0-9]{8}\/<\/link>/g) || []).length, markdownCount);
    assert.match(feed, /<pubDate>[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT<\/pubDate>/);
  } finally {
    await cleanup(dir);
  }
});

test("sitemap.xml includes the homepage and every post", async () => {
  const dir = await prepare();
  try {
    await buildIn(dir);
    const sitemap = await readFile(path.join(dir, "public", "sitemap.xml"), "utf8");
    const markdownCount = (await readdir(repoRoot)).filter((name) => name.toLowerCase().endsWith(".md")).length;
    assert.match(sitemap, /<urlset[^>]*>/);
    assert.match(sitemap, /<loc>https:\/\/shen005\.vercel\.app\/<\/loc>/);
    assert.equal((sitemap.match(/<loc>/g) || []).length, markdownCount + 1);
  } finally {
    await cleanup(dir);
  }
});

test("post pages show the date as styled metadata and strip date-only body lines", async () => {
  const dir = await prepare();
  try {
    await buildIn(dir);
    const home = await readFile(path.join(dir, "public", "index.html"), "utf8");
    const links = [...home.matchAll(/href="(\/posts\/[a-z0-9]{8}\/)"/g)].map((m) => m[1]);

    for (const href of links) {
      const postHtml = await readFile(path.join(dir, "public", href, "index.html"), "utf8");
      assert.match(postHtml, /<p class="post-date"><time datetime="\d{4}-\d{2}-\d{2}">\d{4}-\d{2}-\d{2}<\/time><\/p>/);
      assert.equal((postHtml.match(/class="post-date"/g) || []).length, 1, `${href} has one date line`);
      assert.ok(!/<p>20\d{6}<\/p>/.test(postHtml), `${href} keeps a compact date paragraph`);
      assert.ok(!/<p>\d{4}年\d{1,2}月\d{1,2}日<\/p>/.test(postHtml), `${href} keeps a zh date paragraph`);
    }
  } finally {
    await cleanup(dir);
  }
});

test("homepage titles have date prefixes stripped", async () => {
  const dir = await prepare();
  try {
    await buildIn(dir);
    const home = await readFile(path.join(dir, "public", "index.html"), "utf8");
    assert.match(home, /<span>夜晚<\/span>/);
    assert.match(home, /<span>夜晚，又一个刷短视频的夜晚<\/span>/);
    assert.ok(!home.includes("20260819 夜晚"));
    assert.ok(!home.includes("2026年8月20日夜晚，又一个刷短视频的夜晚"));

    const nightHref = home.match(/href="(\/posts\/[a-z0-9]{8}\/)">\s*<span>夜晚<\/span>/)[1];
    const nightPage = await readFile(path.join(dir, "public", nightHref, "index.html"), "utf8");
    assert.match(nightPage, /<h1>夜晚<\/h1>/);
    assert.match(nightPage, /<p class="post-date"><time datetime="2026-08-19">/);
  } finally {
    await cleanup(dir);
  }
});

test("styles define a heading hierarchy, sans-serif UI font and an accent color", async () => {
  const dir = await prepare();
  try {
    await buildIn(dir);
    const css = await readFile(path.join(dir, "public", "style.css"), "utf8");
    assert.match(css, /--accent:/);
    assert.match(css, /--sans:/);
    assert.match(css, /font-family: var\(--sans\);/);
    assert.match(css, /h1 \{\s*font-family: var\(--sans\);/);
    assert.match(css, /font-size: 26px;/);
    assert.match(css, /font-size: 20px;/);
    assert.match(css, /\.progress \{\s*[^}]*background: var\(--accent\);/s);
    assert.match(css, /\.post-date \{/);
  } finally {
    await cleanup(dir);
  }
});
