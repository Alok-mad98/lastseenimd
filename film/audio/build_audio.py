# Soundtrack for the LastSeenIMD launch film.
#   python build_audio.py <ffmpeg.exe>
# Three layers, mixed to ../hf/assets/mix.wav (42 s, 48 kHz stereo):
#   1. the score: the same worn-tape piano the app plays, written out note by note (dread through the film, resolved at the end)
#   2. a rain bed
#   3. recorded CC0 sound effects (see ../../lastseen/public/sfx/CREDITS.md), each placed at the frame where the picture does something
# The cue times are copied from the GSAP timeline in ../hf/index.html and written to cues.json.
import json, os, subprocess, sys, wave
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SFX = os.path.join(HERE, "..", "..", "lastseen", "public", "sfx")
FFMPEG = sys.argv[1] if len(sys.argv) > 1 else "ffmpeg"
SR, DUR = 48000, 42.0
N = int(SR * DUR)
rng = np.random.default_rng(11)
hz = lambda m: 440.0 * 2 ** ((m - 69) / 12)


def note(buf, midi, when, vel, long):
    """One piano-like note: four harmonics, a quick hammer, a long fall, a slow few-cent drift like stretched tape."""
    n = int(long * SR)
    i0 = int(when * SR)
    if i0 >= N:
        return
    n = min(n, N - i0)
    t = np.arange(n) / SR
    drift = 1 + 0.004 * np.sin(2 * np.pi * 0.27 * (t + when))
    env = np.minimum(t / 0.012, 1) * np.exp(-t * (5.5 / long))
    s = np.zeros(n)
    for mult, amp in ((1, 1), (2, 0.42), (3, 0.16), (4.02, 0.07)):
        s += amp * np.sin(2 * np.pi * hz(midi) * mult * drift * t)
    buf[i0:i0 + n] += s * env * vel * 0.2


def pad(buf, midis, when, long, level):
    n = min(int((long + 1.5) * SR), N - int(when * SR))
    if n <= 0:
        return
    t = np.arange(n) / SR
    env = np.minimum(t / (long * 0.4), 1) * np.clip((long + 1.5 - t) / 1.5, 0, 1)
    s = np.zeros(n)
    for k, m in enumerate(midis):
        f = hz(m) * (1.0035 if k % 2 else 0.9965)
        s += (2 / np.pi) * np.arcsin(np.sin(2 * np.pi * f * t))  # triangle
    i0 = int(when * SR)
    buf[i0:i0 + n] += s * env * level


def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):  # one-pole; slow but simple and only run on short buffers
        acc = (1 - a) * x[i] + a * acc
        y[i] = acc
    return y


def reverb(x, seconds=3.6, wet=0.42):
    n = int(seconds * SR)
    ir = rng.standard_normal(n) * (1 - np.arange(n) / n) ** 2.6
    size = 1 << int(np.ceil(np.log2(len(x) + n)))
    y = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[:len(x)]
    y *= wet * np.max(np.abs(x)) / (np.max(np.abs(y)) + 1e-9)
    return x + y


# ---- 1. score -------------------------------------------------------------------------------
# Dread: A minor, B flat, F minor, E. One chord every 6.5 s, starting as the card finishes typing.
music = np.zeros(N)
DREAD = [[45, 52, 60], [46, 53, 58], [41, 53, 56], [40, 52, 56]]
TUNE = [[69, 64], [70, 65], [68, 65], [68, 64]]
BAR = 6.5
bars = [(1.0 + i * BAR, DREAD[i % 4], TUNE[i % 4]) for i in range(5)]  # 1.0, 7.5, 14.0, 20.5, 27.0
for t0, ch, tu in bars:
    pad(music, ch, t0, BAR, 0.03)
    note(music, ch[0] - 12, t0, 0.75, BAR * 0.9)
    step = BAR / 8
    for n_, k in enumerate((0, 1, 2, 1)):
        note(music, ch[k], t0 + step * (n_ * 2 + 1), 0.42 + 0.1 * (n_ % 2), 3.4)
    note(music, tu[int(rng.integers(len(tu)))], t0 + step * 6, 0.5, 5)
note(music, 33, 16.5, 1.0, 7)            # the low toll under the title
note(music, 33, 24.0, 1.0, 6)            # and under the verdict
pad(music, [45, 52, 57], 33.5, 4.5, 0.03)  # holding breath under the last shot
# the end card resolves: A minor, plainly, high and quiet
for k, m in enumerate((57, 64, 69, 72, 76)):
    note(music, m, 38.7 + k * 0.42, 0.5, 4.5)
