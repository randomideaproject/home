// Local stand-in for the Redis commands Moth Watch uses, for `npm run dev`.
// Data lives in ./.local-data/db.json. Writes are queued so they never overlap.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".local-data");
const FILE = path.join(DIR, "db.json");

let cache = null;
let queue = Promise.resolve();

async function load() {
  if (cache) return cache;
  try { cache = JSON.parse(await fs.readFile(FILE, "utf8")); } catch { cache = {}; }
  return cache;
}
function persist() {
  queue = queue.then(async () => {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(FILE + ".tmp", JSON.stringify(cache, null, 1));
    await fs.rename(FILE + ".tmp", FILE);
  });
  return queue;
}
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

// Short-lived keys (cooldowns) are kept in memory only.
const kv = new Map(); // key -> {v, exp}
const live = (k) => { const e = kv.get(k); if (e && e.exp && e.exp <= Date.now()) { kv.delete(k); return null; } return e || null; };

export default {
  async set(key, value, { nx, ex } = {}) {
    if (nx && live(key)) return null;
    kv.set(key, { v: value, exp: ex ? Date.now() + ex * 1000 : 0 });
    return "OK";
  },
  async ttl(key) { const e = live(key); if (!e) return -2; return e.exp ? Math.ceil((e.exp - Date.now()) / 1000) : -1; },
  async incr(key) { const e = live(key); const v = (Number(e?.v) || 0) + 1; kv.set(key, { v, exp: e?.exp || 0 }); return v; },
  async expire(key, sec) { const e = live(key); if (!e) return 0; e.exp = Date.now() + sec * 1000; return 1; },
  async hget(key, field) { const d = await load(); return clone(d[key]?.[field]) ?? null; },
  async hgetall(key) { const d = await load(); return d[key] && Object.keys(d[key]).length ? clone(d[key]) : null; },
  async hlen(key) { const d = await load(); return Object.keys(d[key] || {}).length; },
  async hsetnx(key, field, value) {
    const d = await load(); d[key] ||= {};
    if (field in d[key]) return 0;
    d[key][field] = clone(value); await persist(); return 1;
  },
  async hset(key, obj) {
    const d = await load(); d[key] ||= {};
    let n = 0; for (const [f, v] of Object.entries(obj)) { if (!(f in d[key])) n++; d[key][f] = clone(v); }
    await persist(); return n;
  },
  async hdel(key, ...fields) {
    const d = await load(); let n = 0;
    for (const f of fields) if (d[key] && f in d[key]) { delete d[key][f]; n++; }
    await persist(); return n;
  },
  async del(...keys) {
    const d = await load(); let n = 0;
    for (const k of keys) {
      if (k in d) { delete d[k]; n++; }
      if (kv.delete(k)) n++;
    }
    await persist(); return n;
  },
};
