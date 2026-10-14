// LastSeenIMD client. Calls /api/scan and /api/trace, tells the story as messages, draws the charts.
(function () {
  const $ = id => document.getElementById(id);
  const C = { ink: "#d6d8cf", dim: "#8a9087", line: "#232a31", lamp: "#e9d37c", blood: "#c8463b", moss: "#7fb08a", cold: "#7fa3c7", violet: "#a48bd1", sand: "#c9a36b" };
  const KIND = { exchange: C.cold, mixer: C.blood, bad: C.blood, sanctioned: C.blood, bridge: C.moss, swap: C.moss, unknown: C.dim, other: C.sand, start: C.lamp, poison: C.violet, deposit: C.cold };
  const KNAME = { exchange: "Exchange", mixer: "Mixer", bad: "Flagged", sanctioned: "Sanctioned", bridge: "Bridge", swap: "Swap / DEX", unknown: "No label", other: "Known contract", start: "Start", poison: "Look-alike (poisoning)", deposit: "Exchange deposit address" };
  const PAL = [C.lamp, C.cold, C.moss, C.blood, C.violet, C.sand, "#9aa7b1", "#d98f6c"];
  const short = a => a ? a.slice(0, 6) + "…" + a.slice(-4) : "";
  const usd = v => v >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : v >= 1e4 ? "$" + Math.round(v / 1e3) + "k" : "$" + Math.round(v).toLocaleString("en-US");
  let EXP = { eth: "https://etherscan.io" }, MAIN = "eth", CN = { eth: "Ethereum" }, CID = { eth: 1 };
  const exA = (a, c) => (EXP[c || MAIN] || EXP.eth) + "/address/" + a, exT = (h, c) => (EXP[c || MAIN] || EXP.eth) + "/tx/" + h;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const aLink = (a, name, c) => `<a href="${exA(a, c)}" target="_blank" rel="noopener" title="${a}">${esc(name || short(a))}</a>`;
  const when = ts => new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 16);
  const charts = {};
  let D = null, T = null, tapeTimer = null, curTab = "overview";
  const OWN = ["exchange", "swap", "bridge", "other"];
  // the owner's own swaps and bridges are real activity, but they hide the theft; this switch takes them out of the pictures
  const peers = () => D.sent.filter(c => !$("own").checked || !OWN.includes(c.kind));
  const chip = c => `<span class="tag chain">${esc(CN[c] || c)}</span>`;

  // tape clock
  setInterval(() => { const d = new Date(); $("clock").textContent = d.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }).toUpperCase() + "  " + d.toLocaleTimeString("en-GB"); }, 1000);
  $("fx").onchange = e => document.body.classList.toggle("nofx", !e.target.checked);
  const snd = (n, max) => window.SND && SND.play(n, max);
  const sb = $("snd"), sbText = () => { sb.textContent = window.SND && SND.on ? "SOUND ON" : "SOUND OFF"; sb.setAttribute("aria-pressed", window.SND && SND.on ? "true" : "false"); };
  sb.onclick = () => { if (window.SND) SND.toggle(); sbText(); }; sbText();
  document.querySelectorAll("#tabs button").forEach((b, n) => b.style.setProperty("--n", n));
  // evidence appears as it scrolls into view, one piece after another
  const io = "IntersectionObserver" in window ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.remove("pre"); io.unobserve(e.target); } }), { threshold: 0.08 }) : null;
  function reveal(root) {
    if (!io || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    [...root.querySelectorAll("figure, .stat, .tw, .note")].filter(el => !el.dataset.seen).forEach((el, n) => { el.dataset.seen = 1; el.classList.add("pre"); el.style.transitionDelay = Math.min(n, 8) * 70 + "ms"; io.observe(el); });
    // never leave evidence invisible if the observer does not fire (background tab, old browser)
    setTimeout(() => root.querySelectorAll(".pre").forEach(el => el.classList.remove("pre")), 1800);
  }
  $("own").onchange = () => { if (!D) return; rendered = {}; render(curTab); };

  const base = { backgroundColor: "transparent", textStyle: { color: C.ink, fontFamily: "IBM Plex Mono, monospace", fontSize: 12 }, color: PAL, animationDuration: 700,
    tooltip: { backgroundColor: "#0b0e12", borderColor: C.line, textStyle: { color: C.ink, fontSize: 12 }, confine: true } };
  const axis = { axisLine: { lineStyle: { color: C.line } }, axisLabel: { color: C.dim }, splitLine: { lineStyle: { color: "#151a1f" } }, axisTick: { show: false } };
  function draw(id, opt) {
    const el = $(id); if (!el) return;
    if (charts[id]) charts[id].dispose();
    const ch = charts[id] = echarts.init(el, null, { renderer: "canvas" });
    ch.setOption(Object.assign({}, base, opt));
    return ch;
  }
  function empty(id, text) { const el = $(id); if (charts[id]) { charts[id].dispose(); delete charts[id]; } el.innerHTML = `<p style="color:${C.dim};padding:20px 4px;margin:0">${esc(text)}</p>`; }
  addEventListener("resize", () => Object.values(charts).forEach(c => c.resize()));

  // ---- navigation ----
  $("f").onsubmit = e => { e.preventDefault(); run($("addr").value.trim()); };
  $("back").onclick = () => { history.replaceState(null, "", location.pathname); D = null; show(false); if (window.SND) SND.mood("calm"); if (window.SCENE) SCENE.retreat(); };
  $("tabs").onclick = e => { const b = e.target.closest("button"); if (b) tab(b.dataset.t); };
  function tab(t) {
    document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.t === t));
    curTab = t;
    document.querySelectorAll(".pane").forEach(p => p.hidden = p.id !== "p-" + t);
    render(t);
    Object.values(charts).forEach(c => c.resize());
    reveal($("p-" + t));
  }
  function show(inCase) { $("home").hidden = inCase; $("case").hidden = !inCase; document.body.classList.toggle("incase", inCase); scrollTo(0, 0); }

  async function run(address) {
    $("err").textContent = "";
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return runSol(address);
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) { $("err").textContent = "That is not a wallet address. An EVM address starts with 0x and is 42 characters long; a Solana address is 32 to 44 letters and numbers."; return; }
    $("tabs").hidden = false;
    const intro = opening(address); if (window.SCENE) SCENE.approach();
    $("load").hidden = false; $("loadt").textContent = "REWINDING THE TAPE…"; snd("tape");
    try {
      $("loadt").textContent = "CHECKING 28 CHAINS…";
      const disc = await (await fetch("/api/discover?address=" + address)).json();
      if (disc.error) throw new Error(disc.error);
      const pick = disc.active.slice(0, 10);
      $("loadt").textContent = pick.length ? "REWINDING THE TAPE ON " + pick.length + " CHAIN" + (pick.length > 1 ? "S" : "") + "…" : "REWINDING THE TAPE…";
      const r = await fetch("/api/scan?address=" + address + (pick.length ? "&chains=" + pick.join(",") : "")); const d = await r.json();
      if (!d.error) { d.allChains = disc.chains; d.skipped = disc.active.slice(10); }
      if (d.error) throw new Error(d.error);
      await intro;
      D = d; T = null; rendered = {};
      EXP = {}; CN = {}; CID = {}; d.allChains.concat(d.chains).forEach(c => { EXP[c.key] = c.explorer; CN[c.key] = c.name; CID[c.key] = c.id; });
      const sw0 = d.compromise.sweeper, busiest = d.chains.filter(c => c.ok).sort((a, b) => (b.outCount + b.inCount) - (a.outCount + a.inCount))[0];
      MAIN = sw0 ? sw0.chains[0] : d.incident ? d.incident.chain : busiest ? busiest.key : "eth";
      verdict(d); opinion(d); swarm(d);
      history.replaceState(null, "", "?a=" + address);
      $("whoLink").textContent = address; $("whoLink").href = exA(address);
      document.querySelectorAll("[data-seen]").forEach(el => delete el.dataset.seen);
      const rw = $("rewind"), cs = $("case"); rw.classList.remove("go"); cs.classList.remove("enter"); void rw.offsetWidth; rw.classList.add("go"); cs.classList.add("enter");
      show(true); tab("overview"); tell(d); todo(d);
      setTimeout(() => d.compromise.level !== "none" ? snd("alarm", 6) : d.incident ? snd("impact", 4) : snd("ok"), 1000);
      if (window.SND) SND.mood(d.compromise.level !== "none" || d.incident ? "dread" : "calm");
      subtitle(d.story[0]);
    } catch (err) { $("err").textContent = err.message || "Something went wrong. Try again."; show(false); snd("error"); $("card").hidden = true; if (window.SCENE) SCENE.retreat(); }
    $("load").hidden = true;
  }

  // ---- the story, one message at a time ----
  function tell(d) {
    clearTimeout(tapeTimer); const box = $("msgs"); box.innerHTML = ""; let i = 0;
    (function next() {
      if (i >= d.story.length) return;
      const dots = document.createElement("div"); dots.className = "msg dots"; dots.textContent = "•••"; box.appendChild(dots);
      const quick = matchMedia("(prefers-reduced-motion: reduce)").matches;
      setTimeout(() => {
        dots.remove();
        const m = document.createElement("div"); m.className = "msg" + ((d.compromise.level !== "none" || d.incident) && i < 3 ? " bad" : ""); m.textContent = d.story[i++];
        const s = document.createElement("small"); s.textContent = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); m.appendChild(s);
        box.appendChild(m); snd("message"); box.parentElement.parentElement.scrollTop = 1e6;
      }, quick ? 0 : 650);
      tapeTimer = setTimeout(next, matchMedia("(prefers-reduced-motion: reduce)").matches ? 20 : 1900);
    })();
  }
  function verdict(d) {
    const v = $("verdict"), c = d.compromise, sw = c.sweeper;
    v.hidden = false;
    if (sw) { v.className = "verdict"; v.innerHTML = `<h2>COMPROMISED</h2><p>${aLink(sw.address, null, sw.chains[0])} takes funds out of this wallet by itself${sw.type4 ? ", using signatures made with this wallet's private key" : ""}. ${sw.totalCount} transfers so far on ${sw.allChains.map(chip).join(" ")}. Anything you send here will be taken.</p>`; }
    else if (c.level === "suspected") { v.className = "verdict warn"; v.innerHTML = `<h2>CHECK THIS</h2><p>The wallet is delegated to a contract I do not recognise on ${c.delegations.filter(x => !x.name).map(x => chip(x.chain)).join(" ")}. If you did not set that up, someone else controls the wallet.</p>`; }
    else if (d.incident) { v.className = "verdict warn"; v.innerHTML = `<h2>POSSIBLE DRAIN</h2><p>Several assets left for one address within an hour. See “The night it happened”.</p>`; }
    else { v.className = "verdict ok"; v.innerHTML = `<h2>NO THEFT FOUND</h2><p>No sweeper, no unknown delegation, no drain pattern on ${d.chains.filter(x => x.ok).length} chains. That is not a guarantee: I only read the most recent transfers.</p>`; }
  }
  // ---- the two AI models ----
  async function opinion(d) {
    const note = $("ai-note"), mine = d.address;
    note.className = "ai-note wait"; note.textContent = "The analyst is reading the file…"; $("ai-foot").textContent = "";
    ["c-ai1", "c-ai2", "c-ai3"].forEach(id => empty(id, ""));
    const lite = c => c && { level: c.level, sweeper: c.sweeper, poisoning: c.poisoning.map(() => 1) };
    const evidence = { address: d.address, chains: d.chains.filter(c => c.ok), compromise: lite(d.compromise), incident: d.incident && { usd: d.incident.usd, assetCount: d.incident.assetCount, signedByOwner: d.incident.signedByOwner, receiverName: d.incident.receiverName }, counts: d.risk.counts, split: d.split, score: d.risk.score };
    let r;
    try { r = await (await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ evidence }) })).json(); } catch (e) { r = { error: e.message }; }
    if (!D || D.address !== mine) return; // the user moved on to another case
    note.className = "ai-note";
    note.textContent = r.note || ("The written note is not available right now" + (r.noteError || r.error ? ": " + (r.noteError || r.error) : "."));
    const s = r.second;
    if (!s) { empty("c-ai1", "The second model did not answer" + (r.secondError ? ": " + r.secondError : ".")); }
    else {
      const g = (id, value, max, name, fmt, col) => draw(id, { series: [{ type: "gauge", min: 0, max, startAngle: 200, endAngle: -20, radius: "100%", center: ["50%", "68%"], progress: { show: true, width: 10, itemStyle: { color: col } }, axisLine: { lineStyle: { width: 10, color: [[1, "#161b21"]] } }, pointer: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false },
        detail: { formatter: fmt, color: "#fff", fontSize: 34, fontFamily: "VT323, monospace", offsetCenter: [0, "-8%"] }, title: { offsetCenter: [0, "26%"], color: C.dim, fontSize: 15, fontFamily: "VT323, monospace" }, data: [{ value, name }] }] });
      const pc = s.compromised.noul;
      g("c-ai1", Math.round(pc * 100), 100, "CHANCE THE KEY IS STOLEN", "{value}%", pc > .6 ? C.blood : pc > .3 ? C.lamp : C.moss);
      const u = s.urgency;
      g("c-ai3", Math.round(u.score * 10) / 10, 3, (u.legend[Math.round(u.score)] || "").toUpperCase(), "{value} / 3", u.score > 2 ? C.blood : u.score > 1 ? C.lamp : C.moss);
      const names = { stolen_key: "Stolen key", malicious_approval: "Bad approval", address_poisoning_only: "Poisoning only", owner_activity: "Owner's own activity" }, ks = Object.keys(s.attack.probabilities).sort((a, b) => s.attack.probabilities[a] - s.attack.probabilities[b]);
      draw("c-ai2", { grid: { left: 150, right: 44, top: 6, bottom: 6 }, xAxis: { type: "value", max: 1, show: false }, yAxis: { type: "category", data: ks.map(k => names[k] || k), ...axis, axisLabel: { color: C.ink } },
        series: [{ type: "bar", barWidth: 14, data: ks.map(k => ({ value: s.attack.probabilities[k], itemStyle: { color: k === s.attack.choice ? C.lamp : "#3a4148" } })), label: { show: true, position: "right", color: C.dim, formatter: p => Math.round(p.value * 100) + "%" } }] });
    }
    if (r.models) $("ai-foot").textContent = `Note written by ${r.models.note}. Meters from ${r.models.second}. Both saw only the evidence on this page, and both can be wrong: the red banner above comes from on-chain facts, not from the models.`;
  }
  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-audit]"); if (!b) return;
    const [chain, addr, role] = b.dataset.audit.split(":"), body = $("dlg-body");
    body.innerHTML = `<h3>READING THE CONTRACT…</h3><p>${addr} on ${esc(CN[chain] || chain)}. This takes up to a minute.</p>`; $("dlg").showModal();
    let r; try { r = await (await fetch(`/api/audit?chain=${chain}&address=${addr}&role=${role || ""}`)).json(); } catch (err) { r = { error: err.message }; }
    if (r.error) { body.innerHTML = `<h3>NO AUDIT</h3><p>${esc(r.error)}</p>`; return; }
    const a = r.audit, li = l => (l && l.length ? `<ul>${l.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : "<p>None found.</p>");
    body.innerHTML = `<h3 class="v-${esc(a.verdict)}">${esc(String(a.verdict).toUpperCase())}</h3>
      <p>${aLink(addr, r.name || addr, chain)} on ${chip(chain)}</p><p>${esc(a.summary)}</p>
      <h4>What it can do with your funds</h4>${li(a.can_do)}<h4>Red flags</h4>${li(a.red_flags)}
      <h4>How much to trust this</h4><p>${r.basis === "source" ? "The model read the contract's public source code." : "This contract's source code is not public. The model only saw the names of functions found in its bytecode, so this is an informed guess, not an audit."} Confidence: ${esc(a.confidence || "low")}.${r.malicious == null ? "" : ` A second model puts the chance it was built to take funds at ${Math.round(r.malicious * 100)}%.`}</p>
      <p class="foot">Written by ${esc(r.models.audit)}; second check by ${esc(r.models.second)}. An AI review is not a professional audit.</p>`;
  });

  // the black card these stories open on; it holds for a moment even when the scan is quick
  function opening(address) {
    const c = $("card");
    if (document.body.classList.contains("nofx") || matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
    $("card-a").textContent = ""; $("card-b").className = ""; $("card-b").textContent = short(address).toUpperCase(); c.className = "card"; c.hidden = false;
    const text = "What follows was rebuilt from public blockchain records. Nothing in it was made up.";
    let n = 0; const ty = setInterval(() => { $("card-a").textContent = text.slice(0, ++n); if (n >= text.length) { clearInterval(ty); $("card-b").className = "show"; } }, 28);
    return new Promise(done => setTimeout(() => { clearInterval(ty); c.className = "card out"; setTimeout(() => { c.hidden = true; done(); }, 480); }, 4300));
  }
  let subT = null;
  function subtitle(text) { const s = $("subtitle"); clearTimeout(subT); s.textContent = text; s.classList.add("on"); subT = setTimeout(() => s.classList.remove("on"), 5200); }
  setInterval(() => { const h = $("htime"); if (h) h.textContent = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); }, 1000);

  // ---- the on-chain verdict: the IMD swarm checks the case and signs it into the registry ----
  const hex64 = v => BigInt(v).toString(16).padStart(64, "0"), addr64 = a => a.slice(2).toLowerCase().padStart(64, "0");
  async function swarm(d) {
    const box = $("swarm"), sw = d.compromise.sweeper, sc = sw && sw.swarmCase;
    if (!sw) { box.hidden = true; return; }
    box.hidden = false;
    let reg = {};
    try { reg = await (await fetch(`/api/registry?wallet=${d.address}&suspect=${sw.address}`)).json(); } catch (e) { reg = { error: e.message }; }
    if (!D || D.address !== d.address) return;
    const listed = reg.suspect && reg.suspect.listed;
    box.innerHTML = `<h3>${listed ? "SIGNED BY THE SWARM" : "GET THIS SIGNED BY THE IMD SWARM"}</h3>
      <p>${listed ? "The IdentityMD agent swarm has already confirmed this case on chain. The sweeper is on the public do-not-send list that any wallet or app can check for free." :
        "A panel of IdentityMD agents can check this case against the blockchain itself and sign the answer. If at least 4 of 5 agree, the sweeper goes on a public do-not-send list that any wallet, app or exchange can read for free, and hunters can start earning a bounty by tracing where the money went."}</p>
      ${sc ? `<dl><dt>Wallet</dt><dd>${esc(d.address)}</dd><dt>Suspect</dt><dd>${esc(sw.address)}</dd><dt>Chain</dt><dd>${esc(sc.chainName)}</dd><dt>Blocks</dt><dd>${sc.fromBlock.toLocaleString("en-US")} to ${sc.toBlock.toLocaleString("en-US")}</dd><dt>Cost to you</dt><dd>${reg.poolImd >= 0.5 ? "Nothing: paid from the shared pool" : "0.5 IMD, unless the shared pool has funds"}, plus gas on Robinhood Chain</dd></dl>` :
        `<p>The swarm can only read Ethereum, Base, Arbitrum, BNB Chain and Robinhood Chain, and this sweeper was not seen on any of them.</p>`}
      ${!listed && sc ? `<button class="go" type="button" id="askSwarm" ${reg.deployed ? "" : "disabled"}>OPEN THE CASE AND ASK THE SWARM</button>` : ""}
      <p class="state" id="swarmState">${reg.deployed ? (reg.cases != null ? `${reg.cases} case${reg.cases === 1 ? "" : "s"} on the registry so far.` : "") : "The registry contract is written and tested; it goes live with the project's IMD launch. Until then this button stays off."}</p>`;
    const b = $("askSwarm"); if (!b || !reg.deployed) return;
    b.onclick = async () => {
      const st = $("swarmState");
      if (!window.LS_WALLET) { st.textContent = "Connect a wallet first (bottom left). It does not have to be the robbed one: anyone can open a case."; return; }
      b.disabled = true;
      try {
        st.textContent = "Step 1 of 2: confirm “open case” in your wallet. This switches it to Robinhood Chain.";
        const tx1 = await window.LS_WALLET.send(reg.chainId, { to: reg.address, data: "0x26e67e7a" + addr64(d.address) + addr64(sw.address) + hex64(sc.chainId) + hex64(sc.fromBlock) + hex64(sc.toBlock) });
        st.innerHTML = `Case sent: <a href="${reg.explorer}/tx/${tx1}" target="_blank" rel="noopener">${short(tx1)}</a>. Waiting for it to land…`;
        let id = null;
        for (let i = 0; i < 40 && id == null; i++) { await new Promise(r => setTimeout(r, 3000)); const r = await (await fetch("/api/registry?openTx=" + tx1)).json(); if (r.caseId != null) id = r.caseId; else if (r.ok === false) throw new Error("the transaction failed"); }
        if (id == null) throw new Error("the case did not appear in time; try again from the explorer");
        st.textContent = `Case #${id} is open. Step 2 of 2: confirm “ask the swarm” in your wallet.`;
        const tx2 = await window.LS_WALLET.send(reg.chainId, { to: reg.address, data: "0xde46f0f1" + hex64(id) });
        st.innerHTML = `Asked: <a href="${reg.explorer}/tx/${tx2}" target="_blank" rel="noopener">${short(tx2)}</a>. The swarm usually answers within minutes; scan this wallet again to see the result.`;
        snd("ok");
      } catch (err) { b.disabled = false; st.textContent = "Not sent: " + ((err && (err.shortMessage || err.message)) || "cancelled"); snd("error"); }
    };
  }

  function todo(d) {
    const s = [], sw = d.compromise.sweeper, comp = d.compromise.level !== "none";
    if (comp) s.push("<b>Stop sending funds to this wallet.</b> The attacker has the private key, so revoking permissions or changing a password does not help.");
    if (comp || (d.incident && d.incident.method === "key")) s.push("Create a new wallet with a new seed phrase on a clean device. Use that from now on.");
    if (comp) s.push('If something valuable is still stuck here (staked tokens, an airdrop, NFTs), a normal transfer will be front-run by the sweeper. A rescue has to happen in one protected transaction. <a href="https://antidrain.dev" target="_blank" rel="noopener">Antidrain</a> is a free tool built for this; read how it works before you use it.');
    if (sw) s.push(`Save the evidence: the sweeper address ${short(sw.address)} and the transaction links under “The night it happened”.`);
    else if (d.incident) s.push(`Save the evidence: the receiving address ${short(d.incident.to)} and the transaction links in “The night it happened”.`);
    if (!comp && (d.risk.counts.risky || d.risk.counts.unlimited)) s.push(`Revoke the permissions listed under “Open doors”. <a href="https://revoke.cash/address/${d.address}" target="_blank" rel="noopener">Open them on Revoke.cash</a>.`);
    if (sw || d.incident) s.push("Open “The trail”. If the money reached an exchange, write to that exchange's support with the addresses and transaction links, and file a police report: exchanges act on police requests, not on private ones.");
    if (d.compromise.poisoning.length) s.push("Never copy an address from your transaction history. Scammers have planted look-alike addresses there.");
    if (sw || d.incident) s.push("Ignore anyone who messages you offering to recover the funds for a fee. That is a second scam.");
    if (!s.length) s.push("Nothing urgent. Check “Open doors” now and then, and never type your seed phrase into a website.");
    $("steps").innerHTML = s.map(x => `<li>${x}</li>`).join(""); $("todo").hidden = false;
  }

  // ---- panes ----
  let rendered = {};
  function render(t) { if (!D || rendered[t]) return; rendered[t] = 1; ({ overview, incident, trail, money, habits, approvals, online })[t](); }

  function overview() {
    const d = D, st = [
      [d.risk.score + " / 100", "Risk score"], [d.balanceEth.toFixed(4) + " ETH", "ETH on all chains"], [usd(d.split.ownUsd), "Your swaps & bridges"], [usd(d.split.awayUsd), "Sent to other wallets"],
      [(d.totals.inCount + d.totals.outCount) + (d.totals.capped ? "+" : ""), "Transfers read"], [d.approvals ? d.approvals.length : "n/a", "Open permissions"]];
    $("stats").innerHTML = st.map(([v, k]) => `<div class="stat"><b>${esc(v)}</b><span>${k}</span></div>`).join("");
    $("chains").innerHTML = `<div class="tw"><table><tr><th>Chain</th><th class="n">Out</th><th class="n">In</th><th class="n">Balance</th><th>Account type</th></tr>` + d.chains.map(c => !c.ok ? `<tr><td>${esc(c.name)}</td><td colspan="4">could not be read</td></tr>` :
      `<tr><td><a href="${exA(d.address, c.key)}" target="_blank" rel="noopener">${esc(c.name)}</a></td><td class="n">${c.outCount}${c.capped ? "+" : ""}</td><td class="n">${c.inCount}</td><td class="n">${c.balance.toFixed(5)} ${c.native}</td><td>${c.delegate ? (c.delegateName ? `<span class="tag swap">${esc(c.delegateName)}</span>` : `<span class="tag bad">delegated to unknown contract</span> ${aLink(c.delegate, null, c.key)}<button class="mini" type="button" data-audit="${c.key}:${c.delegate}:delegate">AUDIT</button>`) : c.isContract ? "contract" : "normal wallet"}</td></tr>`).join("") + `</table></div>` +
      `<p class="foot" style="margin:-6px 0 14px">${d.allChains.filter(c => c.ok).length} chains checked. ${d.allChains.filter(c => c.ok).length - d.chains.length - d.skipped.length} show no activity for this address.${d.skipped.length ? " Not read this time (too many active chains): " + d.skipped.map(k => esc(CN[k] || k)).join(", ") + "." : ""}${d.allChains.some(c => !c.ok) ? " Could not be reached: " + d.allChains.filter(c => !c.ok).map(c => esc(c.name)).join(", ") + "." : ""}</p>`;
    const col = d.risk.level === "high" ? C.blood : d.risk.level === "medium" ? C.lamp : C.moss;
    draw("c-gauge", { series: [{ type: "gauge", min: 0, max: 100, progress: { show: true, width: 16, itemStyle: { color: col } }, axisLine: { lineStyle: { width: 16, color: [[1, "#161b21"]] } }, pointer: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { color: C.dim, distance: 22 },
      detail: { valueAnimation: true, formatter: "{value}", color: "#fff", fontSize: 54, fontFamily: "VT323, monospace", offsetCenter: [0, "0%"] }, title: { offsetCenter: [0, "38%"], color: col, fontSize: 18, fontFamily: "VT323, monospace" }, data: [{ value: d.risk.score, name: d.risk.level.toUpperCase() + " RISK" }] }] });
    const keys = Object.keys(d.risk.parts);
    draw("c-radar", { radar: { radius: "58%", center: ["50%", "54%"], indicator: keys.map(k => ({ name: k, max: 100 })), axisName: { color: C.dim }, splitLine: { lineStyle: { color: C.line } }, splitArea: { show: false }, axisLine: { lineStyle: { color: C.line } } },
      series: [{ type: "radar", data: [{ value: keys.map(k => d.risk.parts[k]) }], areaStyle: { color: "rgba(200,70,59,.35)" }, lineStyle: { color: C.blood }, itemStyle: { color: C.blood } }] });
    const em = {}; peers().forEach(c => { const o = em[c.kind] || (em[c.kind] = { kind: c.kind, usd: 0, count: 0 }); o.usd += c.usd; o.count += c.count; });
    const ends = Object.values(em).filter(e => e.usd > 0 || e.count > 0), byUsd = ends.some(e => e.usd > 0);
    if (!ends.length) empty("c-ends", "This wallet has not sent anything."); else
    draw("c-ends", { tooltip: { ...base.tooltip, formatter: p => `${p.name}: ${byUsd ? usd(p.value) : p.value + " transfers"} (${p.percent}%)` }, legend: { bottom: 0, textStyle: { color: C.dim } },
      series: [{ type: "pie", radius: "62%", center: ["50%", "45%"], label: { color: C.ink }, data: ends.map(e => ({ name: KNAME[e.kind] || e.kind, value: byUsd ? e.usd : e.count, itemStyle: { color: KIND[e.kind] } })) }] });
    const groups = {}; peers().slice(0, 24).forEach(c => (groups[c.kind] = groups[c.kind] || []).push(c));
    const sun = Object.keys(groups).map(k => ({ name: KNAME[k] || k, itemStyle: { color: KIND[k] }, children: groups[k].map(c => ({ name: c.name || short(c.address), value: Math.max(c.usd, 1), addr: c.address, ch: c.chains[0] })) }));
    if (!sun.length) empty("c-sun", "This wallet has not sent anything."); else
    draw("c-sun", { tooltip: { ...base.tooltip, formatter: p => `${esc(p.name)}${p.data.addr ? "<br>" + usd(p.value) : ""}` }, series: [{ type: "sunburst", radius: ["18%", "92%"], data: sun, label: { color: "#111", fontSize: 10, minAngle: 12 }, itemStyle: { borderColor: "#07090c", borderWidth: 1 } }] })
      .on("click", p => p.data.addr && open(exA(p.data.addr, p.data.ch), "_blank"));
  }

  function incident() {
    const i = D.incident, n = $("inc-note"), sw = D.compromise.sweeper, po = D.compromise.poisoning;
    $("sweep-box").hidden = !sw; $("poison-box").hidden = !po.length;
    if (sw) {
      $("sweep-note").innerHTML = `<b>The sweeper: ${aLink(sw.address, sw.address, sw.chains[0])}</b><br>First seen ${when(sw.first)} UTC, last seen ${when(sw.last)} UTC. “The receiver” in the table means the sweeper sent the transaction itself; you never clicked anything. “7702” means it used a signature only this wallet's private key can make.`;
      const pts = D.sweeps.filter(x => x.ts).reverse(); // a few chains return transfers without a time
      draw("c-sweeps", { grid: { left: 90, right: 20, top: 20, bottom: 40 }, tooltip: { ...base.tooltip, formatter: p => `${when(p.data.value[0] / 1000)} · ${esc(p.data.value[1])}<br>${esc(p.data.value[2])}: ${p.data.value[3]}` }, xAxis: { type: "time", ...axis }, yAxis: { type: "category", data: [...new Set(pts.map(x => CN[x.c] || x.c))], ...axis },
        series: [{ type: "scatter", symbolSize: 16, data: pts.map(x => ({ value: [x.ts * 1000, CN[x.c] || x.c, x.a, x.v, x.h, x.c], itemStyle: { color: x.by === "owner key" ? C.lamp : C.blood, opacity: .85 } })) }] })
        .on("click", p => open(exT(p.data.value[4], p.data.value[5]), "_blank"));
      $("sweep-table").innerHTML = `<div class="tw"><table><tr><th>Time (UTC)</th><th>Chain</th><th>Asset</th><th class="n">Amount</th><th>Sent by</th><th>Transaction</th></tr>` + D.sweeps.map(x => `<tr><td>${x.ts ? when(x.ts) : "not given by this chain"}</td><td>${chip(x.c)}</td><td>${esc(x.a)}</td><td class="n">${Number(x.v).toLocaleString("en-US", { maximumFractionDigits: 8 })}</td><td>${esc(x.by)}${x.t4 ? ' <span class="tag bad">7702</span>' : ""}</td><td><a href="${exT(x.h, x.c)}" target="_blank" rel="noopener">${short(x.h)}</a></td></tr>`).join("") + `</table></div>`;
    }
    if (po.length) {
      $("poison-note").innerHTML = `<b>Address poisoning.</b> These transfers were faked to put a look-alike address into this wallet's history. The fake starts and ends like an address you really use. Nothing was stolen by them; the danger is copying the wrong one later.`;
      $("poison-table").innerHTML = `<div class="tw"><table><tr><th>Address you really use</th><th>Look-alike planted</th><th>Chain</th><th class="n">Times</th><th>Fake token</th></tr>` + po.map(x => `<tr><td>${aLink(x.real, x.real.slice(0, 8) + "…" + x.real.slice(-6), x.chains[0])}</td><td>${aLink(x.fake, x.fake.slice(0, 8) + "…" + x.fake.slice(-6), x.chains[0])}</td><td>${x.chains.map(chip).join(" ")}</td><td class="n">${x.count}</td><td>${esc(x.assets.join(", "))}</td></tr>`).join("") + `</table></div>`;
    }
    if (!i) { n.className = "note"; n.textContent = sw ? "No single big drain on top of the sweeping above." : "No drain found in the transfers read. A drain usually looks like several different assets leaving for one address within an hour."; ["c-timeline", "c-taken", "c-cum"].forEach(id => empty(id, "Nothing to show.")); $("inc-table").innerHTML = ""; return; }
    n.className = "note bad";
    n.innerHTML = `<b>${when(i.start)} UTC</b> · ${i.assetCount} assets, ${i.transferCount} transfers, about <b>${usd(i.usd)}</b> at today's prices, all sent to ${aLink(i.to, i.receiverName, i.chain)} on ${chip(i.chain)}. ` +
      (i.method === "key" ? "Signed with this wallet's own key." : `Sent by another address (${i.signers.map(s => aLink(s, null, i.chain)).join(", ")}), using a permission this wallet had given.`);
    const items = i.items.slice().sort((a, b) => a.ts - b.ts);
    draw("c-timeline", { grid: { left: 60, right: 20, top: 20, bottom: 40 }, tooltip: { ...base.tooltip, formatter: p => `${when(p.data[0] / 1000)}<br>${esc(p.data[2])}: ${p.data[3]}<br>${usd(p.data[1])}` },
      xAxis: { type: "time", ...axis }, yAxis: { type: "value", name: "USD", ...axis },
      series: [{ type: "scatter", symbolSize: v => 10 + Math.min(34, Math.sqrt(v[1]) / 3), itemStyle: { color: C.blood, opacity: .85 }, data: items.map(x => [x.ts * 1000, x.u, x.a, x.v, x.h]) }] })
      .on("click", p => open(exT(p.data[4], i.chain), "_blank"));
    const by = {}; items.forEach(x => by[x.a] = (by[x.a] || 0) + x.u);
    draw("c-taken", { tooltip: { ...base.tooltip, formatter: p => `${esc(p.name)}: ${usd(p.value)}` }, series: [{ type: "pie", radius: ["42%", "70%"], label: { color: C.ink }, data: Object.keys(by).map(k => ({ name: k, value: Math.round(by[k]) })) }] });
    let run = 0;
    draw("c-cum", { grid: { left: 60, right: 20, top: 20, bottom: 40 }, tooltip: { ...base.tooltip, trigger: "axis" }, xAxis: { type: "time", ...axis }, yAxis: { type: "value", ...axis },
      series: [{ type: "line", step: "end", showSymbol: false, lineStyle: { color: C.blood, width: 2 }, areaStyle: { color: "rgba(200,70,59,.25)" }, data: items.map(x => [x.ts * 1000, Math.round(run += x.u)]) }] });
    $("inc-table").innerHTML = `<div class="tw"><table><tr><th>Time (UTC)</th><th>Asset</th><th class="n">Amount</th><th class="n">USD today</th><th>Transaction</th></tr>` +
      items.map(x => `<tr><td>${when(x.ts)}</td><td>${esc(x.a)}</td><td class="n">${Number(x.v).toLocaleString("en-US", { maximumFractionDigits: 4 })}</td><td class="n">${usd(x.u)}</td><td><a href="${exT(x.h, i.chain)}" target="_blank" rel="noopener">${short(x.h)}</a></td></tr>`).join("") + `</table></div>`;
  }

  async function trail() {
    const i = D.incident, sw = D.compromise.sweeper, from = sw ? sw.address : i ? i.to : D.address, tc = sw ? sw.chains[0] : i ? i.chain : MAIN, since = sw ? sw.first : i ? i.start : 0, n = $("trail-note");
    n.className = "note"; n.textContent = "Following the money…";
    try {
      T = await (await fetch(`/api/trace?address=${from}&since=${since}&chain=${tc}`)).json();
      if (T.error) throw new Error(T.error);
    } catch (e) { n.textContent = "The trail could not be loaded: " + e.message; return; }
    const exits = T.nodes.filter(x => ["exchange", "mixer", "bridge", "deposit"].includes(x.kind));
    n.innerHTML = (sw ? `Starting from the sweeper, ${aLink(from, null, tc)}, on ${chip(tc)}: everything it has sent on since it first touched this wallet. That includes money taken from other victims. ` : i ? `Starting from the address that received the funds, ${aLink(from, null, tc)}. ` : `No drain was found, so this is simply where this wallet sends money. `) +
      (T.links.length ? `${T.nodes.length - 1} addresses, two steps deep. ` : "It has not moved anything on since. ") +
      (exits.length ? `It reaches ${exits.map(x => `<span class="tag ${x.kind}">${esc(x.name || x.kind)}</span>`).join(" ")}. The trail stops there. What happens inside an exchange is not on any blockchain, so no tool can follow it; but the exchange knows whose account received the deposit, and it will tell the police. Give them the deposit address and the transaction links.` : "");
    if (!T.links.length) { ["c-sankey", "c-graph", "c-funnel", "c-tree"].forEach(id => empty(id, "Nothing has moved yet.")); return; }
    const byId = {}; T.nodes.forEach(x => byId[x.id] = x);
    const nm = x => (x.name || short(x.id)) + (x.kind === "start" ? " (start)" : "");
    const fwd = T.links.filter(l => byId[l.source].hop < byId[l.target].hop);
    draw("c-sankey", { tooltip: { ...base.tooltip, formatter: p => p.dataType === "edge" ? `${esc(p.data.source)} → ${esc(p.data.target)}<br>${usd(p.data.real)} · ${p.data.count} transfers` : esc(p.name) },
      series: [{ type: "sankey", left: 10, right: 150, nodeGap: 12, emphasis: { focus: "adjacency" }, lineStyle: { color: "source", opacity: .35 }, label: { color: C.ink, fontSize: 11 },
        data: T.nodes.map(x => ({ name: nm(x), itemStyle: { color: KIND[x.kind] }, addr: x.id })), links: fwd.map(l => ({ source: nm(byId[l.source]), target: nm(byId[l.target]), value: Math.max(l.usd, 1), real: l.usd, count: l.count })) }] })
      .on("click", p => p.dataType === "node" && open(exA(p.data.addr, tc), "_blank"));
    const kinds = [...new Set(T.nodes.map(x => x.kind))];
    draw("c-graph", { legend: { data: kinds.map(k => KNAME[k] || k), textStyle: { color: C.dim }, bottom: 0 }, tooltip: { ...base.tooltip, formatter: p => p.dataType === "node" ? `${esc(p.data.label)}<br>${p.data.id}<br>received ${usd(p.data.usd)}` : `${usd(p.data.usd)} · ${p.data.count} transfers<br>${esc(p.data.assets.join(", "))}` },
      series: [{ type: "graph", layout: "force", roam: true, draggable: true, force: { repulsion: 260, edgeLength: [70, 170] }, edgeSymbol: ["none", "arrow"], edgeSymbolSize: 7, label: { show: true, color: C.ink, fontSize: 10, position: "right", formatter: p => p.data.label },
        categories: kinds.map(k => ({ name: KNAME[k] || k, itemStyle: { color: KIND[k] } })), lineStyle: { color: "#59606a", width: 1.2, curveness: .12 },
        data: T.nodes.map(x => ({ id: x.id, name: x.id, label: x.name || short(x.id), usd: x.usd, category: kinds.indexOf(x.kind), symbolSize: x.kind === "start" ? 30 : 12 + Math.min(26, Math.sqrt(x.usd) / 6) })), links: T.links.map(l => ({ source: l.source, target: l.target, usd: l.usd, count: l.count, assets: l.assets })) }] })
      .on("click", p => p.dataType === "node" && open(exA(p.data.id, tc), "_blank"));
    // every stage is a part of the one before it, so the funnel can only narrow
    const first = T.links.filter(l => l.source === T.start), tot = l => Math.round(l.reduce((a, x) => a + x.usd, 0));
    const known = first.filter(l => byId[l.target].kind !== "unknown"), out = first.filter(l => ["exchange", "mixer", "bridge"].includes(byId[l.target].kind));
    draw("c-funnel", { tooltip: { ...base.tooltip, formatter: p => `${p.name}: ${usd(p.value)}` }, series: [{ type: "funnel", left: "8%", right: "8%", top: 10, bottom: 10, sort: "none", gap: 3, minSize: "18%", label: { color: "#111", position: "inside", formatter: p => p.name + String.fromCharCode(10) + usd(p.value) },
      data: [{ name: "Sent on by this address", value: tot(first), itemStyle: { color: C.lamp } }, { name: "…to a labelled service", value: tot(known), itemStyle: { color: C.sand } }, { name: "…to an exchange, mixer or bridge", value: tot(out), itemStyle: { color: C.cold } }] }] });
    const kids = id => fwd.filter(l => l.source === id).map(l => ({ name: byId[l.target].name || short(l.target), addr: l.target, itemStyle: { color: KIND[byId[l.target].kind] }, children: kids(l.target) }));
    draw("c-tree", { tooltip: { ...base.tooltip, formatter: p => esc(p.name) + (p.data.addr ? "<br>" + p.data.addr : "") }, series: [{ type: "tree", data: [{ name: short(T.start), addr: T.start, itemStyle: { color: C.lamp }, children: kids(T.start) }], left: 70, right: 130, top: 10, bottom: 10, symbolSize: 9, initialTreeDepth: 3, label: { color: C.ink, fontSize: 10, position: "left" }, leaves: { label: { position: "right" } }, lineStyle: { color: "#3b434c" } }] })
      .on("click", p => p.data.addr && open(exA(p.data.addr, tc), "_blank"));
  }

  function money() {
    const m = D.series.months;
    if (!m.length) { ["c-months", "c-water", "c-tokens", "c-tree2", "c-scatter", "c-bubble"].forEach(id => empty(id, "No transfers yet.")); return; }
    draw("c-months", { grid: { left: 64, right: 16, top: 30, bottom: 30 }, legend: { textStyle: { color: C.dim } }, tooltip: { ...base.tooltip, trigger: "axis", valueFormatter: v => usd(Math.abs(v)) }, xAxis: { type: "category", data: m.map(x => x.m), ...axis }, yAxis: { type: "value", ...axis },
      series: [{ name: "Came in", type: "bar", stack: "a", itemStyle: { color: C.moss }, data: m.map(x => x.inUsd) }, { name: "Went out", type: "bar", stack: "a", itemStyle: { color: C.blood }, data: m.map(x => -x.outUsd) }] });
    let acc = 0; const baseV = [], up = [], down = [];
    m.forEach(x => { const net = x.inUsd - x.outUsd; if (net >= 0) { baseV.push(acc); up.push(net); down.push(0); } else { baseV.push(acc + net); up.push(0); down.push(-net); } acc += net; });
    const lo = Math.min(0, ...baseV); // shift so the invisible base is never negative
    draw("c-water", { grid: { left: 64, right: 16, top: 20, bottom: 30 }, tooltip: { ...base.tooltip, trigger: "axis", formatter: p => `${p[0].name}<br>${p[1].value ? "+" + usd(p[1].value) : "−" + usd(p[2].value)}` }, xAxis: { type: "category", data: m.map(x => x.m), ...axis }, yAxis: { type: "value", ...axis, axisLabel: { color: C.dim, formatter: v => usd(v + lo) } },
      series: [{ type: "bar", stack: "w", itemStyle: { color: "transparent" }, data: baseV.map(v => v - lo) }, { type: "bar", stack: "w", itemStyle: { color: C.moss }, data: up }, { type: "bar", stack: "w", itemStyle: { color: C.blood }, data: down }] });
    const tk = D.tokensOut.filter(t => t.usd > 0);
    if (!tk.length) empty("c-tokens", "Nothing with a known price has left."); else
    draw("c-tokens", { tooltip: { ...base.tooltip, formatter: p => `${esc(p.name)}: ${usd(p.value)} (${p.percent}%)` }, series: [{ type: "pie", radius: ["42%", "70%"], label: { color: C.ink }, data: tk.map(t => ({ name: t.asset, value: t.usd })) }] });
    draw("c-tree2", { tooltip: { ...base.tooltip, formatter: p => `${esc(p.name)}<br>${usd(p.value)}` }, series: [{ type: "treemap", roam: false, nodeClick: false, breadcrumb: { show: false }, label: { color: "#111", fontSize: 11 }, itemStyle: { borderColor: "#07090c", gapWidth: 2 },
      data: peers().slice(0, 30).map(c => ({ name: c.name || short(c.address), value: Math.max(c.usd, 1), addr: c.address, ch: c.chains[0], itemStyle: { color: KIND[c.kind] } })) }] })
      .on("click", p => p.data.addr && open(exA(p.data.addr, p.data.ch), "_blank"));
    const ownSet = new Set($("own").checked ? D.sent.filter(c => OWN.includes(c.kind)).map(c => c.address) : []);
    const tr = D.transfers.filter(t => t.u > 0 && !ownSet.has(t.p));
    draw("c-scatter", { grid: { left: 64, right: 16, top: 30, bottom: 36 }, legend: { textStyle: { color: C.dim } }, tooltip: { ...base.tooltip, formatter: p => `${when(p.data[0] / 1000)}<br>${esc(p.data[2])} ${usd(p.data[1])}<br>${short(p.data[3])}` }, xAxis: { type: "time", ...axis }, yAxis: { type: "log", ...axis },
      series: ["in", "out"].map(d => ({ name: d === "in" ? "Came in" : "Went out", type: "scatter", symbolSize: 7, itemStyle: { color: d === "in" ? C.moss : C.blood, opacity: .75 }, data: tr.filter(t => t.d === d).map(t => [t.ts * 1000, Math.max(t.u, .01), t.a, t.p, t.h, t.c]) })) })
      .on("click", p => open(exT(p.data[4], p.data[5]), "_blank"));
    draw("c-bubble", { grid: { left: 64, right: 16, top: 20, bottom: 40 }, tooltip: { ...base.tooltip, formatter: p => `${esc(p.data[3])}<br>${p.data[0]} transfers · ${usd(p.data[1])}` }, xAxis: { type: "log", name: "transfers", nameLocation: "middle", nameGap: 26, ...axis }, yAxis: { type: "log", ...axis },
      series: [{ type: "scatter", symbolSize: v => 8 + Math.min(40, Math.sqrt(v[1]) / 5), data: peers().filter(c => c.usd > 0).map(c => ({ value: [c.count, Math.max(c.usd, .01), c.address, c.name || short(c.address), c.chains[0]], itemStyle: { color: KIND[c.kind], opacity: .8 } })) }] })
      .on("click", p => open(exA(p.data.value[2], p.data.value[4]), "_blank"));
  }

  function habits() {
    const days = D.series.days, keys = Object.keys(days).sort();
    if (!keys.length) { ["c-cal", "c-heat", "c-count"].forEach(id => empty(id, "No activity yet.")); return; }
    const end = new Date((D.totals.last || Date.now() / 1000) * 1000), start = new Date(end); start.setUTCFullYear(end.getUTCFullYear() - 1);
    const range = [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)], cd = keys.filter(k => k >= range[0]).map(k => [k, days[k]]);
    draw("c-cal", { tooltip: { ...base.tooltip, formatter: p => `${p.data[0]}: ${p.data[1]} transfers` }, visualMap: { min: 0, max: Math.max(3, ...cd.map(x => x[1])), show: false, inRange: { color: ["#161b21", C.lamp, C.blood] } },
      calendar: { range, left: 40, right: 10, top: 30, cellSize: ["auto", 16], itemStyle: { color: "#0d1115", borderColor: "#07090c", borderWidth: 2 }, splitLine: { show: false }, dayLabel: { color: C.dim }, monthLabel: { color: C.dim }, yearLabel: { show: false } },
      series: [{ type: "heatmap", coordinateSystem: "calendar", data: cd }] });
    const h = D.series.heat, hd = []; h.forEach((row, dow) => row.forEach((v, hr) => hd.push([hr, dow, v])));
    draw("c-heat", { grid: { left: 44, right: 10, top: 10, bottom: 30 }, tooltip: { ...base.tooltip, formatter: p => `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][p.data[1]]} ${p.data[0]}:00 · ${p.data[2]} transfers` }, xAxis: { type: "category", data: [...Array(24).keys()], ...axis }, yAxis: { type: "category", data: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], ...axis },
      visualMap: { min: 0, max: Math.max(1, ...hd.map(x => x[2])), show: false, inRange: { color: ["#0d1115", C.cold, C.lamp] } }, series: [{ type: "heatmap", data: hd, itemStyle: { borderColor: "#07090c", borderWidth: 1 } }] });
    const m = D.series.months; let cum = 0;
    draw("c-count", { grid: { left: 44, right: 44, top: 30, bottom: 30 }, legend: { textStyle: { color: C.dim } }, tooltip: { ...base.tooltip, trigger: "axis" }, xAxis: { type: "category", data: m.map(x => x.m), ...axis }, yAxis: [{ type: "value", ...axis }, { type: "value", ...axis, splitLine: { show: false } }],
      series: [{ name: "Transfers", type: "bar", itemStyle: { color: C.cold }, data: m.map(x => x.inN + x.outN) }, { name: "Running total", type: "line", yAxisIndex: 1, showSymbol: false, lineStyle: { color: C.lamp }, itemStyle: { color: C.lamp }, data: m.map(x => cum += x.inN + x.outN) }] });
  }

  async function online() {
    const body = $("online-body"), sw = D.compromise.sweeper;
    const who = [{ a: D.address, label: "This wallet" }].concat(sw ? [{ a: sw.address, label: "The sweeper" }] : []);
    body.innerHTML = who.map((w, i) => `<h3 class="online-h">${esc(w.label)} · <span class="data" style="font-size:15px">${short(w.a)}</span></h3><div id="on-${i}"><p class="note">Searching X and name records…</p></div>`).join("");
    await Promise.all(who.map(async (w, i) => {
      const box = $("on-" + i);
      let r; try { r = await (await fetch("/api/mentions?address=" + w.a)).json(); } catch (e) { r = { error: e.message }; }
      if (!D) return;
      if (r.error) { box.innerHTML = `<p class="note">The search failed: ${esc(r.error)}</p>`; return; }
      const n = r.names, names = n && (n.ens || n.twitter || n.farcaster) ? `<p class="note">Published by the owner: ${[n.ens && `ENS name <b>${esc(n.ens)}</b>`, n.twitter && `X account <a href="https://x.com/${esc(n.twitter)}" target="_blank" rel="noopener">@${esc(n.twitter)}</a>`, n.farcaster && n.farcaster.username && `Farcaster <a href="https://farcaster.xyz/${esc(n.farcaster.username)}" target="_blank" rel="noopener">@${esc(n.farcaster.username)}</a>`, n.github && `GitHub ${esc(n.github)}`].filter(Boolean).join(" · ")}</p>` : "";
      const posts = r.posts.sort((a, b) => (b.exact - a.exact) || (b.at || 0) - (a.at || 0));
      box.innerHTML = names + (posts.length ? posts.map(p => `<div class="post"><div class="who"><a href="${esc(p.url)}" target="_blank" rel="noopener">@${esc(p.user)}</a><span>${p.at ? when(p.at).slice(0, 10) : ""}${p.followers != null ? " · " + p.followers.toLocaleString("en-US") + " followers" : ""}</span></div><p>${esc(p.text)}</p><div class="meta">${p.exact ? "Contains the address." : "Matched by X search; the address is not in the visible text (it may be in a quote, link or image)."} ${p.likes} likes${p.views != null ? " · " + p.views.toLocaleString("en-US") + " views" : ""}</div></div>`).join("") :
        `<p class="note">${r.postsError ? "X search is unavailable right now: " + esc(r.postsError) : "No public posts on X contain this address."}</p>`);
    }));
  }

  function approvals() {
    const a = D.approvals, n = $("ap-note");
    if (a === null) { n.textContent = "The permission list could not be loaded right now. Try again in a minute."; empty("c-apbar", ""); $("ap-table").innerHTML = ""; return; }
    if (!a.length) { n.textContent = "No contract has permission to move this wallet's tokens. Nothing to close."; empty("c-apbar", "No open permissions."); $("ap-table").innerHTML = ""; return; }
    n.innerHTML = `A permission lets a contract move a token out of this wallet without asking again. ${D.risk.counts.risky ? `<b>${D.risk.counts.risky} point to a flagged contract.</b> ` : ""}${D.risk.counts.unlimited} are unlimited. Close the ones you do not use: ${mineNow() ? "Press REVOKE next to one and confirm it in your wallet; each costs a little gas." : `Connect this wallet (bottom left) to revoke here, or <a href="https://revoke.cash/address/${D.address}" target="_blank" rel="noopener">use Revoke.cash</a>.`}${D.compromise.level !== "none" ? " <b>This wallet's key is compromised, so revoking will not make it safe.</b>" : ""}`;
    const by = {}; a.forEach(x => { const o = by[x.token] || (by[x.token] = { ok: 0, bad: 0 }); x.risky ? o.bad++ : o.ok++; });
    const ks = Object.keys(by).sort((p, q) => by[q].ok + by[q].bad - by[p].ok - by[p].bad).slice(0, 14).reverse();
    draw("c-apbar", { grid: { left: 90, right: 20, top: 26, bottom: 24 }, legend: { textStyle: { color: C.dim } }, tooltip: { ...base.tooltip, trigger: "axis" }, xAxis: { type: "value", minInterval: 1, ...axis }, yAxis: { type: "category", data: ks, ...axis },
      series: [{ name: "Open", type: "bar", stack: "s", itemStyle: { color: C.lamp }, data: ks.map(k => by[k].ok) }, { name: "Flagged", type: "bar", stack: "s", itemStyle: { color: C.blood }, data: ks.map(k => by[k].bad) }] });
    const rows = a.slice().sort((p, q) => (q.risky - p.risky) || (q.unlimited - p.unlimited));
    $("ap-table").innerHTML = `<div class="tw"><table><tr><th>Token</th><th>Who can spend it</th><th>How much</th><th>Status</th></tr>` + rows.map(x =>
      `<tr><td>${esc(x.token)} ${chip(x.chain)}</td><td>${mineNow() ? `<button class="mini danger" type="button" data-revoke="${x.chain}:${x.tokenAddress}:${x.spender}">REVOKE</button>` : ""}${aLink(x.spender, x.spenderName, x.chain)}${x.isContract ? `<button class="mini" type="button" data-audit="${x.chain}:${x.spender}:spender">AUDIT</button>` : ""}</td><td>${x.unlimited ? "Unlimited" : esc(String(x.amount).slice(0, 18))}</td><td>${x.risky ? '<span class="tag bad">flagged</span>' : x.trusted ? '<span class="tag swap">well known</span>' : !x.openSource && x.isContract ? '<span class="tag unknown">code not public</span>' : '<span class="tag other">open</span>'}</td></tr>`).join("") + `</table></div>`;
  }

  // ---- actions only the owner can take ----
  const mineNow = () => !!(window.LS_WALLET && D && window.LS_WALLET.address === D.address);
  let lastWallet = null;
  document.addEventListener("ls-wallet", e => {
    const a = e.detail.address;
    if (a && a !== lastWallet && !D) run(a); // first connection on the title screen: go straight to the owner's own case
    lastWallet = a;
    if (D) { delete rendered.approvals; if (curTab === "approvals") render("approvals"); }
  });
  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-revoke]"); if (!b || !window.LS_WALLET) return;
    const [chain, token, spender] = b.dataset.revoke.split(":");
    b.disabled = true; b.textContent = "CHECK WALLET…";
    try {
      // approve(spender, 0): the standard way to take a spending permission back
      const hash = await window.LS_WALLET.send(CID[chain], { to: token, data: "0x095ea7b3" + spender.slice(2).padStart(64, "0") + "0".repeat(64) });
      b.outerHTML = `<a href="${exT(hash, chain)}" target="_blank" rel="noopener">revoke sent ↗</a> `; snd("ok");
    } catch (err) { b.disabled = false; b.textContent = "REVOKE"; snd("error"); alert("The revoke was not sent: " + ((err && (err.shortMessage || err.message)) || "cancelled")); }
  });
  // ---- Solana: one page, its own signals ----
  async function runSol(address) {
    $("err").textContent = "";
    const intro = opening(address); if (window.SCENE) SCENE.approach();
    $("load").hidden = false; $("loadt").textContent = "READING SOLANA…"; snd("tape");
    try {
      const d = await (await fetch("/api/sol?address=" + address)).json();
      if (d.error) throw new Error(d.error);
      await intro;
      D = null; rendered = {};
      history.replaceState(null, "", "?a=" + address);
      $("whoLink").textContent = address; $("whoLink").href = "https://solscan.io/account/" + address;
      show(true); $("tabs").hidden = true; $("swarm").hidden = true;
      document.querySelectorAll(".pane").forEach(p => p.hidden = p.id !== "p-sol");
      const comp = !!(d.taker || d.burst), v = $("verdict"); v.hidden = false;
      v.className = d.taker ? "verdict" : comp || d.delegated.length ? "verdict warn" : "verdict ok";
      v.innerHTML = d.taker ? `<h2>FUNDS TAKEN WITHOUT YOUR SIGNATURE</h2><p>Signed by <a href="https://solscan.io/account/${esc(d.taker.signer)}" target="_blank" rel="noopener">${short(d.taker.signer)}</a> in ${d.taker.count} transaction${d.taker.count > 1 ? "s" : ""}. Treat this wallet as unsafe.</p>` :
        d.burst ? `<h2>POSSIBLE DRAIN</h2><p>Several assets left for one address within an hour.</p>` : d.delegated.length ? `<h2>OPEN DOORS</h2><p>Some token accounts still have a delegate who can move them.</p>` : `<h2>NO THEFT FOUND</h2><p>In the ${d.txRead} latest transactions on Solana.</p>`;
      tell({ story: d.story, compromise: { level: d.taker ? "confirmed" : "none" }, incident: d.burst });
      const s = []; if (d.taker) s.push("<b>Stop sending funds to this wallet.</b> Move anything left to a new wallet with a new seed phrase, made on a clean device.");
      if (d.delegated.length) s.push("Revoke the token delegates listed below in your wallet app (Phantom and Solflare can do this) or with a Solana revoke tool.");
      if (d.taker || d.burst) s.push("Save the transaction links below and report them to the exchange the funds reached, and to the police. Ignore anyone offering to recover funds for a fee.");
      if (!s.length) s.push("Nothing urgent. Never approve a transaction you do not understand, and never type your seed phrase into a website.");
      $("steps").innerHTML = s.map(x => `<li>${x}</li>`).join(""); $("todo").hidden = false;
      $("sol-stats").innerHTML = [[d.risk.score + " / 100", "Risk score"], [d.balanceSol.toFixed(4) + " SOL", "Balance now"], [d.txRead, "Transactions read"], [d.moves.filter(m => !m.signed && m.v < 0).length, "Outgoing, not signed by you"], [d.delegated.length, "Token delegates"]].map(([x, k]) => `<div class="stat"><b>${esc(x)}</b><span>${k}</span></div>`).join("");
      const col = d.risk.level === "high" ? C.blood : d.risk.level === "medium" ? C.lamp : C.moss;
      draw("c-sgauge", { series: [{ type: "gauge", min: 0, max: 100, progress: { show: true, width: 16, itemStyle: { color: col } }, axisLine: { lineStyle: { width: 16, color: [[1, "#161b21"]] } }, pointer: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { color: C.dim, distance: 22 }, detail: { formatter: "{value}", color: "#fff", fontSize: 54, fontFamily: "VT323, monospace", offsetCenter: [0, "0%"] }, title: { offsetCenter: [0, "38%"], color: col, fontSize: 18, fontFamily: "VT323, monospace" }, data: [{ value: d.risk.score, name: d.risk.level.toUpperCase() + " RISK" }] }] });
      const tk = {}; d.moves.filter(m => m.v < 0 && m.u > 0).forEach(m => tk[m.a] = (tk[m.a] || 0) + m.u);
      if (Object.keys(tk).length) draw("c-stokens", { tooltip: { ...base.tooltip, formatter: p => `${esc(p.name)}: ${usd(p.value)}` }, series: [{ type: "pie", radius: ["42%", "70%"], label: { color: C.ink }, data: Object.keys(tk).map(k => ({ name: k, value: Math.round(tk[k]) })) }] }); else empty("c-stokens", "Nothing with a known price has left.");
      const pts = d.moves.filter(m => m.u > 0);
      if (pts.length) draw("c-smoves", { grid: { left: 64, right: 16, top: 30, bottom: 36 }, legend: { textStyle: { color: C.dim } }, tooltip: { ...base.tooltip, formatter: p => `${when(p.data[0] / 1000)}<br>${esc(p.data[2])} ${p.data[3] > 0 ? "in" : "out"} · ${usd(p.data[1])}` }, xAxis: { type: "time", ...axis }, yAxis: { type: "log", ...axis },
        series: [[true, "Signed by you", C.lamp], [false, "Not signed by you", C.blood]].map(([sg, n, c]) => ({ name: n, type: "scatter", symbolSize: 9, itemStyle: { color: c }, data: pts.filter(m => m.signed === sg).map(m => [m.ts * 1000, Math.max(m.u, .01), m.a, m.v, m.s]) })) })
        .on("click", p => open("https://solscan.io/tx/" + p.data[4], "_blank")); else empty("c-smoves", "No priced moves in the transactions read.");
      const sl = a => `<a href="https://solscan.io/account/${esc(a)}" target="_blank" rel="noopener">${short(a)}</a>`;
      $("sol-tables").innerHTML = (d.delegated.length ? `<div class="tw"><table><tr><th>Token</th><th>Delegate who can move it</th><th class="n">Amount allowed</th></tr>${d.delegated.map(x => `<tr><td>${esc(x.symbol)}</td><td>${sl(x.delegate)}</td><td class="n">${x.amount == null ? "?" : x.amount}</td></tr>`).join("")}</table></div>` : "") +
        `<div class="tw"><table><tr><th>Sent to</th><th class="n">USD today</th><th class="n">Times</th><th>Assets</th></tr>${d.sent.map(x => `<tr><td>${sl(x.address)}</td><td class="n">${usd(x.usd)}</td><td class="n">${x.count}</td><td>${esc(x.assets.join(", "))}</td></tr>`).join("") || "<tr><td colspan=4>Nothing sent in the transactions read.</td></tr>"}</table></div>` +
        `<div class="tw"><table><tr><th>Time (UTC)</th><th>Asset</th><th class="n">Change</th><th>Signed by you</th><th>Transaction</th></tr>${d.moves.slice(0, 60).map(m => `<tr><td>${when(m.ts)}</td><td>${esc(m.a)}</td><td class="n">${m.v > 0 ? "+" : ""}${Number(m.v).toLocaleString("en-US", { maximumFractionDigits: 6 })}</td><td>${m.signed ? "yes" : '<span class="tag bad">no</span>'}</td><td><a href="https://solscan.io/tx/${esc(m.s)}" target="_blank" rel="noopener">${short(m.s)}</a></td></tr>`).join("")}</table></div>`;
      setTimeout(() => d.taker ? snd("alarm", 6) : d.burst ? snd("impact", 4) : snd("ok"), 1000);
      if (window.SND) SND.mood(comp ? "dread" : "calm");
      subtitle(d.story[0]);
    } catch (err) { $("err").textContent = err.message || "Something went wrong."; show(false); snd("error"); $("card").hidden = true; if (window.SCENE) SCENE.retreat(); }
    $("load").hidden = true;
  }
  window.LS = { run };
  const q = new URLSearchParams(location.search).get("a");
  if (q) { $("addr").value = q; run(q); }
})();
