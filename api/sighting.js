import { addSighting, claimCooldown, findUser, removeSighting, readJson, send, MAX_PER_LOG, COOLDOWN_SECONDS, fail } from "../lib/store.js";

// POST   {user, where: "in"|"out", count}  -> logs moths, returns an undo token
//                                             (one log per resident every 5 seconds)
// DELETE {id, token}                        -> undoes a log from the same browser
export default async function handler(req, res) {
  try {
    const body = await readJson(req);

    if (req.method === "POST") {
      const user = await findUser(String(body.user || "").toLowerCase());
      if (!user) return send(res, 404, { error: "That resident isn't registered. Move in first." });
      if (!["in", "out"].includes(body.where)) return send(res, 400, { error: "Say whether the moth was inside or outside." });
      const n = Number(body.count);
      if (!Number.isInteger(n) || n < 1 || n > MAX_PER_LOG) {
        return send(res, 400, { error: `Log between 1 and ${MAX_PER_LOG} moths at a time.` });
      }
      const cd = await claimCooldown(user.key);
      if (!cd.ok) {
        res.setHeader("Retry-After", String(cd.retryAfter));
        return send(res, 429, { error: `Hold on a moment. You can log again in ${cd.retryAfter} seconds.`, retryAfter: cd.retryAfter });
      }
      const r = await addSighting(user, body.where, n);
      return send(res, 201, { ...r, retryAfter: COOLDOWN_SECONDS });
    }

    if (req.method === "DELETE") {
      const ok = await removeSighting(body.id, body.token);
      return ok ? send(res, 200, { ok: true }) : send(res, 403, { error: "That sighting can only be undone from the device that logged it." });
    }

    send(res, 405, { error: "Use POST or DELETE." });
  } catch (e) {
    fail(res, e, "Couldn't save that sighting. Try again in a moment.");
  }
}
