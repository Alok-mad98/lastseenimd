import { isAddr, json, CHAINS, chainOf, batch, rpc, transferParams, mapTransfers, priceAll, labels, goplusAddress, goplusApprovals, tracer } from "../_lib.js";

// chains the IMD oracle can read evidence on (api.imd.fun /requests/check, 14 Oct 2026)
const ORACLE_CHAINS = ["base", "arb", "bnb", "eth", "robinhood"];

// GET /api/scan?address=0x…  →  everything the case file needs for one wallet, across every chain we can read.
const BURN = ["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"];
// EIP-7702 delegates that belong to well-known wallet software. Anything else is "not recognised", which is not the same as "malicious".
const SAFE_DELEGATES = {
  "0x63c0c19a282a1b52b07dd5a65b58948a07dae32b": "MetaMask smart account",
  "0x5a7fc11397e9a8ad41bf10bf13f22b0a63f96f6d": "Ambire smart account",
  "0x000000009b1d0af20d8c6d0a44e162d11f9b8f00": "Uniswap wallet (Calibur)",
  "0x7702cb554e6bfb442cb743a7df23154544a7176c": "Coinbase smart wallet",
};
const OWN_USE = ["exchange", "swap", "bridge", "other"]; // labelled services: the owner's ordinary activity
const DEFAULT = ["eth", "base", "arb", "opt", "bnb", "polygon"], MAX_CHAINS = 10; // more chains than this would break the per-request limits of the host
const cap = k => k === "eth" ? 500 : 300;

