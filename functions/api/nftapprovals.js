import { isAddr, json, CHAINS } from "../_lib.js";

// GET /api/nftapprovals?address=0x…&chains=eth,base  →  who may move this wallet's NFTs (setApprovalForAll and single-token approvals).
// A "for all" approval is how most NFT drainers empty a wallet in one signature. GoPlus, ERC-721 and ERC-1155, up to 10 chains.
export async function onRequestGet({ request }) {
  const q = new URL(request.url).searchParams, address = (q.get("address") || "").toLowerCase();
  if (!isAddr(address)) return json({ error: "Not a wallet address." }, 400);
  const chains = (q.get("chains") || "eth").split(",").map(k => CHAINS.find(c => c.key === k)).filter(Boolean).slice(0, 10);
  const get = (std, c) => fetch(`https://api.gopluslabs.io/api/v2/nft${std}_approval_security/${c.id}?addresses=${address}`).then(r => r.json()).then(j => (j.result || []).map(t => ({ ...t, std, chain: c.key }))).catch(() => null);
  const lists = await Promise.all(chains.flatMap(c => [get("721", c), get("1155", c)]));
  const out = [];
  for (const t of lists.filter(Boolean).flat()) for (const s of t.approved_list || []) {
    const info = s.address_info || {}, spender = String(s.approved_contract || "").toLowerCase();
    if (!isAddr(spender)) continue;
    const all = t.std === "1155" || s.approved_for_all === 1;
    out.push({
      chain: t.chain, std: t.std, collection: t.nft_name || t.nft_symbol || "NFT", tokenAddress: String(t.nft_address || "").toLowerCase(), spender,
      spenderName: info.contract_name || info.tag || null, forAll: all, tokenId: all ? null : s.approved_token_id,
      risky: info.malicious_address === 1 || info.doubt_list === 1 || (info.malicious_behavior || []).length > 0, trusted: info.trust_list === 1, isContract: info.is_contract === 1, openSource: info.is_open_source === 1, since: s.approved_time || null,
    });
  }
  return json({ address, failed: lists.filter(l => l === null).length, approvals: out.filter(x => isAddr(x.tokenAddress)).sort((a, b) => (b.risky - a.risky) || (b.forAll - a.forAll)) });
}
