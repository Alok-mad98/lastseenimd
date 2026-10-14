// Sound for LastSeenIMD.
// Hits, clicks and stings are real CC0 recordings (see sfx/CREDITS.md).
// The music is played live by this file: a slow, worn-tape piano over a soft pad and distant rain, in the spirit of
// late-night lo-fi horror soundtracks. It has two moods: "calm" for the title screen and "dread" once a case turns bad.
// Nothing plays until the visitor presses a button.
(function () {
  const FILES = { click: "click.ogg", sw: "switch.ogg", ok: "ok.ogg", error: "error.ogg", message: "message.mp3", tape: "tape.mp3", impact: "impact.mp3", alarm: "alarm.mp3" };
  const LEVEL = { click: 0.3, sw: 0.35, ok: 0.45, error: 0.45, message: 0.5, tape: 0.45, impact: 0.65, alarm: 0.5 };
  let ctx = null, master = null, music = null, verb = null, wow = null, buffers = {}, on = localStorage.getItem("ls-sound") !== "off", mood = "calm", timer = null, bar = 0;

  async function load(name) {
    if (buffers[name]) return buffers[name];
    const data = await (await fetch("sfx/" + FILES[name])).arrayBuffer();
    return buffers[name] = await ctx.decodeAudioData(data);
  }
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);

  // a room to play in: a few seconds of decaying noise makes a usable reverb
  function room(seconds) {
    const len = ctx.sampleRate * seconds, b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    const v = ctx.createConvolver(); v.buffer = b; return v;
  }

  // one piano-like note: a few harmonics, a quick hammer, a long fall, slightly out of tune like an old tape
  function note(midi, when, vel, long) {
    const g = ctx.createGain(), f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1500 + vel * 1400;
    g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(vel * 0.22, when + 0.012); g.gain.exponentialRampToValueAtTime(0.0008, when + long);
    [[1, 1], [2, 0.42], [3, 0.16], [4.02, 0.07]].forEach(([mult, amp]) => {
      const o = ctx.createOscillator(), og = ctx.createGain(); o.type = "sine"; o.frequency.value = hz(midi) * mult; og.gain.value = amp;
      wow.connect(o.detune); o.connect(og); og.connect(g); o.start(when); o.stop(when + long + 0.1);
    });
    g.connect(f); f.connect(music); f.connect(verb);
  }
  // a soft held chord underneath
  function pad(midis, when, len, level) {
    midis.forEach((m, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter(); o.type = "triangle"; o.frequency.value = hz(m); o.detune.value = (i % 2 ? 6 : -6);
      f.type = "lowpass"; f.frequency.value = 520; wow.connect(o.detune);
      g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(level, when + len * 0.4); g.gain.linearRampToValueAtTime(0, when + len + 1.5);
      o.connect(f); f.connect(g); g.connect(verb); g.connect(music); o.start(when); o.stop(when + len + 1.6);
    });
  }

  // Calm: A minor, F, C, E minor. Dread: the same shape pulled down and soured (A minor, B flat, F minor, E), slower and sparser.
  const SONGS = {
    calm: { bar: 6.4, chords: [[57, 60, 64], [53, 57, 60], [48, 55, 64], [52, 55, 59]], tune: [[76, 72, 69], [72, 69, 65], [79, 76, 72], [71, 67, 64]], padLevel: 0.028, density: 0.85 },
    dread: { bar: 8.4, chords: [[45, 52, 60], [46, 53, 58], [41, 53, 56], [40, 52, 56]], tune: [[69, 64], [70, 65], [68, 65], [68, 64]], padLevel: 0.04, density: 0.55 },
  };
  function playBar() {
    if (!ctx || ctx.state !== "running") { timer = setTimeout(playBar, 800); return; }
    const s = SONGS[mood], i = bar++ % 4, t0 = ctx.currentTime + 0.1, ch = s.chords[i], step = s.bar / 8;
    pad(ch, t0, s.bar, s.padLevel);
    note(ch[0] - 12, t0, 0.7, s.bar * 0.9);                                         // the bass note, once
    [0, 1, 2, 1].forEach((k, n) => { if (Math.random() < s.density) note(ch[k], t0 + step * (n * 2 + 1) + (Math.random() - 0.5) * 0.05, 0.38 + Math.random() * 0.2, 3.4); });
    if (Math.random() < 0.75) { const tu = s.tune[i]; note(tu[Math.floor(Math.random() * tu.length)], t0 + step * (Math.random() < 0.5 ? 4 : 6), 0.5, 5); }   // a lone high note
    if (mood === "dread" && i === 3) note(33, t0 + step * 5, 0.9, 7);              // a low toll before the loop comes round
    timer = setTimeout(playBar, s.bar * 1000);
  }

  function ambience() {
    music = ctx.createGain(); music.gain.value = 0; music.connect(master);
    verb = room(4.2); const wet = ctx.createGain(); wet.gain.value = 0.5; verb.connect(wet); wet.connect(music);
    // tape wow: every pitched voice drifts a few cents, slowly
    const l = ctx.createOscillator(); wow = ctx.createGain(); l.frequency.value = 0.27; wow.gain.value = 7; l.connect(wow); l.start();
    // rain outside the window, kept far back
    const len = ctx.sampleRate * 4, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1400;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 5200;
    const rain = ctx.createGain(); rain.gain.value = 0.022;
    noise.connect(hp); hp.connect(lp); lp.connect(rain); rain.connect(music); noise.start();
    music.gain.linearRampToValueAtTime(1, ctx.currentTime + 3);
    playBar();
  }

  const SND = window.SND = {
    get on() { return on; },
    // must be called from a click or key press: browsers refuse audio before that
    start() {
      if (!on) return;
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
        ambience(); Object.keys(FILES).forEach(n => load(n).catch(() => {}));
      }
      if (ctx.state === "suspended") ctx.resume();
    },
    // "calm" or "dread"; the change lands on the next bar so it never cuts a phrase
    mood(m) { if (SONGS[m]) mood = m; },
    async play(name, maxSeconds) {
      if (!on || !ctx || !FILES[name]) return;
      try {
        const b = await load(name), s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = b; g.gain.value = LEVEL[name] || 0.5;
        s.connect(g); g.connect(master); s.start();
        if (maxSeconds && b.duration > maxSeconds) { g.gain.setValueAtTime(g.gain.value, ctx.currentTime + maxSeconds - 0.8); g.gain.linearRampToValueAtTime(0, ctx.currentTime + maxSeconds); s.stop(ctx.currentTime + maxSeconds + 0.05); }
      } catch (e) { /* a missing sound must never break the page */ }
    },
    toggle() {
      on = !on; localStorage.setItem("ls-sound", on ? "on" : "off");
      if (on) SND.start(); else if (ctx) ctx.suspend();
      return on;
    },
  };
  // every button makes a small physical click, tabs a heavier switch
  document.addEventListener("click", e => {
    const b = e.target.closest("button, a"); if (!b) return;
    SND.start(); SND.play(b.closest("#tabs") ? "sw" : "click");
  }, true);
})();