export async function onRequestGet(ctx) {
  const { request, env } = ctx;
  const address = (new URL(request.url).searchParams.get("address") || "").toLowerCase();
  if (!isAddr(address)) return json({ error: "That is not a wallet address. It should start with 0x and have 42 characters." }, 400);
  const asked = (new URL(request.url).searchParams.get("chains") || "").split(",").filter(k => CHAINS.some(c => c.key === k));
  const LIST = (asked.length ? [...new Set(asked)] : DEFAULT).slice(0, MAX_CHAINS).map(chainOf);
  const t = tracer(env, "wallet-scan", { address, chains: LIST.map(c => c.key) });
  try {
    // 1. one batched request per chain: transfers both ways, account code, nonce, balance
    const per = await Promise.all(LIST.map(ch => t.step("alchemy_chain_batch", { chain: ch.key, address }, () => batch(env, ch, [
      ["alchemy_getAssetTransfers", [transferParams(address, "out", cap(ch.key), ch)]], ["alchemy_getAssetTransfers", [transferParams(address, "in", cap(ch.key), ch)]],
      ["eth_getCode", [address, "latest"]], ["eth_getTransactionCount", [address, "latest"]], ["eth_getBalance", [address, "latest"]],
    ]).catch(() => null))));
    const out = [], inn = [], chains = [];
    LIST.forEach((ch, i) => {
      const r = per[i]; if (!r || !r[0]) { chains.push({ key: ch.key, id: ch.id, name: ch.name, explorer: ch.explorer, ok: false }); return; }
      const o = mapTransfers(r[0], "out", ch), n = mapTransfers(r[1], "in", ch), code = r[2] || "0x";
      out.push(...o); inn.push(...n);
      const delegate = code.startsWith("0xef0100") ? "0x" + code.slice(8, 48) : null;
      chains.push({ key: ch.key, id: ch.id, name: ch.name, explorer: ch.explorer, native: ch.native, ok: true, outCount: o.length, inCount: n.length, capped: o.length >= cap(ch.key) || n.length >= cap(ch.key),
        txCount: parseInt(r[3] || "0x0", 16), balance: parseInt(r[4] || "0x0", 16) / 1e18, isContract: code !== "0x" && !delegate, delegate, delegateName: delegate ? SAFE_DELEGATES[delegate] || null : null });
    });
    if (chains.every(c => !c.ok)) throw new Error("no chain could be read");
    const all = out.concat(inn);

    // 2. prices, approvals, flags, and who actually signed the most recent outgoing transactions
    const active = chains.filter(c => c.ok && (c.outCount || c.inCount));
    const [ethPrice, flags, apLists, txMaps] = await Promise.all([
      t.step("defillama_prices", { transfers: all.length }, () => priceAll(all)),
      t.step("goplus_address_security", { address }, () => goplusAddress(address)),
      Promise.all(active.map(c => t.step("goplus_token_approvals", { chain: c.key }, () => goplusApprovals(address, chainOf(c.key).id)).then(l => l && l.map(a => ({ ...a, chain: c.key }))))),
      Promise.all(active.map(c => {
        const hashes = [...new Set(out.filter(x => x.chain === c.key).map(x => x.hash))].slice(0, 40);
        return t.step("eth_getTransactionByHash_batch", { chain: c.key, hashes: hashes.length }, () => batch(env, chainOf(c.key), hashes.map(h => ["eth_getTransactionByHash", [h]])).then(r => Object.fromEntries(hashes.map((h, i) => [h, r[i]]))).catch(() => ({})));
      })),
    ]);
    const approvals = apLists.some(l => l) ? apLists.filter(Boolean).flat() : (active.length ? null : []);
    const tx = Object.assign({}, ...txMaps);
    for (const x of out) { const d = tx[x.hash]; if (d) { x.signer = d.from.toLowerCase(); x.type4 = d.type === "0x4"; x.txType = parseInt(d.type || "0x0", 16); } }

    // 3. who this wallet sends to / receives from
    const agg = list => {
      const m = {};
      for (const x of list) {
        const k = x.dir === "out" ? x.to : x.from;
        const c = m[k] || (m[k] = { address: k, usd: 0, count: 0, assets: {}, chains: {}, first: x.ts || Infinity, last: x.ts });
        c.usd += x.usd; c.count++; c.assets[x.asset] = 1; c.chains[x.chain] = 1; c.first = Math.min(c.first, x.ts || Infinity); c.last = Math.max(c.last, x.ts);
      }
      return Object.values(m).map(c => ({ ...c, assets: Object.keys(c.assets).slice(0, 8), chains: Object.keys(c.chains) })).sort((a, b) => b.usd - a.usd || b.count - a.count);
    };
    const sent = agg(out), received = agg(inn);
    for (const c of sent.concat(received)) if (c.first === Infinity) c.first = c.last || null; // some chains return no timestamps
    const sweep = findSweeper(out, address, new Set(chains.filter(c => c.delegate && !c.delegateName).map(c => c.key))), poison = findPoisoning(out, sent);
    const candidates = findIncidents(out, address), keySweeps = findKeySweep(out, address, chains.filter(c => c.delegate && !c.delegateName).length);
    const want = [...new Set(sent.slice(0, 50).map(c => c.address).concat(received.slice(0, 25).map(c => c.address), candidates.map(c => c.to), sweep.map(s => s.address), keySweeps.map(k => k.address), (approvals || []).slice(0, 40).map(a => a.spender)))];
    const lab = await t.step("address_labels", { addresses: want.length }, () => labels(env, request, want));
    const tag = c => Object.assign(c, lab[c.address] ? { kind: lab[c.address].kind, name: lab[c.address].name } : { kind: "unknown", name: null });
    sent.forEach(tag); received.forEach(tag);
    const fake = new Set(poison.map(p => p.fake));
    sent.forEach(c => { if (fake.has(c.address)) { c.kind = "poison"; c.name = "Look-alike address (poisoning)"; } });

    // 4. the verdict
    // a sweeper pulls funds out with its own transactions; a labelled service doing that is a relayer, not a thief
    const sweeper = sweep.find(s => !lab[s.address] || !OWN_USE.includes(lab[s.address].kind)) || null;
    const strange = chains.filter(c => c.delegate && !c.delegateName);
    // the wallet's own key emptying it across chains: only to an address no public label explains
    const keySweep = sweeper ? null : keySweeps.find(k => !lab[k.address]) || null;
    if (keySweep) { const c = sent.find(x => x.address === keySweep.address); if (c) { c.kind = "bad"; c.name = "Emptied the wallet with its key"; } }
    if (strange.length) {
      const ver = await Promise.all(strange.map(c => t.step("sourcify_lookup", { chain: c.key, address: c.delegate }, () => fetch("https://sourcify.dev/server/v2/contract/" + chainOf(c.key).id + "/" + c.delegate).then(r => r.json()).then(j => !!j.match).catch(() => null))));
      strange.forEach((c, i) => c.delegateVerified = ver[i]);
    }
    if (sweeper) {
      const c = sent.find(x => x.address === sweeper.address);
      Object.assign(sweeper, { totalCount: c ? c.count : sweeper.count, totalUsd: c ? Math.round(c.usd * 100) / 100 : 0, first: c ? c.first : sweeper.first, last: c ? c.last : sweeper.last, allChains: c ? c.chains : sweeper.chains });
      sweeper.flags = await t.step("goplus_address_security", { address: sweeper.address }, () => goplusAddress(sweeper.address, chainOf(sweeper.chains[0]).id));
      if (c) { c.kind = "bad"; c.name = "Sweeper: takes whatever arrives"; }
      // the question the swarm would be asked: a chain it can read, and a block window around the sweeping
      const sc = ORACLE_CHAINS.find(k => sweeper.chains.includes(k)) || ORACLE_CHAINS.find(k => sweeper.allChains.includes(k));
      if (sc) {
        const ch = chainOf(sc);
        sweeper.swarmCase = await t.step("swarm_case_window", { chain: sc }, async () => {
          const head = parseInt(await rpc(env, "eth_blockNumber", [], ch), 16);
          const at = ts => fetch("https://coins.llama.fi/block/" + ch.llama + "/" + ts).then(r => r.json()).then(j => j.height).catch(() => null);
          const from = await at(Math.max(0, sweeper.first - 3600));
          return { chain: sc, chainName: ch.name, chainId: ch.id, fromBlock: from || Math.max(1, head - 2000000), toBlock: head - 10 };
        }).catch(() => null);
      }
    }
    const compromise = {
      level: (sweeper || keySweep) && (sweeper && sweeper.type4 || strange.length) ? "confirmed" : sweeper || keySweep ? "likely" : strange.length ? "suspected" : "none",
      sweeper, keySweep, delegations: chains.filter(c => c.delegate).map(c => ({ chain: c.key, chainName: c.name, delegate: c.delegate, name: c.delegateName, verified: c.delegateVerified == null ? null : c.delegateVerified })), poisoning: poison,
    };

    // a burst of several assets leaving at once, on top of the sweeper check; moving funds to a labelled service is ordinary use
    const incident = candidates.find(c => (!lab[c.to] || ["bad", "mixer", "sanctioned"].includes(lab[c.to].kind)) && !fake.has(c.to)) || null;
    if (incident) {
      delete incident.score;
      const signers = [...new Set(incident.hashes.map(h => tx[h] && tx[h].from.toLowerCase()).filter(Boolean))];
      incident.signers = signers; incident.signedByOwner = signers.length ? signers.every(s => s === address) : null;
      incident.method = incident.signedByOwner === false ? "approval" : "key";
      incident.receiverFlags = await t.step("goplus_address_security", { address: incident.to }, () => goplusAddress(incident.to, chainOf(incident.chain).id));
      const l = lab[incident.to]; incident.receiverKind = l ? l.kind : "unknown"; incident.receiverName = l ? l.name : null;
    }
    (approvals || []).forEach(a => { const l = lab[a.spender]; if (l) { a.kind = l.kind; a.spenderName = a.spenderName || l.name; } });

    const risk = scoreRisk({ incident, compromise, approvals, flags, sent });
    const mine = sent.filter(c => OWN_USE.includes(c.kind)), away = sent.filter(c => !OWN_USE.includes(c.kind) && !BURN.includes(c.address));
    t.done({ risk: risk.score, level: risk.level, compromise: compromise.level, incident: !!incident, outCount: out.length, inCount: inn.length });
    return json({
      address, ethPrice, chains, flags, approvals, approvalsAvailable: approvals !== null, compromise, incident, risk,
      balanceEth: chains.filter(c => c.ok && c.native === "ETH").reduce((a, c) => a + c.balance, 0), txCount: chains.reduce((a, c) => a + (c.txCount || 0), 0),
      sent: sent.slice(0, 40), received: received.slice(0, 20),
      split: { ownUsd: sum2(mine), ownCount: cnt(mine), awayUsd: sum2(away), awayCount: cnt(away) },
      totals: { outUsd: sum(out), inUsd: sum(inn), outCount: out.length, inCount: inn.length, capped: chains.some(c => c.capped), first: all.some(x => x.ts) ? Math.min(...all.filter(x => x.ts).map(x => x.ts)) : null, last: all.some(x => x.ts) ? Math.max(...all.map(x => x.ts)) : null },
      series: series(all), tokensOut: byToken(out), endpoints: byKind(sent),
      sweeps: sweeper ? out.filter(x => x.to === sweeper.address).sort((a, b) => b.ts - a.ts).slice(0, 60).map(x => ({ h: x.hash, ts: x.ts, c: x.chain, a: x.asset, v: x.value, u: Math.round(x.usd * 100) / 100, by: x.signer ? (x.signer === address ? "owner key" : x.signer === x.to ? "the receiver" : "third party") : "not checked", t4: !!x.type4 })) : [],
      transfers: all.sort((a, b) => b.ts - a.ts).slice(0, 600).map(x => ({ h: x.hash, ts: x.ts, d: x.dir, c: x.chain, a: x.asset, v: x.value, u: Math.round(x.usd * 100) / 100, p: x.dir === "out" ? x.to : x.from })),
      story: story({ incident, compromise, approvals, flags, risk, out, inn, chains }),
    });
  } catch (e) {
    t.fail(e);
    return json({ error: "The scan failed: " + e.message }, 502);
  } finally {
    ctx.waitUntil(t.send());
  }
}

