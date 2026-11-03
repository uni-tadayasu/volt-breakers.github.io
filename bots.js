// オフライン対戦：COM（ボット）をローカルの疑似ルームとして動かす。
// Room（net.js）と同じインターフェース（peers / on / emit / presence / onPeers / leave）を持つため、
// ゲーム本体はオンライン対戦と同じコードで描画・HP表示・KO集計ができる。
import { NET_VER, SHOT_TYPES, arenaSpawnX } from './game.js';
import { play } from './audio.js';

const GRAV = -38;
const DIFF = {
  easy: { cd: 1.3, aim: 1.6, speed: 4.6, charge: 0.05 },
  normal: { cd: 0.85, aim: 2.2, speed: 5.6, charge: 0.15 },
  hard: { cd: 0.5, aim: 3.0, speed: 6.6, charge: 0.3 },
};

export class LocalRoom {
  /**
   * @param {Array<{kit:object}>} bots COMのキャラ（1〜3体）
   * @param {string} difficulty 'easy' | 'normal' | 'hard'
   * @param {number} total 自分を含む人数（スポーン位置の均等割りに使用）
   */
  constructor(bots, difficulty = 'normal', total = bots.length + 1) {
    this.local = true;
    this.peers = {};
    this.listeners = {};
    this.peerListeners = new Set();
    this.diff = DIFF[difficulty] || DIFF.normal;
    this.total = total;
    this.shots = [];
    this.bots = bots.slice(0, 3).map((b, i) => {
      const kit = b.kit;
      const melee = kit.weapon === 'saber' || !!kit.flail;
      return {
        id: `com-${i + 1}`, kit, slot: i + 1, melee, x: 0, y: 0, vx: 0, vy: 0, w: kit.flail ? 1.1 : 0.8, h: Math.min(1.7, (kit.height || 1.75) * 0.9),
        dir: -1, hp: kit.hp, max: kit.hp, dead: false, respawnT: 0, cd: 1 + Math.random(), think: 0, inv: 0, onGround: false, anim: 'idle', animT: 0,
        name: `COM${i + 1} ${kit.name}`, spawned: false,
      };
    });
  }

  on(topic, cb) {
    (this.listeners[topic] || (this.listeners[topic] = new Set())).add(cb);
    return () => this.listeners[topic] && this.listeners[topic].delete(cb);
  }

  fire(topic, data) {
    (this.listeners[topic] || []).forEach(cb => cb(data));
  }

  // 自分の送信（KO・HP・弾）はゲーム側で処理済みのため何もしない
  emit() {}

  presence() {}

  onPeers(fn) {
    this.peerListeners.add(fn);
    fn(this.peers);
    return () => this.peerListeners.delete(fn);
  }

  leave() {
    this.listeners = {};
    this.peerListeners.clear();
    this.peers = {};
  }

  spawn(b, game, slot) {
    const x = arenaSpawnX(slot, this.total);
    Object.assign(b, { x, y: game.groundAt(x) + 0.05, vx: 0, vy: 0, hp: b.max, dead: false, inv: 1.5, dir: x > 0 ? -1 : 1, spawned: true });
  }

  // プレイヤーの弾がCOMに命中
  hitPeer(id, dmg, by, game) {
    const b = this.bots.find(o => o.id === id);
    if (b) {
      this.damage(b, dmg, by, game);
    }
  }

  damage(b, dmg, by, game) {
    if (b.dead || b.inv > 0) {
      return;
    }
    b.hp -= Math.max(1, Math.round(dmg));
    b.inv = 0.35;
    if (b.hp <= 0) {
      b.hp = 0;
      b.dead = true;
      b.respawnT = 2.2;
      play('boom');
      game.particles.emit(b.x, b.y + 1, b.kit.color || 0xff4466, 16, { ring: true, speed: 5, life: 1.2, size: 0.8 });
      if (by) {
        this.fire('ko', { killer: by, victim: b.id, from: b.id });
      }
    }
  }

