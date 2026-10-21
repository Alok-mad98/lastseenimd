// Per-visitor limits on the API, so one script cannot spend the project's Alchemy, AI and search budgets.
// Counts live in the edge cache per IP and minute. They are approximate (the cache is per data centre and not atomic),
// which is enough to stop a loop without getting in the way of a person clicking around.
const LIMITS = { scan: 15, discover: 24, sol: 12, trace: 30, ai: 4, audit: 4, mentions: 8, registry: 60, tips: 10, classify: 20 };

export async function onRequest(ctx) {
  const { request, next } = ctx;
  const name = new URL(request.url).pathname.split("/")[2] || "";
  const limit = LIMITS[name];
  if (!limit) return next();
  const ip = request.headers.get("cf-connecting-ip") || "unknown", minute = Math.floor(Date.now() / 60000);
  const key = new Request("https://ratelimit.lastseen/" + name + "/" + encodeURIComponent(ip) + "/" + minute);
  const cache = caches.default;
  const hit = await cache.match(key);
  const used = hit ? Number(await hit.text()) || 0 : 0;
  if (used >= limit) {
    return new Response(JSON.stringify({ error: "Too many requests from your connection. Wait a minute and try again." }), { status: 429, headers: { "content-type": "application/json", "retry-after": "60" } });
  }
  ctx.waitUntil(cache.put(key, new Response(String(used + 1), { headers: { "cache-control": "max-age=70" } })));
  return next();
}
