import { isAddr, json, chainOf, batch, transferParams, mapTransfers, labels } from "../_lib.js";

// GET /api/classify?chain=arb&addresses=0x…,0x…  →  what kind of address each one is, from how money moves through it.
//   deposit:   a few wallets pay in, and each payment is passed on within hours to one or two places. Exchanges, Polymarket,
//              bridges and payment apps give every user one of these. Money sent there is the owner's own deposit, not a theft.
//   collector: many different wallets pay in. A thief's address that sweeps victims looks like this.
//   wallet:    anything else.
// Up to 8 addresses per request, all in one batched call to the chain.
export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams, chain = chainOf(q.get("chain"));
  const list = [...new Set((q.get("addresses") || "").toLowerCase().split(",").filter(isAddr))].slice(0, 8);
  if (!list.length) return json({ error: "Give up to 8 addresses." }, 400);
  try {
    const calls = list.flatMap(a => [["alchemy_getAssetTransfers", [transferParams(a, "in", 40, chain)]], ["alchemy_getAssetTransfers", [transferParams(a, "out", 40, chain)]], ["eth_getCode", [a, "latest"]]]);
    const r = await batch(env, chain, calls);
    const rows = list.map((a, i) => ({ a, inn: mapTransfers(r[i * 3], "in", chain), out: mapTransfers(r[i * 3 + 1], "out", chain), code: r[i * 3 + 2] || "0x" }));
    const lab = await labels(env, request, [...new Set(rows.flatMap(x => x.out.map(t => t.to)))].slice(0, 200));
    const result = rows.map(({ a, inn, out, code }) => {
      const senders = new Set(inn.filter(t => t.value > 0).map(t => t.from)), dests = {};
      out.forEach(t => dests[t.to] = (dests[t.to] || 0) + 1);
      const top = Object.entries(dests).sort((x, y) => y[1] - x[1]), main = top.slice(0, 2).reduce((s, x) => s + x[1], 0);
      // each payment in is followed by a payment out within six hours
      const passed = inn.filter(t => t.value > 0 && t.ts && out.some(o => o.ts >= t.ts && o.ts - t.ts <= 6 * 3600)).length, paidIn = inn.filter(t => t.value > 0 && t.ts).length;
      const name = top.filter(([d]) => !/^0x0{36}(0000|dead)$/.test(d)).map(([d]) => lab[d] && lab[d].name).find(Boolean) || null;
      let kind = "wallet";
      if (senders.size >= 10) kind = "collector";
      else if (senders.size >= 1 && senders.size <= 4 && out.length && main / out.length >= 0.8 && paidIn && passed / paidIn >= 0.7) kind = "deposit";
      return { address: a, kind, senders: senders.size, service: name, forwardsTo: top.slice(0, 2).map(([d]) => d), isContract: code !== "0x" && !code.startsWith("0xef0100") };
    });
    return json({ chain: chain.key, result });
  } catch (e) {
    return json({ error: "Could not classify: " + e.message }, 502);
  }
}
