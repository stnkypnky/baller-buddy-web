/** Reads a recap like a TV play-by-play call with the device's own voices:
 *  the most announcer-like voice available, delivery that changes line by
 *  line (big plays faster and higher, scores slower), and a crowd made with
 *  Web Audio under it that swells on the big plays. Free and offline. */

// Best first: natural/neural voices, then deeper male voices that suit a broadcast.
const VOICE_PREFS = [
  /Guy.*Natural|Andrew.*Natural|Christopher.*Natural|Davis.*Natural|Eric.*Natural|Roger.*Natural|Steffan.*Natural/i,
  /Natural|Neural|Online/i,
  /Evan \(Enhanced\)|Nathan \(Enhanced\)|Tom \(Enhanced\)|Aaron|Reed/i,
  /Google US English/i,
  /\b(Alex|Fred|Daniel|David|Mark|Tom|Evan|Nathan)\b/i,
];

function loadVoices(synth: SpeechSynthesis): Promise<SpeechSynthesisVoice[]> {
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  // Chrome fills the list in after the first call.
  return new Promise((resolve) => {
    const done = () => resolve(synth.getVoices());
    synth.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 1200);
  });
}

export function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const en = voices.filter((v) => /^en[-_]US/i.test(v.lang));
  const pool = en.length ? en : voices.filter((v) => /^en/i.test(v.lang));
  for (const re of VOICE_PREFS) {
    const hit = pool.find((v) => re.test(v.name));
    if (hit) return hit;
  }
  return pool[0] ?? null;
}

export interface Line {
  text: string;
  rate: number;
  pitch: number;
  /** A big moment: the crowd swells. */
  big: boolean;
}

/** Markdown-free sentences, each with its own delivery. */
export function lines(text: string): Line[] {
  const clean = text
    .replace(/[*_#`>]/g, "")
    .replace(/(\d+)\s*[-–]\s*(\d+)/g, "$1 to $2") // "110-100" -> "110 to 100"
    .replace(/\s+/g, " ")
    .trim();
  const parts = clean.match(/[^.!?…]+[.!?…]+["”']?|[^.!?…]+$/g) ?? [];
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p, i) => {
      const big = /!\s*["”']?$/.test(p);
      const score = /\d+ to \d+/.test(p);
      return {
        text: p,
        big,
        rate: big ? 1.2 : score ? 1.02 : i === 0 ? 1.08 : 1.12,
        pitch: big ? 1.18 : i === 0 ? 1.05 : 0.98,
      };
    });
}

/** A low crowd murmur: filtered noise with a slow drift, swellable. */
function crowd() {
  const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
  if (!Ctx) return null;
  const ctx: AudioContext = new Ctx();
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  // Brown-ish noise reads as a far-off crowd rather than hiss.
  let last = 0;
  for (let i = 0; i < len; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    d[i] = last * 3.5;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 900;
  band.Q.value = 0.6;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.18;
  lfoGain.gain.value = 0.015;
  lfo.connect(lfoGain).connect(gain.gain);
  src.connect(band).connect(gain).connect(ctx.destination);
  src.start();
  lfo.start();
  const BASE = 0.05;
  gain.gain.setTargetAtTime(BASE, ctx.currentTime, 0.6);
  return {
    swell() {
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setTargetAtTime(0.16, t, 0.15);
      gain.gain.setTargetAtTime(BASE, t + 1.6, 0.8);
    },
    stop() {
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setTargetAtTime(0, t, 0.25);
      setTimeout(() => ctx.close().catch(() => {}), 900);
    },
  };
}

/** Starts reading; returns a function that stops it. Call from a tap (iOS
 *  only plays audio started by one). */
export function announce(text: string, onEnd: () => void): () => void {
  const synth = window.speechSynthesis;
  if (!synth) {
    onEnd();
    return () => {};
  }
  synth.cancel();
  let stopped = false;
  const room = crowd();
  const finish = () => {
    if (stopped) return;
    stopped = true;
    room?.stop();
    onEnd();
  };
  const all = lines(text);
  void loadVoices(synth).then((voices) => {
    if (stopped) return;
    const voice = pickVoice(voices);
    all.forEach((l, i) => {
      const u = new SpeechSynthesisUtterance(l.text);
      if (voice) u.voice = voice;
      u.lang = voice?.lang ?? "en-US";
      u.rate = l.rate;
      u.pitch = l.pitch;
      u.volume = 1;
      if (l.big) u.onstart = () => room?.swell();
      if (i === all.length - 1) u.onend = finish;
      u.onerror = (e) => {
        if (e.error !== "interrupted" && e.error !== "canceled") finish();
      };
      synth.speak(u);
    });
    if (!all.length) finish();
  });
  return () => {
    synth.cancel();
    finish();
  };
}
