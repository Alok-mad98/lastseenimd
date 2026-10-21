import { isAddr, json, rpc, chainOf } from "../_lib.js";

// The on-chain registry the IMD swarm writes to (contracts/src/LastSeenRegistry.sol), on Robinhood Chain.
// GET /api/registry?wallet=0x…&suspect=0x…   →  is either one on the swarm-confirmed lists? plus the price and the pool
// GET /api/registry?openTx=0x…                →  the case number a just-sent openCase transaction created
// GET /api/registry?caseFor=0x…&suspect=0x…   →  the latest case already opened for this wallet and suspect
// GET /api/registry?hunts=1                   →  every bounty, newest first
// GET /api/registry?hunt=N                    →  one bounty with its leads
// GET /api/registry?audit=base:0x…            →  the swarm's finding on a contract
// GET /api/registry?holder=0x…                →  that wallet's IMD on Robinhood Chain and what it lets the registry spend
// Until the contract is launched (REGISTRY_ADDRESS unset) this answers { deployed: false }.
const CHAIN = chainOf("robinhood");
const SEL = {
  flagged: "0xcb2505cf", compromised: "0x3908530b", caseCount: "0xda2d7e95", pool: "0x16f0115b", getCase: "0xa91a1080", hunts: "0x15f3598b",
  price: "0xa035b1fe", auditFee: "0x3d6dfe73", auditOf: "0x8a5c8add", asset: "0x38d52e0f", allowance: "0xdd62ed3e", balanceOf: "0x70a08231",
};
const TOPIC = {
  CaseOpened: "0x131db9d003decf1af2a6c16af864bfde7d397b272ecff87e484c85dad6007df2",
  BountyPosted: "0x7db9622af2f7a43a6e38de6956cd865c575651f2fb58855ee1e3ee2ae4b450b3",
  LeadSubmitted: "0x779ca7944c4ca5e32d057373177fba74f2f18473121836baad93bb0b1a2b17b3",
  LinkSubmitted: "0x8b98e9a2280d654f1e3e4d6f04ff0c81b18a79bdc1e186ac472006cc1145c042",
  LeadVerdict: "0x3878bbfaa5e35e1d1003175ba5b9a8d093774e11272384461cdc394d9c245b9c",
  TipPaid: "0x120ddb9df9536a6f0ffdff5264082d5db45d7f1e0ad85f7be79acbfb1d7d7276",
};
const word = a => a.slice(2).toLowerCase().padStart(64, "0");
const num = n => BigInt(n).toString(16).padStart(64, "0");
const words = hex => (hex.slice(2).match(/.{64}/g) || []);
const addrAt = w => "0x" + w.slice(24);
const imd = w => Number(BigInt("0x" + w)) / 1e18;
const STATUS = ["none", "open", "asked", "confirmed", "rejected", "no answer"];
const FINDING = ["not checked", "asked", "no power found", "can take funds"];

