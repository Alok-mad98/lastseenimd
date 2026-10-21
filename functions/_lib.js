// Shared helpers for the scan and trace endpoints. Keys stay on the server: the browser only ever calls /api/*.
export const isAddr = a => /^0x[0-9a-fA-F]{40}$/.test(a || "");
export const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "public, max-age=60" } });

// Every EVM chain this Alchemy key can read transfers on. "internal" = the chain supports internal-transfer lookups.
// A chain that is not enabled on the key simply fails its batch and is reported as unreadable.
export const CHAINS = [
  { key: "eth", id: 1, name: "Ethereum", host: "eth-mainnet", native: "ETH", cg: "coingecko:ethereum", llama: "ethereum", explorer: "https://etherscan.io", internal: true },
  { key: "base", id: 8453, name: "Base", host: "base-mainnet", native: "ETH", cg: "coingecko:ethereum", llama: "base", explorer: "https://basescan.org" },
  { key: "arb", id: 42161, name: "Arbitrum", host: "arb-mainnet", native: "ETH", cg: "coingecko:ethereum", llama: "arbitrum", explorer: "https://arbiscan.io" },
  { key: "opt", id: 10, name: "Optimism", host: "opt-mainnet", native: "ETH", cg: "coingecko:ethereum", llama: "optimism", explorer: "https://optimistic.etherscan.io" },
  { key: "bnb", id: 56, name: "BNB Chain", host: "bnb-mainnet", native: "BNB", cg: "coingecko:binancecoin", llama: "bsc", explorer: "https://bscscan.com" },
  { key: "polygon", id: 137, name: "Polygon", host: "polygon-mainnet", native: "POL", cg: "coingecko:polygon-ecosystem-token", llama: "polygon", explorer: "https://polygonscan.com", internal: true },
  { key: "avax", id: 43114, name: "Avalanche", host: "avax-mainnet", native: "AVAX", cg: "coingecko:avalanche-2", llama: "avax", explorer: "https://snowscan.xyz" },
  { key: "linea", id: 59144, name: "Linea", host: "linea-mainnet", native: "ETH", cg: "coingecko:ethereum", llama: "linea", explorer: "https://lineascan.build" },
  { key: "zksync", id: 324, name: "zkSync Era", host: "zksync-mainnet", native: "ETH", cg: "coingecko:ethereum", llama: "era", explorer: "https://explorer.zksync.io" },
  { key: "scroll", id: 534352, name: "Scroll", host: "scroll-mainnet", native: "ETH", cg: "coingecko:ethereum", llama: "scroll", explorer: "https://scrollscan.com" },
  { key: "blast", id: 81457, name: "Blast", host: "blast-mainnet", native: "ETH", cg: "coingecko:ethereum", llama: "blast", explorer: "https://blastscan.io" },
  { key: "unichain", id: 130, name: "Unichain", host: "unichain-mainnet", native: "ETH", cg: "coingecko:ethereum", llama: "unichain", explorer: "https://uniscan.xyz" },
  { key: "worldchain", id: 480, name: "World Chain", host: "worldchain-mainnet", native: "ETH", cg: "coingecko:ethereum", llama: "wc", explorer: "https://worldscan.org" },
  { key: "ink", id: 57073, name: "Ink", host: "ink-mainnet", native: "ETH", cg: "coingecko:ethereum", llama: "ink", explorer: "https://explorer.inkonchain.com" },
  { key: "soneium", id: 1868, name: "Soneium", host: "soneium-mainnet", native: "ETH", cg: "coingecko:ethereum", llama: "soneium", explorer: "https://soneium.blockscout.com" },
  { key: "abstract", id: 2741, name: "Abstract", host: "abstract-mainnet", native: "ETH", cg: "coingecko:ethereum", llama: "abstract", explorer: "https://abscan.org" },
  { key: "zora", id: 7777777, name: "Zora", host: "zora-mainnet", native: "ETH", cg: "coingecko:ethereum", llama: "zora", explorer: "https://explorer.zora.energy" },
  { key: "shape", id: 360, name: "Shape", host: "shape-mainnet", native: "ETH", cg: "coingecko:ethereum", llama: "shape", explorer: "https://shapescan.xyz" },
  { key: "robinhood", id: 4663, name: "Robinhood Chain", host: "robinhood-mainnet", native: "ETH", cg: "coingecko:ethereum", llama: "robinhood", explorer: "https://robinhoodchain.blockscout.com" },
  { key: "berachain", id: 80094, name: "Berachain", host: "berachain-mainnet", native: "BERA", cg: "coingecko:berachain-bera", llama: "berachain", explorer: "https://berascan.com" },
  { key: "monad", id: 143, name: "Monad", host: "monad-mainnet", native: "MON", cg: "coingecko:monad", llama: "monad", explorer: "https://monadscan.com" },
  { key: "hyperevm", id: 999, name: "HyperEVM", host: "hyperliquid-mainnet", native: "HYPE", cg: "coingecko:hyperliquid", llama: "hyperliquid", explorer: "https://hyperevmscan.io" },
  { key: "gnosis", id: 100, name: "Gnosis", host: "gnosis-mainnet", native: "xDAI", cg: "coingecko:xdai", llama: "xdai", explorer: "https://gnosisscan.io" },
  { key: "celo", id: 42220, name: "Celo", host: "celo-mainnet", native: "CELO", cg: "coingecko:celo", llama: "celo", explorer: "https://celoscan.io" },
  { key: "ronin", id: 2020, name: "Ronin", host: "ronin-mainnet", native: "RON", cg: "coingecko:ronin", llama: "ronin", explorer: "https://app.roninchain.com" },
  { key: "apechain", id: 33139, name: "ApeChain", host: "apechain-mainnet", native: "APE", cg: "coingecko:apecoin", llama: "apechain", explorer: "https://apescan.io" },
  { key: "lens", id: 232, name: "Lens", host: "lens-mainnet", native: "GHO", cg: "coingecko:gho", llama: "lens", explorer: "https://explorer.lens.xyz" },
  { key: "story", id: 1514, name: "Story", host: "story-mainnet", native: "IP", cg: "coingecko:story-2", llama: "story", explorer: "https://www.storyscan.io" },  { key: "mantle", id: 5000, name: "Mantle", host: "mantle-mainnet", native: "MNT", cg: "coingecko:mantle", llama: "mantle", explorer: "https://mantlescan.xyz" },
  { key: "sonic", id: 146, name: "Sonic", host: "sonic-mainnet", native: "S", cg: "coingecko:sonic-3", llama: "sonic", explorer: "https://sonicscan.org" },
  { key: "sei", id: 1329, name: "Sei", host: "sei-mainnet", native: "SEI", cg: "coingecko:sei-network", llama: "sei", explorer: "https://seitrace.com" },
  { key: "opbnb", id: 204, name: "opBNB", host: "opbnb-mainnet", native: "BNB", cg: "coingecko:binancecoin", llama: "op_bnb", explorer: "https://opbnb.bscscan.com" },
  { key: "metis", id: 1088, name: "Metis", host: "metis-mainnet", native: "METIS", cg: "coingecko:metis-token", llama: "metis", explorer: "https://andromeda-explorer.metis.io" },
  { key: "fraxtal", id: 252, name: "Fraxtal", host: "frax-mainnet", native: "frxETH", cg: "coingecko:ethereum", llama: "fraxtal", explorer: "https://fraxscan.com" },
  { key: "mode", id: 34443, name: "Mode", host: "mode-mainnet", native: "ETH", cg: "coingecko:ethereum", llama: "mode", explorer: "https://modescan.io" },
  { key: "rootstock", id: 30, name: "Rootstock", host: "rootstock-mainnet", native: "RBTC", cg: "coingecko:rootstock", llama: "rsk", explorer: "https://rootstock.blockscout.com" },
  { key: "flow", id: 747, name: "Flow EVM", host: "flow-mainnet", native: "FLOW", cg: "coingecko:flow", llama: "flow", explorer: "https://evm.flowscan.io" },
  { key: "zetachain", id: 7000, name: "ZetaChain", host: "zetachain-mainnet", native: "ZETA", cg: "coingecko:zetachain", llama: "zeta", explorer: "https://zetachain.blockscout.com" },
  { key: "plasma", id: 9745, name: "Plasma", host: "plasma-mainnet", native: "XPL", cg: "coingecko:plasma", llama: "plasma", explorer: "https://plasmascan.to" },
  { key: "katana", id: 747474, name: "Katana", host: "katana-mainnet", native: "ETH", cg: "coingecko:ethereum", llama: "katana", explorer: "https://katanascan.com" },
  { key: "anime", id: 69000, name: "Animechain", host: "anime-mainnet", native: "ANIME", cg: "coingecko:anime", llama: "anime", explorer: "https://explorer-animechain-39xf6m45e3.t.conduit.xyz" },
  { key: "astar", id: 592, name: "Astar", host: "astar-mainnet", native: "ASTR", cg: "coingecko:astar", llama: "astar", explorer: "https://astar.blockscout.com" },
  { key: "moonbeam", id: 1284, name: "Moonbeam", host: "moonbeam-mainnet", native: "GLMR", cg: "coingecko:moonbeam", llama: "moonbeam", explorer: "https://moonbeam.moonscan.io" },
  { key: "megaeth", id: 4326, name: "MegaETH", host: "megaeth-mainnet", native: "ETH", cg: "coingecko:ethereum", llama: "megaeth", explorer: "https://megaexplorer.xyz" },
  { key: "superseed", id: 5330, name: "Superseed", host: "superseed-mainnet", native: "ETH", cg: "coingecko:ethereum", llama: "superseed", explorer: "https://explorer.superseed.xyz" },
  { key: "boba", id: 288, name: "Boba", host: "boba-mainnet", native: "ETH", cg: "coingecko:ethereum", llama: "boba", explorer: "https://bobascan.com" },
  { key: "bob", id: 60808, name: "BOB", host: "bob-mainnet", native: "ETH", cg: "coingecko:ethereum", llama: "bob", explorer: "https://explorer.gobob.xyz" },
  { key: "citrea", id: 4114, name: "Citrea", host: "citrea-mainnet", native: "cBTC", cg: "coingecko:bitcoin", llama: "citrea", explorer: "https://explorer.mainnet.citrea.xyz" },
];
// chain ids the bridge resolvers report, mapped to our keys; Solana uses Relay's id
export const SOLANA_IDS = [792703809, 1151111081099710];
export const chainOf = k => CHAINS.find(c => c.key === k) || CHAINS[0];

