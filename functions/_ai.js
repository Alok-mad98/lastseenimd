// Two models, two jobs.
// GLM 5.3 (Cloudflare Workers AI) reasons in words: the analyst's note and the contract audit.
// SubQ Snap answers typed questions with probabilities: a fast second opinion the page can show as meters.
const GLM = "@cf/zai-org/glm-5.3", FLASH = "@cf/zai-org/glm-5.3-flash";

async function run(env, model, body) {
  let r;
  if (env.AI) r = await env.AI.run(model, body);
  else if (env.CF_API_TOKEN && env.CF_ACCOUNT_ID) {
    // local development has no AI binding; the REST endpoint is the same model
    r = await (await fetch("https://api.cloudflare.com/client/v4/accounts/" + env.CF_ACCOUNT_ID + "/ai/v1/chat/completions", { method: "POST", headers: { authorization: "Bearer " + env.CF_API_TOKEN, "content-type": "application/json" }, body: JSON.stringify({ model, ...body }) })).json();
    if (r && r.errors && r.errors.length) throw new Error(r.errors[0].message);
  } else throw new Error("no AI access configured");
  const text = (r && (r.response || (r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content))) || "";
  if (!text) throw new Error("the model ran out of room while thinking");
  return String(text).trim();
}

// GLM 5.3 thinks before it answers and the thinking counts against max_tokens, so the budget is generous.
// If it is rate-limited or comes back empty, the smaller GLM 5.3 Flash answers instead, and the caller is told which one wrote the text.
export async function glm(env, system, user, maxTokens = 8000, patienceMs = 45000) {
  const body = { messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: maxTokens, temperature: 0.2 };
  const slow = new Promise((_, no) => setTimeout(() => no(new Error("took too long")), patienceMs));
  try { return { text: await Promise.race([run(env, GLM, body), slow]), model: "GLM 5.3" }; }
  catch (e) { return { text: await run(env, FLASH, body), model: "GLM 5.3 Flash", fellBack: e.message }; }
}

// questions: { name: { type: "noul" | "choice" | "score", instructions, criteria } }
export async function snap(env, state, questions) {
  if (!env.SUBQ_API_KEY) throw new Error("no SubQ key configured");
  const r = await fetch("https://api.subq.ai/v1/systemone", { method: "POST", headers: { authorization: "Bearer " + env.SUBQ_API_KEY, "content-type": "application/json" }, body: JSON.stringify({ model: "subq-snap-preview", state, questions }) });
  const j = await r.json();
  if (!r.ok) throw new Error((j.detail && j.detail.message) || (j.error && j.error.message) || "SubQ error " + r.status);
  return j.answers;
}

// Models wrap JSON in prose or code fences often enough that parsing needs to be forgiving.
export function parseJson(text) {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch (e) { return null; }
}