const sum = l => Math.round(l.reduce((a, x) => a + x.usd, 0) * 100) / 100;
const sum2 = l => Math.round(l.reduce((a, x) => a + x.usd, 0));
const cnt = l => l.reduce((a, x) => a + x.count, 0);

// A sweeper is an address that takes this wallet's funds with transactions it sends itself (so the owner never clicked anything),
// or with an EIP-7702 transaction, which needs a signature only the wallet's private key can make.
function findSweeper(out, self, strangeChains) {
  const m = {};
  for (const x of out) {
    if (!x.signer || x.signer === self || BURN.includes(x.to)) continue;
    if (!x.priced && !x.type4) continue; // anyone can deploy a fake token that claims a transfer from this wallet; only real assets count
    if (x.signer !== x.to && !(x.type4 && strangeChains.has(x.chain))) continue; // a sponsored 7702 transaction through known wallet software is ordinary
    const s = m[x.to] || (m[x.to] = { address: x.to, count: 0, usd: 0, type4: false, chains: {}, first: x.ts || Infinity, last: x.ts });
    s.count++; s.usd += x.usd; s.type4 = s.type4 || x.type4; s.chains[x.chain] = 1; s.first = Math.min(s.first, x.ts || Infinity); s.last = Math.max(s.last, x.ts);
  }
  return Object.values(m).map(s => ({ ...s, first: s.first === Infinity ? s.last : s.first, chains: Object.keys(s.chains), usd: Math.round(s.usd * 100) / 100 })).sort((a, b) => (b.type4 - a.type4) || b.count - a.count);
}

