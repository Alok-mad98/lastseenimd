import { json, tracer, batch } from "../_lib.js";

// GET /api/sol?address=<base58>  →  a Solana wallet's case file.
// Solana has no approvals list and no EIP-7702, but it has its own ways to lose funds:
//   - funds leaving in a transaction the owner did not sign: a token delegate (SPL "approve") or a stolen key on another signer
//   - token accounts that still carry a delegate who can move them
//   - a burst of many assets leaving for one address, the usual shape of a drain
export const isSol = a => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a || "");
const LAMPORTS = 1e9;

// Solana's JSON-RPC through the same Alchemy keys, with the same rotation when one runs out
const SOLANA = { host: "solana-mainnet", name: "Solana" };
const rpc = (env, calls) => batch(env, SOLANA, calls);

export async function onRequestGet(ctx) {
  const { request, env } = ctx;
  const address = new URL(request.url).searchParams.get("address") || "";
  if (!isSol(address)) return json({ error: "That is not a Solana address." }, 400);
  const t = tracer(env, "solana-scan", { address });
  try {
    const [balance, sigs, accounts] = await t.step("solana_basics", { address }, () => rpc(env, [
      ["getBalance", [address]],
      ["getSignaturesForAddress", [address, { limit: 60 }]],
      ["getTokenAccountsByOwner", [address, { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }, { encoding: "jsonParsed" }]],
    ]));
    if (!sigs) throw new Error("the address could not be read");
    const list = sigs.filter(s => !s.err).slice(0, 45);
    const txs = list.length ? await t.step("solana_transactions", { count: list.length }, () => rpc(env, list.map(s => ["getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]]))) : [];

    // every balance change of this wallet, with who signed and who was on the other side
    const moves = [];
    txs.forEach((tx, i) => {
      if (!tx || !tx.meta) return;
      const keys = tx.transaction.message.accountKeys.map(k => (typeof k === "string" ? { pubkey: k, signer: false } : k));
      const me = keys.findIndex(k => k.pubkey === address);
      const signers = keys.filter(k => k.signer).map(k => k.pubkey);
      const ts = tx.blockTime || list[i].blockTime || 0, sig = list[i].signature, ownerSigned = signers.includes(address);
      // native SOL, net of the fee when the owner paid it
      if (me >= 0) {
        let d = (tx.meta.postBalances[me] - tx.meta.preBalances[me]) / LAMPORTS;
        if (keys[0].pubkey === address) d += tx.meta.fee / LAMPORTS;
        if (Math.abs(d) > 1e-6) {
          const other = keys.map((k, j) => ({ k: k.pubkey, d: (tx.meta.postBalances[j] - tx.meta.preBalances[j]) / LAMPORTS })).filter(x => x.k !== address && Math.sign(x.d) === -Math.sign(d)).sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
          moves.push({ sig, ts, mint: "SOL", amount: d, other: other ? other.k : null, ownerSigned, signers });
        }
      }
      // SPL tokens owned by this wallet
      const pre = {}, post = {};
      (tx.meta.preTokenBalances || []).forEach(b => { pre[b.accountIndex] = b; });
      (tx.meta.postTokenBalances || []).forEach(b => { post[b.accountIndex] = b; });
      const idx = new Set(Object.keys(pre).concat(Object.keys(post)));
      const ui = b => (b && b.uiTokenAmount ? Number(b.uiTokenAmount.uiAmountString || b.uiTokenAmount.uiAmount || 0) : 0);
      const changes = [...idx].map(k => { const a = pre[k], b = post[k], x = b || a; return { owner: x.owner, mint: x.mint, d: ui(b) - ui(a) }; }).filter(c => Math.abs(c.d) > 0);
      changes.filter(c => c.owner === address).forEach(c => {
        const other = changes.filter(o => o.mint === c.mint && o.owner !== address && Math.sign(o.d) === -Math.sign(c.d)).sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
        moves.push({ sig, ts, mint: c.mint, amount: c.d, other: other ? other.owner : null, ownerSigned, signers });
      });
    });

    // prices: SOL and the mints we saw, from DefiLlama
    const mints = [...new Set(moves.map(m => m.mint).filter(m => m !== "SOL"))].slice(0, 60);
    let coins = {};
    try { coins = (await (await fetch("https://coins.llama.fi/prices/current/" + ["coingecko:solana"].concat(mints.map(m => "solana:" + m)).join(","))).json()).coins || {}; } catch (e) { /* prices are a nice-to-have */ }
    const px = m => m === "SOL" ? (coins["coingecko:solana"] || {}).price || 0 : ((coins["solana:" + m] || {}).confidence >= 0.9 ? coins["solana:" + m].price : 0);
    const sym = m => m === "SOL" ? "SOL" : (coins["solana:" + m] || {}).symbol || m.slice(0, 4) + "…";
    moves.forEach(m => { m.usd = Math.abs(m.amount) * px(m.mint); m.symbol = sym(m.mint); });

    // the signals
    const out = moves.filter(m => m.amount < 0);
    const unsigned = out.filter(m => !m.ownerSigned && m.usd > 1);
    const takers = {};
    unsigned.forEach(m => { const k = m.signers[0] || "?"; const o = takers[k] || (takers[k] = { signer: k, count: 0, usd: 0, to: {}, first: m.ts, last: m.ts }); o.count++; o.usd += m.usd; if (m.other) o.to[m.other] = 1; o.first = Math.min(o.first, m.ts); o.last = Math.max(o.last, m.ts); });
    const taker = Object.values(takers).sort((a, b) => b.usd - a.usd)[0] || null;
    if (taker) taker.to = Object.keys(taker.to).slice(0, 5);
    const delegated = ((accounts && accounts.value) || []).map(a => a.account.data.parsed.info).filter(i => i.delegate).map(i => ({ mint: i.mint, symbol: sym(i.mint), delegate: i.delegate, amount: i.delegatedAmount ? Number(i.delegatedAmount.uiAmountString || 0) : null }));
    const by = {};
    out.forEach(m => { if (!m.other) return; const o = by[m.other] || (by[m.other] = { address: m.other, usd: 0, count: 0, assets: {} }); o.usd += m.usd; o.count++; o.assets[m.symbol] = 1; });
    const sent = Object.values(by).map(o => ({ ...o, usd: Math.round(o.usd * 100) / 100, assets: Object.keys(o.assets) })).sort((a, b) => b.usd - a.usd).slice(0, 20);
    const burst = (() => {
      const g = {};
      out.forEach(m => { if (m.other) (g[m.other] = g[m.other] || []).push(m); });
      let best = null;
      for (const k in g) {
        const l = g[k].sort((a, b) => a.ts - b.ts);
        for (const m of l) {
          const w = l.filter(x => x.ts >= m.ts && x.ts <= m.ts + 3600), assets = new Set(w.map(x => x.mint)), usd = w.reduce((a, x) => a + x.usd, 0);
          if (assets.size >= 3 && usd >= 50 && (!best || usd > best.usd)) best = { to: k, start: w[0].ts, assets: assets.size, usd: Math.round(usd), count: w.length };
        }
      }
      return best;
    })();
    const score = Math.min(100, (taker ? 90 : 0) + (burst ? 40 : 0) + delegated.length * 25);
    const story = [];
    if (taker) story.push(`Funds left this wallet in ${taker.count} transaction${taker.count > 1 ? "s" : ""} it did not sign, worth about $${Math.round(taker.usd).toLocaleString("en-US")} today. The transactions were signed by ${taker.signer.slice(0, 4)}…${taker.signer.slice(-4)}. On Solana that means a delegate the wallet once approved, or someone holding a key that controls these token accounts.`);
    if (burst) story.push(`On ${new Date(burst.start * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC, ${burst.assets} different assets went to one address within an hour, about $${burst.usd.toLocaleString("en-US")} at today's prices.`);
    if (delegated.length) story.push(`${delegated.length} token account${delegated.length > 1 ? "s still have" : " still has"} a delegate that can move the tokens without asking. Revoke ${delegated.length > 1 ? "them" : "it"} in your wallet or with a revoke tool for Solana.`);
    if (!taker && !burst && !delegated.length) story.push(moves.length ? "In the last transactions I read, every outgoing transfer was signed by this wallet, nothing left in a sudden burst, and no token account has a delegate. That is not what a drain looks like." : "This wallet has no recent activity I can read.");
    story.push(`Risk score: ${score} out of 100. I read the latest ${list.length} transactions only.`);
    t.done({ score, moves: moves.length, unsigned: unsigned.length });
    ctx.waitUntil(t.send());
    return json({
      address, chain: "solana", balanceSol: (balance && balance.value || 0) / LAMPORTS, solPrice: px("SOL"), txRead: list.length,
      risk: { score, level: score >= 60 ? "high" : score >= 25 ? "medium" : "low" }, taker, burst, delegated, sent, story,
      moves: moves.sort((a, b) => b.ts - a.ts).slice(0, 200).map(m => ({ s: m.sig, ts: m.ts, a: m.symbol, v: m.amount, u: Math.round(m.usd * 100) / 100, p: m.other, signed: m.ownerSigned })),
    });
  } catch (e) {
    t.fail(e); ctx.waitUntil(t.send());
    return json({ error: "The Solana scan failed: " + e.message }, 502);
  }
}
