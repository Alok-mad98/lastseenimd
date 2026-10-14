import { isAddr, json, tracer } from "../_lib.js";

// GET /api/mentions?address=0x…  →  where this address shows up off-chain.
//   X posts that contain it (TikHub search through Monid, $0.001 a search, cached for a day)
//   the names it has published for itself: ENS and its text records, Basename, Farcaster, Lens (web3.bio, free)
// Only self-published links and public posts. Nothing here says who owns an address; the page says so too.
export async function onRequestGet(ctx) {
  const { request, env } = ctx;
  const address = (new URL(request.url).searchParams.get("address") || "").toLowerCase();
  if (!isAddr(address)) return json({ error: "Not a wallet address." }, 400);
  const cache = caches.default, key = new Request("https://cache.lastseen/mentions/v2/" + address);
  const hit = await cache.match(key);
  if (hit) return hit;
  const t = tracer(env, "offchain-mentions", { address });
  const [posts, profile] = await Promise.all([
    t.step("monid_tikhub_x_search", { address }, () => searchX(env, address)).catch(e => ({ error: e.message })),
    t.step("web3bio_profiles", { address }, () => names(address)).catch(() => null),
  ]);
  t.done({ posts: Array.isArray(posts) ? posts.length : 0, names: !!(profile && profile.ens) });
  ctx.waitUntil(t.send());
  const res = new Response(JSON.stringify({ address, posts: Array.isArray(posts) ? posts : [], postsError: posts.error || null, names: profile }), { headers: { "content-type": "application/json", "cache-control": "public, max-age=86400" } });
  if (!posts.error) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

async function searchX(env, address) {
  if (!env.MONID_API_KEY) throw new Error("search is not configured");
  const call = (method, path, body) => fetch("https://api.monid.ai" + path, { method, headers: { authorization: "Bearer " + env.MONID_API_KEY, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then(r => r.json());
  let run = await call("POST", "/v1/run", { provider: "tikhub", endpoint: "/api/v1/twitter/web/fetch_search_timeline", input: { queryParams: { keyword: address } } });
  for (let i = 0; i < 8 && run && (run.status === "RUNNING" || run.status === "PENDING" || run.status === "QUEUED"); i++) {
    await new Promise(r => setTimeout(r, 2000));
    run = await call("GET", "/v1/runs/" + encodeURIComponent(run.runId));
  }
  if (!run || run.status !== "COMPLETED") throw new Error(run && run.reason ? run.reason : "the search did not finish");
  const tl = (run.output && run.output.timeline) || [];
  return tl.filter(x => x.type === "tweet").slice(0, 20).map(x => ({
    url: "https://x.com/" + x.screen_name + "/status/" + x.tweet_id, user: x.screen_name, name: x.user_info ? x.user_info.name : null,
    followers: x.user_info ? x.user_info.followers_count : null, at: Date.parse(x.created_at) / 1000 || null,
    text: String(x.text || "").slice(0, 400), likes: x.favorites || 0, views: x.views ? Number(x.views) : null,
    exact: String(x.text || "").toLowerCase().includes(address),   // X search also matches quoted posts and link previews
  }));
}

async function names(address) {
  const r = await fetch("https://api.web3.bio/profile/" + address);
  if (!r.ok) return null;
  const list = await r.json();
  if (!Array.isArray(list) || !list.length) return null;
  const by = p => list.find(x => x.platform === p), links = Object.assign({}, ...list.map(x => x.links || {}));
  const h = k => links[k] ? links[k].handle || links[k].link || null : null;
  return {
    ens: by("ens") ? by("ens").identity : null, basename: by("basenames") ? by("basenames").identity : null,
    farcaster: by("farcaster") ? { username: by("farcaster").identity } : null, lens: by("lens") ? by("lens").identity : null,
    twitter: h("twitter"), github: h("github"), url: h("website"),
  };
}