// Address poisoning: a scammer fakes a transfer "from" this wallet to an address that starts and ends like one the owner really uses,
// hoping the owner copies the wrong one from their history later.
function findPoisoning(out, sent) {
  const groups = {};
  for (const c of sent) { if (BURN.includes(c.address)) continue; const k = c.address.slice(0, 6) + c.address.slice(-4); (groups[k] = groups[k] || []).push(c); }
  const pairs = [];
  for (const k in groups) {
    const g = groups[k]; if (g.length < 2) continue;
    const real = g.slice().sort((a, b) => b.usd - a.usd || a.first - b.first)[0];
    for (const f of g) if (f !== real && f.usd < Math.max(1, real.usd / 100)) pairs.push({ real: real.address, fake: f.address, chains: f.chains, count: f.count, last: f.last, assets: f.assets.slice(0, 3) });
  }
  return pairs.sort((a, b) => b.last - a.last).slice(0, 20);
}

// A stolen key used directly looks like the owner: same signer, ordinary transactions. What gives it away is the sweep: the native coin
// on several chains going to one new address within hours, at the end of the wallet's activity there. On its own that could be the owner
// moving to a new wallet, so it also needs an unknown delegation, the older transaction format the owner does not normally use, or 3+ chains.
function findKeySweep(out, self, strangeCount) {
  const native = out.filter(x => x.cat === "external" && x.to !== self && !BURN.includes(x.to) && x.ts);
  const lastOn = {}; out.forEach(x => { if (x.ts) lastOn[x.chain] = Math.max(lastOn[x.chain] || 0, x.ts); });
  const typed = out.filter(x => x.txType != null && x.signer === self), legacyShare = typed.length ? typed.filter(x => x.txType === 0).length / typed.length : 0;
  const by = {}; native.forEach(x => (by[x.to] = by[x.to] || []).push(x));
  const found = [];
  for (const to in by) {
    const l = by[to].filter(x => x.ts >= lastOn[x.chain] - 2 * 86400).sort((a, b) => a.ts - b.ts);
    if (!l.length) continue;
    const win = l.filter(x => x.ts <= l[0].ts + 12 * 3600), chains = [...new Set(win.map(x => x.chain))];
    if (chains.length < 2) continue;
    if (out.some(x => x.to === to && x.ts && x.ts < l[0].ts - 86400)) continue; // a regular counterparty, not a new address
    const legacy = win.some(x => x.txType === 0) && legacyShare < 0.5;
    if (!strangeCount && !legacy && chains.length < 3) continue;
    found.push({ address: to, chains, count: win.length, usd: Math.round(win.reduce((a, x) => a + x.usd, 0) * 100) / 100, first: l[0].ts, last: win[win.length - 1].ts, legacy,
      items: win.map(x => ({ h: x.hash, ts: x.ts, c: x.chain, a: x.asset, v: x.value, u: Math.round(x.usd * 100) / 100, t: x.txType })) });
  }
  return found.sort((a, b) => b.chains.length - a.chains.length || b.count - a.count);
}

