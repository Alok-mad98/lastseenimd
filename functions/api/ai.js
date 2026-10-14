import { json, isAddr, tracer } from "../_lib.js";
import { glm, snap } from "../_ai.js";

// POST /api/ai  { evidence }  →  the analyst's note (GLM 5.3) and a typed second opinion (SubQ Snap).
// The page sends the evidence it already got from /api/scan. Only known fields are read, and the prompts are fixed here.
const NOTE = `You are a blockchain security analyst writing to an ordinary person who may have been robbed. You get JSON evidence produced by an automatic wallet scan.
Rules: use only the evidence. Short plain sentences, no jargon without a six-word explanation, no markdown, no lists, no headings. Never promise that funds can be recovered. If the evidence is thin, say so.
If a sweeper is present: the attacker holds the private key, so say plainly that revoking approvals will not make the wallet safe, that anything sent to it (even gas money) will be taken, and that a normal transfer out will be beaten by the sweeper, so stuck assets need a single protected rescue transaction. Never tell them to simply move funds out.
Write four short paragraphs: what happened; how sure you are and why; what the attacker can still do; the three things to do now, in order. 170 words at most.`;

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  let ev;
  try { const raw = await request.text(); if (raw.length > 9000) throw 0; ev = JSON.parse(raw).evidence; } catch (e) { return json({ error: "Bad request." }, 400); }
  if (!ev || !isAddr(ev.address)) return json({ error: "Bad request." }, 400);
  const c = ev.compromise || {}, sw = c.sweeper || null, inc = ev.incident || null;
  const state = {
    wallet: ev.address,
    chains_read: (ev.chains || []).slice(0, 8).map(x => ({ chain: String(x.name).slice(0, 20), outgoing: +x.outCount || 0, incoming: +x.inCount || 0, delegated_to: x.delegate ? (x.delegateName ? String(x.delegateName).slice(0, 40) : "unrecognised contract, source code " + (x.delegateVerified ? "public" : "not public")) : "nothing" })),
    sweeper: sw ? { address: sw.address, transfers_to_it: +sw.totalCount || 0, sent_by_the_receiver_itself: +sw.count || 0, used_eip7702_signature_from_wallet_key: !!sw.type4, chains: (sw.allChains || []).slice(0, 6), first_seen: sw.first, last_seen: sw.last } : null,
    look_alike_address_poisoning_attempts: (c.poisoning || []).length,
    burst_drain: inc ? { usd_today: +inc.usd || 0, assets: +inc.assetCount || 0, signed_by_owner_key: inc.signedByOwner, receiver_label: inc.receiverName ? String(inc.receiverName).slice(0, 60) : null } : null,
    approvals: { open: +(ev.counts || {}).approvals || 0, flagged_malicious: +(ev.counts || {}).risky || 0, unlimited: +(ev.counts || {}).unlimited || 0 },
    own_swaps_and_bridges_usd: +(ev.split || {}).ownUsd || 0, sent_to_other_wallets_usd: +(ev.split || {}).awayUsd || 0,
    rule_based_risk_score: +(ev.score) || 0,
  };
  const t = tracer(env, "ai-opinion", { address: ev.address });
  const [note, second] = await Promise.all([
    t.step("glm_5_3_note", { model: "@cf/zai-org/glm-5.3" }, () => glm(env, NOTE, JSON.stringify(state))).catch(e => ({ error: e.message })),
    t.step("subq_snap_decisions", { model: "subq-snap-preview" }, () => snap(env, state, {
      compromised: { type: "noul", instructions: "Does someone other than the owner control this wallet's private key or seed phrase?", criteria: { true: "A third party moves funds on its own, or the wallet is delegated to an unrecognised contract, or the owner key signed a drain.", false: "Nothing in the evidence shows third-party control." } },
      attack: { type: "choice", instructions: "Which explanation fits the evidence best?", criteria: { stolen_key: "Private key or seed phrase stolen; attacker signs as the wallet.", malicious_approval: "A token approval or permit signature let a contract take tokens.", address_poisoning_only: "Only look-alike address spam; nothing was taken.", owner_activity: "Ordinary activity by the owner; no attack." } },
      urgency: { type: "score", instructions: "How fast must the owner act?", criteria: ["No action needed", "Review this week", "Act today", "Stop using the wallet now"] },
    })).catch(e => ({ error: e.message })),
  ]);
  t.done({ note: !note.error, model: note.model, second: !second.error });
  ctx.waitUntil(t.send());
  return new Response(JSON.stringify({ note: note.text || null, noteError: note.error || null, second: second.error ? null : second, secondError: second.error || null, models: { note: (note.model || "GLM 5.3") + " on Cloudflare Workers AI", second: "SubQ Snap Preview" } }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
