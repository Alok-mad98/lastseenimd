import { json, isAddr, chainOf, rpc, tracer } from "../_lib.js";
import { glm, snap, parseJson } from "../_ai.js";

// GET /api/audit?chain=base&address=0x…  →  what a contract can do, in plain words.
// With public source code (Sourcify) the model reads the source. Without it, all we have is the list of functions found in the bytecode, and the answer says so.
const SYS = `You are a smart-contract security reviewer explaining a contract to a non-technical wallet owner who has given it power over their funds (a token approval, or an EIP-7702 delegation that lets the contract act as their wallet).
Reply with one JSON object and nothing else:
{"verdict":"safe"|"caution"|"dangerous","summary":"two plain sentences","can_do":["up to 5 short plain statements of what this contract can do with the owner's funds"],"red_flags":["up to 5 specific concerns, each naming the function involved; empty if none"],"confidence":"low"|"medium"|"high"}
Be specific and honest. If you only have function names from bytecode, confidence cannot be "high". An unverified contract that can execute arbitrary calls or sweep tokens to a fixed address is dangerous. Well-known audited code is safe.`;

export async function onRequestGet(ctx) {
  const { request, env } = ctx;
  const q = new URL(request.url).searchParams, address = (q.get("address") || "").toLowerCase(), chain = chainOf(q.get("chain"));
  if (!isAddr(address)) return json({ error: "Not a contract address." }, 400);
  const t = tracer(env, "contract-audit", { address, chain: chain.key });
  try {
    const code = await t.step("eth_getCode", { address }, () => rpc(env, "eth_getCode", [address, "latest"], chain));
    if (!code || code === "0x") return json({ error: "There is no contract at this address on " + chain.name + ". It is an ordinary wallet." }, 404);
    if (code.startsWith("0xef0100")) return json({ error: "This is a wallet delegated to another contract. Audit the contract it points to: 0x" + code.slice(8, 48) }, 400);
    const src = await t.step("sourcify_source", { address }, () => fetch("https://sourcify.dev/server/v2/contract/" + chain.id + "/" + address + "?fields=sources,compilation").then(r => r.json()).catch(() => null));
    let basis, material, name = null;
    if (src && src.sources && Object.keys(src.sources).length) {
      basis = "source"; name = (src.compilation && src.compilation.name) || null;
      // the contract's own files first, libraries last, and stop before the prompt gets silly
      const files = Object.entries(src.sources).sort((a, b) => /node_modules|@openzeppelin|lib\//.test(a[0]) - /node_modules|@openzeppelin|lib\//.test(b[0]));
      material = ""; for (const [f, v] of files) { if (material.length > 60000) break; material += "\n// FILE " + f + "\n" + String(v.content || "").slice(0, 30000); }
    } else {
      basis = "bytecode";
      const sels = [...new Set((code.match(/63([0-9a-f]{8})/g) || []).map(s => "0x" + s.slice(2)))].slice(0, 60);
      const names = await t.step("openchain_signatures", { selectors: sels.length }, () => fetch("https://api.openchain.xyz/signature-database/v1/lookup?function=" + sels.join(",")).then(r => r.json()).then(j => (j.result && j.result.function) || {}).catch(() => ({})));
      const list = sels.map(s => s + " " + ((names[s] && names[s][0] && names[s][0].name) || "unknown")).join("\n");
      material = "No public source code. Bytecode size: " + (code.length - 2) / 2 + " bytes. Possible function selectors found in the bytecode (some may be data, not functions):\n" + list;
    }
    const role = { delegate: "The owner's wallet is delegated to this contract with EIP-7702, so this code runs as the wallet itself.", contract: "Someone wants to know whether this contract is safe to use, send funds to or approve." }[q.get("role")] || "The owner approved this contract to spend tokens from their wallet.";
    const [out, second] = await Promise.all([
      t.step("glm_5_3_audit", { basis }, () => glm(env, SYS, role + "\nChain: " + chain.name + "\nAddress: " + address + (name ? "\nContract name: " + name : "") + "\n\n" + material, 9000, 100000)),
      t.step("subq_snap_decisions", {}, () => snap(env, { role, basis, material: material.slice(0, 12000) }, { malicious: { type: "noul", instructions: "Is this contract built to take funds from the wallet that trusts it?", criteria: { true: "It can move the wallet's assets to an address the wallet owner does not control, with no legitimate purpose shown.", false: "It is ordinary wallet, exchange or protocol code." } } })).catch(() => null),
    ]);
    const text = out.text, a = parseJson(text) || { verdict: "caution", summary: text.slice(0, 400), can_do: [], red_flags: [], confidence: "low" };
    t.done({ verdict: a.verdict, basis });
    return json({ address, chain: chain.key, name, basis, audit: a, malicious: second && second.malicious ? second.malicious.noul : null, models: { audit: out.model, second: "SubQ Snap Preview" } });
  } catch (e) {
    t.fail(e);
    return json({ error: "The audit failed: " + e.message }, 502);
  } finally {
    ctx.waitUntil(t.send());
  }
}

// POST /api/audit {source}  →  a free AI review of pasted Solidity: what can go wrong, where, and how to fix it.
const SRC = `You are a smart-contract auditor. Someone pasted Solidity source code and wants to know what is wrong with it before they deploy it, use it or approve it.
Reply with one JSON object and nothing else:
{"verdict":"safe"|"caution"|"dangerous","summary":"two plain sentences","can_do":["up to 5 short plain statements of what the owner or an admin can do with users' funds"],"findings":[{"severity":"critical"|"high"|"medium"|"low","title":"short name","where":"function or line it is in","why":"one or two plain sentences on how it can be abused","fix":"one sentence"}],"confidence":"low"|"medium"|"high"}
Look for: reentrancy, missing access control, owner or admin powers over user funds (sweep, mint, pause, blacklist, upgrade), unchecked external calls and return values, tx.origin auth, signature replay, oracle or price manipulation, integer and rounding issues, unbounded loops, front-running, hidden fees or transfer taxes, honeypot patterns (users can buy but not sell), and anything that sends funds to a hard-coded address.
List at most 10 findings, most severe first, each naming the function. Do not invent issues: if the code is clean, say so and return few or no findings. Confidence cannot be "high" if imported files are missing.`;

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  let source = "";
  try { source = String((await request.json()).source || ""); } catch { return json({ error: "Send the source code as JSON." }, 400); }
  source = source.trim();
  if (source.length < 40 || !/\b(contract|library|interface)\s+\w+/.test(source)) return json({ error: "That does not look like Solidity source code. Paste the whole contract, starting from pragma." }, 400);
  if (source.length > 80000) return json({ error: "That is too long for one review (over 80,000 characters). Paste the main contract without its libraries." }, 413);
  const t = tracer(env, "contract-audit-pasted", { chars: source.length });
  try {
    const name = (source.match(/\bcontract\s+(\w+)/g) || []).pop()?.split(/\s+/)[1] || null;
    const [out, second] = await Promise.all([
      t.step("glm_5_3_audit", { basis: "pasted" }, () => glm(env, SRC, (name ? "Main contract: " + name + "\n\n" : "") + source, 12000, 100000)),
      t.step("subq_snap_decisions", {}, () => snap(env, { basis: "pasted source", material: source.slice(0, 12000) }, { malicious: { type: "noul", instructions: "Is this contract built to take funds from the people who use it?", criteria: { true: "It lets an owner, admin or hard-coded address move users' assets with no legitimate purpose shown, or users can put money in but not take it out.", false: "It is ordinary token, wallet, exchange or protocol code, even if it has bugs." } } })).catch(() => null),
    ]);
    const a = parseJson(out.text) || { verdict: "caution", summary: out.text.slice(0, 400), can_do: [], findings: [], confidence: "low" };
    t.done({ verdict: a.verdict, findings: (a.findings || []).length });
    return json({ name, basis: "pasted", audit: a, malicious: second && second.malicious ? second.malicious.noul : null, models: { audit: out.model, second: "SubQ Snap Preview" } });
  } catch (e) {
    t.fail(e);
    return json({ error: "The audit failed: " + e.message }, 502);
  } finally {
    ctx.waitUntil(t.send());
  }
}
