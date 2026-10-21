import { json } from "../_lib.js";

// Private tips for a bounty. Everything here is already encrypted in the sender's browser; this only stores and hands back bytes.
//   POST {kind:"key", pub, wrapped, iv}               a hirer's tip key: the public half, and the private half locked with their wallet signature
//   GET  ?key=<sha-256 of pub, hex>                   that key, for hunters (who check the hash against the bounty on chain) and for the hirer
//   POST {kind:"tip", caseId, keyId, epk, iv, ct}     a tip, sealed to the hirer's public key with a one-time key
//   GET  ?caseId=N                                    the sealed tips for a case; only the hirer can open them
// No name, email, account or IP address is stored with a tip. The ids are random.
const B64 = /^[A-Za-z0-9+/]+={0,2}$/, HEX32 = /^[0-9a-f]{64}$/;
const b64ok = (s, min, max) => typeof s === "string" && s.length >= min && s.length <= max && B64.test(s);
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const bytes = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export async function onRequestGet({ request, env }) {
  if (!env.TIPS) return json({ error: "Tips are not set up on this server." }, 503);
  const q = new URL(request.url).searchParams;
  const key = (q.get("key") || "").toLowerCase().replace(/^0x/, "");
  if (key) {
    if (!HEX32.test(key)) return json({ error: "Bad key id." }, 400);
    const v = await env.TIPS.get("key:" + key, "json");
    return v ? json(v) : json({ error: "No tip key with that id." }, 404);
  }
  const caseId = q.get("caseId");
  if (!/^\d{1,9}$/.test(caseId || "")) return json({ error: "Give a case number." }, 400);
  const list = await env.TIPS.list({ prefix: "tip:" + caseId + ":", limit: 100 });
  const tips = (await Promise.all(list.keys.map(k => env.TIPS.get(k.name, "json")))).filter(Boolean);
  return json({ caseId: Number(caseId), tips });
}

export async function onRequestPost({ request, env }) {
  if (!env.TIPS) return json({ error: "Tips are not set up on this server." }, 503);
  let b; try { b = await request.json(); } catch { return json({ error: "Send JSON." }, 400); }
  if (b.kind === "key") {
    // a raw P-256 public key is 65 bytes (88 base64 characters); the locked private half is a few hundred
    if (!b64ok(b.pub, 88, 88) || !b64ok(b.wrapped, 100, 400) || !b64ok(b.iv, 16, 16)) return json({ error: "That is not a tip key." }, 400);
    const id = hex(await crypto.subtle.digest("SHA-256", bytes(b.pub)));
    // stored under its own hash, so nobody can swap a hirer's key for theirs
    await env.TIPS.put("key:" + id, JSON.stringify({ id, pub: b.pub, wrapped: b.wrapped, iv: b.iv }));
    return json({ id });
  }
  if (b.kind === "tip") {
    const keyId = String(b.keyId || "").toLowerCase().replace(/^0x/, "");
    if (!/^\d{1,9}$/.test(String(b.caseId)) || !HEX32.test(keyId) || !b64ok(b.epk, 88, 88) || !b64ok(b.iv, 16, 16) || !b64ok(b.ct, 24, 16000)) return json({ error: "That is not a sealed tip." }, 400);
    const id = hex(crypto.getRandomValues(new Uint8Array(32))), at = Math.floor(Date.now() / 1000);
    const tip = { id, caseId: Number(b.caseId), keyId, epk: b.epk, iv: b.iv, ct: b.ct, at };
    // kept for a year; the time is rounded to the hour so it says little about who sent it
    tip.at = at - (at % 3600);
    await env.TIPS.put("tip:" + tip.caseId + ":" + String(1e12 - at).padStart(13, "0") + ":" + id, JSON.stringify(tip), { expirationTtl: 365 * 86400 });
    return json({ id });
  }
  return json({ error: "Unknown kind." }, 400);
}
