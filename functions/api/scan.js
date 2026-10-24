import { isAddr, json, CHAINS, chainOf, batch, rpc, transferParams, mapTransfers, priceAll, labels, goplusAddress, goplusApprovals, tracer } from "../_lib.js";
import { findKeySweep, METHODS } from "../../public/detect.js";

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
const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
// Payments the owner signed and a payment service submitted: the service sends the transaction and is often the one paid,
// which looks exactly like a sweeper. x402 settles through its Permit2 proxy or USDC's transferWithAuthorization (EIP-3009).
// Orders the owner signed and someone else filled are trades, not sweeps: OpenSea Seaport 1.5 and 1.6, CoW Protocol, UniswapX, 1inch.
// (A phished order signature looks the same on chain; the page says what it was so the owner can tell.)
const SIGNED_PAYMENT_TO = ["0x402085c248eea27d92e8b30b2c58ed07f9e20001", "0x0000000000000068f116a894984e2db1123eb395", "0x00000000000000adc04c56bf30ac9d3c0aaf14dc", "0x9008d19f58aabd9ed0d60971565aa8510560ab41", "0x00000011f84b9aa48e5f8aa8b9897600006289be", "0x6000da47483062a0d734ba3dc7576ce6a0b645c4", "0x111111125421ca6dc452d289314280a0f8842a65"], SIGNED_PAYMENT_SEL = ["0xe3ee160e", "0xef55bec6", "0xcf092995"];
const signedPayment = x => SIGNED_PAYMENT_TO.includes(x.txTo) || SIGNED_PAYMENT_SEL.includes(x.sel);
// ERC-4337 EntryPoints (v0.6, v0.7, v0.8): a bundler submits the owner's own smart-account operations. Only on a chain where the
// wallet is delegated to an unknown contract does a bundler moving funds mean the attacker's code is running.
const ENTRYPOINTS = ["0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789", "0x0000000071727de22e5e9d8baf0edac6f37da032", "0x4337084d9e255ff0702461cf8895ce9e3b5ff108"];
// function selectors that move tokens on someone else's behalf: transferFrom, safeTransferFrom (721/1155, both forms), permit, and Permit2's transfers
const PULL_SELECTORS = { "0x23b872dd": "transferFrom", "0x42842e0e": "safeTransferFrom", "0xb88d4fde": "safeTransferFrom", "0xf242432a": "safeTransferFrom", "0x2eb2c2d6": "safeBatchTransferFrom", "0xd505accf": "permit", "0x30f28b7a": "Permit2 permitTransferFrom", "0xedd9444b": "Permit2 permitTransferFrom", "0x36c78516": "Permit2 transferFrom", "0x0d58b1db": "Permit2 transferFrom", "0x2b67b570": "Permit2 permit", "0x2a2d80d1": "Permit2 permit" };
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
    // prices first: they decide which outgoing transfers get their signer checked
    const ethPrice = await t.step("defillama_prices", { transfers: all.length }, () => priceAll(all));
    const [flags, apLists, txMaps] = await Promise.all([
      t.step("goplus_address_security", { address }, () => goplusAddress(address)),
      Promise.all(active.map(c => t.step("goplus_token_approvals", { chain: c.key }, () => goplusApprovals(address, chainOf(c.key).id)).then(l => l && l.map(a => ({ ...a, chain: c.key }))))),
      Promise.all(active.map(c => {
        // poisoners flood a wallet with fake "outgoing" transfers; real money is checked first, newest first, then the rest
        const real = x => x.priced && x.usd >= 1 ? 1 : 0;
        const hashes = [...new Set(out.filter(x => x.chain === c.key).sort((a, b) => real(b) - real(a) || b.ts - a.ts).map(x => x.hash))].slice(0, 40);
        return t.step("eth_getTransactionByHash_batch", { chain: c.key, hashes: hashes.length }, () => batch(env, chainOf(c.key), hashes.map(h => ["eth_getTransactionByHash", [h]])).then(r => Object.fromEntries(hashes.map((h, i) => [h, r[i]]))).catch(() => ({})));
      })),
    ]);
    const approvals = apLists.some(l => l) ? apLists.filter(Boolean).flat() : (active.length ? null : []);
    const tx = Object.assign({}, ...txMaps);
    for (const x of out) { const d = tx[x.hash]; if (d) { x.signer = d.from.toLowerCase(); x.type4 = d.type === "0x4"; x.txType = parseInt(d.type || "0x0", 16); x.txTo = (d.to || "").toLowerCase(); x.sel = (d.input || "").slice(0, 10); } }
    for (const x of out) x.native = x.cat === "external" || x.cat === "internal";

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
    const lastOn = {}, seen = {};
    out.forEach(x => { if (x.ts) { lastOn[x.chain] = Math.max(lastOn[x.chain] || 0, x.ts); seen[x.to] = Math.min(seen[x.to] || Infinity, x.ts); } });
    const typed = out.filter(x => x.txType != null && x.signer === address), legacyShare = typed.length ? typed.filter(x => x.txType === 0).length / typed.length : 0;
    const strangeCount = chains.filter(c => c.delegate && !c.delegateName).length;
    const tail = out.filter(x => x.ts && x.ts >= lastOn[x.chain] - 2 * 86400).sort((a, b) => b.ts - a.ts).slice(0, 400)
      .map(x => ({ to: x.to, chain: x.chain, ts: x.ts, native: x.native, priced: !!x.priced, asset: x.asset, value: x.value, usd: Math.round(x.usd * 100) / 100, hash: x.hash, txType: x.txType, signer: x.signer }));
    const candidates = findIncidents(out, address), keySweeps = findKeySweep({ tail, self: address, seen, lastOn, strangeCount, legacyShare });
    const knownDelegate = new Set(chains.filter(c => c.delegateName).map(c => c.key));
    const pulls = findPull(out, address, knownDelegate, new Set(chains.filter(c => c.delegate && !c.delegateName).map(c => c.key))), poisonLoss = findPoisonLoss(out, address);
    const want = [...new Set(sent.slice(0, 50).map(c => c.address).concat(received.slice(0, 25).map(c => c.address), candidates.map(c => c.to), sweep.map(s => s.address), keySweeps.map(k => k.address), pulls.map(p => p.to), pulls.map(p => p.txTo), (approvals || []).slice(0, 40).map(a => a.spender)))].filter(Boolean);
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
    // a third party moving tokens to an address no label explains, by calling the token, Permit2, or an unlabelled contract
    const pull = summarisePulls(pulls.filter(p => !lab[p.to] && (p.txTo === p.contract || p.txTo === PERMIT2 || !lab[p.txTo]) && (!sweeper || p.to !== sweeper.address)));
    pull.forEach(p => { const c = sent.find(x => x.address === p.to); if (c) { c.kind = "bad"; c.name = "Took tokens with a permission"; } });
    poisonLoss.forEach(p => { const c = sent.find(x => x.address === p.fake); if (c) { c.kind = "poison"; c.name = "Look-alike: real money sent here"; } });
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
      sweeper, keySweep, pull, poisonLoss, delegations: chains.filter(c => c.delegate).map(c => ({ chain: c.key, chainName: c.name, delegate: c.delegate, name: c.delegateName, verified: c.delegateVerified == null ? null : c.delegateVerified })), poisoning: poison,
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
      checks: checks({ compromise, incident, risk, approvals }),
      // what the page needs to run the cross-chain rules again after folding several scans of this wallet together
      cross: { tail, seen: Object.fromEntries(Object.entries(seen).filter(([a]) => tail.some(x => x.to === a))), lastOn, strangeCount, typed: typed.length, legacy: typed.filter(x => x.txType === 0).length },
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
    if (!x.signer || x.signer === self || BURN.includes(x.to) || signedPayment(x)) continue;
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

