import { createUser, findUser, updateUserHome, setUserLight, readJson, send, NAME_RE, nameProblem, TOWERS, FLOORS, fail } from "../lib/store.js";

// POST {name, tower, floor}          -> registers a new resident
//      name already taken            -> 409 "taken" (so nobody grabs a name by accident)
// PATCH {user, tower, floor}       -> changes a resident's home (past moths move too)
// PATCH {user, light: true|false}  -> switches the resident's own window light on or off
// POST {name, signIn: true}          -> signs in as that existing resident (e.g. a new device;
//                                       there are no passwords, it's a neighbourly moth count)
export default async function handler(req, res) {
  if (req.method === "PATCH") return changeHome(req, res);
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  try {
    const { name, tower, floor, signIn } = await readJson(req);
    const clean = String(name || "").trim();
    if (!NAME_RE.test(clean)) {
      return send(res, 400, { error: "Usernames are 2–20 letters, numbers, dots, dashes or underscores." });
    }
    const existing = await findUser(clean.toLowerCase());
    if (!signIn) {
      const problem = nameProblem(clean);
      if (problem) return send(res, 400, { error: problem });
    }
    if (signIn) {
      return existing
        ? send(res, 200, { user: existing, existing: true })
        : send(res, 404, { error: `There's no resident called ${clean}.` });
    }
    if (existing) return send(res, 409, { error: "taken", name: existing.name });

    const f = Number(floor);
    if (!TOWERS.includes(tower)) return send(res, 400, { error: "Pick Clifton or Gilpin." });
    if (!Number.isInteger(f) || f < 0 || f > FLOORS) return send(res, 400, { error: `Pick Ground or a level from 1 to ${FLOORS}.` });

    // createUser is atomic: if someone claimed the name a moment ago, it's taken.
    const r = await createUser(clean, tower, f);
    if (!r.created) return send(res, 409, { error: "taken", name: r.user.name });
    send(res, 201, { user: r.user, existing: false });
  } catch (e) {
    fail(res, e, "Couldn't register that resident. Try again in a moment.");
  }
}

// PATCH {user, tower, floor} -> a resident changes their own home; past moths move with them.
async function changeHome(req, res) {
  try {
    const body = await readJson(req);
    if (typeof body.light === "boolean") {
      const u = await setUserLight(String(body.user || "").toLowerCase(), body.light);
      return u ? send(res, 200, { user: u }) : send(res, 404, { error: "That resident isn't registered." });
    }
    const { user, tower, floor } = body;
    const f = Number(floor);
    if (!TOWERS.includes(tower)) return send(res, 400, { error: "Pick Clifton or Gilpin." });
    if (!Number.isInteger(f) || f < 0 || f > FLOORS) return send(res, 400, { error: `Pick Ground or a level from 1 to ${FLOORS}.` });
    const updated = await updateUserHome(String(user || "").toLowerCase(), tower, f);
    if (!updated) return send(res, 404, { error: "That resident isn't registered." });
    send(res, 200, { user: updated });
  } catch (e) {
    fail(res, e, "Couldn't change your home. Try again in a moment.");
  }
}