  targetFor(b, game) {
    const p = game.player;
    const list = [];
    if (p && !p.dead) {
      list.push({ id: 'me', x: p.x, y: p.y, h: p.h });
    }
    this.bots.forEach(o => {
      if (o !== b && !o.dead) {
        list.push({ id: o.id, x: o.x, y: o.y, h: o.h, bot: o });
      }
    });
    let best = null;
    let bd = Infinity;
    for (const t of list) {
      const d = Math.abs(t.x - b.x) + Math.abs(t.y - b.y) * 1.5 + (t.id === 'me' ? -2 : 0);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  // 固有技（ルナ・カッター／地雷／ローリング・レイ）を時々使う
  special(b, t, game) {
    const w = b.kit.weapons || [];
    const dx = Math.abs(t.x - b.x);
    const x = b.x + b.dir * 0.6;
    const y = b.y + b.h * 0.55;
    const sid = game.stage.id;
    if (w.includes('cutter') && dx > 2.4) {
      this.fire('shot', { type: 'cutter', x, y, dir: b.dir, level: 1, stage: sid, from: b.id });
      this.shots.push({ x, y, vx: b.dir * 12, owner: b, dmg: 4, life: 1.5, r: 1.2 });
      b.anim = 'sword';
      b.animT = 0.3;
      return true;
    }
    if (w.includes('spinray') && b.onGround && dx < 9) {
      b.vy = 13;
      b.spinT = 0.9;
      b.spinTick = 0;
      b.spinN = 0;
      return true;
    }
    if (w.includes('mine') && dx < 6) {
      this.fire('shot', { type: 'mine', x: b.x, y: b.y + 0.5, dir: b.dir, level: 0, stage: sid, from: b.id });
      this.shots.push({ x: b.x, y: b.y + 0.4, vx: 0, owner: b, dmg: 3, life: 6, r: 0.7, arm: 0.6 });
      return true;
    }
    return false;
  }

  spinTick(b, dt, game) {
    b.spinT -= dt;
    b.vy = Math.max(b.vy, -1.5);
    b.spinTick -= dt;
    if (b.spinTick <= 0) {
      b.spinTick = 0.22;
      b.spinN++;
      const y = b.y + b.h * 0.55;
      for (let k = 0; k < 6; k++) {
        const a = b.spinN * 0.5 + (k / 6) * Math.PI * 2;
        this.fire('shot', { type: 'ray', x: b.x, y, dir: 1, level: 0, stage: game.stage.id, from: b.id, ang: a });
        this.shots.push({ x: b.x, y, vx: Math.cos(a) * 17, vy: Math.sin(a) * 17, owner: b, dmg: 1.5, life: 0.9, r: 0.3 });
      }
    }
  }

  shoot(b, t, game) {
    const D = this.diff;
    if (b.kit.weapons && Math.random() < 0.3 && this.special(b, t, game)) {
      b.cd = D.cd * 1.6;
      return;
    }
    let type = SHOT_TYPES.has(b.kit.weapon) ? b.kit.weapon : 'buster';
    let level = Math.random() < D.charge ? 1 + (Math.random() < 0.4 ? 1 : 0) : 0;
    const dx = Math.abs(t.x - b.x);
    if (b.kit.weapon === 'saber') {
      if (dx < 2.4) {
        type = 'slash';
        level = 0;
      } else {
        type = 'wave';
        level = 1;
      }
    }
    const x = b.x + b.dir * 0.6;
    const y = b.y + b.h * 0.55;
    this.fire('shot', { type, x, y, dir: b.dir, level, stage: game.stage.id, from: b.id });
    // COM同士の当たり判定用の簡易弾（見た目はゲーム側の弾）
    const slash = type === 'slash';
    this.shots.push({ x, y, vx: slash ? 0 : b.dir * 15, owner: b, dmg: level >= 2 ? 3 : level ? 2 : 1, life: slash ? 0.18 : 1.3, r: slash ? 1.2 : 0.4 });
    b.anim = slash ? 'sword' : 'shoot';
    b.animT = 0.25;
    b.cd = D.cd * (0.7 + Math.random() * 0.6) * (slash ? 0.6 : 1);
  }

  tick(dt, game) {
    const D = this.diff;
    const frozen = game.readyT > 0 || game.clearT >= 0;
    for (const b of this.bots) {
      if (!b.spawned) {
        this.spawn(b, game, b.slot);
      }
      if (b.dead) {
        b.respawnT -= dt;
        if (b.respawnT <= 0) {
          this.spawn(b, game, Math.floor(Math.random() * this.total));
        }
        continue;
      }
      b.inv = Math.max(0, b.inv - dt);
      b.animT -= dt;
      const t = frozen ? null : this.targetFor(b, game);
      let mv = 0;
      if (t) {
        const dx = t.x - b.x;
        b.dir = dx >= 0 ? 1 : -1;
        const want = b.melee ? 1.6 : 6.5;
        if (Math.abs(dx) > want + 1) {
          mv = b.dir;
        } else if (!b.melee && Math.abs(dx) < want - 2) {
          mv = -b.dir;
        }
        b.think -= dt;
        if (b.onGround && (b.think <= 0 || b.hitWall)) {
          b.think = 0.5 + Math.random() * 0.7;
          if (b.hitWall || t.y > b.y + 1.5 || Math.random() < 0.22) {
            b.vy = 13 + Math.random() * 2;
          }
        }
        b.cd -= dt;
        if (b.cd <= 0 && Math.abs(t.y - b.y) < D.aim && Math.abs(dx) < 15) {
          this.shoot(b, t, game);
        }
      }
      b.vx = mv * D.speed;
      b.vy = Math.max(-20, b.vy + GRAV * dt);
      if (b.spinT > 0) {
        this.spinTick(b, dt, game);
      }
      game.moveBody(b, dt);
      if (b.y < -12) {
        this.damage(b, 99, null, game);
      }
      if (b.spinT > 0) {
        b.anim = 'spin';
      } else if (b.animT <= 0) {
        b.anim = !b.onGround ? 'jump' : Math.abs(b.vx) > 0.2 ? 'run' : 'idle';
      } else if (!b.onGround) {
        b.anim = 'jump';
      }
    }
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += (s.vy || 0) * dt;
      if (s.arm > 0) {
        s.arm -= dt;
        continue;
      }
      let gone = s.life <= 0;
      for (const o of this.bots) {
        if (!gone && o !== s.owner && !o.dead && Math.abs(s.x - o.x) < o.w / 2 + s.r && s.y > o.y - s.r && s.y < o.y + o.h + s.r) {
          this.damage(o, s.dmg, s.owner.id, game);
          gone = s.vx !== 0 || s.arm !== undefined; // 地雷は1回で爆発
        }
      }
      if (gone) {
        this.shots.splice(i, 1);
      }
    }
    this.peers = {};
    for (const b of this.bots) {
      this.peers[b.id] = {
        pid: b.id, local: true, inGame: true, stage: game.stage.id, mode: 'versus', x: b.x, y: b.y, dir: b.dir, kit: b.kit.id, anim: b.anim,
        dead: b.dead, name: b.name, hp: b.hp, max: b.max, ver: NET_VER, km: b.kit.model, kh: b.kit.height || 1.75,
        kt: b.kit.tint ?? null, ke: b.kit.emissive ?? null, kf: !!b.kit.flail,
      };
    }
  }
}
