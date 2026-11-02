// InstantDB rooms: presence + topics.
import { init, id } from '@instantdb/core';
import { INSTANT_DB_APP_ID } from './instant_db_config.js';

let db = null;

function getDb() {
  if (!db) {
    db = init({ appId: INSTANT_DB_APP_ID });
  }
  return db;
}

export const myId = id();
export const newId = () => id();

export class Room {
  constructor(roomId) {
    this.roomId = roomId;
    this.room = getDb().joinRoom('game', roomId);
    this.peers = {};
    this.peerListeners = new Set();
    this.unsubs = [];
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
  }

  onPeers(fn) {
    this.peerListeners.add(fn);
    fn(this.peers);
    return () => this.peerListeners.delete(fn);
  }

  presence(data) {
    try {
      this.room.publishPresence({ ...data, pid: myId });
    } catch (e) {
      console.warn(e);
    }
  }

  on(topic, cb) {
    const un = this.room.subscribeTopic(topic, (e) => {
      if (e && e.from !== myId) {
        cb(e);
      }
    });
    this.unsubs.push(un);
    return un;
  }

  emit(topic, data) {
    try {
      this.room.publishTopic(topic, { ...data, from: myId });
    } catch (e) {
      console.warn(e);
    }
  }

  leave() {
    this.unsubs.forEach(u => {
      try {
        u();
      } catch (e) {
        // ignore
      }
    });
    this.unsubs = [];
    this.peerListeners.clear();
    try {
      this.room.leaveRoom && this.room.leaveRoom();
    } catch (e) {
      // ignore
    }
  }
}