pad(music, [45, 57, 64], 38.6, 3.0, 0.035)
music = reverb(music)

# ---- 2. rain --------------------------------------------------------------------------------
noise = rng.standard_normal(N)
rain = noise - lowpass(noise, 1400)  # high-pass by subtraction
rain = lowpass(rain, 5200) * 0.03
gate = np.ones(N)
gate[:int(5 * SR)] = np.linspace(0.25, 1, int(5 * SR))              # far away during the card
gate[int(38.2 * SR):] = np.linspace(1, 0.15, N - int(38.2 * SR))     # falls back for the end card

# ---- 3. recorded effects, placed from the picture's timeline --------------------------------
CUES = [
    # time, file, gain, max seconds, what the picture is doing
    (0.00, "tape.mp3", 0.45, None, "tape starts"),
    (5.00, "switch.ogg", 0.40, None, "cut to the road"),
    (11.60, "message.mp3", 0.60, None, "message 1 lands"),
    (12.90, "message.mp3", 0.60, None, "message 2 lands"),
    (14.20, "message.mp3", 0.60, None, "message 3 lands"),
    (16.50, "impact.mp3", 0.75, 4.0, "the mark stamps in"),
    (21.97, "switch.ogg", 0.50, None, "PLAY pressed"),
    (22.20, "tape.mp3", 0.40, None, "rewind"),
    (24.00, "alarm.mp3", 0.55, 4.5, "COMPROMISED slams in"),
    (24.60, "message.mp3", 0.50, None, "case message 1"),
    (25.60, "message.mp3", 0.50, None, "case message 2"),
    (26.90, "message.mp3", 0.50, None, "case message 3"),
    (29.00, "switch.ogg", 0.40, None, "cut to the trail"),
    (29.50, "click.ogg", 0.45, None, "node 1"),
    (30.10, "click.ogg", 0.45, None, "node 2"),
    (30.70, "click.ogg", 0.45, None, "node 3"),
    (31.30, "click.ogg", 0.50, None, "node 4"),
    (37.93, "tape.mp3", 0.50, None, "the lamp dies"),
    (38.60, "ok.ogg", 0.40, None, "end card"),
]
# typing: one key click per four characters of the address, 34 characters a second from 20.5 s
CUES += [(20.5 + i * 4 / 34, "click.ogg", 0.22, None, "typing") for i in range(11)]
json.dump([{"t": round(t, 3), "frame": round(t * 30), "file": f, "gain": g, "what": w} for t, f, g, _, w in sorted(CUES)], open(os.path.join(HERE, "cues.json"), "w"), indent=1)

cache = {}


def load(name):
    if name not in cache:
        raw = subprocess.run([FFMPEG, "-v", "error", "-i", os.path.join(SFX, name), "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"], capture_output=True, check=True).stdout
        cache[name] = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float64)
    return cache[name]


fx = np.zeros((N, 2))
for t, name, gain, limit, _ in CUES:
    s = load(name).copy()
    if limit and len(s) > limit * SR:
        s = s[:int(limit * SR)]
        fade = int(0.8 * SR)
        s[-fade:] *= np.linspace(1, 0, fade)[:, None]
    # peak-aligned: the loudest instant of a short hit sits on the cue, not the file's first sample
    lead = int(np.argmax(np.abs(s).max(axis=1))) if len(s) < 1.5 * SR else 0
    i0 = max(0, int(t * SR) - lead)
    n = min(len(s), N - i0)
    fx[i0:i0 + n] += s[:n] * gain

# ---- mix: effects duck the score a little, then a soft limit --------------------------------
env = np.abs(fx).max(axis=1)
k = int(0.25 * SR)
env = np.convolve(env, np.ones(k) / k, mode="same")
duck = 1 - np.clip(env * 2.2, 0, 0.45)
bed = (music * 0.95 * duck + rain * gate)
mix = np.stack([bed, bed], axis=1) + fx
mix[:int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))[:, None]
mix[-int(0.6 * SR):] *= np.linspace(1, 0, int(0.6 * SR))[:, None]
mix = np.tanh(mix * 1.15) * 0.92
peak = float(np.max(np.abs(mix)))
out = os.path.join(HERE, "..", "hf", "assets", "mix.wav")
with wave.open(out, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype(np.int16).tobytes())
rms = lambda a: 20 * np.log10(np.sqrt(np.mean(a ** 2)) + 1e-12)
print("mix written: %.1f s, peak %.2f, rms %.1f dBFS | music %.1f dB, fx %.1f dB, rain %.1f dB" % (DUR, peak, rms(mix), rms(music), rms(fx), rms(rain)))
