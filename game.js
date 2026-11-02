// Core side-scrolling 3D action engine.
import * as THREE from 'three';
import { WEAPONS, findKit } from './data.js';
import { input } from './input.js';
import { play, playMusic, setTrack } from './audio.js';
import { makeModel, playAnim, getTexture } from './assets.js';
import { myId } from './net.js';

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
    for (let i = 0; i < 240; i++) {
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
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
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
    this.renderer.render(this.scene, this.camera);
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
        this.spawns.push({ type, x: ex, y: type === 'drone' ? nh + 2.5 + R() * 1.5 : nh, done: false });
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
    const corrType = st.enemies.find(e => e !== 'drone') || 'walker';
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
    if (team === 'foe' && owner === 'boss') {
      sh.dmg = Math.ceil(sh.dmg * 1.3) + 1;
    }
    const od = team === 'ally' && owner === myId && (this.parts & 4) && this.mode !== 'versus';
    if (od) {
      sh.dmg *= 1.5;
      sh.r *= 1.3;
    }
    sh.color = color;
    let mesh;
    if (vis === 'crescent') {
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
    } else {
      mesh = new THREE.Mesh(g.sphere, basicMat(0xffffff));
      mesh.scale.setScalar(sh.r * 0.7);
    }
    const gl = new THREE.Sprite(spriteMat(color));
    gl.scale.setScalar(vis === 'orb' ? 6 : 3);
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

  removeShot(i, spark = true) {
    const sh = this.shots[i];
    if (spark) {
      this.particles.emit(sh.x, sh.y, sh.color, 5, { speed: 3, life: 0.25, size: 0.4 });
    }
    this.world.remove(sh.mesh);
    this.shots.splice(i, 1);
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
        default:
          break;
      }
      sh.x += sh.vx * dt;
      sh.y += sh.vy * dt;
      sh.mesh.position.set(sh.x, sh.y, 0.3);
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
    if (type === 'walker' || type === 'shielder') {
      rig = makeModel('enemy-walker', { height: def.h + 0.1, tint: type === 'shielder' ? 0x6677aa : null });
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
    const e = { type, rig, x, y, baseY: y, w: def.w, h: def.h, vx: 0, vy: 0, hp: def.hp, dir: -1, t: Math.random() * 2, shootT: 1.5 + Math.random(), fly: !!def.fly, flash: 0, onGround: false };
    this.enemies.push(e);
    return e;
  }

  killEnemy(e) {
    e.dead = true;
    this.world.remove(e.rig.group);
    this.particles.emit(e.x, e.y + e.h / 2, 0xffaa33, 14, { speed: 5, life: 0.5, size: 0.7 });
    this.particles.emit(e.x, e.y + e.h / 2, 0xffffff, 6, { ring: true, speed: 3, life: 0.3 });
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
      e.shootT -= dt;
      e.flash -= dt;
      const toP = p.x < e.x ? -1 : 1;
      const aim = Math.atan2(p.y + 0.9 - (e.y + e.h * 0.6), p.x - e.x);
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
        default:
          break;
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
        this.hurtPlayer(3, 'boss');
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
            const r = Math.random();
            b.state = r < 0.38 ? 'shoot' : r < 0.62 ? 'leap' : r < 0.82 ? 'dash' : 'rain';
            b.t = 0;
            b.act = 0;
            b.wi = (b.wi + 1) % b.weapons.length;
          }
          break;
        }
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
    if (b.state !== 'intro' && !p.dead && this.overlap(p, { x0: b.x - b.w / 2, x1: b.x + b.w / 2, y0: b.y, y1: b.y + b.h })) {
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
    for (let i = this.bosses.length - 1; i >= 0; i--) {
      if (this.bosses[i]) {
        this.updateBoss(this.bosses[i], dt);
      }
    }
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
      b.rig.group.visible = b.flash <= 0 || Math.floor(this.time * 30) % 2 === 0;
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
    this.camera.position.set(this.camX, this.camY + 1.4, this.camDist);
    this.camera.lookAt(this.camX, this.camY, 0);
    this.bg.position.x = this.camX * 0.85;
    this.bg.position.y = 14 + this.camY * 0.5;
    this.accentLight.position.set(p.x, p.y + 3, 4);
  }

  // ---------------- networking ----------------
  attachNet(room, { hostile = false, only = null, quiet = false } = {}) {
    this.net = { room, hostile, only, quiet, ghosts: {}, sendT: 0, unsubs: [], targetSeen: false, lostT: 0 };
    const n = this.net;
    n.unsubs.push(room.on('shot', e => {
      if (!this.running || e.stage !== this.stage.id || n.only && e.from !== n.only) {
        return;
      }
      const sh = this.spawnShot(n.hostile ? 'foe' : 'ally', e.type, e.x, e.y, e.dir, e.level, e.from);
      if (sh && e.type === 'slash' && n.ghosts[e.from]) {
        sh.follow = n.ghosts[e.from];
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

  updateNet(dt) {
    const n = this.net;
    const p = this.player;
    n.sendT -= dt;
    if (n.sendT <= 0) {
      n.sendT = 1 / 15;
      n.room.presence({
        inGame: true, stage: this.stage.id, mode: this.mode, x: +p.x.toFixed(2), y: +p.y.toFixed(2), dir: p.dir,
        kit: p.kit.id, anim: this.animFor(p), dead: p.dead, name: p.kit.name,
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
      if (!gh) {
        const kit = findKit(pr.kit);
        gh = { pid, rig: this.makeRig(kit), x: pr.x, y: pr.y, tx: pr.x, ty: pr.y, w: 0.8, h: 1.7, dir: 1, anim: 'idle', visible: true };
        n.ghosts[pid] = gh;
      }
      gh.tx = pr.x;
      gh.ty = pr.y;
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
