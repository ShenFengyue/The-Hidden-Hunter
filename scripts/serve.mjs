import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.join(process.cwd(), "public");
const port = Number(process.env.PORT || 3000);
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

const fileFor = (url) => {
  const decoded = decodeURIComponent(url.split("?")[0]);
  const pathname = decoded === "/" ? "/index.html" : decoded;
  return path.join(root, pathname.endsWith("/") ? `${pathname}index.html` : pathname);
};

createServer(async (request, response) => {
  try {
    const file = fileFor(request.url || "/");
    const resolved = path.resolve(file);
    if (!resolved.startsWith(path.resolve(root))) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    const fileStat = await stat(resolved);
    if (!fileStat.isFile()) throw new Error("Not a file");

    response.writeHead(200, {
      "content-type": types[path.extname(resolved)] || "application/octet-stream"
    });
    response.end(await readFile(resolved));
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}).listen(port, () => {
  console.log(`http://localhost:${port}`);
});
