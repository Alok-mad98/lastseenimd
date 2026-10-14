import { isAddr, json, transfers, priceAll, labels, tracer, chainOf } from "../_lib.js";

// GET /api/trace?address=0x…&since=unix  →  where the money went next, two hops deep.
// The trail stops at exchanges, mixers and bridges: what happens inside them is not public.
const STOP = ["exchange", "mixer", "bridge", "sanctioned"];
export async function onRequestGet(ctx) {
  const { request, env } = ctx;
  const q = new URL(request.url).searchParams;
  const start = (q.get("address") || "").toLowerCase(), since = Number(q.get("since") || 0);
  if (!isAddr(start)) return json({ error: "Not a wallet address." }, 400);
  const chain = chainOf(q.get("chain"));
  const t = tracer(env, "fund-trace", { address: start, since, chain: chain.key });
  try {
    const nodes = { [start]: { id: start, hop: 0, usd: 0 } }, links = [];
    let frontier = [start];
    for (let hop = 1; hop <= 2 && frontier.length; hop++) {
      const lists = await t.step("alchemy_transfers_out", { hop, addresses: frontier }, () => Promise.all(frontier.map(a => transfers(env, a, "out", 300, chain).catch(() => []))));
      const flat = lists.flat().filter(x => x.ts >= since);
      await t.step("defillama_prices", { hop, transfers: flat.length }, () => priceAll(flat));
      const next = {};
      for (const t of flat) {
        if (t.to === t.from) continue;
        const k = t.from + ">" + t.to, l = next[k] || (next[k] = { source: t.from, target: t.to, usd: 0, count: 0, assets: {}, first: t.ts });
        l.usd += t.usd; l.count++; l.assets[t.asset] = 1; l.first = Math.min(l.first, t.ts);
      }
      // keep the biggest few edges per source so the picture stays readable
      const kept = [];
      for (const a of frontier) kept.push(...Object.values(next).filter(l => l.source === a).sort((x, y) => y.usd - x.usd || y.count - x.count).slice(0, hop === 1 ? 8 : 4));
      const lab = await t.step("address_labels", { hop, addresses: kept.length }, () => labels(env, request, [...new Set(kept.map(l => l.target))]));
      frontier = [];
      for (const l of kept) {
        const known = lab[l.target];
        if (!nodes[l.target]) {
          nodes[l.target] = { id: l.target, hop, usd: 0, kind: known ? known.kind : "unknown", name: known ? known.name : null };
          if (!known || !STOP.includes(known.kind)) frontier.push(l.target);
        }
        nodes[l.target].usd += l.usd;
        links.push({ source: l.source, target: l.target, usd: Math.round(l.usd * 100) / 100, count: l.count, assets: Object.keys(l.assets).slice(0, 6), first: l.first });
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
    t.done({ nodes: Object.keys(nodes).length, links: links.length });
    return json({ start, chain: chain.key, nodes: Object.values(nodes).map(n => ({ ...n, usd: Math.round(n.usd * 100) / 100 })), links });
  } catch (e) {
    t.fail(e);
    return json({ error: "The trace failed: " + e.message }, 502);
  } finally {
    ctx.waitUntil(t.send());
  }
}