// Tokens taken by someone else's transaction: the wallet once signed a permission (approve, permit, Permit2, setApprovalForAll)
// and a third party used it. Chains where the wallet runs known smart-account software are skipped: there a relayer sends the owner's own transactions.
function findPull(out, self, knownDelegate, strangeChains) {
  return out.filter(x => x.priced && x.usd >= 1 && x.signer && x.signer !== self && x.signer !== x.to && x.to !== self && !BURN.includes(x.to) && !knownDelegate.has(x.chain) && !signedPayment(x) && !(ENTRYPOINTS.includes(x.txTo) && !strangeChains.has(x.chain)))
    .map(x => ({ to: x.to, chain: x.chain, ts: x.ts, asset: x.asset, value: x.value, usd: x.usd, hash: x.hash, signer: x.signer, txTo: x.txTo, contract: x.contract, how: (x.txTo === x.contract || x.txTo === PERMIT2) && PULL_SELECTORS[x.sel] ? PULL_SELECTORS[x.sel] + " (a permission the wallet gave)" : strangeChains.has(x.chain) ? "the unknown EIP-7702 delegate" : PULL_SELECTORS[x.sel] || (x.txTo === PERMIT2 ? "Permit2" : "a contract call") }));
}
function summarisePulls(list) {
  const by = {};
  for (const p of list) { const g = by[p.to] || (by[p.to] = { to: p.to, usd: 0, count: 0, chains: {}, how: {}, signers: {}, first: p.ts || Infinity, last: p.ts, items: [] }); g.usd += p.usd; g.count++; g.chains[p.chain] = 1; g.how[p.how] = 1; g.signers[p.signer] = 1; g.first = Math.min(g.first, p.ts || Infinity); g.last = Math.max(g.last, p.ts); g.items.push({ h: p.hash, ts: p.ts, c: p.chain, a: p.asset, v: p.value, u: Math.round(p.usd * 100) / 100, how: p.how, by: p.signer }); }
  return Object.values(by).map(g => ({ ...g, usd: Math.round(g.usd * 100) / 100, chains: Object.keys(g.chains), how: Object.keys(g.how), signers: Object.keys(g.signers), first: g.first === Infinity ? g.last : g.first, items: g.items.slice(0, 30) })).sort((a, b) => b.usd - a.usd);
}