// Several JSON-RPC calls in one HTTP request. A failed call comes back as null instead of failing the rest.
export async function batch(env, chain, calls) {
  if (!calls.length) return [];
  const r = await fetch("https://" + chain.host + ".g.alchemy.com/v2/" + env.ALCHEMY_KEY, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(calls.map(([method, params], i) => ({ jsonrpc: "2.0", id: i, method, params }))) });
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error(chain.name + ": " + ((j.error && j.error.message) || "bad response"));
  const out = calls.map(() => null);
  for (const x of j) if (x && x.error == null) out[x.id] = x.result;
  return out;
}
export async function rpc(env, method, params, chain = CHAINS[0]) {
  const r = await fetch("https://" + chain.host + ".g.alchemy.com/v2/" + env.ALCHEMY_KEY, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(method + ": " + j.error.message);
  return j.result;
}

const CATS_OUT = ["external", "erc20", "erc721", "erc1155"];
export function transferParams(address, dir, max, chain) {
  const p = { fromBlock: "0x0", toBlock: "latest", category: dir === "in" && chain.internal ? CATS_OUT.concat("internal") : CATS_OUT, withMetadata: true, excludeZeroValue: false, maxCount: "0x" + max.toString(16), order: "desc" };
  p[dir === "in" ? "toAddress" : "fromAddress"] = address;
  return p;
}
export function mapTransfers(res, dir, chain) {
  return ((res && res.transfers) || []).map(t => ({
    hash: t.hash, ts: t.metadata && t.metadata.blockTimestamp ? Math.floor(Date.parse(t.metadata.blockTimestamp) / 1000) : 0 /* a few chains return no timestamp */, from: (t.from || "").toLowerCase(), to: (t.to || "").toLowerCase(),
    asset: t.asset || (t.category === "erc721" || t.category === "erc1155" ? "NFT" : "?"), value: t.value == null ? (t.category === "external" || t.category === "internal" || t.category === "erc20" ? 0 : 1) : Number(t.value),
    cat: t.category, contract: t.rawContract && t.rawContract.address ? t.rawContract.address.toLowerCase() : null, dir, usd: 0, chain: chain.key,
  })).filter(t => t.to);
}
// One page of transfers in one direction, newest first.
export async function transfers(env, address, dir, max = 1000, chain = CHAINS[0]) {
  return mapTransfers(await rpc(env, "alchemy_getAssetTransfers", [transferParams(address, dir, max, chain)], chain), dir, chain);
}

// Current USD prices from DefiLlama. Tokens without a trusted price (most scam tokens) stay at 0.
export async function priceAll(list) {
  const keys = new Set(list.map(t => chainOf(t.chain).cg).concat("coingecko:ethereum"));
  for (const t of list) if (t.cat === "erc20" && t.contract && keys.size < 130) keys.add(chainOf(t.chain).llama + ":" + t.contract);
  const ks = [...keys], coins = {};
  try {
    await Promise.all([0, 1, 2].map(async n => {
      const part = ks.slice(n * 45, n * 45 + 45);
      if (!part.length) return;
      Object.assign(coins, (await (await fetch("https://coins.llama.fi/prices/current/" + part.join(","))).json()).coins || {});
    }));
  } catch (e) { /* prices are a nice-to-have */ }
  for (const t of list) {
    const ch = chainOf(t.chain);
    if (t.cat === "external" || t.cat === "internal") { t.usd = t.value * ((coins[ch.cg] || {}).price || 0); t.priced = true; }
    else if (t.cat === "erc20" && t.contract) { const c = coins[ch.llama + ":" + t.contract]; if (c && (c.confidence == null || c.confidence >= 0.9)) { t.usd = t.value * c.price; t.priced = true; } }
  }
  return (coins["coingecko:ethereum"] || {}).price || 0;
}

// Address labels live as static shards (public/labels/xx.json), built from dawsbot/eth-labels.
export async function labels(env, request, addrs) {
  const out = {}, shards = {};
  for (const a of addrs) (shards[a.slice(2, 4)] = shards[a.slice(2, 4)] || []).push(a);
  await Promise.all(Object.keys(shards).map(async k => {
    try {
      const r = await env.ASSETS.fetch(new URL("/labels/" + k + ".json", request.url));
      if (!r.ok) return;
      const m = await r.json();
      for (const a of shards[k]) if (m[a]) out[a] = { kind: m[a][0], name: m[a][1] };
    } catch (e) { /* unlabeled is fine */ }
  }));
  return out;
}

const GP_FLAGS = { cybercrime: "cybercrime", money_laundering: "money laundering", financial_crime: "financial crime", darkweb_transactions: "darkweb activity", phishing_activities: "phishing", stealing_attack: "theft", blackmail_activities: "blackmail", sanctioned: "sanctioned", mixer: "mixer", honeypot_related_address: "honeypot", fake_kyc: "fake KYC", blacklist_doubt: "suspected blacklist", malicious_mining_activities: "malicious mining" };
export async function goplusAddress(a, chainId = 1) {
  try {
    const j = await (await fetch("https://api.gopluslabs.io/api/v1/address_security/" + a + "?chain_id=" + chainId)).json();
    const r = j.result || {};
    return Object.keys(GP_FLAGS).filter(k => r[k] === "1").map(k => GP_FLAGS[k]);
  } catch (e) { return []; }
}

export async function goplusApprovals(a, chainId = 1) {
  try {
    const j = await (await fetch("https://api.gopluslabs.io/api/v2/token_approval_security/" + chainId + "?addresses=" + a)).json();
    const out = [];
    for (const t of j.result || []) for (const s of t.approved_list || []) {
      const info = s.address_info || {};
      out.push({
        token: t.token_symbol || t.token_name || "?", tokenAddress: (t.token_address || "").toLowerCase(), spender: (s.approved_contract || "").toLowerCase(),
        spenderName: info.contract_name || info.tag || null, amount: s.approved_amount, unlimited: /unlimited/i.test(String(s.approved_amount)) || Number(s.approved_amount) > 1e30,
        risky: info.malicious_address === 1 || (info.doubt_list === 1) || t.malicious_address === 1, openSource: info.is_open_source === 1, trusted: info.trust_list === 1, isContract: info.is_contract === 1,
      });
    }
    return out;
  } catch (e) { return null; }
}

// Neatlogs tracing: one nested trace per request, sent as a single POST when the request ends. Without NEATLOGS_API_KEY it does nothing.
const brief = v => { if (Array.isArray(v)) return { count: v.length }; const s = typeof v === "string" ? v : JSON.stringify(v); return s && s.length > 400 ? s.slice(0, 400) + "…" : v; };
export function tracer(env, name, input) {
  const root = { name, kind: "WORKFLOW", input, start: new Date().toISOString(), children: [] }, t0 = Date.now();
  return {
    async step(tool, input, fn) {
      const s = { name: tool, kind: "TOOL", tool_name: tool, input, start: new Date().toISOString() }, t = Date.now();
      root.children.push(s);
      try { const r = await fn(); s.output = brief(r); return r; }
      catch (e) { s.status = "ERROR"; s.error = e.message; throw e; }
      finally { s.duration_ms = Date.now() - t; }
    },
    done(output) { root.output = output; },
    fail(e) { root.status = "ERROR"; root.error = e.message; },
    async send() {
      if (!env.NEATLOGS_API_KEY) return;
      root.duration_ms = Date.now() - t0;
      try { await fetch("https://ingest.neatlogs.com/v1/trace", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + env.NEATLOGS_API_KEY }, body: JSON.stringify(root) }); } catch (e) { /* tracing must never break a request */ }
    },
  };
}

export const short = a => a ? a.slice(0, 6) + "…" + a.slice(-4) : "";
