import {
  readBoard, resetBoard, pinMatches, readJson, send,
  adminLockedFor, countAdminAttempt, lockAdmin, clearAdminAttempts, ADMIN_MAX_TRIES, fail,
  readBugs, countBugs, deleteBug, deleteResident,
} from "../lib/store.js";

// POST {pin, action: "check"}                                -> verifies the PIN, returns counts
// POST {pin, action: "bugs"}                                 -> bug reports, newest first
// POST {pin, action: "bug-delete", id}                       -> removes one bug report
// POST {pin, action: "residents"}                            -> every resident with their moth totals
// POST {pin, action: "resident-delete", key}                -> removes one resident and their moths
// POST {pin, action: "reset", scope: "sightings"|"all", confirm: "RESET"}
// 3 wrong PINs within 10 minutes locks admin for 10 minutes.
const lockedMsg = (sec) => `Too many wrong attempts. Admin is locked for ${Math.ceil(sec / 60)} more minute${sec > 60 ? "s" : ""}.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  try {
    const body = await readJson(req);
    if (pinMatches("") === null) return send(res, 503, { error: "Admin is switched off. Set the ADMIN_PIN environment variable in Vercel and redeploy." });

    const locked = await adminLockedFor();
    if (locked) return send(res, 423, { error: lockedMsg(locked), retryAfter: locked });

    const n = await countAdminAttempt();
    if (n > ADMIN_MAX_TRIES) { await lockAdmin(); return send(res, 423, { error: lockedMsg(600), retryAfter: 600 }); }

    if (!pinMatches(body.pin)) {
      await new Promise((r) => setTimeout(r, 1000)); // slow down guessing
      if (n >= ADMIN_MAX_TRIES) { await lockAdmin(); return send(res, 423, { error: lockedMsg(600), retryAfter: 600 }); }
      const left = ADMIN_MAX_TRIES - n;
      return send(res, 401, { error: `Wrong PIN. ${left} ${left === 1 ? "try" : "tries"} left before admin locks for 10 minutes.` });
    }
    await clearAdminAttempts();

    if (body.action === "check") {
      const b = await readBoard();
      return send(res, 200, { residents: b.users.length, sightings: b.sightings.length, moths: b.sightings.reduce((a, s) => a + s.count, 0), bugs: await countBugs() });
    }

    const residentList = async () => {
      const b = await readBoard();
      const tot = new Map();
      for (const s of b.sightings) tot.set(s.user, (tot.get(s.user) || 0) + s.count);
      return b.users.map((u) => ({ key: u.key, name: u.name, tower: u.tower, floor: u.floor, moths: tot.get(u.key) || 0, lightOff: !!u.lightOff, created: u.created || 0 }))
        .sort((a, c) => a.name.localeCompare(c.name));
    };
    if (body.action === "residents") return send(res, 200, { residents: await residentList() });
    if (body.action === "resident-delete") {
      const r = await deleteResident(String(body.key || "").toLowerCase());
      if (!r.removed) return send(res, 404, { error: "That resident wasn't found. They may already be removed." });
      console.log(`admin removed resident ${body.key} (${r.sightings} sightings)`);
      return send(res, 200, { residents: await residentList(), counts: (await (async () => { const b = await readBoard(); return { residents: b.users.length, sightings: b.sightings.length, moths: b.sightings.reduce((a, s) => a + s.count, 0) }; })()) });
    }

    if (body.action === "bugs") return send(res, 200, { bugs: await readBugs() });

    if (body.action === "bug-delete") {
      await deleteBug(body.id);
      return send(res, 200, { bugs: await readBugs() });
    }

    if (body.action === "reset") {
      if (!["sightings", "all"].includes(body.scope)) return send(res, 400, { error: "Choose what to reset." });
      if (body.confirm !== "RESET") return send(res, 400, { error: "Type RESET to confirm." });
      const removed = await resetBoard(body.scope);
      console.log(`admin reset: scope=${body.scope} removed=${removed}`);
      return send(res, 200, { removed });
    }

    send(res, 400, { error: "Unknown action." });
  } catch (e) {
    fail(res, e, "The reset didn't finish. Try again; anything already removed stays removed.");
  }
}
