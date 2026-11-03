// Core side-scrolling 3D action engine.
import * as THREE from 'three';
import { WEAPONS, findKit } from './data.js';
import { input } from './input.js';
import { play, playMusic, setTrack } from './audio.js';
import { makeModel, playAnim, getTexture, ensureModel, hasModel } from './assets.js';

const DEFERRED_MODELS = ['overlord', 'vb-operator-brute'];
// ネットワークから受け付ける弾種／モデル名のホワイトリスト
const SHOT_TYPES = new Set(['buster', 'slash', 'wave', 'fire', 'ice', 'homing', 'spark', 'quake', 'boomerang', 'laser', 'spread', 'spikebomb']);
const NET_MODELS = new Set(['vb-hero-van', 'vb-hero-rei', 'enemy-walker', 'boss-mech', ...DEFERRED_MODELS]);
const num = (v, lo, hi, d) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
import { myId } from './net.js';

// オンライン同期の版番号（見た目・技の仕様を変えたら上げる）
const NET_VER = 20;

const STEP = 1 / 60;

// 特殊能力装置（隠し場所でのみ入手）
export const PARTS = {
  1: { name: 'ハイジャンプ・ユニット', desc: 'ジャンプ力アップ', color: 0x66ff99 },
  2: { name: 'ブースト・ユニット', desc: '移動・ダッシュ速度アップ', color: 0x66ccff },
  4: { name: 'オーバードライブ・ユニット', desc: '攻撃力アップ＆攻撃エフェクト強化', color: 0xffcc33 },
  8: { name: 'ガード・ユニット', desc: '被ダメージ半減＆バリア', color: 0xc77dff },
};
const GRAV = -38;
const MAX_EN = 28;

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- shared visual resources ----------
let GLOW = null;
function glowTex() {
  if (GLOW) {
    return GLOW;
  }
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  GLOW = new THREE.CanvasTexture(c);
  GLOW.colorSpace = THREE.SRGBColorSpace;
  return GLOW;
}

let WIN = null;
function windowTex() {
  if (WIN) {
    return WIN;
  }
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#05070d';
  g.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 128; y += 8) {
    for (let x = 4; x < 64; x += 8) {
      if (Math.random() < 0.35) {
        g.fillStyle = Math.random() < 0.5 ? '#ffd27a' : '#6fd8ff';
        g.fillRect(x, y, 4, 4);
      }
    }
  }
  WIN = new THREE.CanvasTexture(c);
  WIN.colorSpace = THREE.SRGBColorSpace;
  return WIN;
}

const GEO = {};
function geo() {
  if (GEO.sphere) {
    return GEO;
  }
  GEO.sphere = new THREE.SphereGeometry(1, 12, 10);
  GEO.crescent = new THREE.RingGeometry(0.55, 1, 20, 1, -Math.PI / 2, Math.PI);
  GEO.shard = new THREE.ConeGeometry(0.4, 1.6, 6).rotateZ(-Math.PI / 2);
  GEO.pillar = new THREE.BoxGeometry(0.9, 2.4, 0.9).translate(0, 1.2, 0);
  GEO.beam = new THREE.BoxGeometry(3.5, 0.28, 0.28);
  GEO.box = new THREE.BoxGeometry(1, 1, 1);
  GEO.torus = new THREE.TorusGeometry(0.7, 0.12, 6, 16);
  GEO.cyl = new THREE.CylinderGeometry(0.18, 0.18, 0.9, 8).rotateZ(Math.PI / 2);
  GEO.cone = new THREE.ConeGeometry(0.5, 1, 8);
  GEO.oct = new THREE.OctahedronGeometry(1, 0);
  GEO.ring = new THREE.RingGeometry(0.8, 1, 24);
  GEO.ico = new THREE.IcosahedronGeometry(1, 0);
  return GEO;
}

const basicCache = {};
function basicMat(color) {
  if (!basicCache[color]) {
    basicCache[color] = new THREE.MeshBasicMaterial({ color, toneMapped: false, side: THREE.DoubleSide });
  }
  return basicCache[color];
}
const spriteCache = {};
function spriteMat(color) {
  if (!spriteCache[color]) {
    spriteCache[color] = new THREE.SpriteMaterial({ map: glowTex(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
  }
  return spriteCache[color];
}

function boxUV(g, w, h, d) {
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[f][0] / 2, uv.getY(i) * dims[f][1] / 2);
    }
  }
  uv.needsUpdate = true;
}

// ---------- particles ----------
class Particles {
  constructor(scene) {
    this.pool = [];
    this.live = [];
    for (let i = 0; i < 520; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
      s.visible = false;
      scene.add(s);
      this.pool.push(s);
    }
  }
  emit(x, y, color, n = 8, { speed = 4, life = 0.5, size = 0.4, grav = 0, ring = false, z = 0.4 } = {}) {
    for (let i = 0; i < n; i++) {
      const s = this.pool.pop();
      if (!s) {
        return;
      }
      const a = ring ? (i / n) * Math.PI * 2 : Math.random() * Math.PI * 2;
      const sp = ring ? speed : speed * (0.3 + Math.random() * 0.7);
      s.visible = true;
      s.material.color.setHex(color);
      s.material.opacity = 1;
      s.position.set(x, y, z);
      s.scale.setScalar(size);
      this.live.push({ s, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, max: life, size, grav });
    }
  }
  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.s.visible = false;
        this.pool.push(p.s);
        this.live.splice(i, 1);
        continue;
      }
      p.vy += p.grav * dt;
      p.s.position.x += p.vx * dt;
      p.s.position.y += p.vy * dt;
      const k = p.life / p.max;
      p.s.material.opacity = k;
      p.s.scale.setScalar(p.size * (0.4 + k * 0.6));
    }
  }
  clear() {
    this.live.forEach(p => {
      p.s.visible = false;
      this.pool.push(p.s);
    });
    this.live = [];
  }
}

// ---------- enemies ----------
const ENEMY_TYPES = {
  walker: { hp: 3, w: 0.9, h: 1.4 },
  drone: { hp: 2, w: 0.9, h: 0.8, fly: true },
  turret: { hp: 4, w: 1.0, h: 1.0 },
  hopper: { hp: 3, w: 0.9, h: 1.0 },
  shielder: { hp: 5, w: 1.0, h: 1.5 },
  // ---- 追加バリエーション ----
  bomber: { hp: 3, w: 1.1, h: 0.8, fly: true },     // 上空から爆弾投下
  sniper: { hp: 4, w: 1.0, h: 1.3 },                // 予告線→高速レーザー
  roller: { hp: 3, w: 0.9, h: 0.9 },                // 高速で転がる棘玉
  mine: { hp: 2, w: 0.8, h: 0.6 },                  // 近づくと全方位炸裂
  bat: { hp: 2, w: 0.8, h: 0.6, fly: true },        // 急降下アタック
  mortar: { hp: 5, w: 1.2, h: 1.1 },                // 放物線の迫撃砲
  heavy: { hp: 9, w: 1.3, h: 1.9 },                 // 重装：3WAY弾＋踏み込み
  splitter: { hp: 4, w: 1.0, h: 1.0 },              // 倒すと2体に分裂
  mini: { hp: 1, w: 0.6, h: 0.6 },                  // 分裂体・召喚体
  orbiter: { hp: 4, w: 0.9, h: 0.9, fly: true },    // 回転バリア弾を纏う浮遊機
};

function stdMat(color, emissive = 0x000000) {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.35, emissive, emissiveIntensity: 0.8 });
}

function makePrimEnemy(type) {
  const g = geo();
  const group = new THREE.Group();
  const inner = new THREE.Group();
  group.add(inner);
  if (type === 'drone') {
    const body = new THREE.Mesh(g.sphere, stdMat(0x556070));
    body.scale.set(0.45, 0.35, 0.45);
    body.position.y = 0.4;
    const ring = new THREE.Mesh(g.torus, stdMat(0x222630, 0xff3355));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.45;
    ring.scale.setScalar(0.8);
    const eye = new THREE.Mesh(g.sphere, basicMat(0xff2244));
    eye.scale.setScalar(0.12);
    eye.position.set(0, 0.4, 0.42);
    inner.add(body, ring, eye);
  } else if (type === 'turret') {
    const base = new THREE.Mesh(g.box, stdMat(0x3a4250));
    base.scale.set(1, 0.5, 1);
    base.position.y = 0.25;
    const dome = new THREE.Mesh(g.sphere, stdMat(0x606a7a, 0x331100));
    dome.scale.set(0.4, 0.35, 0.4);
    dome.position.y = 0.6;
    const barrel = new THREE.Mesh(g.cyl, stdMat(0x22252c));
    barrel.position.set(0, 0.7, 0.45);
    barrel.rotation.y = Math.PI / 2;
    const eye = new THREE.Mesh(g.sphere, basicMat(0xffaa22));
    eye.scale.setScalar(0.1);
    eye.position.set(0, 0.75, 0.35);
    inner.add(base, dome, barrel, eye);
  } else if (type === 'bomber') {
    const body = new THREE.Mesh(g.box, stdMat(0x4a3a60, 0x220a33));
    body.scale.set(1.1, 0.35, 0.7);
    body.position.y = 0.45;
    const wingL = new THREE.Mesh(g.box, stdMat(0x2a2236));
    wingL.scale.set(0.3, 0.08, 1.3);
    wingL.position.set(0, 0.55, 0);
    const pod = new THREE.Mesh(g.sphere, stdMat(0x222222, 0xff5500));
    pod.scale.setScalar(0.22);
    pod.position.set(0, 0.2, 0);
    const eye = new THREE.Mesh(g.sphere, basicMat(0xff66ff));
    eye.scale.setScalar(0.1);
    eye.position.set(0, 0.45, 0.38);
    inner.add(body, wingL, pod, eye);
  } else if (type === 'sniper') {
    const leg = new THREE.Mesh(g.cone, stdMat(0x2f3540));
    leg.scale.set(1.2, 0.7, 1.2);
    leg.position.y = 0.35;
    const head = new THREE.Mesh(g.box, stdMat(0x5a6070, 0x003322));
    head.scale.set(0.55, 0.45, 0.55);
    head.position.y = 0.95;
    const barrel = new THREE.Mesh(g.cyl, stdMat(0x15181d));
    barrel.scale.set(1, 0.7, 0.7);
    barrel.rotation.y = Math.PI / 2;
    barrel.position.set(0, 0.98, 0.55);
    const lens = new THREE.Mesh(g.sphere, basicMat(0x33ffcc));
    lens.scale.setScalar(0.11);
    lens.position.set(0, 1.0, 0.3);
    inner.add(leg, head, barrel, lens);
  } else if (type === 'roller' || type === 'mini') {
    const s = type === 'mini' ? 0.62 : 1;
    const ball = new THREE.Mesh(g.ico, stdMat(type === 'mini' ? 0x7a4aa0 : 0x707a88, type === 'mini' ? 0x3a0a55 : 0x110000));
    ball.scale.setScalar(0.42 * s);
    ball.position.y = 0.45 * s;
    inner.add(ball);
    for (let i = 0; i < 6; i++) {
      const sp = new THREE.Mesh(g.cone, stdMat(0xcccccc));
      sp.scale.set(0.18 * s, 0.35 * s, 0.18 * s);
      const a = (i / 6) * Math.PI * 2;
      sp.position.set(Math.cos(a) * 0.45 * s, 0.45 * s + Math.sin(a) * 0.45 * s, 0);
      sp.rotation.z = a - Math.PI / 2;
      ball.add(sp);
      sp.position.set(Math.cos(a) * 1.05, Math.sin(a) * 1.05, 0);
      sp.scale.set(0.4, 0.8, 0.4);
    }
    const eye = new THREE.Mesh(g.sphere, basicMat(0xff3344));
    eye.scale.setScalar(0.1 * s);
    eye.position.set(0, 0.5 * s, 0.4 * s);
    inner.add(eye);
    inner.userData.spin = ball;
  } else if (type === 'mine') {
    const base = new THREE.Mesh(g.sphere, stdMat(0x2a2a2a));
    base.scale.set(0.42, 0.25, 0.42);
    base.position.y = 0.2;
    const lamp = new THREE.Mesh(g.sphere, basicMat(0xff2222));
    lamp.scale.setScalar(0.12);
    lamp.position.y = 0.45;
    inner.add(base, lamp);
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.Mesh(g.cone, stdMat(0x777777));
      sp.scale.set(0.12, 0.3, 0.12);
      const a = (i / 4) * Math.PI * 2;
      sp.position.set(Math.cos(a) * 0.4, 0.25, Math.sin(a) * 0.4);
      sp.rotation.set(Math.sin(a) * 1.3, 0, -Math.cos(a) * 1.3);
      inner.add(sp);
    }
    inner.userData.lamp = lamp;
  } else if (type === 'bat') {
    const body = new THREE.Mesh(g.sphere, stdMat(0x302040, 0x220022));
    body.scale.set(0.3, 0.28, 0.3);
    body.position.y = 0.3;
    const wl = new THREE.Mesh(g.cone, stdMat(0x1a1024, 0x440044));
    wl.scale.set(0.5, 0.06, 0.9);
    wl.rotation.x = Math.PI / 2;
    wl.position.set(0, 0.35, 0);
    const eye = new THREE.Mesh(g.sphere, basicMat(0xffee33));
    eye.scale.setScalar(0.08);
    eye.position.set(0, 0.35, 0.27);
    inner.add(body, wl, eye);
    inner.userData.wing = wl;
  } else if (type === 'mortar') {
    const base = new THREE.Mesh(g.box, stdMat(0x40463a));
    base.scale.set(1.2, 0.45, 1);
    base.position.y = 0.22;
    const tube = new THREE.Mesh(g.cyl, stdMat(0x22261e, 0x221100));
    tube.scale.set(1.2, 1.6, 1.6);
    tube.rotation.z = Math.PI / 2 + 0.6;
    tube.rotation.y = Math.PI / 2;
    tube.position.set(0, 0.75, 0.15);
    const lamp = new THREE.Mesh(g.sphere, basicMat(0xffaa00));
    lamp.scale.setScalar(0.09);
    lamp.position.set(0.3, 0.5, 0.45);
    inner.add(base, tube, lamp);
  } else if (type === 'splitter') {
    const body = new THREE.Mesh(g.oct, stdMat(0x5a2a7a, 0x330055));
    body.scale.setScalar(0.5);
    body.position.y = 0.55;
    const core = new THREE.Mesh(g.sphere, basicMat(0xcc66ff));
    core.scale.setScalar(0.16);
    core.position.set(0, 0.55, 0.3);
    inner.add(body, core);
    inner.userData.spin = body;
  } else if (type === 'orbiter') {
    const body = new THREE.Mesh(g.ico, stdMat(0x3a5060, 0x003344));
    body.scale.setScalar(0.38);
    body.position.y = 0.45;
    const eye = new THREE.Mesh(g.sphere, basicMat(0x33ddff));
    eye.scale.setScalar(0.12);
    eye.position.set(0, 0.45, 0.35);
    inner.add(body, eye);
    for (let i = 0; i < 3; i++) {
      const o = new THREE.Mesh(g.sphere, basicMat(0x66eeff));
      o.scale.setScalar(0.13);
      const s = new THREE.Sprite(spriteMat(0x33ccff));
      s.scale.setScalar(6);
      o.add(s);
      group.add(o);
      (group.userData.orbs = group.userData.orbs || []).push(o);
    }
  } else {
    const body = new THREE.Mesh(g.sphere, stdMat(0x8a6a30));
    body.scale.set(0.45, 0.4, 0.45);
    body.position.y = 0.55;
    const eye = new THREE.Mesh(g.sphere, basicMat(0x55ff88));
    eye.scale.setScalar(0.12);
    eye.position.set(0, 0.62, 0.4);
    const legL = new THREE.Mesh(g.box, stdMat(0x333840));
    legL.scale.set(0.15, 0.4, 0.15);
    legL.position.set(-0.25, 0.2, 0);
    const legR = legL.clone();
    legR.position.x = 0.25;
    inner.add(body, eye, legL, legR);
  }
  return { group, inner, mixer: null, actions: {} };
}

