// Local test server: `npm run dev`, then open http://localhost:3000
// Runs the same api/ handlers as Vercel, saving data to ./.local-data.
// No install needed; requires Node 18 or newer.
import http from "node:http";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

process.env.MOTH_LOCAL = "1";
if (!process.env.ADMIN_PIN) process.env.ADMIN_PIN = "1234";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const PAGES = { "/": "index.html", "/index.html": "index.html", "/admin": "admin.html", "/admin.html": "admin.html" };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    const api = url.pathname.match(/^\/api\/([a-z]+)$/);
    if (api) {
      const mod = await import(pathToFileURL(path.join(ROOT, "api", api[1] + ".js")).href);
      return await mod.default(req, res);
    }
    const page = PAGES[url.pathname];
    if (page) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.end(await fs.readFile(path.join(ROOT, page)));
    }
    // the soundtrack, with Range requests so browsers can seek and loop
    const au = url.pathname.match(/^\/audio\/([A-Za-z0-9._-]+\.(mp3|m4a|ogg|wav))$/);
    if (au) {
      const file = path.join(ROOT, "audio", au[1]);
      const size = (await fs.stat(file)).size;
      const type = { mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", wav: "audio/wav" }[au[2]];
      res.setHeader("Content-Type", type); res.setHeader("Accept-Ranges", "bytes");
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
      if (m) {
        const start = m[1] === "" ? size - Number(m[2]) : Number(m[1]);
        const end = m[1] === "" || m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
        res.statusCode = 206; res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`); res.setHeader("Content-Length", end - start + 1);
        return createReadStream(file, { start, end }).pipe(res);
      }
      res.setHeader("Content-Length", size);
      return createReadStream(file).pipe(res);
    }
    // static files: the home-screen manifest and icons
    if (url.pathname === "/manifest.webmanifest" || /^\/icons\/[a-z0-9-]+\.png$/.test(url.pathname)) {
      res.setHeader("Content-Type", url.pathname.endsWith(".png") ? "image/png" : "application/manifest+json");
      return res.end(await fs.readFile(path.join(ROOT, url.pathname)));
    }
    res.statusCode = 404; res.end("Not found");
  } catch (e) {
    if (e.code === "ERR_MODULE_NOT_FOUND" || e.code === "ENOENT") { res.statusCode = 404; return res.end("Not found"); }
    console.error(e);
    res.statusCode = 500; res.end("Server error");
  }
});

server.listen(PORT, () => {
  console.log(`\n  Moth Watch is running locally (test data only)\n`);
  console.log(`  Leaderboard:  http://localhost:${PORT}`);
  console.log(`  Admin:        http://localhost:${PORT}/admin   PIN: ${process.env.ADMIN_PIN}`);
  console.log(`  Data folder:  ${path.join(ROOT, ".local-data")}\n`);
  console.log(`  Press Ctrl+C to stop.\n`);
});
