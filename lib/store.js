// Storage on Upstash Redis (free via the Vercel Marketplace).
// Two hashes hold everything:
//   users      field = lowercased username  -> {key, name, tower, floor, created}
//   sightings  field = sighting id          -> {id, ts, user, tower, floor, where, count}
// Reading the whole board is two commands. Claiming a username uses HSETNX,
// so two people can't grab the same name at the same moment.
import crypto from "node:crypto";

// `npm run dev` sets MOTH_LOCAL=1 to keep data in a local JSON file instead.
const db = process.env.MOTH_LOCAL
  ? (await import("./db-local.js")).default
  : await (async () => {
      const { Redis } = await import("@upstash/redis");
      // The Vercel integration may name these either way.
      const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
      const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
      return new Redis({ url, token });
    })();

export const TOWERS = ["clifton", "gilpin"];
export const FLOORS = 9;
export const MAX_PER_LOG = 20;
export const NAME_RE = /^[A-Za-z0-9_.-]{2,20}$/;

// Usernames must contain a letter, and can't contain an obviously offensive word.
// Deliberately short list of stems that are rarely part of innocent words; it also
// sees through simple swaps like 0 for o or $ for s, and separators like f.u_c-k.
const BLOCKED = ["fuck", "shit", "cunt", "bitch", "nigg", "fagg", "slut", "whore", "nazi", "retard", "wank", "twat", "porn", "penis", "vagina"];
const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", "@": "a", $: "s" };
export function nameProblem(name) {
  if (!NAME_RE.test(name)) return "Usernames are 2–20 letters, numbers, dots, dashes or underscores.";
  if (!/[A-Za-z]/.test(name)) return "Usernames need at least one letter.";
  const flat = name.toLowerCase().replace(/[0-9@$]/g, (c) => LEET[c] ?? c).replace(/[._-]/g, "");
  if (BLOCKED.some((w) => flat.includes(w))) return "Please choose a different username.";
  return null;
}

const USERS = "users";
const SIGHTINGS = "sightings";

export async function findUser(key) {
  return (await db.hget(USERS, key)) || null;
}

// Returns {user, created}. If the name is already taken, returns the existing resident.
export async function createUser(name, tower, floor) {
  const key = name.toLowerCase();
  const user = { key, name, tower, floor, created: Date.now() };
  const created = await db.hsetnx(USERS, key, user);
  return created ? { user, created: true } : { user: await findUser(key), created: false };
}

// 5 seconds unless overridden (e.g. `COOLDOWN_SECONDS=2 npm run dev` for testing).
// A resident moving (or fixing a wrong pick). Their past moths follow them,
// because readBoard() credits every sighting to the resident's current home.
export async function updateUserHome(key, tower, floor) {
  const user = await findUser(key);
  if (!user) return null;
  const updated = { ...user, tower, floor, moved: Date.now() };
  await db.hset(USERS, { [key]: updated });
  return updated;
}

// A resident switching their own window light off or on (the resident still counts everywhere).
export async function setUserLight(key, on) {
  const user = await findUser(key);
  if (!user) return null;
  const updated = { ...user };
  if (on) delete updated.lightOff; else updated.lightOff = true;
  await db.hset(USERS, { [key]: updated });
  return updated;
}

export const COOLDOWN_SECONDS = Math.max(1, Number(process.env.COOLDOWN_SECONDS) || 5);

// One log per resident every 5 seconds. SET NX EX is atomic, so parallel
// requests can't slip through. Returns {ok:true} or {ok:false, retryAfter}.
export async function claimCooldown(key) {
  const k = `cooldown:${key}`;
  const ok = await db.set(k, Date.now(), { nx: true, ex: COOLDOWN_SECONDS });
  if (ok) return { ok: true };
  const ttl = await db.ttl(k);
  return { ok: false, retryAfter: ttl > 0 ? ttl : COOLDOWN_SECONDS };
}

export async function addSighting(user, where, count) {
  const ts = Date.now();
  const id = `${ts}-${crypto.randomBytes(4).toString("hex")}`;
  const sighting = { id, ts, user: user.key, tower: user.tower, floor: user.floor, where, count };
  await db.hset(SIGHTINGS, { [id]: sighting });
  return { sighting, token: sign(id) };
}

export async function removeSighting(id, token) {
  if (typeof id !== "string" || !token || token !== sign(id)) return false;
  await db.hdel(SIGHTINGS, id);
  return true;
}

// scope "sightings": wipe moth counts, keep residents. "all": wipe both.
export async function resetBoard(scope) {
  const keys = scope === "all" ? [SIGHTINGS, USERS] : [SIGHTINGS];
  const [s, u] = await Promise.all([db.hlen(SIGHTINGS), scope === "all" ? db.hlen(USERS) : 0]);
  await db.del(...keys);
  return s + u;
}

