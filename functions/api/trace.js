import { isAddr, json, transfers, priceAll, labels, tracer, chainOf, CHAINS, SOLANA_IDS, batch } from "../_lib.js";

// GET /api/trace?address=0x…&since=unix&chain=base&depth=2  →  where the money went next, up to three hops deep on one chain.
// The trail stops at exchanges, mixers and bridges. Inside an exchange nothing is public; a bridge is resolved to the chain
// and address it paid out on (Relay, LI.FI, Across), so the page can carry on there.
const STOP = ["exchange", "mixer", "bridge", "sanctioned", "contract"];
// "Bitget: DEX Aggregator" is a swap service, not an exchange account: its output goes back to whoever swapped
const swapLike = n => /(dex|aggregator|router|swap|1inch|0x: exchange proxy|paraswap|odos|kyber|uniswap|pancake|sushi)/i.test(n || "");
export async function onRequestGet(ctx) {
  const { request, env } = ctx;
  const q = new URL(request.url).searchParams;
  const start = (q.get("address") || "").toLowerCase(), since = Number(q.get("since") || 0);
  if (!isAddr(start)) return json({ error: "Not a wallet address." }, 400);
  const chain = chainOf(q.get("chain")), depth = Math.min(3, Math.max(1, Number(q.get("depth")) || 2));
  const t = tracer(env, "fund-trace", { address: start, since, chain: chain.key });
  try {
    const nodes = { [start]: { id: start, hop: 0, usd: 0 } }, links = [];
    let frontier = [start];
    for (let hop = 1; hop <= depth && frontier.length; hop++) {
      const lists = await t.step("alchemy_transfers_out", { hop, addresses: frontier }, () => Promise.all(frontier.map(a => transfers(env, a, "out", 300, chain).catch(() => []))));
      const flat = lists.flat().filter(x => x.ts >= since);
      await t.step("defillama_prices", { hop, transfers: flat.length }, () => priceAll(flat));
      const next = {};
      for (const t of flat) {
        // burns (the zero and dead addresses) destroy tokens or redeem them; nobody received them, so they are not part of the trail
        if (t.to === t.from || t.to === "0x0000000000000000000000000000000000000000" || t.to === "0x000000000000000000000000000000000000dead") continue;
        const k = t.from + ">" + t.to, l = next[k] || (next[k] = { source: t.from, target: t.to, usd: 0, count: 0, assets: {}, first: t.ts, hashes: [] });
        l.usd += t.usd; l.count++; l.assets[t.asset] = 1; l.first = Math.min(l.first, t.ts); if (l.hashes.length < 3 && !l.hashes.includes(t.hash)) l.hashes.push(t.hash);
      }
      // keep the biggest few edges per source so the picture stays readable
      const kept = [];
      for (const a of frontier) kept.push(...Object.values(next).filter(l => l.source === a).sort((x, y) => y.usd - x.usd || y.count - x.count).slice(0, hop === 1 ? 8 : 4));
      const targets = [...new Set(kept.map(l => l.target))];
      const lab = await t.step("address_labels", { hop, addresses: kept.length }, () => labels(env, request, targets));
      for (const a in lab) if (lab[a].kind === "exchange" && swapLike(lab[a].name)) lab[a] = { ...lab[a], kind: "swap" };
      // an unlabelled contract is a DEX pool, a router or a protocol, not a person: the trail does not go through it
      const bare = targets.filter(a => !lab[a] && !nodes[a]);
      const codes = bare.length ? await t.step("eth_getCode_batch", { hop, addresses: bare.length }, () => batch(env, chain, bare.map(a => ["eth_getCode", [a, "latest"]])).catch(() => [])) : [];
      bare.forEach((a, i) => { const c = codes[i]; if (c && c !== "0x" && !c.startsWith("0xef0100")) lab[a] = { kind: "contract", name: "Contract (DEX, pool or protocol)" }; });
      frontier = [];
      for (const l of kept) {
        const known = lab[l.target];
        if (!nodes[l.target]) {
          nodes[l.target] = { id: l.target, hop, usd: 0, kind: known ? known.kind : "unknown", name: known ? known.name : null };
          if (!known || !STOP.includes(known.kind)) frontier.push(l.target);
        }
        nodes[l.target].usd += l.usd;
        links.push({ source: l.source, target: l.target, usd: Math.round(l.usd * 100) / 100, count: l.count, assets: Object.keys(l.assets).slice(0, 6), first: l.first, hashes: l.hashes, chain: chain.key });
      }
      frontier = frontier.slice(0, 5);
    }
    // An unlabelled address that forwards nearly everything to one exchange is that exchange's deposit address for somebody's account.
    const loose = Object.values(nodes).filter(n => n.kind === "unknown" && n.hop > 0).sort((a, b) => b.usd - a.usd).slice(0, 6);
    if (loose.length) {
      const outs = await t.step("deposit_address_check", { addresses: loose.length }, () => Promise.all(loose.map(n => transfers(env, n.id, "out", 25, chain).catch(() => []))));
      const lab2 = await labels(env, request, [...new Set(outs.flat().map(x => x.to))]);
      loose.forEach((n, i) => {
        const o = outs[i]; if (o.length < 1) return;
        const tally = {}; o.forEach(x => { const l = lab2[x.to]; if (l && l.kind === "exchange") tally[l.name] = (tally[l.name] || 0) + 1; });
        const best = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
        if (best && best[1] / o.length >= 0.7) { n.kind = "deposit"; n.name = "Deposit address → " + best[0].replace(/[: ]+\d+$/, ""); }
      });
    }
    nodes[start].kind = "start";
    // money that went into a bridge: ask the bridges where it came out
    const into = links.filter(l => nodes[l.target].kind === "bridge").sort((a, b) => b.usd - a.usd).slice(0, 4);
    const crossings = (await t.step("bridge_resolve", { links: into.length }, () => Promise.all(into.map(l => resolveBridge(chain, l.hashes[0]).then(r => r && { ...r, from: l.source, bridge: l.target, hash: l.hashes[0], usd: l.usd, ts: l.first })))))
      .filter(c => c && c.toChainId && c.toChainId !== chain.id); // a same-chain swap is not a crossing
    // the ends of the trail that were not followed further: the page can carry on from them
    const ends = Object.values(nodes).filter(n => n.hop === depth && n.kind === "unknown").sort((a, b) => b.usd - a.usd).slice(0, 4).map(n => n.id);
    t.done({ nodes: Object.keys(nodes).length, links: links.length, crossings: crossings.length });
    return json({ start, chain: chain.key, depth, nodes: Object.values(nodes).map(n => ({ ...n, usd: Math.round(n.usd * 100) / 100 })), links, crossings, loose: ends });
  } catch (e) {
    t.fail(e);
    return json({ error: "The trace failed: " + e.message }, 502);
  } finally {
    ctx.waitUntil(t.send());
  }
}