// ---------- Game ----------
export class Game {
  constructor(container, ui) {
    this.ui = ui;
    // 軽量化：高DPR端末ではMSAAを省略（解像度で十分滑らか）し、解像度上限を抑える
    const dpr = window.devicePixelRatio || 1;
    const mobile = matchMedia('(pointer:coarse)').matches;
    this.maxDpr = Math.min(dpr, mobile ? 1.5 : 1.75);
    this.renderer = new THREE.WebGLRenderer({ antialias: dpr < 1.5, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(this.maxDpr);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05060c);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
    this.camera.position.set(0, 2, 17);
    this.timer = new THREE.Timer();
    this.particles = new Particles(this.scene);
    this.running = false;
    this.paused = false;
    this.acc = 0;
    this.world = null;
    this.net = null;
    this.disposables = [];
    this.camX = 0;
    this.camY = 2;
    this.camDist = 17;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(t => this.frame(t));
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.camDist = w < h ? 25 : 17;
  }

  halfW() {
    return this.camDist * Math.tan(THREE.MathUtils.degToRad(20)) * this.camera.aspect;
  }

  // ---------------- lifecycle ----------------
  start(cfg) {
    // 後読みモデル（ラスボス・宇邇宮）を使うキャラで未読込なら、読み込み完了を待ってから開始
    if (cfg.kit && DEFERRED_MODELS.includes(cfg.kit.model) && !hasModel(cfg.kit.model) && !cfg._waited) {
      ensureModel(cfg.kit.model).then(() => this.start({ ...cfg, _waited: true }));
      return;
    }
    DEFERRED_MODELS.forEach(m => ensureModel(m));
    this.cleanup();
    this.cfg = cfg;
    const st = this.stage = cfg.stage;
    this.mode = cfg.mode || 'solo';
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.shots = [];
    this.enemies = [];
    this.items = [];
    this.bosses = [];
    this.bossQueue = [];
    this.result = { hidden: [], parts: 0 };
    this.parts = cfg.parts || 0;
    this.capsule = null;
    this.scores = {};
    this.ended = false;
    this.time = 0;
    this.lives = cfg.lives ?? 2;
    this.etanks = cfg.etanks ?? 0;
    this.bossLock = false;
    this.bossTriggered = false;
    this.hiddenTriggered = !st.hidden || cfg.hiddenDone || this.mode !== 'solo';
    this.clearT = -1;
    this.nextBossT = -1;
    this.tipsShown = new Set();
    this.boomCD = 0;
    this.buildLevel(st);
    this.buildScene(st);
    if (cfg.room) {
      this.attachNet(cfg.room, { hostile: !!cfg.hostile, only: cfg.targetPid || null, quiet: !!cfg.quiet });
    }
    this.player = this.makePlayer(cfg.kit, cfg.weapons || [cfg.kit.weapon]);
    this.respawnPlayer(true);
    this.readyT = 1.6;
    this.running = true;
    this.paused = false;
    input.enabled = true;
    input.reset();
    this.ui.hud(true);
    this.ui.setBoss(0, 1, null);
    this.ui.setScore(this.mode === 'versus' ? 'KO 0' : '');
    this.refreshHud();
    // オープニングステージとラスボス最終ステージは共通BGM（F-G-Am-A）
    this.stageTrack = st.id === 'intro' || st.id === 'f4' ? 'hero' : 'main';
    setTrack(this.stageTrack);
    playMusic(1);
    this.ui.banner(st.name, 'stage', 1.5);
    setTimeout(() => {
      if (this.running && !this.ended) {
        this.ui.banner('READY', 'ready', 0.9);
      }
    }, 700);
  }

  cleanup() {
    this.detachNet();
    if (this.world) {
      this.scene.remove(this.world);
      this.world.traverse(o => {
        if (o.isMesh && o.userData.own) {
          o.geometry.dispose();
        }
      });
    }
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
    this.world = null;
    this.particles.clear();
    this.running = false;
  }

  stop() {
    this.cleanup();
    input.enabled = false;
    this.ui.hud(false);
  }

  setPaused(p) {
    this.paused = p;
    input.reset();
    input.enabled = !p && this.running;
  }

  end(kind, data = {}) {
    if (this.ended) {
      return;
    }
    this.ended = true;
    this.running = false;
    input.enabled = false;
    input.reset();
    const res = { ...this.result, ...data, lives: this.lives, etanks: this.etanks };
    if (this.cfg.onEnd) {
      this.cfg.onEnd(kind, res);
    }
  }

  frame(t) {
    this.timer.update(t);
    const dt = Math.min(this.timer.getDelta(), 0.1);
    if (this.running && !this.paused && this.world) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP && n < 6 && this.running && this.world) {
        this.update(STEP);
        input.clearEdges();
        this.acc -= STEP;
        n++;
      }
      if (n >= 6) {
        this.acc = 0;
      }
      if (this.running && this.world) {
        this.updateVisuals(dt);
      }
    }
    // 軽量化：メニュー表示中（非プレイ時）は描画を間引き、タブ非表示時は描画しない
    if (document.hidden) {
      return;
    }
    if (!this.running) {
      this.idleT = (this.idleT || 0) + dt;
      if (this.idleT < 0.25) {
        return;
      }
      this.idleT = 0;
    } else {
      this.adaptQuality(dt);
    }
    this.renderer.render(this.scene, this.camera);
  }

  // 動的解像度：フレーム時間に応じて描画解像度を自動調整（重い端末でも滑らかに）
  adaptQuality(dt) {
    const q = this.quality || (this.quality = { sum: 0, n: 0, t: 0 });
    q.sum += dt;
    q.n++;
    q.t += dt;
    if (q.t < 1.5) {
      return;
    }
    const avg = q.sum / q.n;
    q.sum = q.n = q.t = 0;
    const cur = this.renderer.getPixelRatio();
    let next = cur;
    if (avg > 1 / 48) {
      next = Math.max(0.6, cur - 0.15);
    } else if (avg < 1 / 58 && cur < this.maxDpr) {
      next = Math.min(this.maxDpr, cur + 0.1);
    }
    if (Math.abs(next - cur) > 0.01) {
      this.renderer.setPixelRatio(next);
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
  }

  // ---------------- level ----------------
  buildLevel(st) {
    const R = rng(st.seed);
    const S = this.solids = [];
    const blk = (x0, y0, x1, y1) => S.push({ x0, y0, x1, y1, kind: 'block' });
    const plat = (x0, y, x1) => S.push({ x0, y0: y - 0.3, x1, y1: y, kind: 'plat' });
    this.spawns = [];
    this.itemSpawns = [];
    this.checkpoints = [{ x: 0, y: 0 }];
    this.gate = null;
    this.room = null;
    this.capsuleSpot = null;
    if (st.arena) {
      blk(-22, -10, 22, 0);
      blk(-26, -10, -22, 24);
      blk(22, -10, 26, 24);
      blk(-17, 0, -15.6, 6);
      blk(15.6, 0, 17, 6);
      plat(-12, 3.4, -6);
      plat(6, 3.4, 12);
      plat(-3.5, 6.4, 3.5);
      blk(-1.2, 0, 1.2, 1.4);
      this.arenaSpawns = [[-10, 0], [10, 0], [-19, 0], [19, 0]];
      this.minX = -22;
      this.maxX = 22;
      this.length = 22;
      this.itemSpawns.push({ type: 'hl', x: 0, y: 6.6 }, { type: 'hs', x: -9, y: 3.6 }, { type: 'hs', x: 9, y: 3.6 });
      return;
    }
    const L = st.length;
    blk(-40, -10, -12, 30);
    blk(-12, -10, 12, 0);
    let x = 12;
    let h = 0;
    while (x < L - 6) {
      let gap = 0;
      if (x > 16 && R() < 0.22 && (!st.tutorial || x > 44)) {
        gap = 2 + R() * 1.6;
      }
      x += gap;
      const len = 7 + R() * 8;
      let nh = h;
      if (R() < 0.55) {
        nh = clamp(h + (R() * 3.6 - 1.8), -1.5, 4.5);
      }
      if (gap) {
        nh = clamp(nh, h - 2, h + 1);
      }
      nh = Math.round(nh * 2) / 2;
      blk(x, -10, x + len, nh);
      const r = R();
      if (r < 0.22) {
        plat(x + 1.5, nh + 3.2, x + 5);
        if (R() < 0.5) {
          this.itemSpawns.push({ type: R() < 0.7 ? 'hs' : 'en', x: x + 3.2, y: nh + 3.4 });
        }
      } else if (r < 0.38 && len > 9) {
        blk(x + 2, nh, x + 3, nh + 6);
        blk(x + 5.6, nh, x + 6.6, nh + 7.5);
        const rew = R();
        this.itemSpawns.push({ type: rew < 0.25 ? 'tank' : rew < 0.5 ? 'up' : 'hl', x: x + 6.1, y: nh + 7.7 });
      } else if (r < 0.55) {
        blk(x + len / 2 - 0.7, nh, x + len / 2 + 0.7, nh + 1.6);
      }
      if (st.tutorial && x > 58 && x < 75) {
        blk(x + len - 1.2, nh, x + len, nh + 5);
        plat(x + len - 4.5, nh + 2.8, x + len - 2);
      }
      const cnt = st.density + (R() < 0.5 ? 1 : 0);
      for (let i = 0; i < cnt; i++) {
        const type = st.enemies[Math.floor(R() * st.enemies.length)];
        const ex = x + 2 + R() * (len - 4);
        const fl = ENEMY_TYPES[type] && ENEMY_TYPES[type].fly;
        this.spawns.push({ type, x: ex, y: fl ? nh + 2.5 + R() * 1.5 : nh, done: false });
      }
      // 隠し特殊能力装置：壁蹴りで登る縦穴の頂上
      if (st.part && !this.capsuleSpot && x > L * 0.6 && len > 9 && !gap) {
        const top = nh + 11;
        blk(x + 2, nh + 2.2, x + 3, top - 2.5);
        blk(x + 5.4, nh, x + 6.6, top);
        plat(x + 6.6, top, x + 9.5);
        this.capsuleSpot = { x: x + 8, y: top };
      }
      if (this.checkpoints.length === 1 && x > L * 0.5) {
        this.checkpoints.push({ x: x + 1, y: nh });
      }
      h = nh;
      x += len;
    }
    // narrow corridor -> sealed boss room
    const rx = x;
    const CORR = 18;
    const corrTop = h + 3.2;
    const gateX = rx + CORR;
    const right = gateX + 26;
    const roomTop = h + 13;
    blk(rx, -10, right, h);
    S.push({ x0: rx + 1, y0: corrTop, x1: gateX, y1: h + 60, kind: 'block', ceil: true }); // low corridor ceiling (登れないほど高い)
    S.push({ x0: gateX, y0: roomTop, x1: right, y1: h + 60, kind: 'block', ceil: true }); // room ceiling
    blk(right, h, right + 6, h + 60); // back wall
    plat(gateX + 3, h + 4.2, gateX + 6.5);
    plat(right - 6.5, h + 4.2, right - 3);
    const corrType = st.enemies.find(e => !(ENEMY_TYPES[e] && ENEMY_TYPES[e].fly) && e !== 'mine') || 'walker';
    this.spawns.push({ type: corrType, x: rx + CORR * 0.55, y: h, done: false });
    this.gate = { x0: gateX - 0.7, y0: corrTop, x1: gateX, y1: corrTop, kind: 'block', closedY0: h, openY0: corrTop, active: false };
    this.room = { x0: gateX, x1: right, y: h, top: roomTop, corrTop, cx: (gateX + right) / 2, corrX: rx };
    this.checkpoints.push({ x: rx + 2.5, y: h, gate: true });
    this.sanitizeSpawns();
    this.minX = -12;
    this.maxX = right + 4;
    this.length = right;
  }

  // 敵が壁の中・天井裏・穴の上などに埋まって倒せなくなる配置を除去／補正
  sanitizeSpawns() {
    const blocks = this.solids.filter(s => s.kind === 'block');
    const hits = (x, y, w, hgt) => blocks.find(s => x - w / 2 < s.x1 && x + w / 2 > s.x0 && y < s.y1 && y + hgt > s.y0);
    const out = [];
    for (const sp of this.spawns) {
      const def = ENEMY_TYPES[sp.type] || ENEMY_TYPES.walker;
      let ok = false;
      for (let tries = 0; tries < 8; tries++) {
        if (!def.fly) {
          const g = this.groundAt(sp.x, sp.y + 0.6);
          if (g < sp.y - 2.5) {
            sp.x += 1.5; // 穴の上 → 少しずらす
            continue;
          }
          sp.y = g;
        }
        const s = hits(sp.x, sp.y + 0.02, def.w + 0.2, def.h);
        if (!s) {
          ok = true;
          break;
        }
        sp.x = s.x1 + def.w / 2 + 0.4; // 壁の右側へ押し出す
        if (def.fly) {
          sp.y = Math.max(sp.y, this.groundAt(sp.x) + 2.5);
        }
      }
      if (ok && sp.x > 6) {
        out.push(sp);
      }
    }
    this.spawns = out;
  }

  groundAt(x, fromY = 40) {
    let best = -20;
    for (const s of this.solids) {
      if (!s.ceil && x >= s.x0 && x <= s.x1 && s.y1 <= fromY && s.y1 > best) {
        best = s.y1;
      }
    }
    return best;
  }

  buildScene(st) {
    const scene = this.scene;
    scene.background = new THREE.Color(st.fog);
    scene.fog = new THREE.Fog(st.fog, 30, 95);
    const W = this.world;
    const hemi = new THREE.HemisphereLight(0xbcd4ff, 0x202030, 1.4);
    const dir = new THREE.DirectionalLight(0xffffff, 2.2);
    dir.position.set(-6, 14, 12);
    this.accentLight = new THREE.PointLight(st.accent, 30, 18, 1.6);
    W.add(hemi, dir, this.accentLight);

    // backdrop
    const bgT = getTexture('vb-bg-' + st.bg);
    const bgMat = new THREE.MeshBasicMaterial({ map: bgT, color: 0xc4c8dc, fog: false });
    this.disposables.push(bgMat);
    this.bg = new THREE.Mesh(new THREE.PlaneGeometry(150, 84), bgMat);
    this.bg.userData.own = true;
    this.bg.position.set(0, 14, -48);
    W.add(this.bg);

    // buildings
    const R = rng(st.seed + 99);
    const wt = windowTex();
    const bmat = new THREE.MeshStandardMaterial({ color: 0x1a2030, emissive: 0xffffff, emissiveMap: wt, emissiveIntensity: 0.9, map: wt, roughness: 0.8 });
    this.disposables.push(bmat);
    const g = geo();
    for (let x = this.minX - 20; x < this.maxX + 20; x += 4 + R() * 5) {
      const m = new THREE.Mesh(g.box, bmat);
      const hgt = 6 + R() * 20;
      const wd = 3 + R() * 4;
      m.scale.set(wd, hgt, 3);
      m.position.set(x, hgt / 2 - 8, -10 - R() * 14);
      W.add(m);
      if (R() < 0.4) {
        const b = new THREE.Sprite(spriteMat(R() < 0.5 ? 0xff3344 : st.accent));
        b.position.set(x, hgt - 8 + 0.4, m.position.z + 1.6);
        b.scale.setScalar(0.8);
        W.add(b);
      }
    }

    // solids
    const floorT = getTexture('vb-tile-floor');
    const wallT = getTexture('vb-tile-wall');
    const floorM = new THREE.MeshStandardMaterial({ map: floorT, color: 0xdde2ee, metalness: 0.45, roughness: 0.45, emissive: 0xffffff, emissiveMap: floorT, emissiveIntensity: 0.12 });
    const wallM = new THREE.MeshStandardMaterial({ map: wallT, color: 0xb8c0d4, metalness: 0.4, roughness: 0.55, emissive: 0xffffff, emissiveMap: wallT, emissiveIntensity: 0.18 });
    const edgeM = new THREE.MeshBasicMaterial({ color: st.accent, toneMapped: false });
    this.disposables.push(floorM, wallM, edgeM);
    const mats = [wallM, wallM, floorM, wallM, wallM, wallM];
    for (const s of this.solids) {
      const w = s.x1 - s.x0;
      const hh = s.y1 - s.y0;
      const d = s.kind === 'plat' ? 2.4 : 4.4;
      const bg = new THREE.BoxGeometry(w, hh, d);
      boxUV(bg, w, hh, d);
      const m = new THREE.Mesh(bg, mats);
      m.userData.own = true;
      m.position.set((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, -1);
      W.add(m);
      if (s.y1 < 25) {
        const eg = new THREE.BoxGeometry(w, 0.06, 0.06);
        const e = new THREE.Mesh(eg, edgeM);
        e.userData.own = true;
        e.position.set((s.x0 + s.x1) / 2, s.y1, -1 + d / 2);
        W.add(e);
      }
    }
    if (this.gate) {
      const gt = this.gate;
      this.gateH = gt.openY0 - gt.closedY0;
      const gg = new THREE.BoxGeometry(0.7, this.gateH, 3);
      const gm = new THREE.MeshStandardMaterial({ color: 0x404858, emissive: 0xff2233, emissiveIntensity: 0.5, metalness: 0.7, roughness: 0.3, map: getTexture('vb-bossroom-wall') });
      this.disposables.push(gm);
      this.gateMesh = new THREE.Mesh(gg, gm);
      this.gateMesh.userData.own = true;
      this.gateMesh.position.set((gt.x0 + gt.x1) / 2, gt.y0 + this.gateH / 2, -1);
      W.add(this.gateMesh);
      this.buildBossRoomDecor(st);
    }
    for (const it of this.itemSpawns) {
      this.spawnItem(it.type, it.x, it.y, false);
    }
    if (this.capsuleSpot && st.part && !(this.parts & st.part) && (this.mode === 'solo' || this.mode === 'coop')) {
      this.buildCapsule(this.capsuleSpot.x, this.capsuleSpot.y, st.part);
    }
  }

  buildCapsule(x, y, bit) {
    const info = PARTS[bit];
    const g = new THREE.Group();
    const baseM = new THREE.MeshStandardMaterial({ color: 0x2a3040, metalness: 0.9, roughness: 0.25 });
    const glowM = new THREE.MeshBasicMaterial({ color: info.color, toneMapped: false });
    const glassM = new THREE.MeshPhysicalMaterial({ color: info.color, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0, emissive: info.color, emissiveIntensity: 0.4, depthWrite: false });
    this.disposables.push(baseM, glowM, glassM);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 0.4, 24), baseM);
    base.position.y = 0.2;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.07, 8, 32), glowM);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.42;
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 2.6, 24, 1, true), glassM);
    glass.position.y = 1.7;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.1, 0.4, 24), baseM);
    cap.position.y = 3.2;
    const ring2 = ring.clone();
    ring2.position.y = 2.98;
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), glowM);
    core.position.y = 1.7;
    const halo = new THREE.Sprite(spriteMat(info.color));
    halo.scale.setScalar(3.2);
    halo.position.y = 1.7;
    const light = new THREE.PointLight(info.color, 25, 9, 1.5);
    light.position.set(0, 1.8, 1.5);
    [base, ring, glass, cap, ring2, core].forEach(m => {
      m.userData.own = true;
    });
    g.add(base, ring, glass, cap, ring2, core, halo, light);
    g.position.set(x, y, -0.6);
    this.world.add(g);
    this.capsule = { x, y, bit, group: g, core, used: false };
  }

  updateCapsule(dt) {
    const c = this.capsule;
    if (!c || c.used) {
      return;
    }
    c.core.rotation.y += dt * 2;
    c.core.position.y = 1.7 + Math.sin(this.time * 3) * 0.15;
    const p = this.player;
    if (!p.dead && Math.abs(p.x - c.x) < 0.9 && p.y >= c.y - 0.2 && p.y < c.y + 2.5) {
      c.used = true;
      this.parts |= c.bit;
      this.result.parts |= c.bit;
      const info = PARTS[c.bit];
      play('item');
      play('full');
      this.particles.emit(c.x, c.y + 1.7, info.color, 40, { ring: true, speed: 6, life: 1.2, size: 1 });
      this.particles.emit(p.x, p.y + 1, 0xffffff, 20, { speed: 4, life: 0.8 });
      this.ui.banner('POWER UP!', 'clear', 2.4);
      this.ui.toast(`特殊能力装置：${info.name} ── ${info.desc}`, 4.5);
      c.core.visible = false;
      p.hp = p.max;
      this.refreshHud();
    }
  }

  buildBossRoomDecor(st) {
    const W = this.world;
    const rm = this.room;
    const own = m => {
      m.userData.own = true;
      W.add(m);
      return m;
    };
    const roomW = rm.x1 - rm.x0;
    const roomH = rm.top - rm.y;
    // 部屋の奥壁
    const bt = getTexture('vb-bossroom-wall');
    const bossT = bt ? bt.clone() : null;
    if (bossT) {
      bossT.repeat.set(roomW / 6, roomH / 6);
      bossT.needsUpdate = true;
    }
    const backM = new THREE.MeshStandardMaterial({ map: bossT, color: 0xb0b4c4, emissive: 0xffffff, emissiveMap: bossT, emissiveIntensity: 0.35, metalness: 0.5, roughness: 0.5 });
    const back = own(new THREE.Mesh(new THREE.PlaneGeometry(roomW, roomH), backM));
    back.position.set(rm.cx, rm.y + roomH / 2, -3.15);
    // 通路の奥壁（暗め）
    const corrW = rm.x0 - rm.corrX;
    const wt = getTexture('vb-tile-wall');
    const corrT = wt ? wt.clone() : null;
    if (corrT) {
      corrT.repeat.set(corrW / 3.2, 1);
      corrT.needsUpdate = true;
    }
    const corrM = new THREE.MeshStandardMaterial({ map: corrT, color: 0x707890, emissive: 0xffffff, emissiveMap: corrT, emissiveIntensity: 0.25 });
    const cw = own(new THREE.Mesh(new THREE.PlaneGeometry(corrW, 3.2), corrM));
    cw.position.set(rm.corrX + corrW / 2, rm.y + 1.6, -3.15);
    // 発光ライン・柱・天井ライト
    const red = new THREE.MeshBasicMaterial({ color: 0xff2a3a, toneMapped: false });
    const acc = new THREE.MeshBasicMaterial({ color: st.accent, toneMapped: false });
    const pillarM = new THREE.MeshStandardMaterial({ color: 0x2a2e3a, metalness: 0.85, roughness: 0.3 });
    this.disposables.push(backM, corrM, red, acc, pillarM);
    for (let x = rm.corrX + 2; x < rm.x0 - 1; x += 3) {
      const l = own(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.3), acc));
      l.position.set(x, rm.y + 3.12, 0.6);
    }
    for (const px of [rm.x0 + 0.6, rm.x1 - 0.6, rm.cx - 6, rm.cx + 6]) {
      const pl = own(new THREE.Mesh(new THREE.BoxGeometry(1, roomH, 1), pillarM));
      pl.position.set(px, rm.y + roomH / 2, -2.6);
      const st2 = own(new THREE.Mesh(new THREE.BoxGeometry(0.15, roomH - 1, 0.1), red));
      st2.position.set(px, rm.y + roomH / 2, -2.05);
    }
    for (let x = rm.x0 + 3; x < rm.x1 - 2; x += 4) {
      const lamp = own(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 0.8), red));
      lamp.position.set(x, rm.top - 0.1, -1);
    }
    const glow = new THREE.PointLight(0xff3344, 40, 26, 1.4);
    glow.position.set(rm.cx, rm.top - 2, 3);
    W.add(glow);
    // 入口の警告サイン
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#1a0006';
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#ff2a3a';
    for (let i = -2; i < 12; i++) {
      g.beginPath();
      g.moveTo(i * 24, 64);
      g.lineTo(i * 24 + 12, 64);
      g.lineTo(i * 24 + 28, 48);
      g.lineTo(i * 24 + 16, 48);
      g.fill();
    }
    g.font = 'bold 34px "Russo One", sans-serif';
    g.textAlign = 'center';
    g.fillText('⚠ DANGER ⚠', 128, 38);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const signM = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    this.disposables.push(tex, signM);
    const sign = own(new THREE.Mesh(new THREE.PlaneGeometry(4, 1), signM));
    sign.position.set(rm.x0 - 2.6, rm.y + 2.3, -3.1);
  }

  // ---------------- physics ----------------
  overlap(b, s) {
    return b.x - b.w / 2 < s.x1 && b.x + b.w / 2 > s.x0 && b.y < s.y1 && b.y + b.h > s.y0;
  }

  blocks() {
    return this.gate && this.gate.active ? this.solids.concat([this.gate]) : this.solids;
  }

  moveBody(b, dt) {
    const S = this.blocks();
    b.x += b.vx * dt;
    b.hitWall = 0;
    for (const s of S) {
      if (s.kind !== 'block' || !this.overlap(b, s)) {
        continue;
      }
      if (b.x < (s.x0 + s.x1) / 2) {
        b.x = s.x0 - b.w / 2 - 0.001;
        b.hitWall = 1;
      } else {
        b.x = s.x1 + b.w / 2 + 0.001;
        b.hitWall = -1;
      }
    }
    const oldY = b.y;
    b.y += b.vy * dt;
    b.onGround = false;
    for (const s of S) {
      if (s.kind === 'plat') {
        if (b.vy <= 0 && oldY >= s.y1 - 0.02 && b.y < s.y1 && b.x + b.w / 2 > s.x0 && b.x - b.w / 2 < s.x1) {
          b.y = s.y1;
          b.vy = 0;
          b.onGround = true;
        }
        continue;
      }
      if (!this.overlap(b, s)) {
        continue;
      }
      if (b.vy <= 0 && oldY >= s.y1 - 0.3) {
        b.y = s.y1;
        b.vy = 0;
        b.onGround = true;
      } else if (b.vy > 0) {
        b.y = s.y0 - b.h - 0.001;
        b.vy = 0;
      } else {
        b.y = s.y1;
        b.onGround = true;
      }
    }
  }

  touching(b, dir) {
    const t = { x: b.x + dir * 0.08, y: b.y + 0.2, w: b.w, h: b.h - 0.4 };
    return this.blocks().some(s => s.kind === 'block' && this.overlap(t, s));
  }

  pointSolid(x, y) {
    return this.blocks().some(s => s.kind === 'block' && x > s.x0 && x < s.x1 && y > s.y0 && y < s.y1);
  }

  // ---------------- player ----------------
  makeRig(kit) {
    const isMech = kit.model === 'boss-mech';
    const rig = makeModel(isMech ? 'enemy-walker' : kit.model, {
      height: kit.height || 1.75,
      tint: isMech ? kit.tint : null,
      emissive: kit.emissive || (isMech ? kit.tint : null),
    });
    rig.glow = new THREE.Sprite(spriteMat(0xffffff));
    rig.glow.visible = false;
    rig.group.add(rig.glow);
    if (kit.flail) {
      // 運営キャラ：背中から鎖でつながったトゲ鉄球
      const g = geo();
      const H = kit.height || 1.75;
      const steel = new THREE.MeshStandardMaterial({ color: 0x3a3d44, metalness: 0.9, roughness: 0.3 });
      const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dde4, metalness: 1, roughness: 0.15 });
      this.disposables.push(steel, chrome);
      const ball = new THREE.Mesh(g.sphere, steel);
      ball.scale.setScalar(H * 0.2);
      for (let k = 0; k < 10; k++) {
        const s = new THREE.Mesh(g.cone, chrome);
        const phi = Math.acos(1 - 2 * (k + 0.5) / 10);
        const th = k * 2.4;
        const v = new THREE.Vector3(Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th));
        s.position.copy(v).multiplyScalar(1.05);
        s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
        s.scale.set(0.35, 0.6, 0.35);
        ball.add(s);
      }
      const base = new THREE.Vector3(-H * 0.05, H * 1.15, -H * 0.25);
      ball.position.copy(base);
      const beads = [];
      for (let k = 1; k <= 7; k++) {
        const b = new THREE.Mesh(g.sphere, chrome);
        b.scale.setScalar(H * 0.035);
        beads.push(b);
        rig.group.add(b);
      }
      const anchor = new THREE.Vector3(0, H * 0.75, -H * 0.2);
      ball.onBeforeRender = () => {
        const t = performance.now() / 1000;
        ball.position.set(base.x + Math.sin(t * 1.7) * H * 0.06, base.y + Math.sin(t * 2.3) * H * 0.05, base.z);
        ball.rotation.y = t * 1.2;
        beads.forEach((b, i) => {
          const k = (i + 1) / 8;
          b.position.lerpVectors(anchor, ball.position, k);
          b.position.y += Math.sin(k * Math.PI) * H * 0.12;
        });
      };
      rig.group.add(ball);
      rig.flail = ball;
    }
    this.world.add(rig.group);
    return rig;
  }

  makePlayer(kit, weapons) {
    const p = {
      kit, rig: this.makeRig(kit), x: 0, y: 0, w: 0.7, h: Math.min(1.7, (kit.height || 1.75) * 0.9),
      vx: 0, vy: 0, onGround: false, dir: 1, hp: kit.hp, max: kit.hp, inv: 0,
      dashT: 0, dashCarry: false, kickT: 0, wallDir: 0, wall: 0, charge: 0, chargeLv: 0,
      shootT: 0, shootAnim: 0, combo: 0, comboT: 0, slashT: 0, hurtT: 0, dead: false, deathT: 0,
      weapons: [...new Set(weapons)], wi: new Set(weapons).size > 1 ? 1 : 0, energy: {}, lastHitBy: null, cp: 0,
    };
    p.weapons.forEach(w => {
      p.energy[w] = MAX_EN;
    });
    return p;
  }

  respawnPlayer(first) {
    const p = this.player;
    let sx;
    let sy;
    if (this.stage.arena) {
      const ids = [myId, ...Object.keys(this.net ? this.net.room.peers : {})].sort();
      const idx = first ? Math.max(0, ids.indexOf(myId)) : Math.floor(Math.random() * 4);
      const sp = this.arenaSpawns[idx % 4];
      sx = sp[0];
      sy = sp[1];
    } else {
      const c = this.checkpoints[p.cp];
      sx = c.x;
      sy = this.groundAt(c.x);
    }
    Object.assign(p, { x: sx, y: sy + 0.05, vx: 0, vy: 0, hp: p.max, dead: false, inv: 2, dashT: 0, kickT: 0, hurtT: 0, charge: 0, dashCarry: false });
    p.rig.group.visible = true;
    this.camX = sx;
    this.camY = sy + 2;
    this.refreshHud();
  }

  refreshHud() {
    const p = this.player;
    if (!p) {
      return;
    }
    const w = p.weapons[p.wi];
    const def = WEAPONS[w] || { name: w, color: 0xffffff };
    this.ui.setHP(p.hp, p.max);
    this.ui.setWeapon(def.name, def.color, p.energy[w], MAX_EN, p.wi === 0);
    this.ui.setLives(this.mode === 'versus' ? null : this.lives);
    this.ui.setTanks(this.etanks);
  }

  updatePlayer(p, dt) {
    if (p.dead) {
      p.deathT -= dt;
      if (p.deathT <= 0) {
        if (this.mode === 'versus') {
          this.respawnPlayer(false);
        } else if (this.mode === 'invader') {
          this.end('invadeEnd', { win: false });
        } else if (this.lives < 0) {
          this.end('gameover');
        } else {
          this.resetBossFight();
          this.respawnPlayer(false);
        }
      }
      return;
    }
    const frozen = this.readyT > 0 || this.clearT >= 0;
    const L = !frozen && input.isDown('left');
    const Rr = !frozen && input.isDown('right');
    const mv = (Rr ? 1 : 0) - (L ? 1 : 0);
    if (p.hurtT > 0) {
      p.hurtT -= dt;
      p.vx = -p.dir * 2.5;
    } else {
      if (mv) {
        p.dir = mv;
      }
      if (!frozen && input.wasPressed('dash') && p.onGround) {
        p.dashT = 0.4;
        play('dash');
        this.particles.emit(p.x - p.dir * 0.4, p.y + 0.1, 0x9fdcff, 6, { speed: 2, life: 0.3, size: 0.5 });
      }
      if (p.dashT > 0) {
        p.dashT -= dt;
        if (!input.isDown('dash')) {
          p.dashT = 0;
        }
      }
      const boost = p === this.player && (this.parts & 2) ? 1.22 : 1;
      const speed = (p.dashCarry ? 10 : 5.6) * boost;
      if (p.kickT > 0) {
        p.kickT -= dt;
        p.vx = -p.wallDir * (p.dashCarry ? 10 : 6);
      } else if (p.onGround && p.dashT > 0) {
        p.vx = p.dir * 11 * boost;
        if (Math.random() < 0.5) {
          this.particles.emit(p.x - p.dir * 0.5, p.y + 0.1, 0x7fc8ff, 1, { speed: 1, life: 0.25, size: 0.4 });
        }
      } else {
        p.vx = mv * speed;
      }
      p.wall = 0;
      if (!p.onGround && mv !== 0 && p.vy < 0.5 && this.touching(p, mv)) {
        p.wall = mv;
        p.dir = -mv; // 壁ずり中は壁と反対側を向き、攻撃も反対側へ
        if (p.vy < -3.2) {
          p.vy = -3.2;
        }
        if (Math.random() < 0.3) {
          this.particles.emit(p.x + mv * 0.35, p.y + 1.4, 0xffffff, 1, { speed: 0.5, life: 0.3, size: 0.25 });
        }
      }
      if (!frozen && input.wasPressed('jump')) {
        if (p.onGround) {
          p.vy = (this.parts & 1) ? 15.8 : 13.5;
          p.dashCarry = p.dashT > 0;
          play('jump');
        } else {
          const wd = this.touching(p, 1) ? 1 : this.touching(p, -1) ? -1 : 0;
          if (wd) {
            p.vy = (this.parts & 1) ? 14 : 12.5;
            p.kickT = 0.14;
            p.wallDir = wd;
            p.dir = -wd;
            p.dashCarry = input.isDown('dash');
            play('jump');
            this.particles.emit(p.x + wd * 0.35, p.y + 1, 0xffffff, 6, { speed: 3, life: 0.25, size: 0.3 });
          }
        }
      }
      if (input.wasReleased('jump') && p.vy > 0) {
        p.vy *= 0.4;
      }
    }
    p.vy = Math.max(-20, p.vy + GRAV * dt);
    this.moveBody(p, dt);
    if (p.onGround) {
      p.dashCarry = false;
    }
    if (!frozen) {
      this.handleWeapon(p, dt);
      if ((input.wasPressed('next') || input.wasPressed('prev')) && p.weapons.length > 1) {
        // 特殊武器のみを巡回（通常武器はショットボタンで常時使用）
        this.selectSpecial(p.wi + (input.wasPressed('next') ? 1 : -1));
      }
      if (input.wasPressed('tank') && this.etanks > 0 && p.hp < p.max && this.mode !== 'versus') {
        this.etanks--;
        p.hp = p.max;
        play('item');
        this.particles.emit(p.x, p.y + 1, 0x66ffcc, 16, { ring: true, speed: 3, life: 0.6 });
        this.refreshHud();
      }
    }
    p.inv -= dt;
    if (p.y < -14) {
      p.hp = 0;
      this.killPlayer();
    }
    // checkpoints
    for (let i = p.cp + 1; i < this.checkpoints.length; i++) {
      if (p.x > this.checkpoints[i].x) {
        p.cp = i;
      }
    }
  }

  selectSpecial(idx) {
    const p = this.player;
    const n = p.weapons.length - 1;
    if (!p || n < 1) {
      return;
    }
    p.wi = ((((idx - 1) % n) + n) % n) + 1;
    play('select');
    this.refreshHud();
  }

  handleWeapon(p, dt) {
    const w = p.weapons[0];
    if (input.wasPressed('special')) {
      if (p.weapons.length > 1 && p.wi > 0) {
        if (p.shootT <= 0) {
          this.fire(p, p.weapons[p.wi], 0, p.wi);
        }
      } else {
        play('buzz');
      }
    }
    p.shootT -= dt;
    p.comboT -= dt;
    p.slashT -= dt;
    p.shootAnim -= dt;
    if (input.isDown('shoot')) {
      p.charge += dt;
      const lv = p.charge > 1.4 ? 2 : p.charge > 0.6 ? 1 : 0;
      if (lv > p.chargeLv) {
        play(lv === 2 ? 'full' : 'charge');
      }
      p.chargeLv = lv;
    }
    if (input.wasPressed('shoot')) {
      if (w === 'saber') {
        this.slash(p);
      } else if (p.shootT <= 0) {
        this.fire(p, w, 0);
      }
    }
    if (input.wasReleased('shoot')) {
      const c = p.charge;
      p.charge = 0;
      p.chargeLv = 0;
      if (w === 'saber') {
        if (c > 1.2) {
          this.fire(p, 'wave', 1);
        }
      } else if (c > 0.6) {
        this.fire(p, w, c > 1.4 ? 2 : 1);
      }
    }
  }

  fire(p, type, level, idx = 0) {
    const w = p.weapons[idx];
    const free = idx === 0;
    if (!free && type !== 'wave') {
      const cost = level ? 3 : 1;
      if (p.energy[w] < cost) {
        play('buzz');
        return;
      }
      p.energy[w] -= cost;
      this.refreshHud();
    }
    if (!['buster', 'wave'].includes(type) && level === 2) {
      level = 1;
    }
    p.shootT = 0.14;
    p.shootAnim = 0.3;
    const x = p.x + p.dir * 0.7;
    const y = p.y + p.h * 0.6;
    this.spawnShot('ally', type, x, y, p.dir, level, myId);
    this.muzzleFx(type, x, y, p.dir, level);
    this.emitShot(type, x, y, p.dir, level);
    play(type === 'buster' ? 'shot' : 'zap');
  }

  slash(p) {
    p.combo = p.comboT > 0 ? (p.combo + 1) % 3 : 0;
    p.comboT = 0.5;
    p.slashT = 0.25;
    const x = p.x + p.dir * 0.9;
    const y = p.y + p.h * 0.55;
    const sh = this.spawnShot('ally', 'slash', x, y, p.dir, p.combo, myId);
    sh.follow = p;
    // 連撃ごとに異なる斬撃エフェクト
    const cols = [0x66ff99, 0x99ffcc, 0xffffff];
    const n = [6, 8, 14][p.combo];
    for (let k = 0; k < n; k++) {
      const a = (p.combo === 0 ? 1 : p.combo === 1 ? -1 : 0) * 0.6 + (k / (n - 1) - 0.5) * Math.PI * 0.9;
      this.particles.emit(p.x + p.dir * Math.cos(a) * 1.1, y + Math.sin(a) * 1.1, cols[p.combo], 1, { speed: 1.5, life: 0.22, size: 0.4 + p.combo * 0.1 });
    }
    if (p.combo === 2) {
      this.particles.emit(x, y, 0x66ff99, 12, { ring: true, speed: 5, life: 0.25, size: 0.4 });
      this.shake(0.06);
    }
    this.emitShot('slash', x, y, p.dir, p.combo);
    play('slash');
  }

  hurtPlayer(dmg, by = null) {
    const p = this.player;
    if (p.dead || p.inv > 0 || this.readyT > 0 || this.clearT >= 0) {
      return;
    }
    if (this.parts & 8) {
      dmg = Math.max(1, Math.ceil(dmg * 0.5));
      this.showBarrier(p);
    }
    p.hp -= Math.round(dmg);
    p.lastHitBy = by;
    p.inv = 1.2;
    p.hurtT = 0.3;
    p.dashT = 0;
    p.charge = 0;
    play('hurt');
    this.particles.emit(p.x, p.y + 1, 0xffffff, 8, { speed: 4, life: 0.3 });
    this.refreshHud();
    if (p.hp <= 0) {
      this.killPlayer();
    }
  }

  showBarrier(p) {
    if (!p.barrier) {
      const m = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1.15, 2),
        new THREE.MeshBasicMaterial({ color: 0xc77dff, transparent: true, opacity: 0.5, wireframe: true, toneMapped: false, depthWrite: false }),
      );
      const shell = new THREE.Mesh(
        new THREE.SphereGeometry(1.1, 24, 16),
        new THREE.MeshBasicMaterial({ color: 0x9a6bff, transparent: true, opacity: 0.18, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      m.add(shell);
      m.userData.own = true;
      shell.userData.own = true;
      this.disposables.push(m.material, shell.material);
      p.rig.group.add(m);
      p.barrier = m;
    }
    p.barrierT = 0.7;
    p.barrier.position.set(0, p.h * 0.55, 0);
    this.particles.emit(p.x, p.y + p.h * 0.55, 0xc77dff, 16, { ring: true, speed: 4, life: 0.4, size: 0.6 });
    play('deflect');
  }

  killPlayer() {
    const p = this.player;
    if (p.dead) {
      return;
    }
    p.dead = true;
    p.hp = 0;
    p.deathT = 2.2;
    p.rig.group.visible = false;
    play('boom');
    const col = p.kit.color || 0x66ccff;
    this.particles.emit(p.x, p.y + 1, col, 16, { ring: true, speed: 5, life: 1.4, size: 0.8 });
    this.particles.emit(p.x, p.y + 1, 0xffffff, 16, { ring: true, speed: 2.5, life: 1.4, size: 0.6 });
    if (this.mode !== 'versus') {
      this.lives--;
    }
    if (this.net && (this.mode === 'versus' || this.mode === 'invader' || this.net.only) && p.lastHitBy && p.lastHitBy !== 'boss') {
      this.net.room.emit('ko', { killer: p.lastHitBy, victim: myId });
      this.onKO({ killer: p.lastHitBy, victim: myId });
    }
    this.refreshHud();
  }

  // ---------------- shots ----------------
  spawnShot(team, type, x, y, dir, level = 0, owner = null, opts = {}) {
    const g = geo();
    const sh = { team, type, x, y, vx: 0, vy: 0, dir, level, owner, dmg: 1, r: 0.2, life: 1.6, pierce: false, walls: true, hit: new Set(), t: 0, beh: null };
    let vis = 'orb';
    let color = (WEAPONS[type] && WEAPONS[type].color) || 0xffffff;
    const ang = opts.angle;
    const setV = s => {
      if (ang !== undefined) {
        sh.vx = Math.cos(ang) * s;
        sh.vy = Math.sin(ang) * s;
      } else {
        sh.vx = dir * s;
      }
    };
    switch (type) {
      case 'buster': {
        const L = [[16, 1, 0.18, 0xfff27a], [17, 2, 0.36, 0x7fffd0], [18, 4, 0.62, 0x6fd8ff]][level];
        setV(L[0]);
        sh.dmg = L[1];
        sh.r = L[2];
        color = L[3];
        sh.pierce = level === 2;
        sh.walls = level < 2;
        break;
      }
      case 'wave':
        setV(14); sh.dmg = 3; sh.r = 0.7; sh.pierce = true; sh.walls = false; vis = 'crescent'; color = 0x66ff99; break;
      case 'slash':
        sh.life = 0.16; sh.dmg = [2, 2, 3][level] || 2; sh.r = 1.05; sh.pierce = true; sh.walls = false; vis = 'crescent'; color = 0x66ff99; break;
      case 'fire':
        setV(9); sh.dmg = level ? 4 : 2; sh.r = level ? 0.6 : 0.35; sh.beh = 'fire'; break;
      case 'ice':
        setV(18); sh.dmg = level ? 4 : 2; sh.r = 0.3; sh.pierce = !!level; vis = 'shard'; break;
      case 'homing':
        setV(8); sh.dmg = level ? 3 : 1.5; sh.r = 0.3; sh.beh = 'homing'; sh.life = 2.4; sh.walls = false; break;
      case 'spark':
        sh.vx = dir * 7; sh.vy = 5; sh.dmg = level ? 4 : 2; sh.r = level ? 0.6 : 0.35; sh.beh = 'bounce'; sh.life = 2.6; sh.walls = false; break;
      case 'spikebomb':
        // トゲトゲボム：放物線で放ち、地面で数回バウンドしてから爆発
        sh.vx = dir * (level ? 8 : 6.5); sh.vy = level ? 7 : 6; sh.dmg = level ? 4 : 2; sh.r = level ? 0.6 : 0.45;
        sh.beh = 'spikebounce'; sh.bounces = level ? 4 : 3; sh.life = 3.2; sh.walls = false; sh.pierce = !!level; vis = 'spikeball'; break;
      case 'quake':
        sh.y = this.groundAt(x, y + 0.5); setV(10); sh.vy = 0; sh.dmg = level ? 5 : 3; sh.r = 0.8; sh.pierce = true; sh.walls = true; sh.life = 1.2; vis = 'pillar'; sh.beh = 'quake'; break;
      case 'boomerang':
        setV(15); sh.dmg = 2; sh.r = 0.45; sh.pierce = true; sh.walls = false; sh.beh = 'boomer'; sh.life = 1.6; vis = 'blade'; break;
      case 'laser':
        setV(38); sh.dmg = level ? 4 : 2; sh.r = 0.3; sh.pierce = true; sh.walls = false; vis = 'beam'; sh.life = 0.8; break;
      case 'spread': {
        const base = ang !== undefined ? ang : dir > 0 ? 0 : Math.PI;
        const n = level ? 5 : 3;
        let last = null;
        for (let i = 0; i < n; i++) {
          const a = base + (i - (n - 1) / 2) * 0.28;
          last = this.spawnShot(team, 'spreadp', x, y, dir, 0, owner, { angle: a });
        }
        return last;
      }
      case 'spreadp':
        setV(12); sh.dmg = 1.5; sh.r = 0.25; color = WEAPONS.spread.color; break;
      case 'orb':
      default:
        setV(opts.speed || 7); sh.dmg = 2; sh.r = 0.22; color = opts.color || 0xff4466; break;
    }
    if (opts.color && type !== 'orb') {
      color = opts.color;
    }
    if (opts.ov) {
      Object.assign(sh, opts.ov);
    }
    const src = team === 'foe' ? this.shotSrc : null; // 発射中の雑魚／ボス
    if (sh.fixed) {
      // 固定ダメージ（爆風など）
    } else if (team === 'foe' && owner === 'boss') {
      if (src && src.kind === 'enemy') {
        sh.fromEnemy = true;
        // 雑魚弾：控えめな固定ダメージ（ステージ進行で少し上昇）
        sh.dmg = Math.min(sh.dmg, 2) * this.enemyDmgScale();
        if (type === 'laser') sh.dmg = 3 * this.enemyDmgScale();
        sh.dmg = Math.max(1, Math.round(sh.dmg));
      } else {
        sh.dmg = Math.min(6, Math.ceil(sh.dmg * 1.2) + 1);
      }
    }
    const od = team === 'ally' && owner === myId && (this.parts & 4) && this.mode !== 'versus';
    if (od) {
      sh.dmg *= 1.5;
      sh.r *= 1.3;
    }
    sh.color = color;
    let mesh;
    const shape = opts.shape || (src && type === 'orb' && (!opts.ov || ['bomb', 'arc', 'delay'].includes(opts.ov.beh)) ? src.shape : null);
    if (shape) {
      mesh = this.shapeMesh(shape, color, sh);
    } else if (vis === 'crescent') {
      mesh = new THREE.Mesh(g.crescent, basicMat(color));
      mesh.scale.setScalar(sh.r * 1.2);
      mesh.scale.x *= dir;
      if (type === 'slash') {
        mesh.rotation.z = [0.4, -0.4, 0][level] || 0;
      }
    } else if (vis === 'shard') {
      mesh = new THREE.Mesh(g.shard, basicMat(color));
      mesh.scale.setScalar(0.6);
      mesh.rotation.z = Math.atan2(sh.vy, sh.vx);
    } else if (vis === 'pillar') {
      mesh = new THREE.Mesh(g.pillar, basicMat(color));
    } else if (vis === 'beam') {
      mesh = new THREE.Mesh(g.beam, basicMat(color));
      mesh.rotation.z = Math.atan2(sh.vy, sh.vx);
    } else if (vis === 'blade') {
      mesh = new THREE.Mesh(g.crescent, basicMat(color));
      mesh.scale.setScalar(0.55);
    } else if (vis === 'spikeball') {
      mesh = new THREE.Mesh(g.sphere, basicMat(0x2a2a30));
      mesh.scale.setScalar(sh.r * 0.8);
      if (!g.spikeCone) g.spikeCone = new THREE.ConeGeometry(0.35, 0.9, 6);
      const dirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[1,1,1],[-1,1,1],[1,-1,1],[-1,-1,1],[1,1,-1],[-1,1,-1],[1,-1,-1],[-1,-1,-1]];
      const up = new THREE.Vector3(0, 1, 0);
      for (const d of dirs) {
        const v = new THREE.Vector3(...d).normalize();
        const s = new THREE.Mesh(g.spikeCone, basicMat(color));
        s.position.copy(v).multiplyScalar(1.15);
        s.quaternion.setFromUnitVectors(up, v);
        mesh.add(s);
      }
    } else {
      mesh = new THREE.Mesh(g.sphere, basicMat(0xffffff));
      mesh.scale.setScalar(sh.r * 0.7);
    }
    const gl = new THREE.Sprite(spriteMat(color));
    gl.scale.setScalar(shape ? 2.6 / Math.max(0.05, mesh.scale.x) * sh.r : vis === 'orb' ? 6 : 3);
    mesh.add(gl);
    if (od) {
      // オーバードライブ：金色の二重オーラ＋スパーク
      mesh.scale.multiplyScalar(1.3);
      const aura = new THREE.Sprite(spriteMat(0xffcc33));
      aura.scale.setScalar(vis === 'orb' ? 9 : 5);
      const aura2 = new THREE.Sprite(spriteMat(0xff66ee));
      aura2.scale.setScalar(vis === 'orb' ? 4 : 2.4);
      mesh.add(aura, aura2);
      sh.od = true;
    }
    mesh.position.set(sh.x, sh.y, 0.3);
    sh.mesh = mesh;
    this.world.add(mesh);
    this.shots.push(sh);
    return sh;
  }

  // 敵ごとの弾の形状
  shapeMesh(shape, color, sh) {
    const g = geo();
    const r = sh.r;
    let m;
    const core = (geom, s) => {
      const c = new THREE.Mesh(geom, basicMat(0xffffff));
      c.scale.setScalar(s);
      return c;
    };
    switch (shape) {
      case 'cube':
        m = new THREE.Mesh(g.box, basicMat(color));
        m.scale.setScalar(r * 1.5);
        m.add(core(g.box, 0.55));
        sh.spinV = [3, 5, 0];
        break;
      case 'diamond':
        m = new THREE.Mesh(g.oct, basicMat(color));
        m.scale.set(r * 0.9, r * 1.5, r * 0.9);
        m.add(core(g.oct, 0.5));
        sh.spinV = [0, 6, 0];
        break;
      case 'ring':
        m = new THREE.Mesh(g.torus, basicMat(color));
        m.scale.setScalar(r * 1.3);
        m.add(core(g.sphere, 0.3));
        sh.spinV = [0, 0, 8];
        break;
      case 'spike':
        m = new THREE.Mesh(g.cone, basicMat(color));
        m.scale.set(r * 1.1, r * 3, r * 1.1);
        m.add(core(g.cone, 0.5));
        sh.faceVel = true;
        break;
      case 'needle':
        m = new THREE.Mesh(g.cone, basicMat(color));
        m.scale.set(r * 0.5, r * 4.5, r * 0.5);
        sh.faceVel = true;
        break;
      case 'bomb': {
        m = new THREE.Mesh(g.sphere, basicMat(0x222222));
        m.scale.setScalar(r * 1.2);
        const fuse = new THREE.Mesh(g.sphere, basicMat(color));
        fuse.scale.setScalar(0.35);
        fuse.position.y = 1;
        m.add(fuse);
        sh.spinV = [0, 0, 3];
        break;
      }
      case 'shell':
        m = new THREE.Mesh(g.sphere, basicMat(color));
        m.scale.set(r * 1.8, r * 1.0, r * 1.0);
        m.add(core(g.sphere, 0.5));
        sh.faceVel = true;
        break;
      case 'star':
        m = new THREE.Mesh(g.ico, basicMat(color));
        m.scale.setScalar(r * 1.4);
        m.add(core(g.ico, 0.5));
        sh.spinV = [4, 4, 4];
        break;
      case 'shuriken': {
        m = new THREE.Group();
        for (let k = 0; k < 4; k++) {
          const b = new THREE.Mesh(g.cone, basicMat(color));
          b.scale.set(0.35, 1.2, 0.2);
          b.rotation.z = (k / 4) * Math.PI * 2;
          b.position.set(Math.sin(-b.rotation.z) * 0.5, Math.cos(b.rotation.z) * 0.5, 0);
          m.add(b);
        }
        m.add(core(g.sphere, 0.3));
        m.scale.setScalar(r * 1.6);
        sh.spinV = [0, 0, 14];
        break;
      }
      case 'flame':
        m = new THREE.Mesh(g.cone, basicMat(color));
        m.scale.set(r * 1.6, r * 2.4, r * 1.6);
        m.add(core(g.sphere, 0.3));
        sh.faceVel = true;
        sh.flicker = true;
        break;
      case 'crystal':
        m = new THREE.Mesh(g.oct, basicMat(color));
        m.scale.set(r * 0.7, r * 2.2, r * 0.7);
        m.add(core(g.oct, 0.45));
        sh.faceVel = true;
        break;
      case 'bolt':
        m = new THREE.Mesh(g.box, basicMat(color));
        m.scale.set(r * 3, r * 0.5, r * 0.5);
        m.add(core(g.box, 0.5));
        sh.faceVel = true;
        sh.flicker = true;
        break;
      case 'rock':
        m = new THREE.Mesh(g.ico, basicMat(color));
        m.scale.set(r * 1.5, r * 1.2, r * 1.3);
        sh.spinV = [2, 3, 5];
        break;
      case 'drop':
        m = new THREE.Mesh(g.sphere, basicMat(color));
        m.scale.set(r * 1.2, r * 1.6, r * 1.2);
        m.add(core(g.sphere, 0.4));
        sh.faceVel = true;
        break;
      default:
        m = new THREE.Mesh(g.sphere, basicMat(color));
        m.scale.setScalar(r * 0.8);
    }
    if (['spike', 'needle', 'crystal', 'drop'].includes(shape)) sh.faceOff = -Math.PI / 2;
    if (shape === 'flame') sh.faceOff = Math.PI / 2; // 炎の尾を後方に
    m.userData.baseScale = m.scale.clone();
    return m;
  }

  removeShot(i, spark = true) {
    const sh = this.shots[i];
    if (spark) {
      this.impactFx(sh);
    }
    this.world.remove(sh.mesh);
    this.shots.splice(i, 1);
    if ((sh.beh === 'bomb' || sh.beh === 'arc') && !sh.blasted) {
      sh.blasted = true;
      this.blast(sh.x, sh.y, sh.team, sh.color, 1.2, sh.fromEnemy ? 2 : 4);
    } else if (sh.beh === 'spikebounce' && !sh.blasted) {
      sh.blasted = true;
      this.spikeBlast(sh);
    }
  }

  // 爆風（敵弾の爆弾・迫撃砲・地雷用）
  blast(x, y, team, color, r, dmg = 2) {
    const b = this.spawnShot(team, 'orb', x, y, 1, 0, 'boss', { speed: 0, color, ov: { r, life: 0.18, pierce: true, walls: false, dmg, fixed: true } });
    b.mesh.visible = false;
    this.particles.emit(x, y, color, 14, { ring: true, speed: 6, life: 0.35, size: 0.7 });
    this.particles.emit(x, y, 0xffee99, 10, { speed: 4, life: 0.45, size: 0.8 });
    this.particles.emit(x, y, 0x555555, 6, { speed: 1.5, life: 0.9, size: 1, grav: 2 });
    if (this.boomCD <= 0) {
      play('boom');
      this.boomCD = 0.12;
    }
    this.shake(0.12);
  }

  // トゲトゲボムの爆発（味方側の固定ダメージ爆風＋トゲ破片）
  spikeBlast(sh) {
    const r = sh.r > 0.5 ? 1.8 : 1.4;
    const b = this.spawnShot(sh.team, 'orb', sh.x, sh.y, 1, 0, sh.owner, { speed: 0, color: sh.color, ov: { r, life: 0.18, pierce: true, walls: false, dmg: sh.r > 0.5 ? 3 : 2, fixed: true } });
    b.mesh.visible = false;
    this.particles.emit(sh.x, sh.y, sh.color, 16, { ring: true, speed: 7, life: 0.35, size: 0.7 });
    this.particles.emit(sh.x, sh.y, 0xffee99, 10, { speed: 4, life: 0.45, size: 0.8 });
    if (this.boomCD <= 0) { play('boom'); this.boomCD = 0.12; }
    this.shake(0.15);
  }

  mineBurst(e) {
    const prev = this.shotSrc;
    this.shotSrc = this.enemySrc(e);
    for (let k = 0; k < 8; k++) {
      this.spawnShot('foe', 'orb', e.x, e.y + 0.4, 1, 0, 'boss', { angle: (k / 8) * Math.PI * 2, speed: 6, color: 0xff3322 });
    }
    this.shotSrc = prev;
    this.blast(e.x, e.y + 0.3, 'foe', 0xff4422, 1.4, 2);
  }

  // 敵ごとの弾の形（攻撃エフェクト図形）
  enemySrc(e) {
    const SH = {
      walker: 'cube', shielder: 'diamond', drone: 'ring', turret: 'spike', hopper: 'cube',
      bomber: 'bomb', sniper: 'needle', roller: 'rock', mine: 'spike', bat: 'drop',
      mortar: 'shell', heavy: 'flame', splitter: 'crystal', mini: 'diamond', orbiter: 'star',
    };
    return { kind: 'enemy', shape: SH[e.type] || 'cube' };
  }

  bossSrc(b) {
    const SH = {
      volca: 'flame', frost: 'crystal', storm: 'shuriken', spark: 'bolt', quake: 'rock', boomer: 'shuriken',
      laser: 'diamond', scorpio: 'drop', vile: 'needle', shadow: 'star', void: 'bolt', crimsonx: 'flame',
      trinity: 'star', guardian: 'cube', overlord: b.phase === 2 ? 'star' : 'spike',
    };
    return { kind: 'boss', shape: SH[b.def.id] || 'diamond' };
  }

  // ステージ進行度による雑魚の強さ補正
  stageTier() {
    const id = this.stage ? this.stage.id : '';
    if (id === 'intro') return 0;
    if (/^f\d/.test(id)) return 2;
    return this.stage && this.stage.arena ? 1 : 1;
  }

  enemyDmgScale() {
    return [0.75, 1, 1.25][this.stageTier()];
  }

  shake(amt) {
    this.shakeT = Math.max(this.shakeT || 0, amt);
  }

  // 技ごとの軌跡エフェクト
  trailFx(sh) {
    const R = Math.random();
    const P = this.particles;
    switch (sh.type) {
      case 'buster':
        if (sh.level === 2) {
          if (R < 0.9) P.emit(sh.x - sh.vx * 0.02, sh.y + (Math.random() - 0.5) * 0.6, Math.random() < 0.5 ? 0x6fd8ff : 0xffffff, 1, { speed: 1.5, life: 0.3, size: 0.55 });
          if (R < 0.25) P.emit(sh.x, sh.y, 0xaaf0ff, 3, { ring: true, speed: 2.5, life: 0.18, size: 0.3 });
        } else if (sh.level === 1 && R < 0.6) {
          P.emit(sh.x, sh.y, 0x7fffd0, 1, { speed: 0.6, life: 0.22, size: 0.4 });
        }
        break;
      case 'wave':
        if (R < 0.9) P.emit(sh.x - sh.dir * 0.3, sh.y + (Math.random() - 0.5) * 1.2, Math.random() < 0.6 ? 0x66ff99 : 0xccffdd, 1, { speed: 1, life: 0.35, size: 0.5 });
        sh.mesh.scale.y = sh.r * 1.2 * (1 + Math.sin(sh.t * 30) * 0.12);
        break;
      case 'ice':
        if (R < 0.6) P.emit(sh.x, sh.y, Math.random() < 0.5 ? 0xbbf4ff : 0xffffff, 1, { speed: 0.8, life: 0.4, size: 0.25, grav: -3 });
        sh.mesh.rotation.x += 0.4;
        break;
      case 'spark':
        if (R < 0.7) {
          const a = Math.random() * Math.PI * 2;
          P.emit(sh.x + Math.cos(a) * sh.r, sh.y + Math.sin(a) * sh.r, Math.random() < 0.5 ? 0xffee55 : 0xffffff, 1, { speed: 4, life: 0.12, size: 0.25 });
        }
        sh.mesh.scale.setScalar(sh.r * 0.7 * (0.8 + Math.random() * 0.5));
        break;
      case 'laser':
        if (R < 0.8) P.emit(sh.x - sh.vx * 0.03, sh.y, Math.random() < 0.5 ? sh.color : 0xffffff, 1, { speed: 0.3, life: 0.2, size: 0.35 });
        break;
      case 'boomerang':
        if (R < 0.7) P.emit(sh.x, sh.y, 0xffcc55, 1, { speed: 0.4, life: 0.25, size: 0.45 });
        break;
      case 'spreadp':
        if (R < 0.4) P.emit(sh.x, sh.y, 0xcc88ff, 1, { speed: 0.4, life: 0.25, size: 0.3, grav: -2 });
        break;
      case 'homing':
        if (R < 0.3) P.emit(sh.x, sh.y, 0xffffff, 1, { speed: 0.2, life: 0.2, size: 0.2 });
        break;
      case 'fire':
        if (R < 0.5) P.emit(sh.x, sh.y, Math.random() < 0.5 ? 0xffdd33 : 0xff3300, 1, { speed: 1.2, life: 0.3, size: 0.4, grav: 4 });
        break;
      case 'slash':
        if (R < 0.9) {
          const a = (Math.random() - 0.5) * Math.PI;
          P.emit(sh.x + Math.cos(a) * sh.dir, sh.y + Math.sin(a), [0x66ff99, 0x99ffcc, 0xffffff][sh.level] || 0x66ff99, 1, { speed: 2, life: 0.18, size: 0.35 });
        }
        break;
      default:
        break;
    }
  }

  // 技ごとの着弾エフェクト
  impactFx(sh) {
    const P = this.particles;
    const x = sh.x;
    const y = sh.y;
    const c = sh.color || 0xffffff;
    switch (sh.type) {
      case 'buster':
        if (sh.level === 2) {
          P.emit(x, y, 0x6fd8ff, 16, { ring: true, speed: 7, life: 0.35, size: 0.6 });
          P.emit(x, y, 0xffffff, 10, { speed: 5, life: 0.3, size: 0.5 });
          this.shake(0.1);
        } else if (sh.level === 1) {
          P.emit(x, y, 0x7fffd0, 10, { ring: true, speed: 4, life: 0.25, size: 0.45 });
        } else {
          P.emit(x, y, 0xfff27a, 5, { speed: 3, life: 0.2, size: 0.35 });
        }
        break;
      case 'fire':
        P.emit(x, y, 0xff5511, 10, { speed: 3, life: 0.45, size: 0.7, grav: 5 });
        P.emit(x, y, 0xffdd33, 6, { speed: 2, life: 0.3, size: 0.5, grav: 6 });
        P.emit(x, y, 0x553322, 3, { speed: 1, life: 0.8, size: 0.8, grav: 2 });
        break;
      case 'ice':
        P.emit(x, y, 0xbbf4ff, 10, { speed: 6, life: 0.35, size: 0.3, grav: -12 });
        P.emit(x, y, 0xffffff, 8, { ring: true, speed: 3, life: 0.25, size: 0.35 });
        break;
      case 'homing':
        P.emit(x, y, c, 10, { ring: true, speed: 4, life: 0.3, size: 0.45 });
        P.emit(x, y, 0xffffff, 4, { speed: 2, life: 0.25, size: 0.3 });
        break;
      case 'spark':
        for (let k = 0; k < 5; k++) {
          const a = Math.random() * Math.PI * 2;
          for (let d = 0.2; d < 1.4; d += 0.3) {
            P.emit(x + Math.cos(a) * d + (Math.random() - 0.5) * 0.2, y + Math.sin(a) * d + (Math.random() - 0.5) * 0.2, 0xffee55, 1, { speed: 0.2, life: 0.15, size: 0.25 });
          }
        }
        P.emit(x, y, 0xffffff, 6, { ring: true, speed: 5, life: 0.2, size: 0.4 });
        break;
      case 'quake':
        P.emit(x, y + 0.3, 0xd29a5a, 12, { speed: 5, life: 0.5, size: 0.6, grav: -14 });
        P.emit(x, y + 0.2, 0x776655, 6, { speed: 1.5, life: 0.8, size: 1, grav: 1 });
        this.shake(0.08);
        break;
      case 'boomerang':
        P.emit(x, y, 0xffaa33, 10, { ring: true, speed: 5, life: 0.25, size: 0.4 });
        P.emit(x, y, 0xffffff, 6, { speed: 6, life: 0.15, size: 0.25 });
        break;
      case 'laser':
        P.emit(x, y, c, 12, { ring: true, speed: 6, life: 0.3, size: 0.4 });
        P.emit(x, y, 0xffffff, 6, { ring: true, speed: 2.5, life: 0.2, size: 0.5 });
        break;
      case 'spreadp':
        P.emit(x, y, 0xaa66ff, 6, { speed: 2.5, life: 0.4, size: 0.5, grav: -6 });
        P.emit(x, y, 0x66ff66, 3, { speed: 1, life: 0.6, size: 0.6, grav: 1 });
        break;
      case 'wave':
      case 'slash':
        P.emit(x, y, 0x66ff99, 10, { ring: true, speed: 5, life: 0.25, size: 0.45 });
        P.emit(x, y, 0xffffff, 6, { speed: 4, life: 0.2, size: 0.3 });
        break;
      default:
        P.emit(x, y, c, 6, { speed: 3, life: 0.25, size: 0.4 });
        break;
    }
  }

  // 発射時のマズルフラッシュ（技ごと）
  muzzleFx(type, x, y, dir, level) {
    const P = this.particles;
    const c = (WEAPONS[type] && WEAPONS[type].color) || 0xffffff;
    if (type === 'buster') {
      const col = [0xfff27a, 0x7fffd0, 0x6fd8ff][level] || 0xfff27a;
      P.emit(x, y, col, 4 + level * 6, { ring: true, speed: 2 + level * 2, life: 0.15 + level * 0.05, size: 0.3 + level * 0.15 });
      if (level === 2) {
        P.emit(x - dir * 0.3, y, 0xffffff, 8, { speed: 5, life: 0.2, size: 0.4 });
        this.shake(0.08);
      }
    } else if (type === 'wave') {
      P.emit(x, y, 0x66ff99, 16, { ring: true, speed: 5, life: 0.3, size: 0.5 });
      this.shake(0.08);
    } else if (type === 'fire') {
      P.emit(x, y, 0xff6622, 8, { speed: 3, life: 0.3, size: 0.6, grav: 4 });
    } else if (type === 'ice') {
      P.emit(x, y, 0xccf6ff, 8, { ring: true, speed: 3, life: 0.2, size: 0.3 });
    } else if (type === 'spark') {
      P.emit(x, y, 0xffee55, 10, { speed: 6, life: 0.12, size: 0.25 });
    } else if (type === 'quake') {
      P.emit(x, y - 0.8, 0xd29a5a, 10, { speed: 4, life: 0.4, size: 0.6, grav: -10 });
      this.shake(0.1);
    } else if (type === 'laser') {
      P.emit(x, y, c, 6, { ring: true, speed: 1.5, life: 0.25, size: 0.6 });
    } else {
      P.emit(x, y, c, 6, { ring: true, speed: 2.5, life: 0.2, size: 0.35 });
    }
  }

  hitTest(sh, b) {
    const cx = clamp(sh.x, b.x - b.w / 2, b.x + b.w / 2);
    const cy = clamp(sh.y, b.y, b.y + b.h);
    const dx = sh.x - cx;
    const dy = sh.y - cy;
    return dx * dx + dy * dy < sh.r * sh.r;
  }

  weaponOf(type) {
    return type === 'wave' || type === 'slash' ? 'saber' : type === 'spreadp' ? 'spread' : type;
  }

  nearestTarget(sh) {
    let best = null;
    let bd = 1e9;
    const list = sh.team === 'ally' ? [...this.enemies, ...this.bosses] : [this.player];
    for (const t of list) {
      if (t.dead || t.dying) {
        continue;
      }
      const d = (t.x - sh.x) ** 2 + (t.y + t.h / 2 - sh.y) ** 2;
      if (d < bd && d < 300) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  updateShots(dt) {
    const p = this.player;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const sh = this.shots[i];
      sh.t += dt;
      sh.life -= dt;
      if (sh.follow) {
        sh.x = sh.follow.x + sh.dir * 0.9;
        sh.y = sh.follow.y + sh.follow.h * 0.55;
      }
      switch (sh.beh) {
        case 'fire':
          sh.vy = Math.cos(sh.t * 12) * 3;
          if (Math.random() < 0.6) {
            this.particles.emit(sh.x, sh.y, 0xff8833, 1, { speed: 1, life: 0.35, size: 0.5, grav: 3 });
          }
          break;
        case 'homing': {
          const t = this.nearestTarget(sh);
          if (t) {
            const a = Math.atan2(t.y + t.h / 2 - sh.y, t.x - sh.x);
            const cur = Math.atan2(sh.vy, sh.vx);
            let d = a - cur;
            d = Math.atan2(Math.sin(d), Math.cos(d));
            const na = cur + clamp(d, -5 * dt, 5 * dt);
            sh.vx = Math.cos(na) * 9;
            sh.vy = Math.sin(na) * 9;
          }
          if (Math.random() < 0.5) {
            this.particles.emit(sh.x, sh.y, sh.color, 1, { speed: 0.3, life: 0.3, size: 0.3 });
          }
          break;
        }
        case 'bounce':
          sh.vy += GRAV * 0.55 * dt;
          if (sh.vy < 0 && this.pointSolid(sh.x, sh.y - sh.r)) {
            sh.vy = 8;
            play('zap');
          }
          if (this.pointSolid(sh.x + Math.sign(sh.vx) * sh.r, sh.y)) {
            sh.vx = -sh.vx;
          }
          break;
        case 'spikebounce':
          sh.vy += GRAV * 0.6 * dt;
          sh.mesh.rotation.z -= Math.sign(sh.vx || 1) * dt * 10;
          sh.mesh.rotation.x += dt * 4;
          if (sh.vy < 0 && this.pointSolid(sh.x, sh.y - sh.r)) {
            sh.bounces--;
            if (sh.bounces <= 0) {
              sh.life = 0;
            } else {
              sh.vy = 7.5;
              sh.vx *= 0.92;
              play('zap');
              this.particles.emit(sh.x, sh.y - sh.r, 0xffaa55, 5, { speed: 3, life: 0.3, size: 0.4 });
            }
          }
          if (this.pointSolid(sh.x + Math.sign(sh.vx) * sh.r, sh.y)) {
            sh.vx = -sh.vx;
          }
          break;
        case 'boomer':
          sh.vx -= sh.dir * 26 * dt;
          sh.mesh.rotation.z += dt * 20;
          break;
        case 'quake':
          if (Math.random() < 0.5) {
            this.particles.emit(sh.x, sh.y + 0.2, 0xd29a5a, 1, { speed: 2, life: 0.4, size: 0.5, grav: -6 });
          }
          sh.mesh.scale.y = 0.6 + Math.abs(Math.sin(sh.t * 18)) * 0.6;
          break;
        case 'arc':
        case 'bomb':
          sh.vy += GRAV * (sh.beh === 'bomb' ? 0.9 : 0.6) * dt;
          if (Math.random() < 0.5) {
            this.particles.emit(sh.x, sh.y, 0x888888, 1, { speed: 0.5, life: 0.4, size: 0.4, grav: 1.5 });
          }
          break;
        case 'tornado':
          sh.vy = Math.sin(sh.t * 4) * 1.5;
          sh.mesh.rotation.y += dt * 14;
          if (Math.random() < 0.8) {
            const a = sh.t * 20;
            this.particles.emit(sh.x + Math.cos(a) * sh.r, sh.y - sh.r + Math.random() * sh.r * 2, sh.color, 1, { speed: 0.6, life: 0.35, size: 0.4, grav: 3 });
          }
          break;
        case 'spiral':
          sh.ang = (sh.ang || 0) + dt * (sh.spin || 2);
          sh.vx = Math.cos(sh.ang) * sh.spd;
          sh.vy = Math.sin(sh.ang) * sh.spd;
          break;
        case 'delay':
          // 一時停止してから狙い撃ち
          if (sh.t < sh.wait) {
            sh.vx *= 0.9;
            sh.vy *= 0.9;
          } else if (!sh.fired) {
            sh.fired = true;
            const a = Math.atan2(p.y + 0.9 - sh.y, p.x - sh.x);
            sh.vx = Math.cos(a) * 11;
            sh.vy = Math.sin(a) * 11;
            this.particles.emit(sh.x, sh.y, sh.color, 6, { ring: true, speed: 2, life: 0.2 });
          }
          break;
        default:
          break;
      }
      this.trailFx(sh);
      sh.x += sh.vx * dt;
      sh.y += sh.vy * dt;
      sh.mesh.position.set(sh.x, sh.y, 0.3);
      if (sh.spinV) {
        sh.mesh.rotation.x += sh.spinV[0] * dt;
        sh.mesh.rotation.y += sh.spinV[1] * dt;
        sh.mesh.rotation.z += sh.spinV[2] * dt * (sh.vx < 0 ? 1 : -1);
      } else if (sh.faceVel && (sh.vx || sh.vy)) {
        sh.mesh.rotation.z = Math.atan2(sh.vy, sh.vx) + (sh.faceOff || 0);
      }
      if (sh.flicker && sh.mesh.userData.baseScale) {
        sh.mesh.scale.copy(sh.mesh.userData.baseScale).multiplyScalar(0.8 + Math.random() * 0.4);
      }
      if (sh.walls && this.pointSolid(sh.x, sh.y + (sh.beh === 'quake' ? 0.5 : 0))) {
        this.removeShot(i);
        continue;
      }
      if (sh.life <= 0 || Math.abs(sh.x - this.camX) > 30) {
        this.removeShot(i, false);
        continue;
      }
      let gone = false;
      if (sh.team === 'ally') {
        for (const t of [...this.enemies, ...this.bosses]) {
          if (t.dead || t.dying || sh.hit.has(t) || !this.hitTest(sh, t)) {
            continue;
          }
          sh.hit.add(t);
          if (this.damageTarget(t, sh) === 'deflect') {
            gone = true;
            play('deflect');
            break;
          }
          if (!sh.pierce) {
            gone = true;
            break;
          }
        }
        if (!gone && this.net && this.net.hostile && sh.owner === myId) {
          for (const gh of Object.values(this.net.ghosts)) {
            if (gh.visible && !sh.hit.has(gh) && this.hitTest(sh, gh)) {
              sh.hit.add(gh);
              this.particles.emit(sh.x, sh.y, 0xffffff, 6, { speed: 4, life: 0.25 });
              if (!sh.pierce) {
                gone = true;
              }
              break;
            }
          }
        }
        // saber slash deflects enemy bullets
        if (sh.type === 'slash' && sh.owner === myId) {
          for (let j = this.shots.length - 1; j >= 0; j--) {
            const o = this.shots[j];
            if (o.team === 'foe' && !o.pierce && Math.hypot(o.x - sh.x, o.y - sh.y) < sh.r + o.r) {
              play('deflect');
              this.removeShot(j);
              if (j < i) {
                i--;
              }
            }
          }
        }
      } else if (!p.dead && this.hitTest(sh, p)) {
        if (p.inv <= 0) {
          this.hurtPlayer(sh.dmg, sh.owner);
        }
        if (!sh.pierce) {
          gone = true;
        }
      }
      if (gone && this.shots[i] === sh) {
        this.removeShot(i);
      }
    }
  }

  damageTarget(t, sh) {
    let d = sh.dmg;
    if (t.type === 'shielder' && sh.level < 2 && Math.sign(sh.vx || sh.dir) === -t.dir && sh.type !== 'slash') {
      return 'deflect';
    }
    if (t.isBoss) {
      if (t.state === 'intro' || t.inv > 0) {
        return 'deflect';
      }
      if (t.def.weakness === this.weaponOf(sh.type)) {
        d *= 3;
        t.stun = 0.5;
        this.particles.emit(t.x, t.y + t.h / 2, 0xffff66, 14, { ring: true, speed: 6, life: 0.4 });
      }
      t.inv = sh.pierce ? 0.2 : 0.05;
    }
    t.hp -= d;
    t.flash = 0.12;
    play('hit');
    this.particles.emit(sh.x, sh.y, 0xffffff, 4, { speed: 3, life: 0.2, size: 0.4 });
    if (t.hp <= 0) {
      if (t.isBoss) {
        this.bossDown(t);
      } else {
        this.killEnemy(t);
      }
    }
    if (t.isBoss) {
      this.ui.setBoss(Math.max(0, t.hp), t.max, t.def.name);
    }
    return 'hit';
  }

  // ---------------- enemies ----------------
  spawnEnemy(type, x, y) {
    const def = ENEMY_TYPES[type] || ENEMY_TYPES.walker;
    let rig;
    if (type === 'walker' || type === 'shielder' || type === 'heavy') {
      rig = makeModel('enemy-walker', { height: def.h + 0.1, tint: type === 'shielder' ? 0x6677aa : type === 'heavy' ? 0x8a2a22 : null, emissive: type === 'heavy' ? 0x551100 : null });
      if (type === 'shielder') {
        const sm = new THREE.Mesh(geo().box, stdMat(0x3a6aff, 0x2244ff));
        sm.scale.set(0.15, 1.2, 0.9);
        sm.position.set(0, 0.75, 0);
        rig.shield = sm;
        rig.group.add(sm);
      }
    } else {
      rig = makePrimEnemy(type);
    }
    this.world.add(rig.group);
    const e = { type, rig, x, y, baseY: y, w: def.w, h: def.h, vx: 0, vy: 0, hp: Math.max(1, Math.round(def.hp * [0.8, 1, 1.35][this.stageTier()])), dir: -1, t: Math.random() * 2, shootT: 1.5 + Math.random(), fly: !!def.fly, flash: 0, onGround: false, st: 0, aimT: 0 };
    this.enemies.push(e);
    return e;
  }

  killEnemy(e) {
    e.dead = true;
    this.world.remove(e.rig.group);
    const EXC = { bomber: 0xff66ff, sniper: 0x33ffcc, roller: 0xcccccc, mine: 0xff3322, bat: 0xcc44ff, mortar: 0xffaa00, heavy: 0xff4422, splitter: 0xcc66ff, mini: 0xaa55ff, orbiter: 0x33ddff };
    const ec = EXC[e.type] || 0xffaa33;
    const cy = e.y + e.h / 2;
    this.particles.emit(e.x, cy, ec, 14, { speed: 5, life: 0.5, size: 0.7 });
    this.particles.emit(e.x, cy, 0xffffff, 8, { ring: true, speed: 3, life: 0.3 });
    this.particles.emit(e.x, cy, 0x666677, 6, { speed: 2.5, life: 0.8, size: 0.9, grav: 2 }); // 煙
    this.particles.emit(e.x, cy, 0xffdd88, 6, { speed: 7, life: 0.35, size: 0.25, grav: -14 }); // 破片
    if (e.type === 'heavy') {
      this.particles.emit(e.x, cy, 0xff8844, 16, { ring: true, speed: 6, life: 0.6, size: 0.9 });
      this.shake(0.25);
    }
    if (e.type === 'mine') {
      this.mineBurst(e);
    }
    if (e.type === 'splitter') {
      for (const d of [-1, 1]) {
        const m = this.spawnEnemy('mini', e.x + d * 0.4, e.y + 0.2);
        m.vx = d * 3;
        m.vy = 6;
        m.dir = d;
      }
    }
    if (this.boomCD <= 0) {
      play('boom');
      this.boomCD = 0.15;
    }
    const r = Math.random();
    const type = r < 0.16 ? 'hs' : r < 0.22 ? 'hl' : r < 0.29 ? 'en' : r < 0.305 ? 'up' : r < 0.312 ? 'tank' : null;
    if (type) {
      this.spawnItem(type, e.x, e.y + 0.5, true);
    }
  }

  updateEnemies(dt) {
    const p = this.player;
    if (this.mode === 'solo' || this.mode === 'coop') {
      for (const s of this.spawns) {
        if (!s.done && s.x < this.camX + this.halfW() + 3 && s.x > this.camX - this.halfW() - 2) {
          s.done = true;
          this.spawnEnemy(s.type, s.x, s.y);
        }
      }
    }
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead) {
        this.enemies.splice(i, 1);
        continue;
      }
      if (Math.abs(e.x - p.x) > 20 || this.readyT > 0) {
        continue;
      }
      e.t += dt;
      e.shootT -= dt * [0.7, 1, 1.12][this.stageTier()];
      e.flash -= dt;
      const toP = p.x < e.x ? -1 : 1;
      const aim = Math.atan2(p.y + 0.9 - (e.y + e.h * 0.6), p.x - e.x);
      this.shotSrc = e.src || (e.src = this.enemySrc(e));
      switch (e.type) {
        case 'walker':
        case 'shielder':
          e.dir = toP;
          e.vx = e.dir * (e.type === 'walker' ? 1.4 : 0.8);
          if (e.shootT <= 0) {
            e.shootT = e.type === 'walker' ? 2.4 : 3;
            this.spawnShot('foe', 'orb', e.x + e.dir * 0.5, e.y + e.h * 0.6, e.dir, 0, 'boss');
          }
          break;
        case 'drone':
          e.dir = toP;
          e.x += clamp(p.x - e.x, -1, 1) * 1.3 * dt;
          e.y = e.baseY + Math.sin(e.t * 2.5) * 0.6;
          if (e.shootT <= 0) {
            e.shootT = 3;
            this.spawnShot('foe', 'orb', e.x, e.y + 0.3, e.dir, 0, 'boss', { angle: aim });
          }
          break;
        case 'turret':
          e.dir = toP;
          e.vx = 0;
          if (e.shootT <= 0) {
            e.shootT = 1.9;
            this.spawnShot('foe', 'orb', e.x, e.y + 0.7, e.dir, 0, 'boss', { angle: aim, color: 0xffaa22 });
          }
          break;
        case 'hopper':
          if (e.onGround) {
            e.vx = 0;
            if (e.shootT <= 0) {
              e.shootT = 1.3;
              e.dir = toP;
              e.vy = 11;
              e.vx = e.dir * 3.5;
              e.onGround = false;
            }
          }
          break;
        case 'bomber': {
          // プレイヤーの頭上へ移動して爆弾投下
          e.dir = toP;
          e.x += clamp(p.x - e.x, -1, 1) * 2.2 * dt;
          e.y = Math.max(e.baseY, p.y + 4.2) + Math.sin(e.t * 3) * 0.25;
          if (e.shootT <= 0 && Math.abs(p.x - e.x) < 2.5) {
            e.shootT = 1.6;
            this.spawnShot('foe', 'orb', e.x, e.y + 0.1, e.dir, 0, 'boss', { angle: -Math.PI / 2, speed: 1, color: 0xff5500, ov: { beh: 'bomb', r: 0.3 } });
          }
          break;
        }
        case 'sniper':
          e.dir = toP;
          e.vx = 0;
          if (e.st === 0 && e.shootT <= 0) {
            e.st = 1;
            e.aimT = 0.9;
            e.lockA = aim;
          }
          if (e.st === 1) {
            e.aimT -= dt;
            // 予告線
            const k = 1 - e.aimT / 0.9;
            for (let d = 1; d < 14; d += 1.4) {
              if (Math.random() < 0.25 + k * 0.3) {
                this.particles.emit(e.x + Math.cos(e.lockA) * d, e.y + 1 + Math.sin(e.lockA) * d, 0x33ffcc, 1, { speed: 0, life: 0.08, size: 0.22 });
              }
            }
            if (e.aimT <= 0) {
              e.st = 0;
              e.shootT = 2.6;
              this.spawnShot('foe', 'laser', e.x, e.y + 1, e.dir, 0, 'boss', { angle: e.lockA, color: 0x33ffcc });
              this.particles.emit(e.x + e.dir * 0.6, e.y + 1, 0x99ffee, 8, { ring: true, speed: 3, life: 0.2 });
              play('zap');
            }
          }
          break;
        case 'roller':
        case 'mini':
          if (e.st === 0) {
            e.dir = toP;
            e.st = 1;
          }
          e.vx = e.dir * (e.type === 'mini' ? 3.2 : 5.2);
          if (e.rig.inner.userData.spin) {
            e.rig.inner.userData.spin.rotation.z -= e.vx * dt * 2.2;
          }
          if (Math.abs(p.x - e.x) > 9 && Math.sign(p.x - e.x) !== e.dir) {
            e.dir = toP;
          }
          if (e.onGround && Math.random() < 0.15) {
            this.particles.emit(e.x - e.dir * 0.3, e.y + 0.05, 0xffcc88, 1, { speed: 1.5, life: 0.2, size: 0.25 });
          }
          break;
        case 'mine': {
          e.vx = 0;
          const near = Math.hypot(p.x - e.x, p.y - e.y) < 3;
          if (near && e.st === 0) {
            e.st = 1;
            e.aimT = 0.7;
            play('warn');
          }
          if (e.rig.inner.userData.lamp) {
            e.rig.inner.userData.lamp.visible = e.st === 0 ? Math.floor(e.t * 2) % 2 === 0 : Math.floor(e.t * 16) % 2 === 0;
          }
          if (e.st === 1) {
            e.aimT -= dt;
            if (e.aimT <= 0) {
              e.hp = 0;
              this.killEnemy(e);
            }
          }
          break;
        }
        case 'bat':
          e.dir = toP;
          if (e.st === 0) {
            e.x += clamp(p.x - e.x, -1, 1) * 1.6 * dt;
            e.y = e.baseY + Math.sin(e.t * 4) * 0.4;
            if (e.shootT <= 0 && Math.abs(p.x - e.x) < 6) {
              e.st = 1;
              e.aimT = 0;
              e.sx = e.x;
              e.sy = e.y;
              e.tx = p.x;
              e.ty = p.y + 0.4;
            }
          } else {
            e.aimT += dt / 1.1;
            const k = Math.min(1, e.aimT);
            const dip = Math.sin(k * Math.PI);
            e.x = e.sx + (e.tx - e.sx) * k * 2;
            e.y = e.sy + (e.ty - e.sy) * dip;
            if (k >= 1) {
              e.st = 0;
              e.baseY = e.y;
              e.shootT = 2.2;
            }
          }
          if (e.rig.inner.userData.wing) {
            e.rig.inner.userData.wing.scale.x = 0.5 + Math.abs(Math.sin(e.t * 18)) * 0.5;
          }
          break;
        case 'mortar':
          e.dir = toP;
          e.vx = 0;
          if (e.shootT <= 0 && Math.abs(p.x - e.x) < 15) {
            e.shootT = 2.8;
            const dx = p.x - e.x;
            const tFlight = 1.25;
            const g = GRAV * 0.6;
            const vx = dx / tFlight;
            const vy = (p.y - (e.y + 1) - 0.5 * g * tFlight * tFlight) / tFlight;
            const sh = this.spawnShot('foe', 'orb', e.x + e.dir * 0.4, e.y + 1, e.dir, 0, 'boss', { color: 0xffaa00, ov: { beh: 'arc', r: 0.32, life: 3 } });
            sh.vx = vx;
            sh.vy = vy;
            this.particles.emit(e.x + e.dir * 0.4, e.y + 1.2, 0xaaaaaa, 6, { speed: 2, life: 0.5, size: 0.6, grav: 2 });
            play('shot');
          }
          break;
        case 'heavy':
          e.dir = toP;
          e.vx = e.st === 1 ? e.dir * 6 : e.dir * 0.7;
          if (e.st === 1) {
            e.aimT -= dt;
            if (Math.random() < 0.5) {
              this.particles.emit(e.x - e.dir * 0.5, e.y + 0.2, 0xff8844, 1, { speed: 2, life: 0.3, size: 0.5 });
            }
            if (e.aimT <= 0) {
              e.st = 0;
            }
          }
          if (e.shootT <= 0) {
            e.shootT = 3;
            if (Math.random() < 0.5 && Math.abs(p.x - e.x) < 7) {
              e.st = 1;
              e.aimT = 0.6;
            } else {
              for (const da of [-0.25, 0, 0.25]) {
                this.spawnShot('foe', 'orb', e.x + e.dir * 0.7, e.y + e.h * 0.6, e.dir, 0, 'boss', { angle: (e.dir > 0 ? 0 : Math.PI) + da, color: 0xff5533 });
              }
            }
          }
          break;
        case 'splitter':
          e.dir = toP;
          if (e.onGround) {
            e.vx = 0;
            if (e.shootT <= 0) {
              e.shootT = 1.8;
              e.vy = 8;
              e.vx = e.dir * 2.5;
              e.onGround = false;
              this.spawnShot('foe', 'orb', e.x, e.y + 0.6, e.dir, 0, 'boss', { angle: aim, color: 0xcc66ff });
            }
          }
          if (e.rig.inner.userData.spin) {
            e.rig.inner.userData.spin.rotation.y += dt * 3;
          }
          break;
        case 'orbiter': {
          e.dir = toP;
          e.x += clamp(p.x - e.x, -1, 1) * 0.9 * dt;
          e.y = e.baseY + Math.sin(e.t * 1.8) * 0.8;
          const orbs = e.rig.group.userData.orbs || [];
          orbs.forEach((o, k) => {
            const a = e.t * 3 + (k / orbs.length) * Math.PI * 2;
            o.position.set(Math.cos(a) * 1.25, 0.45 + Math.sin(a) * 1.25, 0.2);
            const ox = e.x + o.position.x;
            const oy = e.y + o.position.y;
            if (!p.dead && Math.abs(ox - p.x) < 0.5 && oy > p.y && oy < p.y + p.h) {
              this.hurtPlayer(2, 'boss');
            }
          });
          if (e.shootT <= 0) {
            e.shootT = 3.4;
            for (let k = 0; k < 6; k++) {
              this.spawnShot('foe', 'orb', e.x, e.y + 0.45, e.dir, 0, 'boss', { angle: (k / 6) * Math.PI * 2 + e.t, speed: 5, color: 0x33ddff });
            }
          }
          break;
        }
        default:
          break;
      }
      if (e.dead) {
        continue;
      }
      if (!e.fly) {
        e.vy = Math.max(-20, e.vy + GRAV * dt);
        const keepVx = e.vx;
        this.moveBody(e, dt);
        if (e.hitWall) {
          e.vx = -keepVx;
        }
        if (e.y < -14) {
          e.dead = true;
          this.world.remove(e.rig.group);
          continue;
        }
      }
      if (!p.dead && this.overlap(p, { x0: e.x - e.w / 2, x1: e.x + e.w / 2, y0: e.y, y1: e.y + e.h })) {
        this.hurtPlayer((e.type === 'heavy' || e.type === 'roller' ? 1 : 0) + [2, 2, 3][this.stageTier()], 'boss');
      }
    }
  }

  // ---------------- items ----------------
  spawnItem(type, x, y, temp) {
    const map = { hs: 'vb-i-hs', hl: 'vb-i-hl', en: 'vb-i-en', up: 'vb-i-up', tank: 'vb-i-tank' };
    const tex = getTexture(map[type]);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, color: tex ? 0xffffff : 0x66ff99 });
    this.disposables.push(mat);
    const s = new THREE.Sprite(mat);
    const sz = type === 'hs' ? 0.6 : 0.85;
    s.scale.setScalar(sz);
    this.world.add(s);
    this.items.push({ type, x, y, vx: 0, vy: temp ? 6 : 0, w: sz * 0.8, h: sz * 0.8, s, temp, life: temp ? 9 : 1e9, onGround: false, t: 0 });
  }

  updateItems(dt) {
    const p = this.player;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      it.life -= dt;
      if (it.temp) {
        it.vy = Math.max(-15, it.vy + GRAV * dt);
        this.moveBody(it, dt);
      }
      it.s.position.set(it.x, it.y + it.h / 2 + Math.sin(it.t * 4) * 0.08, 0.4);
      it.s.visible = it.life > 2 || Math.floor(it.t * 10) % 2 === 0;
      if (it.life <= 0 || it.y < -14) {
        this.world.remove(it.s);
        this.items.splice(i, 1);
        continue;
      }
      if (!p.dead && this.overlap(p, { x0: it.x - it.w / 2, x1: it.x + it.w / 2, y0: it.y, y1: it.y + it.h })) {
        this.collect(it.type);
        this.particles.emit(it.x, it.y + 0.3, 0xaaffee, 10, { ring: true, speed: 3, life: 0.4 });
        this.world.remove(it.s);
        this.items.splice(i, 1);
      }
    }
  }

  collect(type) {
    const p = this.player;
    play('item');
    const NAMES = { hs: 'リペアパック', hl: 'リペアパックL', en: 'アームズチャージ' };
    if (NAMES[type]) {
      this.ui.toast(NAMES[type], 0.8);
    }
    if (type === 'hs') {
      p.hp = Math.min(p.max, p.hp + 4);
    } else if (type === 'hl') {
      p.hp = Math.min(p.max, p.hp + 12);
    } else if (type === 'en') {
      let w = p.weapons[p.wi];
      if (p.wi === 0) {
        w = p.weapons.slice(1).sort((a, b) => p.energy[a] - p.energy[b])[0];
      }
      if (w) {
        p.energy[w] = Math.min(MAX_EN, p.energy[w] + 10);
      }
    } else if (type === 'up') {
      this.lives = Math.min(9, this.lives + 1);
      this.ui.toast('スペアコア入手！ 残機+1', 1.4);
    } else if (type === 'tank') {
      this.etanks = Math.min(4, this.etanks + 1);
      this.ui.toast('エナジーセル入手！（T / Yボタンで使用）', 2);
    }
    this.refreshHud();
  }

  // ---------------- bosses ----------------
  spawnBoss(def, x, y, opts = {}) {
    const isMech = def.model === 'boss-mech';
    const rig = makeModel(isMech ? 'enemy-walker' : def.model, {
      height: def.height, tint: isMech ? def.color : null, emissive: def.emissive || (isMech ? def.color : null),
    });
    const light = new THREE.PointLight(def.emissive || def.color || 0xff3344, 12, 8, 1.5);
    light.position.set(0, def.height * 0.6, 1.5);
    rig.group.add(light);
    this.world.add(rig.group);
    const b = {
      def, rig, isBoss: true, x, y: y + (this.room && !opts.hidden ? Math.min(7, this.room.top - y - def.height - 0.5) : 9), w: Math.max(0.9, def.height * 0.42), h: def.height * 0.9, vx: 0, vy: 0,
      hp: 0, max: def.hp, state: 'intro', t: 0, dir: -1, weapons: def.weapons, wi: 0, phase: 1,
      hidden: !!opts.hidden, hiddenIdx: opts.hiddenIdx, flash: 0, inv: 0, stun: 0, onGround: false, act: 0,
    };
    this.bosses.push(b);
    this.decorateBoss(b);
    this.ui.setBoss(0, b.max, def.name);
    this.ui.banner(def.name, 'boss', 2);
    const sid = this.stage.id;
    let track = null;
    if (opts.hidden) {
      track = 'hidden';
    } else if (def.id === 'overlord') {
      track = 'lastboss';
    } else if (/^f\d/.test(sid)) {
      track = 'finalboss';
    } else if (sid !== 'intro' && !this.stage.arena) {
      track = 'boss';
    }
    if (track) {
      setTrack(track);
      playMusic(1);
    } else {
      playMusic(1.15);
    }
    return b;
  }

  triggerBossFight() {
    this.bossTriggered = true;
    this.bossLock = true;
    this.gate.active = true;
    this.gate.y0 = this.gate.closedY0;
    this.gateMesh.position.y = this.gate.y0 + this.gateH / 2;
    play('warn');
    this.bossQueue = [...this.stage.bosses];
    this.nextBossT = 1.4;
  }

  resetBossFight() {
    if (this.bossLock || this.bosses.length) {
      this.bosses.forEach(b => this.world.remove(b.rig.group));
      this.bosses = [];
      this.bossQueue = [];
      this.bossLock = false;
      this.bossTriggered = false;
      this.nextBossT = -1;
      if (this.gate) {
        this.gate.active = false;
        this.gate.y0 = this.gate.openY0;
        this.gateMesh.position.y = this.gate.y0 + this.gateH / 2;
      }
      if (this.hiddenActive) {
        this.hiddenActive = false;
        this.hiddenTriggered = false;
      }
      this.ui.setBoss(0, 1, null);
      setTrack(this.stageTrack);
      playMusic(1);
    }
  }

  bossDown(b) {
    const d = b.def;
    if (d.phase2 && b.phase === 1) {
      b.phase = 2;
      b.hp = 0;
      b.state = 'intro';
      b.grounded = true;
      b.t = 0;
      b.weapons = d.phase2Weapons;
      b.rig.group.scale.setScalar(1.45);
      b.w *= 1.45;
      b.h *= 1.45;
      b.max = Math.round(d.hp * 1.2);
      play('warn');
      setTrack('lastboss2');
      playMusic(1);
      this.ui.banner('第二形態 ── 真・' + d.name, 'warning', 2.4);
      this.particles.emit(b.x, b.y + b.h / 2, 0xff2244, 24, { ring: true, speed: 7, life: 1, size: 1 });
      return;
    }
    b.dying = 1.6;
    b.vx = 0;
    play('boom');
  }

  finishBoss(b) {
    this.world.remove(b.rig.group);
    this.bosses.splice(this.bosses.indexOf(b), 1);
    this.particles.emit(b.x, b.y + b.h / 2, 0xffffff, 24, { ring: true, speed: 8, life: 1.2, size: 1.2 });
    this.particles.emit(b.x, b.y + b.h / 2, b.def.color || 0xff4444, 24, { ring: true, speed: 4, life: 1.4, size: 1 });
    play('boom');
    this.ui.setBoss(0, 1, null);
    if (b.hidden) {
      this.hiddenActive = false;
      this.result.hidden.push(b.hiddenIdx);
      this.ui.banner(b.def.name + ' 撃破！', 'clear', 2);
      setTrack(this.stageTrack);
      playMusic(1);
      return;
    }
    if (this.bossQueue.length) {
      this.nextBossT = 1.6;
      return;
    }
    this.clearT = 0;
    this.ui.banner('MISSION COMPLETE', 'clear', 3);
    if (this.net && this.mode === 'coop') {
      this.net.room.emit('clear', {});
    }
  }

  bossShoot(b, w, angle) {
    this.spawnShot('foe', w, b.x + b.dir * b.w * 0.7, b.y + b.h * 0.6, b.dir, b.phase === 2 ? 1 : 0, 'boss', angle !== undefined ? { angle } : {});
    play('zap');
  }

  // ---- ボス行動バリエーション ----
  pickBossState(b, fury) {
    const id = b.def.id;
    // ボスごとの性格（行動の重み）
    const PERS = {
      volca: { shoot: 3, leap: 2, dash: 2, rain: 1, barrage: 2, slam: 2, sig: 3 },
      frost: { shoot: 3, leap: 1, dash: 2, rain: 2, barrage: 2, spiral: 1, sig: 3 },
      storm: { shoot: 2, leap: 2, rain: 2, spiral: 3, teleport: 2, sig: 3 },
      spark: { shoot: 2, dash: 3, leap: 1, teleport: 2, barrage: 1, sig: 3 },
      quake: { shoot: 1, leap: 3, dash: 2, slam: 3, rain: 1, sig: 3 },
      boomer: { shoot: 3, dash: 2, leap: 1, spiral: 2, barrage: 1, sig: 3 },
      laser: { shoot: 3, teleport: 3, barrage: 2, spiral: 1, sig: 3 },
      scorpio: { shoot: 2, leap: 2, rain: 2, barrage: 2, summon: 2, sig: 3 },
      overlord: { shoot: 2, leap: 1, dash: 2, rain: 2, barrage: 2, spiral: 2, slam: 1, teleport: 2, summon: 1, sig: 3 },
      trinity: { shoot: 2, barrage: 3, spiral: 3, summon: 2, sig: 3, rain: 1 },
      guardian: { shoot: 2, slam: 3, dash: 2, barrage: 2, leap: 2, sig: 2 },
    };
    const w = { ...(PERS[id] || { shoot: 3, leap: 2, dash: 2, rain: 1, barrage: 2, spiral: 1, slam: 1, teleport: 1, summon: 1, sig: 2 }) };
    if (!fury) {
      w.sig = (w.sig || 0) * 0.5;
      w.summon = (w.summon || 0) * 0.5;
    }
    if (b.lastState && w[b.lastState]) {
      w[b.lastState] *= 0.35; // 同じ行動の連続を抑える
    }
    if (this.enemies.length > 4) {
      w.summon = 0;
    }
    const tot = Object.values(w).reduce((a, c) => a + c, 0);
    let r = Math.random() * tot;
    for (const k in w) {
      r -= w[k];
      if (r <= 0) {
        return k;
      }
    }
    return 'shoot';
  }

  bossSigKind(b) {
    const MAP = { volca: 'erupt', frost: 'icefall', storm: 'tornado', spark: 'thunder', quake: 'rockfall', boomer: 'blades', laser: 'prism', scorpio: 'acid', guardian: 'rockfall', vile: 'thunder', shadow: 'prism', void: 'thunder', crimsonx: 'erupt' };
    if (MAP[b.def.id]) {
      return MAP[b.def.id];
    }
    const all = ['erupt', 'icefall', 'tornado', 'thunder', 'rockfall', 'blades', 'prism', 'acid'];
    if (!b.sigK || b.act === 0) {
      b.sigK = all[Math.floor(Math.random() * all.length)];
    }
    return b.sigK;
  }

  bossCol(b) {
    return b.def.emissive || b.def.color || 0xff3344;
  }

  warnColumn(x, y0, y1, color) {
    for (let y = y0; y < y1; y += 0.7) {
      if (Math.random() < 0.5) {
        this.particles.emit(x + (Math.random() - 0.5) * 0.3, y, color, 1, { speed: 0.2, life: 0.12, size: 0.35 });
      }
    }
  }

  bossPattern(b, dt, fury) {
    const p = this.player;
    const rm = this.room;
    const col = this.bossCol(b);
    const floorY = rm ? rm.y : this.groundAt(p.x);
    const topY = rm && !b.hidden ? rm.top - 0.6 : p.y + 9;
    const done = () => {
      b.state = 'idle';
      b.t = 0;
      b.vx = 0;
    };
    const aimP = (ox, oy) => Math.atan2(p.y + 0.9 - oy, p.x - ox);
    const cx = b.x + b.dir * b.w * 0.6;
    const cy = b.y + b.h * 0.6;
    switch (b.state) {
      case 'barrage': {
        // 扇状弾幕（3波）
        const waves = fury ? 3 : 2;
        if (b.act < waves && b.t > 0.35 + b.act * 0.45) {
          const n = fury ? 7 : 5;
          const base = aimP(cx, cy);
          for (let k = 0; k < n; k++) {
            const a = base + (k - (n - 1) / 2) * 0.22 + (b.act % 2 ? 0.11 : 0);
            this.spawnShot('foe', 'orb', cx, cy, b.dir, 0, 'boss', { angle: a, speed: 8, color: col });
          }
          this.particles.emit(cx, cy, col, 10, { ring: true, speed: 3, life: 0.2 });
          play('zap');
          b.act++;
        }
        if (b.t < 0.35) {
          this.particles.emit(cx, cy, col, 1, { speed: 2, life: 0.2, size: 0.4 });
        }
        if (b.t > 0.5 + waves * 0.45) done();
        break;
      }
      case 'spiral': {
        // 回転しながら全方位に撃つ
        b.vx = 0;
        const dur = fury ? 2.2 : 1.6;
        b.spT = (b.spT || 0) - dt;
        if (b.t > 0.3 && b.t < dur && b.spT <= 0) {
          b.spT = fury ? 0.09 : 0.13;
          const a = b.t * 5.5;
          const arms = fury ? 3 : 2;
          for (let k = 0; k < arms; k++) {
            this.spawnShot('foe', 'orb', b.x, b.y + b.h * 0.55, b.dir, 0, 'boss', { angle: a + (k / arms) * Math.PI * 2, speed: 6, color: col });
          }
        }
        b.rig.group.rotation.y = b.t < dur ? b.t * 12 : 0;
        if (b.t > dur + 0.3) {
          b.rig.group.rotation.y = 0;
          done();
        }
        break;
      }
      case 'slam': {
        // 大ジャンプ→急降下→両側に衝撃波
        if (b.act === 0) {
          b.vy = 17;
          b.vx = clamp((p.x - b.x) * 0.9, -7, 7);
          b.act = 1;
          b.onGround = false;
        } else if (b.act === 1 && b.vy < 0) {
          b.vx = 0;
          b.vy = -22;
          b.act = 2;
        } else if (b.act === 2 && b.onGround) {
          b.act = 3;
          play('boom');
          this.shake(0.35);
          this.particles.emit(b.x, b.y + 0.2, 0xd2a070, 20, { ring: true, speed: 8, life: 0.5, size: 0.9 });
          this.particles.emit(b.x, b.y + 0.2, col, 12, { speed: 5, life: 0.5, size: 0.7, grav: -10 });
          for (const d of [-1, 1]) {
            this.spawnShot('foe', 'quake', b.x + d * 0.6, b.y + 0.2, d, 0, 'boss', { color: col });
            if (fury) {
              const s2 = this.spawnShot('foe', 'quake', b.x + d * 0.6, b.y + 0.2, d, 0, 'boss', { color: 0xffffff });
              s2.vx *= 0.55;
            }
          }
        }
        if (b.act === 3 && b.t > 0.4 || b.t > 3) done();
        break;
      }
      case 'teleport': {
        // 消えてプレイヤーの背後に出現→至近距離ショット
        if (b.act === 0) {
          b.act = 1;
          this.particles.emit(b.x, b.y + b.h / 2, col, 18, { ring: true, speed: 5, life: 0.35, size: 0.6 });
          play('dash');
        }
        if (b.act === 1) {
          b.rig.group.visible = false;
          b.inv = 0.1;
          if (b.t > 0.55) {
            const side = p.dir > 0 ? -1 : 1;
            let nx = p.x + side * 3.2;
            if (rm) nx = clamp(nx, rm.x0 + b.w, rm.x1 - b.w);
            b.x = nx;
            b.y = Math.max(floorY, p.y);
            b.vy = 0;
            b.dir = p.x < b.x ? -1 : 1;
            b.act = 2;
            this.particles.emit(b.x, b.y + b.h / 2, col, 18, { ring: true, speed: 4, life: 0.35, size: 0.6 });
            this.particles.emit(b.x, b.y + b.h / 2, 0xffffff, 8, { speed: 3, life: 0.3 });
          }
        }
        if (b.act === 2 && b.t > 0.85) {
          b.act = 3;
          const w = b.weapons[b.wi];
          this.bossShoot(b, w, ['homing', 'spark', 'quake', 'boomerang'].includes(w) ? undefined : aimP(cx, cy));
          if (fury) {
            for (const da of [-0.3, 0.3]) this.spawnShot('foe', 'orb', cx, cy, b.dir, 0, 'boss', { angle: aimP(cx, cy) + da, speed: 9, color: col });
          }
        }
        if (b.t > 1.4) done();
        break;
      }
      case 'summon': {
        // 雑魚召喚
        b.vx = 0;
        if (b.t < 0.8 && Math.random() < 0.6) {
          this.particles.emit(b.x + (Math.random() - 0.5) * 2, b.y + Math.random() * b.h, col, 1, { speed: 1, life: 0.4, size: 0.5, grav: -3 });
        }
        if (b.act === 0 && b.t > 0.8) {
          b.act = 1;
          const pool = ['mini', 'bat', 'mini', 'roller', 'drone'];
          const n = fury ? 3 : 2;
          for (let k = 0; k < n; k++) {
            const tp = pool[Math.floor(Math.random() * pool.length)];
            let x = b.x + (k - (n - 1) / 2) * 2.4;
            if (rm) x = clamp(x, rm.x0 + 1.5, rm.x1 - 1.5);
            const fy = ENEMY_TYPES[tp].fly ? floorY + 3 : floorY + 0.5;
            this.spawnEnemy(tp, x, fy);
            this.particles.emit(x, fy + 0.4, col, 12, { ring: true, speed: 3, life: 0.35 });
          }
          play('warn');
        }
        if (b.t > 1.4) done();
        break;
      }
      case 'sig':
        this.bossSignature(b, dt, fury, { col, floorY, topY, done, aimP, cx, cy });
        break;
      default:
        done();
    }
  }

  bossSignature(b, dt, fury, c) {
    const p = this.player;
    const kind = this.bossSigKind(b);
    const { col, floorY, topY, done, aimP, cx, cy } = c;
    b.vx = 0;
    if (b.act === 0) {
      b.act = 1;
      b.sigTargets = [];
      this.ui.toast('⚡ ' + b.def.name + '：' + ({ erupt: 'ボルカニック・ピラー', icefall: 'フロスト・レイン', tornado: 'サイクロン・ゲイル', thunder: 'サンダー・ジャッジ', rockfall: 'ロック・アバランチ', blades: 'ギア・ストーム', prism: 'プリズム・ケージ', acid: 'ミアズマ・シャワー' }[kind]), 1.2);
      this.particles.emit(b.x, b.y + b.h / 2, col, 20, { ring: true, speed: 6, life: 0.5, size: 0.7 });
      play('warn');
    }
    // 溜めの演出
    if (b.t < 0.5 && Math.random() < 0.8) {
      const a = Math.random() * Math.PI * 2;
      this.particles.emit(b.x + Math.cos(a) * 1.6, b.y + b.h / 2 + Math.sin(a) * 1.6, col, 1, { speed: 0.5, life: 0.25, size: 0.5 });
    }
    const roomX = x => (this.room ? clamp(x, this.room.x0 + 0.8, this.room.x1 - 0.8) : x);
    switch (kind) {
      case 'erupt': {
        // 火柱が足元から順番に噴き上がる（予告あり）
        const n = fury ? 6 : 4;
        if (b.sigTargets.length === 0) {
          for (let k = 0; k < n; k++) b.sigTargets.push({ x: roomX(p.x + (k - 1) * 2.6 * (p.x < b.x ? -1 : 1)), t: 0.5 + k * 0.28, fired: false });
        }
        for (const s of b.sigTargets) {
          if (!s.fired && b.t > s.t - 0.5) this.warnColumn(s.x, floorY, floorY + 0.6, 0xff6622);
          if (!s.fired && b.t > s.t) {
            s.fired = true;
            const sh = this.spawnShot('foe', 'quake', s.x, floorY + 0.1, 1, 0, 'boss', { color: 0xff5511, ov: { vx: 0, life: 0.7 } });
            sh.mesh.scale.set(1, 1.8, 1);
            this.particles.emit(s.x, floorY + 0.5, 0xffaa33, 14, { speed: 6, life: 0.6, size: 0.7, grav: 6 });
            play('boom');
          }
        }
        if (b.t > 0.5 + n * 0.28 + 0.6) done();
        break;
      }
      case 'icefall': {
        const n = fury ? 9 : 6;
        if (b.sigTargets.length === 0) {
          for (let k = 0; k < n; k++) b.sigTargets.push({ x: roomX(p.x + (Math.random() - 0.5) * 12), t: 0.6 + k * 0.17, fired: false });
          b.sigTargets[0].x = p.x;
        }
        for (const s of b.sigTargets) {
          if (!s.fired && b.t > s.t - 0.45) this.warnColumn(s.x, topY - 1.5, topY, 0xbbf4ff);
          if (!s.fired && b.t > s.t) {
            s.fired = true;
            this.spawnShot('foe', 'ice', s.x, topY, 1, 0, 'boss', { angle: -Math.PI / 2, ov: { vy: -14, vx: 0 } });
          }
        }
        if (b.t > 0.6 + n * 0.17 + 0.8) done();
        break;
      }
      case 'tornado': {
        if (b.act === 1 && b.t > 0.55) {
          b.act = 2;
          const dirs = fury ? [-1, 1] : [b.dir];
          for (const d of dirs) {
            const sh = this.spawnShot('foe', 'orb', b.x + d, floorY + 1.2, d, 0, 'boss', { speed: 4.5, color: 0x88ffcc, ov: { beh: 'tornado', r: 0.9, pierce: true, walls: false, life: 3.2 } });
            sh.mesh.scale.set(0.7, 1.6, 0.7);
          }
          play('dash');
        }
        if (b.t > 1.6) done();
        break;
      }
      case 'thunder': {
        // プレイヤー位置に落雷（予告→直撃）
        const n = fury ? 4 : 3;
        if (b.sigTargets.length === 0) {
          for (let k = 0; k < n; k++) b.sigTargets.push({ x: 0, t: 0.7 + k * 0.5, locked: false, fired: false });
        }
        for (const s of b.sigTargets) {
          if (!s.locked && b.t > s.t - 0.55) {
            s.locked = true;
            s.x = roomX(p.x);
          }
          if (s.locked && !s.fired) this.warnColumn(s.x, floorY, topY, 0xffee55);
          if (!s.fired && b.t > s.t) {
            s.fired = true;
            const sh = this.spawnShot('foe', 'laser', s.x, topY, 1, 0, 'boss', { angle: -Math.PI / 2, color: 0xffee55, ov: { life: 0.5 } });
            sh.vx = 0;
            sh.vy = -38;
            this.particles.emit(s.x, floorY + 0.2, 0xffffaa, 16, { ring: true, speed: 6, life: 0.3, size: 0.5 });
            this.shake(0.15);
            play('zap');
          }
        }
        if (b.t > 0.7 + n * 0.5 + 0.4) done();
        break;
      }
      case 'rockfall': {
        const n = fury ? 8 : 5;
        if (b.act === 1 && b.t > 0.4) {
          b.act = 2;
          b.vy = 12;
          b.onGround = false;
        }
        if (b.act === 2 && b.onGround && b.t > 0.6) {
          b.act = 3;
          b.t3 = b.t;
          this.shake(0.3);
          play('boom');
          for (let k = 0; k < n; k++) b.sigTargets.push({ x: roomX(p.x + (Math.random() - 0.5) * 10), t: b.t + 0.3 + k * 0.15, fired: false });
        }
        for (const s of b.sigTargets) {
          if (!s.fired && b.t > s.t - 0.4) this.warnColumn(s.x, topY - 1, topY, 0xd2a070);
          if (!s.fired && b.t > s.t) {
            s.fired = true;
            const sh = this.spawnShot('foe', 'orb', s.x, topY, 1, 0, 'boss', { angle: -Math.PI / 2, speed: 2, color: 0xb07a44, ov: { beh: 'bomb', r: 0.45 } });
            sh.mesh.scale.setScalar(0.5);
          }
        }
        if (b.act === 3 && b.t > b.t3 + 0.5 + n * 0.15 + 0.6 || b.t > 5) done();
        break;
      }
      case 'blades': {
        if (b.act === 1 && b.t > 0.5) {
          b.act = 2;
          const n = fury ? 8 : 6;
          for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2;
            const sh = this.spawnShot('foe', 'boomerang', b.x, b.y + b.h * 0.55, 1, 0, 'boss', { ov: { beh: 'spiral', ang: a, spd: 6, spin: 1.6, life: 2.6, walls: false } });
            sh.vx = Math.cos(a) * 6;
            sh.vy = Math.sin(a) * 6;
          }
          play('slash');
        }
        if (b.t > 1.8) done();
        break;
      }
      case 'prism': {
        // 周囲に光弾を配置→一斉に狙撃
        if (b.act === 1 && b.t > 0.3) {
          b.act = 2;
          const n = fury ? 8 : 6;
          for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2;
            this.spawnShot('foe', 'orb', b.x, b.y + b.h * 0.55, 1, 0, 'boss', { angle: a, speed: 6, color: col, ov: { beh: 'delay', wait: 0.7 + k * 0.08, life: 3 } });
          }
          play('zap');
        }
        if (b.t > 1.9) done();
        break;
      }
      case 'acid': {
        // 放物線の毒弾を扇状にばら撒く
        const waves = fury ? 3 : 2;
        if (b.act >= 1 && b.act <= waves && b.t > 0.4 + (b.act - 1) * 0.45) {
          for (let k = 0; k < 5; k++) {
            const sh = this.spawnShot('foe', 'orb', cx, cy + 0.3, b.dir, 0, 'boss', { color: 0x99ff44, ov: { beh: 'arc', r: 0.28, life: 3 } });
            sh.vx = b.dir * (2 + k * 1.8 + (b.act % 2) * 0.9);
            sh.vy = 9 + Math.random() * 2;
          }
          play('shot');
          b.act++;
        }
        if (b.t > 0.6 + waves * 0.45 + 0.8) done();
        break;
      }
      default:
        done();
    }
  }

  // ボスごとの外見バリエーション（装飾パーツ）
  decorateBoss(b) {
    const g = geo();
    const id = b.def.id;
    const col = this.bossCol(b);
    const H = b.def.height;
    const grp = new THREE.Group();
    const em = c => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.9, metalness: 0.5, roughness: 0.3 });
    const add = (geom, mat, pos, scl, rot) => {
      const m = new THREE.Mesh(geom, mat);
      m.position.set(...pos);
      m.scale.set(...scl);
      if (rot) m.rotation.set(...rot);
      m.userData.own = true;
      grp.add(m);
      this.disposables.push(mat);
      return m;
    };
    const STY = {
      volca: 'horns', frost: 'crystal', storm: 'wings', spark: 'coils', quake: 'pads', boomer: 'gear',
      laser: 'halo', scorpio: 'tail', vile: 'horns', shadow: 'wings', void: 'halo', crimsonx: 'horns',
      trinity: 'crown', guardian: 'pads',
    };
    const st = STY[id];
    if (!st) return;
    if (st === 'horns') {
      for (const s of [-1, 1]) add(g.cone, em(col), [s * H * 0.12, H * 0.98, 0], [H * 0.08, H * 0.25, H * 0.08], [0, 0, -s * 0.5]);
    } else if (st === 'crystal') {
      for (let k = 0; k < 5; k++) add(g.oct, em(0xbbf4ff), [(k - 2) * H * 0.08, H * 0.95 + Math.abs(k - 2) * -0.05, -H * 0.05], [H * 0.04, H * 0.12, H * 0.04]);
      for (const s of [-1, 1]) add(g.oct, em(0x88ddff), [s * H * 0.24, H * 0.72, 0], [H * 0.06, H * 0.14, H * 0.06]);
    } else if (st === 'wings') {
      for (const s of [-1, 1]) {
        const w = add(g.cone, em(col), [0, H * 0.7, -H * 0.15], [H * 0.1, H * 0.5, H * 0.04], [0, 0, s * 1.1]);
        w.userData.flap = s;
      }
    } else if (st === 'coils') {
      for (const s of [-1, 1]) {
        for (let k = 0; k < 3; k++) add(g.torus, em(0xffe033), [s * H * 0.22, H * (0.62 + k * 0.08), 0], [H * 0.09, H * 0.09, H * 0.09], [Math.PI / 2, 0, 0]);
      }
    } else if (st === 'pads') {
      for (const s of [-1, 1]) add(g.box, em(col), [s * H * 0.24, H * 0.74, 0], [H * 0.18, H * 0.12, H * 0.22]);
      add(g.box, em(0x333333), [0, H * 0.4, H * 0.15], [H * 0.3, H * 0.1, H * 0.05]);
    } else if (st === 'gear') {
      const gr = add(g.torus, em(col), [0, H * 0.62, -H * 0.18], [H * 0.3, H * 0.3, H * 0.3]);
      gr.userData.spin = 3;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const t = new THREE.Mesh(g.box, gr.material);
        t.position.set(Math.cos(a) * 0.85, Math.sin(a) * 0.85, 0);
        t.scale.set(0.22, 0.22, 0.2);
        t.rotation.z = a;
        t.userData.own = true;
        gr.add(t);
      }
    } else if (st === 'halo') {
      const h = add(g.torus, em(col), [0, H * 1.08, 0], [H * 0.18, H * 0.18, H * 0.18], [Math.PI / 2, 0, 0]);
      h.userData.spin = 2;
      for (let k = 0; k < 3; k++) {
        const o = add(g.oct, em(0xffffff), [0, H * 0.6, 0], [H * 0.05, H * 0.08, H * 0.05]);
        o.userData.orbit = k;
      }
    } else if (st === 'tail') {
      for (let k = 0; k < 5; k++) add(g.sphere, em(k === 4 ? 0x99ff44 : col), [0, H * (0.3 + k * 0.14), -H * (0.2 + Math.sin(k * 0.6) * 0.15)], [H * 0.07, H * 0.07, H * 0.07]);
      add(g.cone, em(0x99ff44), [0, H * 1.0, -H * 0.12], [H * 0.06, H * 0.14, H * 0.06], [0.8, 0, 0]);
    } else if (st === 'crown') {
      for (let k = 0; k < 3; k++) {
        const a = (k - 1) * 0.6;
        add(g.cone, em([0xff2266, 0xffaa00, 0x66ccff][k]), [Math.sin(a) * H * 0.2, H * 1.0, 0], [H * 0.07, H * 0.2, H * 0.07], [0, 0, -a]);
      }
    }
    b.rig.group.add(grp);
    b.deco = grp;
  }

  animateDeco(b, dt) {
    if (!b.deco) return;
    const H = b.def.height;
    for (const m of b.deco.children) {
      if (m.userData.spin) m.rotation.z += dt * m.userData.spin;
      if (m.userData.flap) m.rotation.z = m.userData.flap * (1.1 + Math.sin(b.t * 8) * 0.25);
      if (m.userData.orbit !== undefined) {
        const a = b.t * 2.5 + (m.userData.orbit / 3) * Math.PI * 2;
        m.position.set(Math.cos(a) * H * 0.45, H * 0.6 + Math.sin(a * 2) * 0.2, Math.sin(a) * H * 0.45);
      }
    }
  }

  updateBoss(b, dt) {
    const p = this.player;
    b.t += dt;
    b.flash -= dt;
    b.inv -= dt;
    if (b.dying) {
      b.dying -= dt;
      if (Math.random() < 0.4) {
        this.particles.emit(b.x + (Math.random() - 0.5) * 2, b.y + Math.random() * b.h, 0xffaa33, 6, { speed: 3, life: 0.4, size: 0.8 });
        if (Math.random() < 0.3) {
          play('boom');
        }
      }
      if (b.dying <= 0) {
        this.finishBoss(b);
      }
      return;
    }
    const fury = b.hp < b.max / 2 || b.phase === 2;
    if (b.stun > 0) {
      b.stun -= dt;
      b.vx = 0;
    } else {
      switch (b.state) {
        case 'intro':
          if (b.onGround || b.grounded || b.t > 3) {
            b.hp = Math.min(b.max, b.hp + b.max * dt / 1.2);
            this.ui.setBoss(b.hp, b.max, b.def.name);
            if (b.hp >= b.max) {
              b.state = 'idle';
              b.t = 0;
              b.grounded = false;
            }
          }
          break;
        case 'idle': {
          b.vx = 0;
          b.dir = p.x < b.x ? -1 : 1;
          if (b.t > (fury ? 0.45 : 0.85)) {
            b.state = this.pickBossState(b, fury);
            b.lastState = b.state;
            b.t = 0;
            b.act = 0;
            b.wi = (b.wi + 1) % b.weapons.length;
          }
          break;
        }
        case 'barrage':
        case 'spiral':
        case 'slam':
        case 'teleport':
        case 'summon':
        case 'sig':
          this.bossPattern(b, dt, fury);
          break;
        case 'shoot': {
          const times = fury ? [0.2, 0.45, 0.7, 0.95] : [0.25, 0.6, 0.95];
          if (b.act < times.length && b.t > times[b.act]) {
            const aim = Math.atan2(p.y + 0.9 - (b.y + b.h * 0.6), p.x - b.x);
            const w = b.weapons[b.wi];
            this.bossShoot(b, w, ['homing', 'spark', 'quake', 'boomerang'].includes(w) ? undefined : aim);
            b.act++;
          }
          if (b.t > (fury ? 1.2 : 1.4)) {
            b.state = 'idle';
            b.t = 0;
          }
          break;
        }
        case 'leap':
          if (b.act === 0) {
            b.vy = 15;
            b.vx = clamp((p.x - b.x) * 1.1, -9, 9);
            b.act = 1;
            b.onGround = false;
          } else if (b.onGround && b.t > 0.2) {
            b.vx = 0;
            play('hit');
            this.particles.emit(b.x, b.y, 0xd2a070, 12, { speed: 5, life: 0.4, size: 0.7 });
            if (fury) {
              this.spawnShot('foe', 'quake', b.x, b.y + 0.2, 1, 0, 'boss');
              this.spawnShot('foe', 'quake', b.x, b.y + 0.2, -1, 0, 'boss');
            }
            b.state = 'idle';
            b.t = 0;
          }
          break;
        case 'dash':
          if (b.t < 0.4) {
            b.vx = 0;
            if (Math.random() < 0.5) {
              this.particles.emit(b.x, b.y + b.h / 2, b.def.emissive || b.def.color || 0xff4444, 1, { speed: 2, life: 0.3 });
            }
          } else {
            b.vx = b.dir * (fury ? 14 : 11);
            if (b.hitWall || b.t > 1.3) {
              b.state = 'idle';
              b.t = 0;
              b.vx = 0;
            }
          }
          break;
        case 'rain':
          if (b.act === 0) {
            b.vy = 12;
            b.act = 1;
          }
          if (b.act >= 1 && b.act < (fury ? 8 : 5) && b.t > 0.35 + b.act * 0.16) {
            const x = p.x + (Math.random() - 0.5) * 8;
            this.spawnShot('foe', 'orb', x, p.y + 9, 1, 0, 'boss', { angle: -Math.PI / 2, speed: 9, color: b.def.emissive || b.def.color || 0xff3344 });
            b.act++;
          }
          if (b.t > 2) {
            b.state = 'idle';
            b.t = 0;
          }
          break;
        default:
          b.state = 'idle';
      }
    }
    b.vy = Math.max(-22, b.vy + GRAV * dt);
    this.moveBody(b, dt);
    const rm = this.room;
    if (rm && !b.hidden) {
      // ボスは必ず部屋の中に留める（天井の上に乗らない）
      if (b.y + b.h > rm.top - 0.05) {
        b.y = rm.top - b.h - 0.06;
        b.vy = Math.min(b.vy, 0);
      }
      b.x = clamp(b.x, rm.x0 + b.w / 2 + 0.05, rm.x1 - b.w / 2 - 0.05);
    }
    if (b.y < -14) {
      b.y = (rm ? rm.y : this.groundAt(p.x)) + 4;
      b.vy = 0;
    }
    if (b.state !== 'intro' && !(b.state === 'teleport' && b.act === 1) && !p.dead && this.overlap(p, { x0: b.x - b.w / 2, x1: b.x + b.w / 2, y0: b.y, y1: b.y + b.h })) {
      this.hurtPlayer(4, 'boss');
    }
  }

  // ---------------- main update ----------------
  update(dt) {
    this.time += dt;
    this.boomCD -= dt;
    if (this.readyT > 0) {
      this.readyT -= dt;
    }
    const p = this.player;
    if (input.wasPressed('pause') && this.cfg.onPause) {
      this.cfg.onPause();
      return;
    }
    this.updatePlayer(p, dt);
    this.updateEnemies(dt);
    this.shotSrc = null;
    for (let i = this.bosses.length - 1; i >= 0; i--) {
      if (this.bosses[i]) {
        this.shotSrc = this.bossSrc(this.bosses[i]);
        this.updateBoss(this.bosses[i], dt);
      }
    }
    this.shotSrc = null;
    this.updateShots(dt);
    this.updateItems(dt);
    // stage events
    const st = this.stage;
    if (st.tips) {
      st.tips.forEach((tip, i) => {
        if (!this.tipsShown.has(i) && p.x > tip.x) {
          this.tipsShown.add(i);
          this.ui.toast(tip.text, 4.5);
        }
      });
    }
    if (!this.hiddenTriggered && p.x > this.length * 0.45 && !p.dead) {
      this.hiddenTriggered = true;
      this.hiddenActive = true;
      play('warn');
      this.ui.banner('WARNING', 'warning', 2.4);
      setTimeout(() => {
        if (this.running && this.hiddenActive && this.world) {
          const x = this.player.x + 8;
          this.spawnBoss(st.hidden, x, this.groundAt(x), { hidden: true, hiddenIdx: st.hiddenIdx });
        }
      }, 1600);
    }
    this.updateCapsule(dt);
    // ボス部屋に完全に入ってから（通路を抜けて床に着いた状態）ボス戦開始
    // 赤いゲート（通路の高さ）を左から右へ通過した場合のみ「入室」扱い。天井の上などからは絶対に始まらない
    let inRoom = false;
    if (this.room && !p.dead) {
      const R = this.room;
      const inCorrBand = p.y >= R.y - 0.6 && p.y < R.corrTop - 0.2;
      if (p._gateLastX !== undefined && p._gateLastX < R.x0 + 0.2 && p.x >= R.x0 - 0.7 && inCorrBand) {
        if (p.x > R.x0 - 0.7) p.gatePassed = true;
      }
      if (p.x < R.x0 - 1.2 || p.y >= R.top - 0.3) p.gatePassed = false;
      p._gateLastX = p.x;
      inRoom = !!p.gatePassed && p.onGround && p.y < R.top - 1 && p.y >= R.y - 0.6 &&
        p.x - p.w / 2 > R.x0 + 1.5 && p.x < R.x1;
    }
    if (this.gate && !this.bossTriggered && !this.hiddenActive && inRoom && (this.mode === 'solo' || this.mode === 'coop')) {
      this.triggerBossFight();
    }
    if (this.nextBossT > 0) {
      this.nextBossT -= dt;
      if (this.nextBossT <= 0 && this.bossQueue.length) {
        const def = this.bossQueue.shift();
        const x = this.room.x1 - 3;
        this.spawnBoss(def, x, this.room.y);
      }
    }
    if (this.clearT >= 0) {
      this.clearT += dt;
      if (this.clearT > 3.2) {
        this.end('clear');
        return;
      }
    }
    if (this.net) {
      this.updateNet(dt);
    }
  }

  // ---------------- visuals ----------------
  updateVisuals(dt) {
    const p = this.player;
    this.particles.update(dt);
    // player rig
    this.poseRig(p.rig, p, dt, this.animFor(p));
    if (p.barrier) {
      p.barrierT = (p.barrierT || 0) - dt;
      const on = p.barrierT > 0;
      p.barrier.visible = on;
      if (on) {
        const k = p.barrierT / 0.7;
        p.barrier.material.opacity = 0.6 * k;
        p.barrier.children[0].material.opacity = 0.25 * k;
        p.barrier.scale.setScalar(1 + (1 - k) * 0.35);
        p.barrier.rotation.y += dt * 4;
        p.barrier.rotation.x += dt * 2;
      }
    }
    for (const sh of this.shots) {
      if (sh.od && Math.random() < 0.5) {
        this.particles.emit(sh.x, sh.y, Math.random() < 0.5 ? 0xffcc33 : 0xffffff, 1, { speed: 1.5, life: 0.3, size: 0.45 });
      }
    }
    p.rig.group.visible = !p.dead && (p.inv <= 0 || Math.floor(this.time * 20) % 2 === 0);
    const gl = p.rig.glow;
    if (p.charge > 0.6 && p.weapons[0] !== 'saber' || p.charge > 1.2) {
      gl.visible = true;
      const col = p.chargeLv === 2 ? (Math.floor(this.time * 15) % 2 ? 0x66ddff : 0xff66ee) : 0x88ffcc;
      gl.material = spriteMat(col);
      gl.position.set(p.dir * 0.5, p.h * 0.6, 0.6);
      gl.scale.setScalar(p.chargeLv === 2 ? 1.6 : 1);
      if (Math.random() < 0.3) {
        this.particles.emit(p.x, p.y + p.h / 2, col, 1, { speed: 2, life: 0.3, size: 0.3 });
      }
    } else {
      gl.visible = false;
    }
    for (const e of this.enemies) {
      e.rig.group.position.set(e.x, e.y, 0);
      e.rig.inner.rotation.y = e.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      e.rig.group.visible = e.flash <= 0 || Math.floor(this.time * 30) % 2 === 0;
      if (e.rig.mixer) {
        playAnim(e.rig, 'walk');
        e.rig.mixer.update(dt);
      } else if (e.type === 'drone') {
        e.rig.inner.rotation.y += dt * 3;
      }
      if (e.rig.shield) {
        e.rig.shield.position.x = e.dir * 0.55;
      }
    }
    for (const b of this.bosses) {
      const anim = b.state === 'intro' ? (b.onGround ? 'idle' : 'jump') : !b.onGround ? 'jump' : b.state === 'dash' && b.t > 0.4 ? 'run' : b.state === 'shoot' ? 'shoot' : Math.abs(b.vx) > 0.2 ? 'run' : 'idle';
      this.poseRig(b.rig, b, dt, anim);
      this.animateDeco(b, dt);
      if (b.state !== 'spiral') {
        b.rig.group.rotation.y = 0;
      }
      const hiding = b.state === 'teleport' && b.act === 1;
      b.rig.group.visible = !hiding && (b.flash <= 0 || Math.floor(this.time * 30) % 2 === 0);
      if (b.dying) {
        b.rig.group.position.x += (Math.random() - 0.5) * 0.15;
      }
    }
    if (this.net) {
      for (const gh of Object.values(this.net.ghosts)) {
        gh.x += (gh.tx - gh.x) * Math.min(1, dt * 12);
        gh.y += (gh.ty - gh.y) * Math.min(1, dt * 12);
        this.poseRig(gh.rig, gh, dt, gh.anim);
        gh.rig.group.visible = gh.visible;
      }
    }
    this.updateCamera(dt);
  }

  animFor(p) {
    if (!p.onGround) {
      return 'jump';
    }
    if (p.slashT > 0) {
      return 'sword';
    }
    if (p.shootAnim > 0) {
      return 'shoot';
    }
    if (Math.abs(p.vx) > 0.2) {
      return 'run';
    }
    return 'idle';
  }

  poseRig(rig, o, dt, anim) {
    rig.group.position.set(o.x, o.y, 0);
    const targetRot = o.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    rig.inner.rotation.y += (targetRot - rig.inner.rotation.y) * Math.min(1, dt * 18);
    if (rig.mixer) {
      if (anim === 'shoot' && !Object.keys(rig.actions).some(k => k.includes('shoot'))) {
        anim = 'idle';
      }
      if (anim === 'sword' && !Object.keys(rig.actions).some(k => k.includes('sword'))) {
        anim = 'idle';
      }
      playAnim(rig, anim);
      rig.mixer.update(dt);
    } else {
      const t = this.time;
      rig.inner.position.y = anim === 'run' ? Math.abs(Math.sin(t * 14)) * 0.1 : anim === 'idle' ? Math.sin(t * 3) * 0.02 : 0;
      rig.inner.rotation.z = 0;
      rig.inner.rotation.x = anim === 'run' ? 0.15 : anim === 'jump' ? -0.1 : 0;
      if (anim === 'sword') {
        rig.inner.rotation.x = 0.35;
      }
    }
  }

  updateCamera(dt) {
    const p = this.player;
    const hw = this.halfW();
    let tx = p.x + p.dir * 1.6;
    if (this.bossLock && this.room) {
      const rw = (this.room.x1 - this.room.x0) / 2;
      tx = hw >= rw ? this.room.cx : clamp(p.x, this.room.x0 + hw, this.room.x1 - hw);
    }
    tx = clamp(tx, this.minX + hw - 1, Math.max(this.minX + hw - 1, this.maxX - hw + 1));
    if (this.stage.arena) {
      tx = hw >= 22 ? 0 : clamp(p.x, -22 + hw, 22 - hw);
    }
    const ty = p.dead ? this.camY : p.y + 1.8;
    this.camX += (tx - this.camX) * Math.min(1, dt * 6);
    this.camY += (ty - this.camY) * Math.min(1, dt * 4);
    let sx = 0;
    let sy = 0;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const a = Math.min(0.35, this.shakeT) * 1.2;
      sx = (Math.random() - 0.5) * a;
      sy = (Math.random() - 0.5) * a;
    }
    this.camera.position.set(this.camX + sx, this.camY + 1.4 + sy, this.camDist);
    this.camera.lookAt(this.camX + sx, this.camY + sy, 0);
    this.bg.position.x = this.camX * 0.85;
    this.bg.position.y = 14 + this.camY * 0.5;
    this.accentLight.position.set(p.x, p.y + 3, 4);
  }

  // ---------------- networking ----------------
  attachNet(room, { hostile = false, only = null, quiet = false } = {}) {
    this.net = { room, hostile, only, quiet, ghosts: {}, sendT: 0, unsubs: [], targetSeen: false, lostT: 0, rate: {} };
    const n = this.net;
    n.unsubs.push(room.on('shot', e => {
      if (!this.running || e.stage !== this.stage.id || n.only && e.from !== n.only) {
        return;
      }
      // 不正データ対策：弾種・座標・段階を検証し、連射しすぎる送信元は間引く
      if (!SHOT_TYPES.has(e.type) || !Number.isFinite(e.x) || !Number.isFinite(e.y) || Math.abs(e.x) > 5000 || Math.abs(e.y) > 5000) {
        return;
      }
      e.dir = e.dir < 0 ? -1 : 1;
      e.level = Math.max(0, Math.min(2, e.level | 0));
      const now = performance.now();
      const rl = n.rate[e.from] || (n.rate[e.from] = { t: now, c: 0 });
      if (now - rl.t > 1000) {
        rl.t = now;
        rl.c = 0;
      }
      if (++rl.c > 30) {
        return;
      }
      const sh = this.spawnShot(n.hostile ? 'foe' : 'ally', e.type, e.x, e.y, e.dir, e.level, e.from);
      if (sh && e.type === 'slash' && n.ghosts[e.from]) {
        sh.follow = n.ghosts[e.from];
      }
    }));
    n.hpOf = {};
    n.unsubs.push(room.on('hp', e => {
      if (e && e.from && typeof e.hp === 'number' && (!e.stage || !this.stage || e.stage === this.stage.id)) {
        const max = num(e.max, 1, 200, 28);
        n.hpOf[e.from] = { hp: num(e.hp, 0, max, 0), max, name: String(e.name || '').slice(0, 24), t: performance.now() };
      }
    }));
    n.unsubs.push(room.on('ko', e => this.onKO(e)));
    n.unsubs.push(room.on('clear', () => {
      if (this.running && this.mode === 'coop' && this.clearT < 0) {
        this.clearT = 0;
        this.ui.banner('MISSION COMPLETE', 'clear', 3);
      }
    }));
  }

  setInvader(pid) {
    if (!this.net || !this.running) {
      return;
    }
    this.net.only = pid;
    this.net.quiet = false;
    this.net.hostile = true;
    play('warn');
    this.ui.banner('WARNING', 'warning', 2.6);
    this.ui.toast('侵入者「宇邇宮」が現れた！ 迎え撃て！', 3);
  }

  detachNet() {
    if (!this.net) {
      return;
    }
    this.net.unsubs.forEach(u => {
      try {
        u();
      } catch (e) {
        // ignore
      }
    });
    Object.values(this.net.ghosts).forEach(g => this.world && this.world.remove(g.rig.group));
    this.drawRivalHP(null);
    try {
      this.net.room.presence({ inGame: false });
    } catch (e) {
      // ignore
    }
    this.net = null;
  }

  emitShot(type, x, y, dir, level) {
    if (this.net && !this.net.quiet) {
      this.net.room.emit('shot', { type, x, y, dir, level, stage: this.stage.id });
    }
  }

  onKO(e) {
    if (!this.running) {
      return;
    }
    if (this.mode === 'versus') {
      this.scores[e.killer] = (this.scores[e.killer] || 0) + 1;
      const mine = this.scores[myId] || 0;
      this.ui.setScore('KO ' + mine);
      if (e.killer === myId) {
        this.ui.toast('撃破！', 1.2);
      }
      if (this.scores[e.killer] >= 3) {
        this.ui.banner(e.killer === myId ? 'YOU WIN' : 'YOU LOSE', 'clear', 2.5);
        setTimeout(() => this.end('versus', { win: e.killer === myId, scores: { ...this.scores } }), 2200);
        this.clearT = -2;
      }
    } else if (this.mode === 'invader') {
      if (e.killer === myId) {
        this.ui.banner('ターゲット撃破', 'clear', 2.5);
        setTimeout(() => this.end('invadeEnd', { win: true }), 2500);
      }
    } else if (this.net && this.net.only && e.victim === this.net.only) {
      this.ui.banner('侵入者撃退！', 'clear', 2.5);
      this.net.only = '__none__';
      this.net.quiet = true;
    }
  }

  // 他プレイヤーのHPパネル（人数分の行・ボスバーとは独立したDOM／textContentのみ使用）
  drawRivalHP(rows, label = '') {
    // 軽量化：内容が変わらないフレームはDOMに触れない
    const sig = rows && rows.length ? label + rows.map(r => `${r.name}:${Math.round(r.hp)}/${r.max}`).join('|') : '';
    if (sig === this._rivSig) {
      return;
    }
    this._rivSig = sig;
    let el = document.getElementById('rivalhp');
    if (!rows || !rows.length) {
      if (el) el.style.display = 'none';
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.id = 'rivalhp';
      el.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top) + 10px);z-index:30;pointer-events:none;'
        + 'min-width:200px;width:40vw;max-width:400px;display:flex;flex-direction:column;gap:4px;font:12px "DotGothic16",sans-serif;color:#ffe8ea;text-shadow:1px 1px 0 #000;';
      (document.getElementById('game-container') || document.body).appendChild(el);
    }
    const ally = label === '味方';
    while (el.children.length < rows.length) {
      const row = document.createElement('div');
      row.style.cssText = 'padding:3px 8px 5px;background:rgba(10,8,16,.75);border:2px solid;border-radius:6px;';
      const head = document.createElement('div');
      head.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:2px';
      head.append(document.createElement('span'), document.createElement('span'));
      const bar = document.createElement('div');
      bar.style.cssText = 'height:8px;background:#1a0a10;border:1px solid #000';
      const fill = document.createElement('i');
      fill.style.cssText = 'display:block;height:100%;transition:width .15s';
      bar.append(fill);
      row.append(head, bar);
      el.append(row);
    }
    while (el.children.length > rows.length) {
      el.lastChild.remove();
    }
    rows.forEach((r, i) => {
      const row = el.children[i];
      const max = Math.max(1, r.max || 1);
      const hp = Math.max(0, Math.min(max, Math.round(r.hp)));
      row.style.borderColor = ally ? '#4fc8ff' : '#ff4a5a';
      const [l, v] = row.firstChild.children;
      l.textContent = `${label} ${r.name || ''}`;
      v.textContent = `HP ${hp}/${max}`;
      const f = row.lastChild.firstChild;
      f.style.width = `${(hp / max) * 100}%`;
      f.style.background = ally ? 'linear-gradient(#9ee4ff,#1c8ad0)' : 'linear-gradient(#ff8a96,#d0182c)';
    });
    el.style.display = 'flex';
  }

  updateNet(dt) {
    const n = this.net;
    const p = this.player;
    n.sendT -= dt;
    if (n.sendT <= 0) {
      n.sendT = 1 / 15;
      n.room.presence({
        inGame: true, stage: this.stage.id, mode: this.mode, x: +p.x.toFixed(2), y: +p.y.toFixed(2), dir: p.dir,
        kit: p.kit.id, anim: this.animFor(p), dead: p.dead, name: p.kit.name,
        // 見た目情報も同送：受信側のデータ版が違っても正しい外見で描画する
        hp: Math.max(0, Math.round(p.hp)), max: p.max,
        ver: NET_VER, km: p.kit.model, kh: p.kit.height || 1.75, kt: p.kit.tint ?? null, ke: p.kit.emissive ?? null, kf: !!p.kit.flail,
      });
    }
    const peers = n.room.peers;
    const seen = new Set();
    for (const pid in peers) {
      const pr = peers[pid];
      if (!pr.inGame || pr.stage !== this.stage.id || (n.only && pid !== n.only)) {
        continue;
      }
      if (this.mode === 'solo' && !n.only) {
        continue;
      }
      seen.add(pid);
      let gh = n.ghosts[pid];
      if (!pr.kit) {
        continue;
      }
      if (pr.ver !== NET_VER && !n.verWarned) {
        n.verWarned = true;
        const mine = NET_VER > (pr.ver || 0);
        this.ui.toast(mine ? '相手の端末が古い版です。相手にページの再読み込みをお願いしてください' : 'この端末は古い版です。ページを再読み込みしてください', 5);
      }
      const look = `${pr.kit}|${pr.km || ''}|${pr.kf ? 1 : 0}|${pr.km && hasModel(pr.km) ? 1 : 0}`;
      if (gh && gh.look !== look) {
        // 古いプレゼンス（前回のキャラ）で作られたゴーストを作り直す
        this.world.remove(gh.rig.group);
        delete n.ghosts[pid];
        gh = null;
      }
      if (!gh) {
        let kit = findKit(pr.kit);
        if (pr.km && NET_MODELS.has(pr.km)) {
          // 送信側の外見情報を優先（値は検証・範囲制限して使用）
          kit = { ...(kit.id === pr.kit ? kit : {}), id: String(pr.kit).slice(0, 32), name: String(pr.name || kit.name).slice(0, 24), model: pr.km, height: num(pr.kh, 0.8, 4, 1.75), tint: Number.isFinite(pr.kt) ? pr.kt : undefined, emissive: Number.isFinite(pr.ke) ? pr.ke : undefined, flail: !!pr.kf };
        }
        gh = { pid, look, kitId: pr.kit, kit, rig: this.makeRig(kit), x: pr.x, y: pr.y, tx: pr.x, ty: pr.y, w: kit.flail ? 1.1 : 0.8, h: kit.height || 1.7, dir: 1, anim: 'idle', visible: true };
        n.ghosts[pid] = gh;
      }
      gh.tx = num(pr.x, -5000, 5000, gh.tx);
      gh.ty = num(pr.y, -5000, 5000, gh.ty);
      gh.name = String(pr.name || gh.kit.name || '').slice(0, 24);
      gh.dir = pr.dir;
      gh.anim = pr.anim || 'idle';
      gh.visible = !pr.dead;
    }
    for (const pid in n.ghosts) {
      if (!seen.has(pid)) {
        this.world.remove(n.ghosts[pid].rig.group);
        delete n.ghosts[pid];
      }
    }
    // 侵入戦のHP共有：専用トピックで送信（変化時＋0.5秒ごと）し、相手のHPを専用パネルに表示
    const hv = Math.max(0, Math.round(p.hp));
    n.hpT = (n.hpT || 0) - dt;
    const invading = n.only && n.only !== '__none__';
    const online = this.mode === 'coop' || this.mode === 'versus';
    if ((invading || online) && (hv !== n.lastHp || n.hpT <= 0)) {
      n.lastHp = hv;
      n.hpT = 0.5;
      n.room.emit('hp', { hp: hv, max: p.max, name: p.kit.name, stage: this.stage.id });
    }
    // 表示対象：侵入戦は相手1人、協力・対戦は同じステージの全プレイヤー
    const ids = invading ? [n.only] : online ? Object.keys(n.ghosts) : [];
    const rows = [];
    for (const id of ids) {
      const ev = n.hpOf && n.hpOf[id];
      const pr = peers[id];
      const gh = n.ghosts[id];
      let r = null;
      if (ev && performance.now() - ev.t < 4000) {
        r = { ...ev };
      } else if (pr && Number.isFinite(pr.hp) && pr.stage === this.stage.id) {
        const max = num(pr.max, 1, 200, 28);
        r = { hp: num(pr.hp, 0, max, 0), max, name: String(pr.name || '').slice(0, 24) };
      }
      if (r) {
        r.name = r.name || (gh && gh.name) || '';
        rows.push(r);
      }
    }
    const label = this.mode === 'invader' ? 'ターゲット' : invading ? '侵入者' : this.mode === 'versus' ? '相手' : '味方';
    this.drawRivalHP(rows, label);
    if (this.mode === 'invader') {
      const tg = n.ghosts[n.only];
      if (tg && !n.targetSeen) {
        n.targetSeen = true;
        let x = tg.tx + 12;
        if (this.groundAt(x) < -15) {
          x = tg.tx + 6;
        }
        p.x = x;
        p.y = this.groundAt(x) + 0.1;
        p.dir = -1;
        this.camX = p.x;
        this.ui.banner('INVADE!', 'warning', 1.6);
      }
      if (n.targetSeen && !tg) {
        n.lostT += dt;
        if (n.lostT > 5) {
          this.end('invadeEnd', { win: false, lost: true });
        }
      } else {
        n.lostT = 0;
      }
    }
    if (n.only && n.only !== '__none__' && this.mode === 'solo' && !n.ghosts[n.only]) {
      n.lostT += dt;
      if (n.lostT > 6) {
        n.only = '__none__';
        n.quiet = true;
        this.ui.toast('侵入者は去った', 2);
      }
    }
  }
}