// Removing one resident: their record, their sightings and their log wait all go.
export async function deleteResident(key) {
  if (typeof key !== "string" || !key) return { removed: false, sightings: 0 };
  const user = await findUser(key);
  if (!user) return { removed: false, sightings: 0 };
  const all = (await db.hgetall(SIGHTINGS)) || {};
  const ids = Object.values(all).filter((x) => x && x.user === key).map((x) => x.id);
  if (ids.length) await db.hdel(SIGHTINGS, ...ids);
  await db.hdel(USERS, key);
  await db.del(`cooldown:${key}`);
  return { removed: true, sightings: ids.length };
}

// Admin lockout: 3 wrong PINs within 10 minutes locks the admin page for 10 minutes.
export const ADMIN_MAX_TRIES = 3;
export const ADMIN_LOCK_SECONDS = 600;

export async function adminLockedFor() {
  const t = await db.ttl("admin:lock");
  return t > 0 ? t : 0;
}
// Every attempt is counted *before* the PIN is checked (INCR is atomic), so a burst
// of parallel guesses still only gets 3 tries. A correct PIN clears the count.
export async function countAdminAttempt() {
  const n = await db.incr("admin:tries");
  if (n === 1) await db.expire("admin:tries", ADMIN_LOCK_SECONDS);
  return n;
}
export async function lockAdmin() {
  await db.set("admin:lock", Date.now(), { ex: ADMIN_LOCK_SECONDS });
  await db.del("admin:tries");
}
export async function clearAdminAttempts() { await db.del("admin:tries"); }

export function pinMatches(pin) {
  const want = process.env.ADMIN_PIN;
  if (!want) return null; // admin disabled until a PIN is configured
  const a = crypto.createHash("sha256").update(String(pin ?? "")).digest();
  const b = crypto.createHash("sha256").update(want).digest();
  return crypto.timingSafeEqual(a, b);
}

// ---- bug reports (from the About window) ----
// Hash "bugs": field = report id -> {id, ts, text, user, device}. Kept separate from the
// board, so resetting moth counts or residents never deletes bug reports.
const BUGS = "bugs";
export const BUG_MAX_CHARS = 150;
export const BUG_COOLDOWN_SECONDS = 30;
const BUG_KEEP = 500;

export async function claimBugCooldown(who) {
  const k = `bugcool:${who}`;
  const ok = await db.set(k, Date.now(), { nx: true, ex: BUG_COOLDOWN_SECONDS });
  if (ok) return { ok: true };
  const ttl = await db.ttl(k);
  return { ok: false, retryAfter: ttl > 0 ? ttl : BUG_COOLDOWN_SECONDS };
}
export async function addBug({ text, user, device }) {
  const ts = Date.now();
  const id = `${ts}-${crypto.randomBytes(3).toString("hex")}`;
  await db.hset(BUGS, { [id]: { id, ts, text, user: user || "", device: device || "" } });
  // keep the newest 500 so a flood of reports can't grow the database without limit
  if ((await db.hlen(BUGS)) > BUG_KEEP) {
    const old = Object.values((await db.hgetall(BUGS)) || {}).sort((a, b) => a.ts - b.ts).slice(0, 50).map((x) => x.id);
    if (old.length) await db.hdel(BUGS, ...old);
  }
  return id;
}
export async function readBugs() {
  return Object.values((await db.hgetall(BUGS)) || {}).filter((x) => x && x.id).sort((a, b) => b.ts - a.ts);
}
export async function countBugs() { return db.hlen(BUGS); }
export async function deleteBug(id) { return typeof id === "string" ? db.hdel(BUGS, id) : 0; }

export async function readBoard() {
  const [u, s] = await Promise.all([db.hgetall(USERS), db.hgetall(SIGHTINGS)]);
  const users = Object.values(u || {}).filter((x) => x && TOWERS.includes(x.tower));
  const home = new Map(users.map((x) => [x.key, x]));
  const sightings = Object.values(s || {})
    .filter((x) => x && TOWERS.includes(x.tower))
    // credit each sighting to the resident's current home (moths move with them)
    .map((x) => { const h = home.get(x.user); return h ? { ...x, tower: h.tower, floor: h.floor } : x; })
    .sort((a, b) => b.ts - a.ts);
  return { users, sightings };
}

// Undo tokens: only the browser that logged a sighting can remove it.
function sign(id) {
  const secret = process.env.UNDO_SECRET || process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "dev";
  return crypto.createHmac("sha256", secret).update(id).digest("hex").slice(0, 32);
}

export async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

// Shared catch-all for the API handlers: a malformed request body is the
// caller's mistake (400), anything else is ours (500).
export function fail(res, e, message) {
  if (e instanceof SyntaxError) return send(res, 400, { error: "That request wasn't valid JSON." });
  console.error(e);
  return send(res, 500, { error: message });
}

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}
