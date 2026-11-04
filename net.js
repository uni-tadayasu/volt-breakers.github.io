// InstantDB rooms: presence + topics.
// 軽量化：InstantDB本体は初回利用時（またはアイドル時の先読み）に動的読み込みする。
import { INSTANT_DB_APP_ID } from './instant_db_config.js';

let dbPromise = null;

function uuid() {
  if (crypto && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function getDb() {
  if (!dbPromise) {
    dbPromise = import('@instantdb/core').then(m => m.init({ appId: INSTANT_DB_APP_ID }));
  }
  return dbPromise;
}

// アイドル時に先読み（ゲーム起動は待たせない）
export function preloadNet() {
  const go = () => getDb().catch(() => {});
  if ('requestIdleCallback' in window) {
    requestIdleCallback(go, { timeout: 4000 });
  } else {
    setTimeout(go, 1500);
  }
}

// ---- 端末間セーブ同期（同期コードで保存・取得） ----
// 中身は呼び出し側で必ず検証してから使う（sanitizeSave）。サイズ上限で悪用を防止
const SYNC_MAX = 4000;
async function findSync(db, code) {
  const r = await db.queryOnce({ vbsync: { $: { where: { code } } } });
  return r?.data?.vbsync?.[0] || null;
}
export async function pushSync(code, data) {
  const json = JSON.stringify(data);
  if (json.length > SYNC_MAX) throw new Error('too large');
  const db = await getDb();
  const cur = await findSync(db, code);
  const id = cur?.id || uuid();
  await db.transact(db.tx.vbsync[id].update({ code, json, t: Date.now() }));
}
export async function pullSync(code) {
  const db = await getDb();
  const cur = await findSync(db, code);
  if (!cur || typeof cur.json !== 'string' || cur.json.length > SYNC_MAX) return null;
  try {
    return JSON.parse(cur.json);
  } catch (e) {
    return null;
  }
}

export const myId = uuid();
export const newId = () => uuid();

export class Room {
  constructor(roomId) {
    this.roomId = roomId;
    this.room = null;
    this.peers = {};
    this.peerListeners = new Set();
    this.unsubs = [];
    this.pending = []; // 接続前の購読・送信を保留
    this.lastPresence = null;
    this.left = false;
    getDb().then(db => {
      if (this.left) {
        return;
      }
      this.room = db.joinRoom('game', roomId);
      this.unsubs.push(this.room.subscribePresence({}, data => {
        this.peers = {};
        const peers = (data && data.peers) || {};
        for (const key in peers) {
          const p = peers[key];
          if (p && p.pid && p.pid !== myId) {
            this.peers[p.pid] = p;
          }
        }
        this.peerListeners.forEach(fn => fn(this.peers));
      }));
      const q = this.pending;
      this.pending = [];
      q.forEach(fn => fn());
      if (this.lastPresence) {
        this.presence(this.lastPresence);
      }
    }).catch(e => console.warn('net unavailable', e));
  }

  whenReady(fn) {
    if (this.room) {
      fn();
    } else {
      this.pending.push(fn);
    }
  }

  onPeers(fn) {
    this.peerListeners.add(fn);
    fn(this.peers);
    return () => this.peerListeners.delete(fn);
  }

  presence(data) {
    this.lastPresence = data;
    if (!this.room) {
      return;
    }
    try {
      this.room.publishPresence({ ...data, pid: myId });
    } catch (e) {
      console.warn(e);
    }
  }

  on(topic, cb) {
    let un = null;
    let cancelled = false;
    this.whenReady(() => {
      if (cancelled) {
        return;
      }
      un = this.room.subscribeTopic(topic, e => {
        if (e && e.from !== myId) {
          cb(e);
        }
      });
      this.unsubs.push(un);
    });
    return () => {
      cancelled = true;
      if (un) {
        un();
      }
    };
  }

  emit(topic, data) {
    this.whenReady(() => {
      try {
        this.room.publishTopic(topic, { ...data, from: myId });
      } catch (e) {
        console.warn(e);
      }
    });
  }

  leave() {
    this.left = true;
    this.unsubs.forEach(u => {
      try {
        u();
      } catch (e) {
        // ignore
      }
    });
    this.unsubs = [];
    this.pending = [];
    this.peerListeners.clear();
    try {
      this.room && this.room.leaveRoom && this.room.leaveRoom();
    } catch (e) {
      // ignore
    }
  }
}
