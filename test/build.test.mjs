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
    assert.match(html, /记录生活、情绪与思考的个人日志/);
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
