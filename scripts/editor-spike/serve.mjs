import { createReadStream, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mediaRoot = path.resolve(".tmp/editor-f0");
const resultsDir = path.join(mediaRoot, "results");
const port = Number(process.argv[2] ?? 5199);
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".json": "application/json",
};

const resolveUnder = (root, rel) => {
  const full = path.resolve(root, "." + path.posix.normalize("/" + rel));
  return full.startsWith(root + path.sep) ? full : null;
};

const sendFile = (req, res, file) => {
  const { size } = statSync(file);
  const type = TYPES[path.extname(file)] ?? "application/octet-stream";
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (range) {
    const start = range[1] === "" ? size - Number(range[2]) : Number(range[1]);
    const end =
      range[2] === "" || range[1] === "" ? size - 1 : Math.min(Number(range[2]), size - 1);
    res.writeHead(206, {
      "Content-Type": type,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Accept-Ranges": "bytes",
    });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes" });
  createReadStream(file).pipe(res);
};

createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (req.method === "POST" && url.pathname.startsWith("/save/")) {
    const name = path.basename(url.pathname.slice("/save/".length));
    if (!/^[\w.-]+\.json$/.test(name)) return res.writeHead(400).end("bad name");
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      mkdirSync(resultsDir, { recursive: true });
      writeFileSync(path.join(resultsDir, name), body + "\n");
      res.writeHead(204).end();
    });
    return;
  }
  if (url.pathname.startsWith("/media/")) {
    const file = resolveUnder(mediaRoot, url.pathname.slice("/media/".length));
    if (!file) return res.writeHead(403).end();
    try {
      return sendFile(req, res, file);
    } catch {
      return res.writeHead(404).end();
    }
  }
  const file = resolveUnder(
    path.join(here, "browser"),
    url.pathname === "/" ? "index.html" : url.pathname.slice(1),
  );
  if (!file) return res.writeHead(403).end();
  try {
    sendFile(req, res, file);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}/`));
