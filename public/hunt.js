// LastSeenIMD: the audit desk and the hunt.
//   Audit: paste Solidity (or a contract address) for a free AI review, or hire the IMD swarm to sign a finding on chain.
//   Hunt: a victim posts a reward in IMD and prepays the swarm's checks; hunters bring leads anonymously; the swarm judges them.
// Private tips are sealed in the hunter's browser to the hirer's public key (ECDH P-256 + AES-GCM). The server only ever holds ciphertext.
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const short = a => a ? a.slice(0, 6) + "…" + a.slice(-4) : "";
  const ark = a => "https://intel.arkm.com/explorer/address/" + a;
  const aLink = (a, name) => `<a href="${ark(a)}" target="_blank" rel="noopener" title="${esc(a)}">${esc(name || short(a))}</a>`;
  const snd = n => window.SND && SND.play(n);
  const CHAINS = [["eth","Ethereum",1],["base","Base",8453],["arb","Arbitrum",42161],["opt","Optimism",10],["bnb","BNB Chain",56],["polygon","Polygon",137],["avax","Avalanche",43114],["linea","Linea",59144],["zksync","zkSync Era",324],["scroll","Scroll",534352],["blast","Blast",81457],["unichain","Unichain",130],["worldchain","World Chain",480],["ink","Ink",57073],["soneium","Soneium",1868],["abstract","Abstract",2741],["zora","Zora",7777777],["shape","Shape",360],["robinhood","Robinhood Chain",4663],["berachain","Berachain",80094],["monad","Monad",143],["hyperevm","HyperEVM",999],["gnosis","Gnosis",100],["celo","Celo",42220],["ronin","Ronin",2020],["apechain","ApeChain",33139],["lens","Lens",232],["story","Story",1514]];
  const ORACLE = [1, 56, 4663, 8453, 42161];
  const getJ = async u => { const r = await fetch(u); const j = await r.json(); if (j.error && r.status >= 400) throw new Error(j.error); return j; };
  const postJ = async (u, b) => { const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); const j = await r.json(); if (j.error) throw new Error(j.error); return j; };
  const open = html => { $("dlg-body").innerHTML = html; if (!$("dlg").open) $("dlg").showModal(); };
  const errText = e => (e && (e.shortMessage || e.message)) || "cancelled";

  // ---- encoding for the registry calls ----
  const w64 = v => BigInt(v).toString(16).padStart(64, "0"), a64 = a => a.slice(2).toLowerCase().padStart(64, "0");
  const wei = imd => BigInt(Math.round(Number(imd) * 1e6)) * 10n ** 12n;
  const SEL = { approve: "0x095ea7b3", openCase: "0x26e67e7a", postBounty: "0x055f0d55", submitLead: "0xed1c0763", submitLink: "0x301bc698", payTip: "0xa858c7d3", requestAudit: "0xce19fcc1" };
  function strArg(s) { // one dynamic string argument, after `head` static words
    const hex = [...new TextEncoder().encode(s)].map(b => b.toString(16).padStart(2, "0")).join("");
    return w64(hex.length / 2) + hex.padEnd(Math.ceil(hex.length / 64) * 64, "0");
  }
  let REG = null;
  const reg = async (extra = "") => (REG = await getJ("/api/registry?" + extra));
  async function mined(hash) {
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 2500));
      const r = await getJ("/api/registry?openTx=" + hash).catch(() => ({}));
      if (r.ok === true) return r; if (r.ok === false) throw new Error("the transaction failed on chain");
    }
    throw new Error("the transaction did not confirm in time");
  }
  async function send(data, say) {
    say("Confirm in your wallet…");
    const h = await window.LS_WALLET.send(REG.chainId, { to: REG.address, data });
    say(`Sent <a href="${REG.explorer}/tx/${h}" target="_blank" rel="noopener">${short(h)}</a>. Waiting for Robinhood Chain…`);
    return mined(h);
  }
  // make sure the registry may take `need` IMD from the connected wallet
  async function allow(need, say) {
    const me = window.LS_WALLET.address, r = await reg("holder=" + me);
    if (r.holder.imd < need) throw new Error(`this wallet holds ${r.holder.imd} IMD on Robinhood Chain and this needs ${need}`);
    if (r.holder.allowanceImd >= need) return;
    say(`Step: let the registry use ${need} IMD. Confirm in your wallet…`);
    const h = await window.LS_WALLET.send(REG.chainId, { to: r.token, data: SEL.approve + a64(REG.address) + w64(wei(need)) });
    say("Approval sent. Waiting for it to confirm…");
    await mined(h);
  }
  const needWallet = say => { if (window.LS_WALLET) return false; say("Connect a wallet first (bottom left)."); return true; };

  // ---- sealing tips ----
  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))), unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const hexOf = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  const EC = { name: "ECDH", namedCurve: "P-256" };
  const keyMessage = a => "LastSeenIMD tip key\n\nSigning this makes the key that opens private tips sent to your bounties. It is free and moves nothing.\n\nWallet: " + a;
  async function lockFrom(sig) { return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(sig).toLowerCase())), "AES-GCM", false, ["encrypt", "decrypt"]); }
  async function makeTipKey() {
    const sig = await window.LS_WALLET.sign(keyMessage(window.LS_WALLET.address));
    const kp = await crypto.subtle.generateKey(EC, true, ["deriveKey"]);
    const pub = await crypto.subtle.exportKey("raw", kp.publicKey), iv = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await lockFrom(sig), await crypto.subtle.exportKey("pkcs8", kp.privateKey));
    const r = await postJ("/api/tips", { kind: "key", pub: b64(pub), wrapped: b64(wrapped), iv: b64(iv) });
    return "0x" + r.id;
  }
  async function seal(tipKey, caseId, message) {
    const k = await getJ("/api/tips?key=" + tipKey.slice(2));
    // the bounty on chain names the hash of the hirer's key; a swapped key would not match
    if ("0x" + hexOf(await crypto.subtle.digest("SHA-256", unb64(k.pub))) !== tipKey.toLowerCase()) throw new Error("the hirer's key does not match the bounty on chain");
    const pub = await crypto.subtle.importKey("raw", unb64(k.pub), EC, false, []), eph = await crypto.subtle.generateKey(EC, true, ["deriveKey"]);
    const aes = await crypto.subtle.deriveKey({ name: "ECDH", public: pub }, eph.privateKey, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12)), ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode(JSON.stringify(message)));
    return postJ("/api/tips", { kind: "tip", caseId, keyId: tipKey, epk: b64(await crypto.subtle.exportKey("raw", eph.publicKey)), iv: b64(iv), ct: b64(ct) });
  }
  async function unseal(tipKey, tips) {
    const k = await getJ("/api/tips?key=" + tipKey.slice(2)), sig = await window.LS_WALLET.sign(keyMessage(window.LS_WALLET.address));
    let raw; try { raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(k.iv) }, await lockFrom(sig), unb64(k.wrapped)); }
    catch { throw new Error("this signature does not open the key. Use the same wallet that posted the bounty; a few hardware wallets sign differently each time and cannot be used for this"); }
    const priv = await crypto.subtle.importKey("pkcs8", raw, EC, false, ["deriveKey"]);
    return Promise.all(tips.map(async t => {
      try {
        const aes = await crypto.subtle.deriveKey({ name: "ECDH", public: await crypto.subtle.importKey("raw", unb64(t.epk), EC, false, []) }, priv, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
        const m = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(t.iv) }, aes, unb64(t.ct))));
        // anyone can send a tip, so its fields are untrusted: plain text, and a payout only if it is really an address
        const payout = typeof m.payout === "string" && /^0x[0-9a-fA-F]{40}$/.test(m.payout) ? m.payout.toLowerCase() : null;
        return { ...t, id: /^[0-9a-f]{64}$/.test(t.id) ? t.id : "", msg: { text: String(m.text || ""), payout } };
      } catch { return { ...t, msg: null }; }
    }));
  }

  // ================================================================ the audit desk
  function auditDesk(prefill) {
    open(`<h3>AUDIT A CONTRACT</h3>
      <p>Paste a contract's Solidity source code, or the address of a deployed contract.</p>
      <textarea id="au-src" rows="9" spellcheck="false" placeholder="pragma solidity ^0.8.0;&#10;contract …&#10;&#10;or 0x… for a deployed contract"></textarea>
      <div class="au-row" id="au-chainrow" hidden><label for="au-chain">Chain</label><select id="au-chain">${CHAINS.map(c => `<option value="${c[0]}">${esc(c[1])}</option>`).join("")}</select></div>
      <div class="au-btns"><button class="go" type="button" id="au-free">FREE AI AUDIT</button><button class="go alt" type="button" id="au-swarm" hidden>HIRE THE SWARM</button></div>
      <p class="fine"><b>Free:</b> GLM 5.3 reads the code and lists what is wrong, where, and how to fix it; SubQ gives a second opinion. About a minute.<br>
      <b>The swarm:</b> for a deployed contract with public source on Ethereum, BNB Chain, Base, Arbitrum or Robinhood Chain. Five IdentityMD agents read the verified source and sign one answer on chain: can a single privileged account move users' funds? Wallets and apps can read that answer for free. Costs <span id="au-price">1 IMD</span>: half pays the swarm, half pays for free verdicts for theft victims.</p>
      <div id="au-out"></div>`);
    const src = $("au-src"), isAddr = s => /^0x[0-9a-fA-F]{40}$/.test(s.trim());
    const sync = () => { const a = isAddr(src.value); $("au-chainrow").hidden = !a; $("au-swarm").hidden = !a || !ORACLE.includes(CHAINS.find(c => c[0] === $("au-chain").value)[2]); };
    src.oninput = sync; $("au-chain").onchange = sync;
    if (prefill) { src.value = prefill.text || ""; if (prefill.chain) $("au-chain").value = prefill.chain; }
    sync();
    reg().then(r => { if (r.deployed) $("au-price").textContent = (r.priceImd + r.auditFeeImd) + " IMD"; }).catch(() => {});
    $("au-free").onclick = () => {
      const v = src.value.trim();
      if (isAddr(v)) return window.LS && LS.audit($("au-chain").value, v.toLowerCase(), "contract");
      pasted(v);
    };
    $("au-swarm").onclick = () => swarmAudit(CHAINS.find(c => c[0] === $("au-chain").value), src.value.trim().toLowerCase(), $("au-out"));
  }

  async function pasted(source) {
    const out = $("au-out"); out.innerHTML = `<p class="state">Reading the code… this takes up to a minute.</p>`; $("au-free").disabled = true;
    let r; try { r = await postJ("/api/audit", { source }); } catch (e) { r = { error: e.message }; }
    $("au-free").disabled = false;
    if (r.error) { out.innerHTML = `<p class="err">${esc(r.error)}</p>`; snd("error"); return; }
    const a = r.audit, fs = (a.findings || []).filter(f => f && f.title);
    out.innerHTML = `<h3 class="v-${esc(a.verdict)}">${esc(String(a.verdict || "caution").toUpperCase())}${r.name ? " · " + esc(r.name) : ""}</h3><p>${esc(a.summary)}</p>
      ${fs.length ? `<div class="tw"><table><tr><th>Severity</th><th>Problem</th><th>Where</th><th>How it can be abused</th><th>Fix</th></tr>${fs.map(f => `<tr><td><span class="tag sev-${esc(f.severity)}">${esc(String(f.severity).toUpperCase())}</span></td><td>${esc(f.title)}</td><td><code>${esc(f.where)}</code></td><td>${esc(f.why)}</td><td>${esc(f.fix)}</td></tr>`).join("")}</table></div>` : "<p>No problems found.</p>"}
      ${a.can_do && a.can_do.length ? `<h4>What the owner or an admin can do</h4><ul>${a.can_do.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      <p class="foot">Confidence: ${esc(a.confidence || "low")}.${r.malicious == null ? "" : ` A second model puts the chance it was built to take users' funds at ${Math.round(r.malicious * 100)}%.`} Written by ${esc(r.models.audit)}; second check by ${esc(r.models.second)}. An AI review is not a professional audit. To get a finding signed on chain, deploy the contract, verify its source, and hire the swarm with its address.</p>`;
    snd(a.verdict === "dangerous" ? "alarm" : "ok");
  }

  async function swarmAudit(chain, address, out) {
    const say = h => out.innerHTML = `<p class="state">${h}</p>`;
    try {
      const r = await reg("audit=" + chain[0] + ":" + address);
      if (!r.deployed) return say("The registry contract goes live with LastSeenIMD's IMD launch. Until then the swarm cannot be hired from here; the free AI audit works now.");
      if (r.audit && r.audit.finding !== "not checked") say(`The swarm's latest finding on this contract: <b>${esc(r.audit.finding.toUpperCase())}</b>. You can ask again.`);
      if (needWallet(say)) return;
      const cost = r.priceImd + r.auditFeeImd;
      await allow(cost, say);
      await send(SEL.requestAudit + w64(chain[2]) + a64(address), say);
      say(`Asked. Five IdentityMD agents are reading ${esc(short(address))} on ${esc(chain[1])}. The signed answer usually lands within minutes; open this again to see it.`); snd("ok");
    } catch (e) { say("Not sent: " + esc(errText(e))); snd("error"); }
  }

  // ================================================================ the hunt
  const PRIVACY = `<p class="fine"><b>Nobody needs to know who you are.</b> No account, name or email. A private tip is sealed in your browser with the victim's key before it leaves your computer: this site stores only the sealed bytes, with no IP address, and cannot read it. For leads judged by the swarm, use a fresh wallet that has nothing to do with you; the reward is paid to that wallet. For more protection, use Tor or a VPN.</p>`;

  async function board() {
    open(`<h3>BOUNTY BOARD</h3><p>Victims hire hunters to find where their money went. The IMD swarm judges every lead, and a lead it confirms pays the hunter straight from the contract.</p>${PRIVACY}<div id="hb"><p class="state">Reading the registry…</p></div>`);
    let r; try { r = await reg("hunts=1"); } catch (e) { $("hb").innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    if (!r.deployed) {
      $("hb").innerHTML = `<p class="note">The registry contract goes live with LastSeenIMD's IMD launch, so there are no bounties yet. How it will work:</p>
        <ol class="howto"><li><b>The victim posts a bounty</b> from their case file: a reward in IMD, plus the swarm's fee for a number of checks, paid up front.</li>
        <li><b>Hunters bring leads</b> from any wallet: one hop the money took on chain, or a public page that ties the thief to an account. Each lead needs a 0.5 IMD stake, returned with the reward when the lead is right, and paid to the victim's checks when it is wrong, so guessing costs the guesser.</li>
        <li><b>The swarm judges.</b> Five IdentityMD agents check the lead; if four agree, the contract pays the hunter a quarter of the reward left.</li>
        <li><b>Whistleblowers</b> can send a private tip with no wallet at all. Only the victim can read it, and the victim can pay for it from the reward.</li></ol>`;
      return;
    }
    const hs = r.hunts || [];
    $("hb").innerHTML = hs.length ? hs.map(h => `<div class="hunt"><div><b>Case #${h.id}</b> · ${aLink(h.wallet)} robbed by ${aLink(h.suspect)} · <span class="tag ${h.status === "confirmed" ? "bad" : ""}">${esc(h.status)}</span></div>
      <div class="hmeta"><span><b>${h.rewardImd}</b> IMD reward</span><span><b>${Math.floor(h.hunt.checksImd / r.priceImd)}</b> swarm checks prepaid</span><span>open until ${new Date(h.hunt.openUntil * 1000).toISOString().slice(0, 10)}</span></div>
      <button class="go" type="button" data-hunt="${h.id}">OPEN THE CASE</button></div>`).join("") : `<p class="note">No bounties yet. A victim posts one from their case file, under “Get this signed by the IMD swarm”.</p>`;
  }

  async function huntView(id) {
    open(`<h3>CASE #${id}</h3><div id="hv"><p class="state">Reading the case…</p></div>`);
    let r; try { r = await reg("hunt=" + id); } catch (e) { $("hv").innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    const h = r.hunt, open_ = h.hunt.openUntil * 1000 > Date.now(), mine = window.LS_WALLET && window.LS_WALLET.address === h.hunt.hirer;
    $("hv").innerHTML = `<dl><dt>Robbed wallet</dt><dd>${aLink(h.wallet, h.wallet)}</dd><dt>Thief</dt><dd>${aLink(h.suspect, h.suspect)} · case ${esc(h.status)}</dd><dt>Reward left</dt><dd>${h.rewardImd} IMD (a confirmed lead earns a quarter of it)</dd><dt>Swarm checks</dt><dd>${Math.floor(h.hunt.checksImd / r.priceImd)} prepaid by the victim${h.hunt.inFlight ? `, ${h.hunt.inFlight} being judged now` : ""}</dd><dt>Open until</dt><dd>${new Date(h.hunt.openUntil * 1000).toISOString().slice(0, 10)}${open_ ? "" : " (closed)"}</dd></dl>
      <h4>The trail so far</h4><p>${h.reached.map(a => aLink(a)).join(" → ")}</p>
      ${h.leads.length ? `<div class="tw"><table><tr><th>#</th><th>Lead</th><th>Status</th><th class="n">Paid</th></tr>${h.leads.map(l => `<tr><td>${l.id}</td><td>${l.kind === "hop" ? `${aLink(l.from)} → ${aLink(l.to)}` : `<a href="${esc(l.url)}" target="_blank" rel="noopener nofollow">${esc(l.url.slice(0, 60))}</a>`}</td><td>${esc(l.status)}</td><td class="n">${l.paidImd ? l.paidImd + " IMD" : ""}</td></tr>`).join("")}</table></div>` : "<p>No leads yet.</p>"}
      ${open_ ? `<h4>SEND A PRIVATE TIP · no wallet needed</h4>
      <textarea id="tp-text" rows="4" maxlength="4000" placeholder="What you know: a Telegram or X handle, an exchange, a name, where the funds were cashed out…"></textarea>
      <input id="tp-pay" placeholder="Optional: an address to be paid at (use a fresh one)" spellcheck="false">
      <button class="go" type="button" id="tp-go" ${h.hunt.tipKey === "0x" + "0".repeat(64) ? "disabled" : ""}>SEAL AND SEND</button><p class="state" id="tp-st"></p>
      <h4>PROVE A HOP ON CHAIN · the swarm checks it</h4>
      <div class="au-row"><select id="ld-from">${h.reached.map(a => `<option value="${a}">${short(a)}</option>`).join("")}</select><span>sent the money to</span><input id="ld-to" placeholder="0x…" spellcheck="false"></div>
      <button class="go" type="button" id="ld-go">SUBMIT TO THE SWARM · ${r.priceImd} IMD STAKE</button><p class="state" id="ld-st"></p>
      <h4>SUBMIT A PUBLIC PAGE · the swarm reads it</h4>
      <input id="lk-url" placeholder="https://… a post, a screenshot, a record that ties the thief to an account" spellcheck="false">
      <button class="go" type="button" id="lk-go">SUBMIT TO THE SWARM · ${r.priceImd} IMD STAKE</button><p class="state" id="lk-st"></p>${PRIVACY}` : ""}
      ${mine ? `<h4>YOUR PRIVATE TIPS</h4><button class="go alt" type="button" id="tp-open">OPEN THEM WITH YOUR WALLET</button><div id="tp-list"></div>` : ""}`;
    const st = id => html => $(id).innerHTML = html;
    if ($("tp-go")) $("tp-go").onclick = async () => {
      const say = st("tp-st"), text = $("tp-text").value.trim(), pay = $("tp-pay").value.trim();
      if (text.length < 10) return say("Write a little more.");
      if (pay && !/^0x[0-9a-fA-F]{40}$/.test(pay)) return say("The payout address is not a wallet address.");
      $("tp-go").disabled = true; say("Sealing in your browser…");
      try { await seal(h.hunt.tipKey, id, { text, payout: pay || null }); $("tp-text").value = ""; say("Sent, sealed. Only the victim can read it."); snd("ok"); }
      catch (e) { say("Not sent: " + esc(errText(e))); $("tp-go").disabled = false; snd("error"); }
    };
    if ($("ld-go")) $("ld-go").onclick = async () => {
      const say = st("ld-st"), to = $("ld-to").value.trim().toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(to)) return say("That is not an address.");
      if (needWallet(say)) return;
      try { await allow(r.priceImd, say); await send(SEL.submitLead + w64(id) + a64($("ld-from").value) + a64(to), say); say("Submitted. The swarm is checking it; open this case again in a few minutes."); snd("ok"); }
      catch (e) { say("Not sent: " + esc(errText(e))); snd("error"); }
    };
    if ($("lk-go")) $("lk-go").onclick = async () => {
      const say = st("lk-st"), url = $("lk-url").value.trim();
      if (!/^https:\/\/[\x21-\x7e]{4,292}$/.test(url) || /["\\]/.test(url)) return say("Give one https:// link without spaces or quotes.");
      if (needWallet(say)) return;
      try { await allow(r.priceImd, say); await send(SEL.submitLink + w64(id) + w64(64) + strArg(url), say); say("Submitted. The swarm is reading the page; open this case again in a few minutes."); snd("ok"); }
      catch (e) { say("Not sent: " + esc(errText(e))); snd("error"); }
    };
    if ($("tp-open")) $("tp-open").onclick = async () => {
      const box = $("tp-list"); box.innerHTML = `<p class="state">Sign in your wallet to open the key…</p>`;
      try {
        let all = [], cursor = "";
        for (let page = 0; page < 20; page++) { const t = await getJ("/api/tips?caseId=" + id + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "")); all = all.concat(t.tips); if (!t.cursor) break; cursor = t.cursor; }
        // only tips sealed to this bounty's key can be opened; anything else is noise
        const list = (await unseal(h.hunt.tipKey, all.filter(t => ("0x" + t.keyId) === h.hunt.tipKey.toLowerCase()))).filter(t => t.msg);
        const paid = new Set(h.tipsPaid.map(x => x.tipId.toLowerCase()));
        box.innerHTML = list.length ? list.map(t => `<div class="tip"><div class="hmeta"><span>${new Date(t.at * 1000).toISOString().slice(0, 13).replace("T", " ")}:00 UTC</span>${t.msg && t.msg.payout ? `<span>pay to ${aLink(t.msg.payout)}</span>` : "<span>no payout address</span>"}${paid.has("0x" + t.id) ? '<span class="tag swap">paid</span>' : ""}</div>
          <p>${t.msg ? esc(t.msg.text) : "<i>This one could not be opened.</i>"}</p>
          ${t.msg && t.msg.payout && !paid.has("0x" + t.id) ? `<div class="au-row"><input data-amt="${t.id}" placeholder="IMD" inputmode="decimal"><button class="mini" type="button" data-pay="${t.id}:${t.msg.payout}">PAY FROM THE REWARD</button></div>` : ""}</div>`).join("") : "<p>No private tips yet.</p>";
        box.onclick = async e => {
          const b = e.target.closest("[data-pay]"); if (!b) return;
          const [tid, to] = b.dataset.pay.split(":"), amt = Number(box.querySelector(`[data-amt="${tid}"]`).value);
          if (!(amt > 0) || amt > h.rewardImd) { b.textContent = "AMOUNT?"; return; }
          b.disabled = true;
          try { await send(SEL.payTip + w64(id) + tid.padStart(64, "0") + a64(to) + w64(wei(amt)), x => b.textContent = x.replace(/<[^>]+>/g, "").slice(0, 30)); b.textContent = "PAID"; snd("ok"); }
          catch (err) { b.disabled = false; b.textContent = "FAILED: " + errText(err).slice(0, 40); snd("error"); }
        };
      } catch (e) { box.innerHTML = `<p class="err">${esc(errText(e))}</p>`; }
    };
  }

  // the victim's side, inside the case file: open the case if needed, make the tip key, prepay, post
  function mountPost(box, d, sw, sc) {
    if (!sc) return;
    const el = document.createElement("div"); el.className = "hire";
    el.innerHTML = `<h3>HIRE HUNTERS</h3>
      <p>Put up a reward in IMD for whoever finds where the money went. You prepay the swarm's fee for the checks, so every lead is judged by five IdentityMD agents and a confirmed one pays the hunter automatically. Hunters stay anonymous; whistleblowers can send you sealed tips that only you can read.</p>
      <div class="au-row"><label>Reward <input id="hb-reward" value="10" inputmode="decimal"> IMD</label><label>Checks <input id="hb-checks" value="4" inputmode="numeric"></label><label>Days <input id="hb-days" value="30" inputmode="numeric"></label></div>
      <p class="fine" id="hb-cost"></p>
      <button class="go" type="button" id="hb-go">POST THE BOUNTY</button> <button class="ghost" type="button" data-board="1">SEE THE BOUNTY BOARD</button>
      <p class="state" id="hb-st"></p>`;
    box.appendChild(el);
    const cost = () => { const p = (REG && REG.priceImd) || 0.5, n = Math.max(1, Math.floor(Number($("hb-checks").value) || 0)); $("hb-cost").textContent = `You pay ${Number($("hb-reward").value) || 0} IMD reward + ${n} × ${p} IMD for the swarm's checks = ${(Number($("hb-reward").value) || 0) + n * p} IMD, plus gas on Robinhood Chain. Whatever is left comes back to you when the bounty closes. A wrong lead pays for its own check.`; };
    ["hb-reward", "hb-checks"].forEach(i => $(i).oninput = cost); cost();
    $("hb-go").onclick = async () => {
      const say = h => $("hb-st").innerHTML = h, reward = Number($("hb-reward").value), checks = Math.floor(Number($("hb-checks").value)), days = Math.floor(Number($("hb-days").value));
      if (!(reward >= 0) || !(checks >= 1 && checks <= 100) || !(days >= 7 && days <= 365)) return say("Reward 0 or more, checks 1 to 100, days 7 to 365.");
      if (needWallet(say)) return;
      $("hb-go").disabled = true;
      try {
        let r = await reg(`caseFor=${d.address}&suspect=${sw.address}`);
        if (!r.deployed) throw new Error("the registry goes live with the IMD launch");
        let caseId = r.case && r.case.status !== "rejected" ? r.case.id : null;
        if (caseId == null) {
          const rc = await send(SEL.openCase + a64(d.address) + a64(sw.address) + w64(sc.chainId) + w64(sc.fromBlock) + w64(sc.toBlock), say);
          caseId = rc.caseId;
        }
        say("Sign the free message in your wallet. It makes the key only you can use to read private tips.");
        const tipKey = await makeTipKey();
        await allow(reward + checks * REG.priceImd, say);
        await send(SEL.postBounty + w64(caseId) + w64(wei(reward)) + w64(checks) + tipKey.slice(2) + w64(days), say);
        say(`The bounty on case #${caseId} is live. <button class="mini" type="button" data-hunt="${caseId}">OPEN IT</button>`); snd("ok");
      } catch (e) { $("hb-go").disabled = false; say("Not posted: " + esc(errText(e))); snd("error"); }
    };
  }

  document.addEventListener("click", e => {
    const t = e.target.closest("[data-hunt],[data-board],[data-desk],[data-swarm-audit]"); if (!t) return;
    if (t.dataset.hunt) huntView(Number(t.dataset.hunt));
    else if (t.dataset.board) board();
    else if (t.dataset.desk) auditDesk();
    else { const [k, a] = t.dataset.swarmAudit.split(":"), c = CHAINS.find(x => x[0] === k); const o = document.createElement("div"); t.after(o); swarmAudit(c, a, o); }
  });
  // pasting Solidity into the wallet box opens the audit desk with it
  const addr = $("addr");
  if (addr) addr.addEventListener("paste", e => {
    const text = (e.clipboardData || window.clipboardData).getData("text");
    if (/\bpragma\s+solidity\b|\bcontract\s+\w+\s*(is\b|\{)/.test(text)) { e.preventDefault(); auditDesk({ text }); }
  });
  window.HUNT = { mountPost, board, auditDesk, huntView };
})();
