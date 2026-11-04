// 権限キー（運営 / スタッフ）の検証と発行。
// 注意：クライアントのみの検証のため、改ざん耐性は「偶然の入力・推測」対策まで。
// 本格的に守るにはサーバー側（InstantDB の権限ルール等）での照合が必要。
export const OP_KEY = 'OVERLORD-ADMIN';
const STAFF_SALT = 'vb-staff-2025';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい 0/O/1/I を除外

const PREMIUM_SALT = 'vb-carmine-2025';
// 有料キャラ購入ページ（Stripe 決済リンク・1回限り）
export const PREMIUM_URL = 'https://buy.stripe.com/bJeaEYbaY0pr003biK9MY01';

function checksum(body, salt = STAFF_SALT) {
  let h = 0x811c9dc5;
  const s = salt + body;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += ALPHA[h & 31];
    h >>>= 5;
  }
  return out;
}

export function normKey(v) {
  return String(v || '').trim().toUpperCase().slice(0, 32);
}

export function isOperatorKey(v) {
  return normKey(v) === OP_KEY;
}

// 形式：VBS-XXXXXX-CCCC
export function isStaffKey(v) {
  const m = /^VBS-([A-HJ-NP-Z2-9]{6})-([A-HJ-NP-Z2-9]{4})$/.exec(normKey(v));
  return !!m && checksum(m[1]) === m[2];
}

function randBody() {
  const r = new Uint8Array(6);
  crypto.getRandomValues(r);
  return Array.from(r, b => ALPHA[b & 31]).join('');
}

export function issueStaffKey() {
  const body = randBody();
  return `VBS-${body}-${checksum(body)}`;
}

// 購入コード：形式 VBP-XXXXXX-CCCC（決済確認後に運営が発行）
export function isPremiumCode(v) {
  const m = /^VBP-([A-HJ-NP-Z2-9]{6})-([A-HJ-NP-Z2-9]{4})$/.exec(normKey(v));
  return !!m && checksum(m[1], PREMIUM_SALT) === m[2];
}

export function issuePremiumCode() {
  const body = randBody();
  return `VBP-${body}-${checksum(body, PREMIUM_SALT)}`;
}

// 端末間同期コード：16文字（約80bit）のランダム値。推測困難さが唯一の鍵
export function newSyncCode() {
  const r = new Uint8Array(16);
  crypto.getRandomValues(r);
  const s = Array.from(r, b => ALPHA[b & 31]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12)}`;
}

export function isSyncCode(v) {
  return /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/.test(normKey(v));
}
