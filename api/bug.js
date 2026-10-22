import crypto from "node:crypto";
import { addBug, claimBugCooldown, findUser, readJson, send, BUG_MAX_CHARS, BUG_COOLDOWN_SECONDS, fail } from "../lib/store.js";

// POST {text, user?} -> saves a bug report from the About window.
// Up to 150 characters. One report every 30 seconds per device/network, so it can't be flooded.
export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  try {
    const body = await readJson(req);
    const text = String(body.text ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
    if (!text) return send(res, 400, { error: "Describe the bug first." });
    if (text.length > BUG_MAX_CHARS) return send(res, 400, { error: `Keep it to ${BUG_MAX_CHARS} characters or fewer.` });

    const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
    const who = crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
    const cd = await claimBugCooldown(who);
    if (!cd.ok) {
      res.setHeader("Retry-After", String(cd.retryAfter));
      return send(res, 429, { error: `Thanks. Please wait ${cd.retryAfter} seconds before sending another report.`, retryAfter: cd.retryAfter });
    }

    // Only keep a username if it is a real, registered resident (so nobody can pose as someone else).
    const resident = body.user ? await findUser(String(body.user).toLowerCase()) : null;
    const device = String(req.headers["user-agent"] || "").slice(0, 140);
    await addBug({ text, user: resident ? resident.name : "", device });
    send(res, 201, { ok: true, wait: BUG_COOLDOWN_SECONDS });
  } catch (e) {
    fail(res, e, "Couldn't send the bug report. Try again in a moment.");
  }
}
