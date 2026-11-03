// 権限キー（運営 / スタッフ）の検証と発行。
// 注意：クライアントのみの検証のため、改ざん耐性は「偶然の入力・推測」対策まで。
// 本格的に守るにはサーバー側（InstantDB の権限ルール等）での照合が必要。
export const OP_KEY = 'OVERLORD-ADMIN';
const STAFF_SALT = 'vb-staff-2025';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい 0/O/1/I を除外

function checksum(body) {
  let h = 0x811c9dc5;
  const s = STAFF_SALT + body;
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

export function issueStaffKey() {
  const r = new Uint8Array(6);
  crypto.getRandomValues(r);
  const body = Array.from(r, b => ALPHA[b & 31]).join('');
  return `VBS-${body}-${checksum(body)}`;
}