// Where a bridge deposit paid out. Each service is asked in turn; the first that knows the transaction answers.
// whatever the bridges say is untrusted: only a real address or transaction hash gets through
const cleanAddr = a => { const v = String(a || ""); return /^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v) ? v : null; };
const cleanHash = h => { const v = String(h || ""); return /^0x[0-9a-fA-F]{64}$/.test(v) || /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(v) ? v : null; };
async function resolveBridge(chain, hash) {
  const r = await askBridges(chain, hash);
  return r && { tool: String(r.tool).replace(/[^\w .()-]/g, "").slice(0, 40), status: String(r.status || "").replace(/\W/g, "").slice(0, 20), toChainId: Number(r.toChainId) || null, toChain: r.toChain, recipient: cleanAddr(r.recipient), outHash: cleanHash(r.outHash) };
}
async function askBridges(chain, hash) {
  const get = u => fetch(u, { headers: { accept: "application/json" } }).then(r => r.ok ? r.json() : null).catch(() => null);
  const keyOf = id => SOLANA_IDS.includes(Number(id)) ? "solana" : (CHAINS.find(c => c.id === Number(id)) || {}).key || null;
  const relay = await get("https://api.relay.link/requests/v2?hash=" + hash);
  const rq = relay && relay.requests && relay.requests[0];
  if (rq && rq.data && rq.data.outTxs && rq.data.outTxs.length) {
    const o = rq.data.outTxs[0];
    return { tool: "Relay", status: rq.status, toChainId: Number(o.chainId), toChain: keyOf(o.chainId), recipient: String(rq.recipient || "").toLowerCase().startsWith("0x") ? rq.recipient.toLowerCase() : rq.recipient, outHash: o.hash };
  }
  const lifi = await get("https://li.quest/v1/status?txHash=" + hash + "&fromChain=" + chain.id);
  if (lifi && lifi.receiving && lifi.receiving.chainId) {
    return { tool: "LI.FI" + (lifi.tool ? " (" + lifi.tool + ")" : ""), status: lifi.status, toChainId: Number(lifi.receiving.chainId), toChain: keyOf(lifi.receiving.chainId), recipient: String(lifi.toAddress || lifi.receiving.address || "").toLowerCase() || null, outHash: lifi.receiving.txHash || null };
  }
  const across = await get("https://app.across.to/api/deposit/status?originChainId=" + chain.id + "&depositTxnRef=" + hash);
  if (across && across.destinationChainId) {
    return { tool: "Across", status: across.status, toChainId: Number(across.destinationChainId), toChain: keyOf(across.destinationChainId), recipient: across.recipient ? String(across.recipient).toLowerCase() : null, outHash: across.fillTx || across.fillTxnRef || null };
  }
  return null;
}