// A drain can also look like many different assets leaving for one address in a short time.
function findIncidents(out, self) {
  const by = {};
  for (const x of out) if (x.to !== self && !BURN.includes(x.to)) (by[x.chain + x.to] = by[x.chain + x.to] || []).push(x);
  const found = [];
  for (const k in by) {
    let best = null;
    const l = by[k].sort((a, b) => a.ts - b.ts);
    for (let i = 0; i < l.length; i++) {
      const w = l.filter(x => x.ts >= l[i].ts && x.ts <= l[i].ts + 3600);
      const assets = new Set(w.map(x => x.asset + (x.contract || "")));
      if (assets.size < 3) continue;
      const usd = w.reduce((a, x) => a + x.usd, 0);
      if (usd < 100) continue; // unpriced spam tokens moving around are not a theft
      const score = assets.size * 10 + Math.log10(1 + usd) * 5;
      if (!best || score > best.score) best = { score, to: l[0].to, chain: l[0].chain, start: w[0].ts, end: w[w.length - 1].ts, usd: Math.round(usd * 100) / 100, assetCount: assets.size, transferCount: w.length, hashes: [...new Set(w.map(x => x.hash))], items: w.slice(0, 40).map(x => ({ h: x.hash, ts: x.ts, c: x.chain, a: x.asset, v: x.value, u: Math.round(x.usd * 100) / 100 })) };
    }
    if (best) found.push(best);
  }
  return found.sort((a, b) => b.score - a.score).slice(0, 5);
}