// Money sent to a planted look-alike. In a group of addresses that share the first 4 and last 4 characters, the planted one
// first appears through a transfer the wallet did not really make (signed by someone else, zero value, or a token with no price).
// If the owner later paid that address real money, the poisoning worked.
function findPoisonLoss(out, self) {
  const groups = {};
  for (const x of out) { if (BURN.includes(x.to) || !x.ts) continue; const k = x.chain + x.to.slice(0, 6) + x.to.slice(-4); ((groups[k] = groups[k] || {})[x.to] = groups[k][x.to] || []).push(x); }
  const loss = [];
  for (const k in groups) {
    const g = groups[k], addrs = Object.keys(g); if (addrs.length < 2) continue;
    for (const a of addrs) {
      const l = g[a].sort((p, q) => p.ts - q.ts), first = l[0];
      const planted = (first.signer && first.signer !== self) || !first.value || !first.priced;
      if (!planted) continue;
      const paid = l.filter(x => x.ts > first.ts && x.priced && x.usd >= 1 && (!x.signer || x.signer === self));
      if (!paid.length) continue;
      const real = addrs.filter(b => b !== a).sort((p, q) => g[q].length - g[p].length)[0];
      loss.push({ fake: a, real, chain: first.chain, plantedAt: first.ts, usd: Math.round(paid.reduce((s2, x) => s2 + x.usd, 0) * 100) / 100, items: paid.map(x => ({ h: x.hash, ts: x.ts, c: x.chain, a: x.asset, v: x.value, u: Math.round(x.usd * 100) / 100 })) });
    }
  }
  return loss.sort((a, b) => b.usd - a.usd);
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
    "Past drain": incident || compromise.keySweep || compromise.pull.length || compromise.poisonLoss.length ? 100 : 0,
    "Risky approvals": Math.min(100, risky * 50 + closed * 10),
    "Open allowances": Math.min(100, unlimited * 12),
    "Unknown delegation": Math.min(100, strange * 40),
    "Being targeted": Math.min(100, compromise.poisoning.length * 25 + badPeers * 20 + flags.length * 50),
  };
  let score = Math.round(parts["Past drain"] * 0.4 + parts["Risky approvals"] * 0.3 + parts["Open allowances"] * 0.15 + parts["Unknown delegation"] * 0.3 + parts["Being targeted"] * 0.15);
  score = Math.min(100, Math.max(score, { confirmed: 97, likely: 85, suspected: 60, none: 0 }[compromise.level], compromise.pull.length || compromise.poisonLoss.length ? 85 : 0));
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
// every drain method the scan looks for, and what it found for each
function checks({ compromise, incident, risk, approvals }) {
  const c = compromise, found = {
    sweeper: c.sweeper ? `${c.sweeper.address} took ${c.sweeper.totalCount} transfers on ${c.sweeper.allChains.length} chain(s)` : null,
    keysweep: c.keySweep ? `${c.keySweep.units} assets on ${c.keySweep.chains.length} chain(s) went to ${c.keySweep.address} within hours` : null,
    delegation: c.delegations.some(d => !d.name) ? `unknown delegate on ${c.delegations.filter(d => !d.name).length} chain(s)` : null,
    pull: c.pull.length ? `${c.pull.reduce((a, p) => a + p.count, 0)} transfers taken by a third party to ${c.pull.length} address(es)` : null,
    burst: incident ? `${incident.assetCount} assets to one address within an hour` : null,
    poisonloss: c.poisonLoss.length ? `${c.poisonLoss.length} payment(s) to a planted look-alike` : null,
    poisoning: c.poisoning.length ? `${c.poisoning.length} look-alike address(es) planted` : null,
    approvals: approvals === null ? undefined : risk.counts.risky || risk.counts.closed ? `${risk.counts.risky} flagged, ${risk.counts.closed} closed-source spender(s)` : null,
    flagged: risk.counts.badPeers ? `${risk.counts.badPeers} flagged receiver(s)` : null,
  };
  return METHODS.map(m => ({ id: m.id, name: m.name, how: m.how, found: found[m.id] === undefined ? null : !!found[m.id], detail: found[m.id] || null }));
}

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
  for (const p of compromise.pull.slice(0, 2)) {
    s.push(`${p.usd >= 1 ? "About " + money(p.usd) + " in tokens was" : "Tokens were"} taken by someone else's transaction${p.count > 1 ? "s" : ""}: ${p.count} transfer${p.count > 1 ? "s" : ""} to an address ending ${p.to.slice(-4)} on ${names(p.chains.map(cn))}, using ${names(p.how)}. ${p.how.every(h => h.includes("delegate")) ? "Whoever controls that delegate contract can move anything this wallet holds." : "This wallet once signed a permission (an approval or a permit), and a drainer used it."}`);
  }
  if (compromise.pull.some(p => !p.how.every(h => h.includes("delegate")))) s.push("Revoke every permission under “Open doors”. The key itself may still be safe, but any token with an open permission can be taken the same way.");
  for (const p of compromise.poisonLoss.slice(0, 2)) s.push(`Address poisoning worked here: ${money(p.usd)} was sent to ${p.fake.slice(0, 6)}…${p.fake.slice(-4)}, a fake planted on ${when(p.plantedAt)} to look like ${p.real.slice(0, 6)}…${p.real.slice(-4)}, an address this wallet really uses.`);
  if (strange.length) s.push(`${sw || ks ? "The wallet is also" : "This wallet is"} delegated to a contract I do not recognise on ${names(strange.map(d => d.chainName))}${strange.length > 1 && new Set(strange.map(d => d.delegate)).size > 1 ? ", a different one on each chain" : ""}. A delegate contract can act as the wallet. ${sw ? "That is how incoming funds get swept." : "If you did not set this up, treat the wallet as compromised."}`);
  const known = compromise.delegations.filter(d => d.name);
  if (known.length && !sw) s.push(`It is delegated to ${known[0].name} on ${names(known.map(d => d.chainName))}. That is ordinary wallet software.`);
  if (incident) {
    s.push(`On ${when(incident.start)}, ${incident.assetCount} different assets left on ${cn(incident.chain)} in ${incident.transferCount} transfers to one address. At today's prices that is about ${money(incident.usd)}.`);
    if (incident.method === "approval") s.push("Those transfers were sent by a different address, using a permission this wallet had given.");
    else if (!sw) s.push("They were signed with this wallet's own key. If you did not send them, someone else has your seed phrase.");
    if (incident.receiverFlags && incident.receiverFlags.length) s.push(`The receiving address is flagged for: ${incident.receiverFlags.join(", ")}.`);
    else if (["bad", "mixer", "sanctioned"].includes(incident.receiverKind)) s.push(`The receiving address is publicly labelled “${incident.receiverName}”.`);
  } else if (!sw && !ks && !strange.length && !compromise.pull.length && !compromise.poisonLoss.length) s.push("I found no sweeper, no unknown delegation, and no moment where many assets left at once. Those are the usual signs of a stolen key or a drain, and they are not here.");
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
