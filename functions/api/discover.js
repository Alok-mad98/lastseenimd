import { isAddr, json, CHAINS, batch, tracer } from "../_lib.js";

// GET /api/discover?address=0x…  →  which EVM chains this address has ever used.
// One small request per chain (nonce, balance, code). The full scan then reads only the chains that matter.
export async function onRequestGet(ctx) {
  const { request, env } = ctx;
  const address = (new URL(request.url).searchParams.get("address") || "").toLowerCase();
  if (!isAddr(address)) return json({ error: "That is not a wallet address. It should start with 0x and have 42 characters." }, 400);
  const t = tracer(env, "chain-discovery", { address });
  const rows = await Promise.all(CHAINS.map(ch => batch(env, ch, [["eth_getTransactionCount", [address, "latest"]], ["eth_getBalance", [address, "latest"]], ["eth_getCode", [address, "latest"]]])
    .then(r => {
      const code = r[2] || "0x", delegate = code.startsWith("0xef0100") ? "0x" + code.slice(8, 48) : null;
      return { key: ch.key, id: ch.id, name: ch.name, explorer: ch.explorer, native: ch.native, ok: r[0] != null, txCount: parseInt(r[0] || "0x0", 16), balance: parseInt(r[1] || "0x0", 16) / 1e18, delegate, isContract: code !== "0x" && !delegate };
    }).catch(() => ({ key: ch.key, id: ch.id, name: ch.name, explorer: ch.explorer, native: ch.native, ok: false, txCount: 0, balance: 0, delegate: null }))));
  // a delegation is the loudest signal, then how much the wallet has done there
  const active = rows.filter(r => r.ok && (r.txCount > 0 || r.balance > 0 || r.delegate || r.isContract)).sort((a, b) => (!!b.delegate - !!a.delegate) || b.txCount - a.txCount);
  t.done({ readable: rows.filter(r => r.ok).length, active: active.length });
  ctx.waitUntil(t.send());
  return json({ address, chains: rows, active: active.map(r => r.key) });
}