export async function onRequestGet({ request, env }) {
  const reg = (env.REGISTRY_ADDRESS || "").toLowerCase();
  const base = { deployed: isAddr(reg), address: isAddr(reg) ? reg : null, chainId: CHAIN.id, chain: CHAIN.key, explorer: CHAIN.explorer, oracleChains: [1, 56, 4663, 8453, 42161] };
  if (!base.deployed) return json(base);
  const q = new URL(request.url).searchParams;
  const call = (data, to = reg) => rpc(env, "eth_call", [{ to, data }, "latest"], CHAIN);
  const logs = topics => rpc(env, "eth_getLogs", [{ address: reg, fromBlock: env.REGISTRY_FROM_BLOCK || "0x0", toBlock: "latest", topics }], CHAIN);
  const getCase = async id => {
    const w = words(await call(SEL.getCase + num(id)));
    return { id: Number(id), wallet: addrAt(w[0]), suspect: addrAt(w[1]), opener: addrAt(w[2]), chainId: parseInt(w[3], 16), fromBlock: parseInt(w[4], 16), toBlock: parseInt(w[5], 16), status: STATUS[parseInt(w[7], 16)] || "unknown", rewardImd: imd(w[8]) };
  };
  const getHunt = async id => {
    const w = words(await call(SEL.hunts + num(id)));
    return { hirer: addrAt(w[0]), openUntil: parseInt(w[1], 16), inFlight: parseInt(w[2], 16), checksImd: imd(w[3]), tipKey: "0x" + w[4] };
  };
  try {
    const tx = q.get("openTx");
    if (tx) {
      if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) return json({ error: "Bad transaction hash." }, 400);
      const rc = await rpc(env, "eth_getTransactionReceipt", [tx], CHAIN);
      if (!rc) return json({ ...base, pending: true });
      const log = (rc.logs || []).find(l => l.address.toLowerCase() === reg && l.topics[0] === TOPIC.CaseOpened);
      return json({ ...base, caseId: log ? parseInt(log.topics[1], 16) : null, ok: rc.status === "0x1" });
    }
    const out = { ...base };
    const [count, pool, price, fee, asset] = await Promise.all([SEL.caseCount, SEL.pool, SEL.price, SEL.auditFee, SEL.asset].map(s => call(s)));
    Object.assign(out, { cases: parseInt(count, 16), poolImd: imd(pool.slice(2)), priceImd: imd(price.slice(2)), auditFeeImd: imd(fee.slice(2)), token: addrAt(asset.slice(2)) });

    const holder = (q.get("holder") || "").toLowerCase();
    if (isAddr(holder)) {
      const [bal, allow] = await Promise.all([call(SEL.balanceOf + word(holder), out.token), call(SEL.allowance + word(holder) + word(reg), out.token)]);
      out.holder = { address: holder, imd: imd(bal.slice(2)), allowanceImd: imd(allow.slice(2)) };
    }
    const cf = (q.get("caseFor") || "").toLowerCase(), cs = (q.get("suspect") || "").toLowerCase();
    if (isAddr(cf) && isAddr(cs)) {
      const l = await logs([TOPIC.CaseOpened, null, "0x" + word(cf), "0x" + word(cs)]);
      if (l.length) { const c = await getCase(parseInt(l[l.length - 1].topics[1], 16)); out.case = { ...c, hunt: await getHunt(c.id) }; }
    }
    if (q.get("hunts")) {
      const ids = [...new Set((await logs([TOPIC.BountyPosted])).map(l => parseInt(l.topics[1], 16)))].reverse().slice(0, 30);
      out.hunts = await Promise.all(ids.map(async id => ({ ...(await getCase(id)), hunt: await getHunt(id) })));
    }
    const h = q.get("hunt");
    if (h && /^\d+$/.test(h)) {
      const id = Number(h), [c, hunt, subs, links, verdicts, tips] = await Promise.all([getCase(id), getHunt(id),
        logs([TOPIC.LeadSubmitted, null, "0x" + num(id)]), logs([TOPIC.LinkSubmitted, null, "0x" + num(id)]), logs([TOPIC.LeadVerdict]), logs([TOPIC.TipPaid, "0x" + num(id)])]);
      const v = {}; verdicts.forEach(l => { const w = words(l.data); v[parseInt(l.topics[1], 16)] = { confirmed: parseInt(w[0], 16) === 1, paidImd: imd(w[1]) }; });
      const leads = subs.map(l => { const w = words(l.data); return { id: parseInt(l.topics[1], 16), kind: "hop", from: addrAt(w[0]), to: addrAt(w[1]), hunter: addrAt(w[2]), tx: l.transactionHash }; })
        .concat(links.map(l => {
          // LinkSubmitted(leadId, caseId, string url, address hunter, bytes32 requestId): the string sits after the three head words
          const w = words(l.data), len = parseInt(w[3], 16), raw = l.data.slice(2 + 64 * 4, 2 + 64 * 4 + len * 2);
          return { id: parseInt(l.topics[1], 16), kind: "link", url: decodeURIComponent(raw.replace(/../g, "%$&")), hunter: addrAt(w[1]), tx: l.transactionHash };
        }))
        .map(x => ({ ...x, ...(v[x.id] ? { status: v[x.id].confirmed ? "confirmed" : "rejected", paidImd: v[x.id].paidImd } : { status: "waiting for the swarm" }) }))
        .sort((a, b) => a.id - b.id);
      out.hunt = { ...c, hunt, leads, reached: [c.suspect].concat(leads.filter(x => x.kind === "hop" && x.status === "confirmed").map(x => x.to)),
        tipsPaid: tips.map(l => { const w = words(l.data); return { tipId: l.topics[2], to: addrAt(w[0]), imd: imd(w[1]) }; }) };
    }
    const au = q.get("audit");
    if (au) {
      const [k, a] = au.split(":"), ch = chainOf(k);
      if (isAddr((a || "").toLowerCase())) out.audit = { chain: ch.key, chainId: ch.id, address: a.toLowerCase(), finding: FINDING[parseInt(await call(SEL.auditOf + num(ch.id) + word(a)), 16)] || "unknown" };
    }
    for (const [k, sel] of [["wallet", SEL.compromised], ["suspect", SEL.flagged]]) {
      const a = (q.get(k) || "").toLowerCase();
      if (isAddr(a)) out[k] = { address: a, listed: BigInt(await call(sel + word(a))) === 1n };
    }
    const id = q.get("caseId");
    if (id && /^\d+$/.test(id)) out.case = await getCase(id);
    return json(out);
  } catch (e) {
    return json({ ...base, error: "Could not read the registry: " + e.message }, 502);
  }
}
