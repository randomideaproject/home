import { readBoard, send, fail } from "../lib/store.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "Use GET." });
  try {
    send(res, 200, await readBoard());
  } catch (e) {
    fail(res, e, "Couldn't read the moth records. Try again in a moment.");
  }
}
