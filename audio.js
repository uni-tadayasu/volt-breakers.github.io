// Music + generated SFX + procedural WebAudio blips.
export const settings = { bgm: 0.55, sfx: 0.8 };

const music = new Audio('assets/audio/stage-theme.mp3');
music.loop = true;
music.preload = 'auto';

const FILES = { shot: 'assets/audio/buster-shot.mp3', boom: 'assets/audio/explosion.mp3' };
const pools = {};
let ctx = null;

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = AC ? new AC() : null;
  }
  if (ctx && ctx.state === 'suspended') {
    ctx.resume();
  }
  if (!pools.shot) {
    for (const k in FILES) {
      const list = [];
      for (let i = 0; i < 4; i++) {
        const a = new Audio(FILES[k]);
        a.preload = 'auto';
        list.push(a);
      }
      pools[k] = { i: 0, list };
    }
  }
}

export function setVolumes(bgm, sfx) {
  settings.bgm = Math.max(0, Math.min(1, bgm));
  settings.sfx = Math.max(0, Math.min(1, sfx));
  music.volume = settings.bgm;
}

const TRACKS = {
  main: 'assets/audio/stage-theme.mp3',
  hero: 'assets/audio/hero-theme.mp3',
  boss: 'assets/audio/boss-theme-hq.mp3',
  kuge: 'assets/audio/kuge-theme.mp3',
  hidden: 'assets/audio/bgm-hidden.mp3',
  finalboss: 'assets/audio/bgm-final-boss.mp3',
  lastboss: 'assets/audio/bgm-lastboss.mp3',
  lastboss2: 'assets/audio/bgm-lastboss2.mp3',
};
let currentTrack = 'main';

export function setTrack(name) {
  const key = TRACKS[name] ? name : 'main';
  if (key === currentTrack) {
    // 同じ曲でも止まっていたら先頭から再開できるようにする
    if (music.paused && music.src) music.currentTime = 0;
    return;
  }
  currentTrack = key;
  const wasPlaying = !music.paused;
  music.pause();
  music.src = TRACKS[key];
  music.currentTime = 0;
  if (wasPlaying) {
    music.play().catch(() => {});
  }
}

export function playMusic(rate = 1) {
  music.playbackRate = rate;
  music.volume = Math.max(0, Math.min(1, settings.bgm));
  if (music.paused) {
    music.play().catch(() => {});
  }
}

export function duckMusic(on) {
  music.volume = Math.max(0, Math.min(1, on ? settings.bgm * 0.3 : settings.bgm));
}

export function stopMusic() {
  music.pause();
  music.currentTime = 0;
}

function tone(type, f0, f1, dur, vol, delay = 0) {
  if (!ctx) {
    return;
  }
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol * settings.sfx, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, vol, freq) {
  if (!ctx) {
    return;
  }
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.value = vol * settings.sfx;
  src.connect(f).connect(g).connect(ctx.destination);
  src.start();
}

const SYNTH = {
  jump: () => tone('square', 260, 560, 0.09, 0.08),
  dash: () => noise(0.2, 0.35, 1600),
  charge: () => tone('sawtooth', 200, 900, 0.3, 0.05),
  full: () => tone('triangle', 900, 1500, 0.15, 0.08),
  hurt: () => tone('sawtooth', 520, 80, 0.3, 0.14),
  hit: () => tone('square', 240, 70, 0.07, 0.1),
  select: () => tone('square', 880, 880, 0.05, 0.06),
  confirm: () => {
    tone('square', 660, 1320, 0.1, 0.08);
    tone('square', 990, 1980, 0.12, 0.06, 0.08);
  },
  item: () => {
    tone('triangle', 660, 660, 0.06, 0.1);
    tone('triangle', 880, 880, 0.06, 0.1, 0.06);
    tone('triangle', 1320, 1320, 0.1, 0.1, 0.12);
  },
  warn: () => {
    tone('sawtooth', 420, 840, 0.45, 0.1);
    tone('sawtooth', 420, 840, 0.45, 0.1, 0.5);
    tone('sawtooth', 420, 840, 0.45, 0.1, 1.0);
  },
  slash: () => {
    noise(0.12, 0.4, 4200);
    tone('sine', 1400, 500, 0.1, 0.05);
  },
  zap: () => tone('sawtooth', 1200, 300, 0.12, 0.06),
  buzz: () => tone('square', 120, 110, 0.12, 0.08),
  deflect: () => tone('triangle', 2000, 1800, 0.05, 0.08),
};

export function play(name) {
  const pool = pools[name];
  if (pool) {
    const a = pool.list[pool.i++ % pool.list.length];
    a.volume = Math.max(0, Math.min(1, settings.sfx * (name === 'shot' ? 0.5 : 0.8)));
    a.currentTime = 0;
    a.play().catch(() => {});
    return;
  }
  if (SYNTH[name]) {
    SYNTH[name]();
  }
}