function scoreRisk({ incident, compromise, approvals, flags, sent }) {
  const a = approvals || [];
  const risky = a.filter(x => x.risky).length, unlimited = a.filter(x => x.unlimited && !x.trusted).length, closed = a.filter(x => x.isContract && !x.openSource).length;
  const badPeers = sent.filter(c => ["bad", "sanctioned", "mixer"].includes(c.kind) && !BURN.includes(c.address)).length;
  const strange = compromise.delegations.filter(d => !d.name).length;
  const parts = {
    "Key compromised": { confirmed: 100, likely: 85, suspected: 55, none: 0 }[compromise.level],
    "Past drain": incident || compromise.keySweep ? 100 : 0,
    "Risky approvals": Math.min(100, risky * 50 + closed * 10),
    "Open allowances": Math.min(100, unlimited * 12),
    "Unknown delegation": Math.min(100, strange * 40),
    "Being targeted": Math.min(100, compromise.poisoning.length * 25 + badPeers * 20 + flags.length * 50),
  };
  let score = Math.round(parts["Past drain"] * 0.4 + parts["Risky approvals"] * 0.3 + parts["Open allowances"] * 0.15 + parts["Unknown delegation"] * 0.3 + parts["Being targeted"] * 0.15);
  score = Math.min(100, Math.max(score, { confirmed: 97, likely: 85, suspected: 60, none: 0 }[compromise.level]));
  return { score, level: score >= 60 ? "high" : score >= 25 ? "medium" : "low", parts, counts: { approvals: a.length, risky, unlimited, closed, badPeers, strange } };
}

function series(all) {
  const months = {}, days = {}, heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const x of all) {
    if (!x.ts) continue;
    const d = new Date(x.ts * 1000), m = d.toISOString().slice(0, 7), day = d.toISOString().slice(0, 10);
    const o = months[m] || (months[m] = { m, inUsd: 0, outUsd: 0, inN: 0, outN: 0 });
    if (x.dir === "in") { o.inUsd += x.usd; o.inN++; } else { o.outUsd += x.usd; o.outN++; }
    days[day] = (days[day] || 0) + 1;
    heat[d.getUTCDay()][d.getUTCHours()]++;
  }
  return { months: Object.values(months).sort((a, b) => a.m < b.m ? -1 : 1).map(o => ({ ...o, inUsd: Math.round(o.inUsd), outUsd: Math.round(o.outUsd) })), days, heat };
}

function byToken(out) {
  const m = {};
  for (const x of out) { const o = m[x.asset] || (m[x.asset] = { asset: x.asset, usd: 0, count: 0 }); o.usd += x.usd; o.count++; }
  return Object.values(m).sort((a, b) => b.usd - a.usd || b.count - a.count).slice(0, 12).map(o => ({ ...o, usd: Math.round(o.usd) }));
}

function byKind(sent) {
  const m = {};
  for (const c of sent) { const o = m[c.kind] || (m[c.kind] = { kind: c.kind, usd: 0, count: 0 }); o.usd += c.usd; o.count += c.count; }
  return Object.values(m).map(o => ({ ...o, usd: Math.round(o.usd) }));
}

const when = ts => new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
const money = u => "$" + Math.round(u).toLocaleString("en-US");
const names = l => l.length > 1 ? l.slice(0, -1).join(", ") + " and " + l[l.length - 1] : l[0];

