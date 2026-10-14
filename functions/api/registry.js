import { isAddr, json, rpc, chainOf } from "../_lib.js";

// The on-chain registry the IMD swarm writes to (contracts/src/LastSeenRegistry.sol), on Robinhood Chain.
// GET /api/registry?wallet=0x…&suspect=0x…   →  is either one on the swarm-confirmed lists?
// GET /api/registry?openTx=0x…                →  the case number a just-sent openCase transaction created
// Until the contract is launched (REGISTRY_ADDRESS unset) this answers { deployed: false }.
const CHAIN = chainOf("robinhood");
const SEL = { flagged: "0xcb2505cf", compromised: "0x3908530b", caseCount: "0xda2d7e95", pool: "0x16f0115b", getCase: "0xa91a1080" };
const CASE_OPENED = "0x131db9d003decf1af2a6c16af864bfde7d397b272ecff87e484c85dad6007df2";
const word = a => a.slice(2).toLowerCase().padStart(64, "0");
const STATUS = ["none", "open", "asked", "confirmed", "rejected", "no answer"];

export async function onRequestGet({ request, env }) {
  const reg = (env.REGISTRY_ADDRESS || "").toLowerCase();
  const base = { deployed: isAddr(reg), address: isAddr(reg) ? reg : null, chainId: CHAIN.id, chain: CHAIN.key, explorer: CHAIN.explorer };
  if (!base.deployed) return json(base);
  const q = new URL(request.url).searchParams;
  const call = data => rpc(env, "eth_call", [{ to: reg, data }, "latest"], CHAIN);
  try {
    const tx = q.get("openTx");
    if (tx) {
      if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) return json({ error: "Bad transaction hash." }, 400);
      const rc = await rpc(env, "eth_getTransactionReceipt", [tx], CHAIN);
      if (!rc) return json({ ...base, pending: true });
      const log = (rc.logs || []).find(l => l.address.toLowerCase() === reg && l.topics[0] === CASE_OPENED);
      return json({ ...base, caseId: log ? parseInt(log.topics[1], 16) : null, ok: rc.status === "0x1" });
    }
    const out = { ...base };
    const [count, pool] = await Promise.all([call(SEL.caseCount), call(SEL.pool)]);
    out.cases = parseInt(count, 16); out.poolImd = Number(BigInt(pool)) / 1e18;
    for (const [k, sel] of [["wallet", SEL.compromised], ["suspect", SEL.flagged]]) {
      const a = (q.get(k) || "").toLowerCase();
      if (isAddr(a)) out[k] = { address: a, listed: BigInt(await call(sel + word(a))) === 1n };
    }
    const id = q.get("caseId");
    if (id && /^\d+$/.test(id)) {
      const r = await call(SEL.getCase + BigInt(id).toString(16).padStart(64, "0"));
      // Case is a static struct: 9 words, status is the 8th
      out.case = { id: Number(id), status: STATUS[parseInt(r.slice(2 + 64 * 7, 2 + 64 * 8), 16)] || "unknown" };
    }
    return json(out);
  } catch (e) {
    return json({ ...base, error: "Could not read the registry: " + e.message }, 502);
  }
}