// The plain-words version, delivered in the app as text messages.
function story({ incident, compromise, approvals, flags, risk, out, inn, chains }) {
  const s = [], cn = k => chainOf(k).name;
  if (!out.length && !inn.length) return ["This wallet has never moved anything on the chains I can read. There is nothing to trace yet."];
  const sw = compromise.sweeper, strange = compromise.delegations.filter(d => !d.name);
  if (sw) {
    s.push("This wallet is compromised. Do not send anything to it.");
    s.push(`An address ending ${sw.address.slice(-4)} is taking funds out with transactions it sends itself. I counted ${sw.totalCount} transfers to it on ${names(sw.allChains.map(cn))}, the latest on ${when(sw.last)}.`);
    if (sw.type4) s.push("It used an EIP-7702 transaction to do it. That needs a signature made with this wallet's private key, so the attacker has the key or the seed phrase. Revoking approvals will not fix this.");
    else s.push("You did not sign those transactions. Someone else can move this wallet's funds.");
  }
  const ks = compromise.keySweep;
  if (ks) {
    s.push("This wallet was emptied with its own key. Do not send anything to it.");
    s.push(`On ${when(ks.first)}, its ${names([...new Set(ks.items.map(x => x.a))])} on ${names(ks.chains.map(cn))} went to one new address ending ${ks.address.slice(-4)}, ${ks.count} transfer${ks.count > 1 ? "s" : ""} within ${Math.max(1, Math.round((ks.last - ks.first) / 3600))} hour${Math.round((ks.last - ks.first) / 3600) > 1 ? "s" : ""}, at the end of the wallet's activity on each chain.`);
    s.push((ks.legacy ? "They used an older transaction format this wallet does not normally use: the mark of a script holding the key, not a wallet app. " : "") + "They were signed with this wallet's key, so the attacker has the key or the seed phrase. If you moved everything to a new wallet yourself that day, ignore this.");
  }
  if (strange.length) s.push(`${sw || ks ? "The wallet is also" : "This wallet is"} delegated to a contract I do not recognise on ${names(strange.map(d => d.chainName))}${strange.length > 1 && new Set(strange.map(d => d.delegate)).size > 1 ? ", a different one on each chain" : ""}. A delegate contract can act as the wallet. ${sw ? "That is how incoming funds get swept." : "If you did not set this up, treat the wallet as compromised."}`);
  const known = compromise.delegations.filter(d => d.name);
  if (known.length && !sw) s.push(`It is delegated to ${known[0].name} on ${names(known.map(d => d.chainName))}. That is ordinary wallet software.`);
  if (incident) {
    s.push(`On ${when(incident.start)}, ${incident.assetCount} different assets left on ${cn(incident.chain)} in ${incident.transferCount} transfers to one address. At today's prices that is about ${money(incident.usd)}.`);
    if (incident.method === "approval") s.push("Those transfers were sent by a different address, using a permission this wallet had given.");
    else if (!sw) s.push("They were signed with this wallet's own key. If you did not send them, someone else has your seed phrase.");
    if (incident.receiverFlags && incident.receiverFlags.length) s.push(`The receiving address is flagged for: ${incident.receiverFlags.join(", ")}.`);
    else if (["bad", "mixer", "sanctioned"].includes(incident.receiverKind)) s.push(`The receiving address is publicly labelled “${incident.receiverName}”.`);
  } else if (!sw && !strange.length) s.push("I found no sweeper, no unknown delegation, and no moment where many assets left at once. Those are the usual signs of a stolen key or a drain, and they are not here.");
  if (compromise.poisoning.length) s.push(`Someone is also trying address poisoning: ${compromise.poisoning.length} fake transfer${compromise.poisoning.length > 1 ? "s" : ""} to look-alike addresses sit in this wallet's history. Never copy an address from your history. Check every character.`);
  if (approvals === null) s.push("I could not load the token approvals right now.");
  else if (risk.counts.risky) s.push(`${risk.counts.risky} approval${risk.counts.risky > 1 ? "s point" : " points"} at a contract flagged as malicious.`);
  else if (risk.counts.unlimited && !sw) s.push(`${risk.counts.unlimited} contract${risk.counts.unlimited > 1 ? "s" : ""} can still spend an unlimited amount of a token from this wallet. Revoke the ones you no longer use.`);
  if (flags.length) s.push(`This address itself is flagged for: ${flags.join(", ")}.`);
  const bad = chains.filter(c => !c.ok).map(c => c.name);
  if (bad.length) s.push(`I could not read ${names(bad)} just now, so this picture is incomplete.`);
  s.push(`Risk score: ${risk.score} out of 100.`);
  return s;
}
