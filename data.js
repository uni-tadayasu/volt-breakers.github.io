// Static game data: weapons, characters, bosses, stages, password codec.

export const WEAPONS = {
  buster: { name: 'アーク・ブラスター', color: 0x7fd8ff },
  saber: { name: 'フォトン・ブレード', color: 0x66ff99 },
  fire: { name: 'フォージ・フレア', color: 0xff5a1f },
  ice: { name: 'グレイシャル・ニードル', color: 0x9fe8ff },
  homing: { name: 'ゲイル・ドローン', color: 0x5dffb0 },
  spark: { name: 'コイル・ボール', color: 0xffe84a },
  quake: { name: 'テラ・ウェイブ', color: 0xd29a5a },
  boomerang: { name: 'ギア・リング', color: 0xffa53a },
  laser: { name: 'プリズム・ビーム', color: 0xff5ad8 },
  spread: { name: 'ミアズマ・スプレー', color: 0xb070ff },
  spikebomb: { name: 'スパイク・ボム', color: 0xff3a2a },
  cutter: { name: 'ルナ・カッター', color: 0x5ff0ff },
  mine: { name: 'ガルヴァ・マイン', color: 0xff6a3a },
  spinray: { name: 'ローリング・レイ', color: 0x66ff88 },
};

export const HEROES = [
  { id: 'van', name: 'ヴァン', model: 'vb-hero-van', height: 1.75, weapon: 'buster', color: 0x4fb4ff, hp: 28, portrait: 'assets/vb-p-van.webp', desc: 'チャージブラスターの射撃型' },
  { id: 'rei', name: 'レイ', model: 'vb-hero-rei', height: 1.8, weapon: 'saber', color: 0xa060ff, hp: 28, portrait: 'assets/vb-p-rei.webp', desc: '3連グレイブの近接型' },
];

export const BOSSES = [
  { id: 'volca', name: 'イグニス・フォージ', area: '灼熱精錬プラント', weapon: 'fire', color: 0xff5522, bg: 'city', fog: 0x2a0d06, enemies: ['walker', 'turret', 'hopper', 'mortar', 'heavy', 'mine'], hiddenIdx: null },
  { id: 'frost', name: 'グレイシア・ベル', area: '極北氷結ベース', weapon: 'ice', color: 0x88ddff, bg: 'city', fog: 0x0a1c2c, enemies: ['walker', 'drone', 'shielder', 'roller', 'sniper', 'bat'], hiddenIdx: 0 },
  { id: 'storm', name: 'テンペスト・ヴェイン', area: '天空風力塔', weapon: 'homing', color: 0x55ffaa, bg: 'city', fog: 0x082218, enemies: ['drone', 'bomber', 'turret', 'bat', 'orbiter', 'walker'], hiddenIdx: null },
  { id: 'spark', name: 'ヴォルテクス・コイル', area: '発電タワー', weapon: 'spark', color: 0xffe033, bg: 'fortress', fog: 0x221d05, enemies: ['hopper', 'turret', 'drone', 'orbiter', 'mine', 'sniper'], hiddenIdx: null },
  { id: 'quake', name: 'テラ・ハンマー', area: '地下採掘場', weapon: 'quake', color: 0xb07a44, bg: 'fortress', fog: 0x1e1208, enemies: ['shielder', 'walker', 'hopper', 'heavy', 'roller', 'mortar'], hiddenIdx: 1 },
  { id: 'boomer', name: 'スピン・ギアード', area: '歯車工場', weapon: 'boomerang', color: 0xff9900, bg: 'city', fog: 0x24120a, enemies: ['walker', 'hopper', 'drone', 'roller', 'splitter', 'bomber'], hiddenIdx: null },
  { id: 'laser', name: 'プリズマ・レンズ', area: '水晶研究所', weapon: 'laser', color: 0xff44cc, bg: 'fortress', fog: 0x1c0820, enemies: ['turret', 'drone', 'shielder', 'sniper', 'orbiter', 'splitter'], hiddenIdx: 2 },
  { id: 'scorpio', name: 'ミアズマ・フラスコ', area: '化学プラント', weapon: 'spread', color: 0x9955ff, bg: 'fortress', fog: 0x160a24, enemies: ['shielder', 'turret', 'walker', 'splitter', 'mine', 'bat'], hiddenIdx: null },
];

export const HIDDEN = [
  { id: 'shadow', name: 'ノクス・ワン', weapon: 'laser', weapons: ['laser', 'homing'], color: 0x2a2840, emissive: 0x8a3cff, portrait: 'assets/vb-p-shadow.webp' },
  { id: 'void', name: 'ヌル・ツー', weapon: 'spark', weapons: ['spark', 'ice'], color: 0x1e3238, emissive: 0x22ddff, portrait: 'assets/vb-p-void.webp' },
  { id: 'crimsonx', name: 'ブレイズ・スリー', weapon: 'fire', weapons: ['fire', 'boomerang'], color: 0x4a0e0e, emissive: 0xff2222, portrait: 'assets/vb-p-crimson.webp' },
];

// 弱点の連鎖（8体ボスから得た技は、必ず他の8体のうち1体の弱点になる。1周の輪）
// fire→グレイシア, ice→テンペスト, homing→ミアズマ, spread→テラ, quake→プリズマ,
// laser→スピン, boomerang→ヴォルテクス, spark→イグニス
export const WEAKNESS = {
  volca: 'spark', frost: 'fire', storm: 'ice', spark: 'boomerang',
  quake: 'spread', boomer: 'laser', laser: 'quake', scorpio: 'homing',
};
(() => {
  // 整合性チェック：各ボスの技がちょうど1体の弱点で、自分自身の弱点ではないこと
  const ws = BOSSES.map(b => WEAKNESS[b.id]);
  BOSSES.forEach(b => {
    const n = ws.filter(w => w === b.weapon).length;
    if (n !== 1 || WEAKNESS[b.id] === b.weapon) console.warn('[WEAKNESS] invalid chain for', b.id);
  });
})();

export function bossDef(b, i, hp = 32) {
  return {
    id: b.id, name: b.name, model: 'vb-boss-' + b.id, color: b.color, weapon: b.weapon,
    weapons: [b.weapon, 'buster'], hp, height: 2.3,
    weakness: WEAKNESS[b.id],
    portrait: `assets/vb-p-${b.id}.webp`,
  };
}

function hiddenDef(h) {
  return { ...h, model: 'vb-hid-' + h.id, hp: 24, height: 2.2, weakness: 'saber' };
}

export const INTRO_BOSS = { id: 'vile', name: 'ゲイル・ランサー', model: 'vb-op-boss', color: 0x55ee44, weapon: 'homing', weapons: ['buster', 'homing'], hp: 22, height: 2.4, weakness: 'buster', portrait: 'assets/vb-p-vile.webp' };
export const FUSED = { id: 'trinity', name: 'トリニティ・ハイドラ', model: 'vb-fused', color: 0x3a2050, emissive: 0xff2266, weapon: 'laser', weapons: ['laser', 'spark', 'fire', 'homing'], hp: 44, height: 3.4, weakness: 'ice', portrait: 'assets/vb-p-shadow.webp' };
export const GUARDIAN = { id: 'guardian', name: 'ゲートキーパーΛ', model: 'vb-guardian', color: 0xd8b040, weapon: 'quake', weapons: ['quake', 'spread', 'boomerang'], hp: 40, height: 2.9, weakness: 'spark', portrait: 'assets/vb-p-guardian.webp' };
export const OVERLORD = { id: 'overlord', name: 'オーバーロード・ザイン', model: 'vb-overlord', phase2Model: 'vb-overlord2', color: null, weapon: 'laser', weapons: ['laser', 'spread', 'buster'], phase2Weapons: ['laser', 'homing', 'fire', 'spread', 'spark'], hp: 36, height: 2.8, weakness: 'boomerang', phase2: true, portrait: 'assets/vb-p-overlord.webp' };

// 8ステージそれぞれ異なるタイル色（床／壁）。共通テクスチャに色を乗せるので追加DLなし
const TILE_COLORS = [
  { floor: 0xff9a6a, wall: 0xc8604a }, // 炎：赤橙
  { floor: 0x9ae8ff, wall: 0x6aa8d8 }, // 氷：水色
  { floor: 0xb8f0c0, wall: 0x78b890 }, // 風：若草
  { floor: 0xfff07a, wall: 0xc8b048 }, // 雷：黄
  { floor: 0xd8b088, wall: 0x987050 }, // 地：茶
  { floor: 0x9ad870, wall: 0x5e9a48 }, // 植物：緑
  { floor: 0xe0a8ff, wall: 0xa070d0 }, // 光：紫
  { floor: 0x7ab8ff, wall: 0x4a70c0 }, // 水：青
];

function makeBossStage(i) {
  const b = BOSSES[i];
  return {
    tile: TILE_COLORS[i % TILE_COLORS.length],
    id: 's' + i, name: b.area, boss: b, seed: 1000 + i * 77, length: 165,
    bg: b.bg, fog: b.fog, accent: b.color, enemies: b.enemies, density: 2,
    bosses: [bossDef(b, i)],
    hidden: b.hiddenIdx !== null ? hiddenDef(HIDDEN[b.hiddenIdx]) : null,
    hiddenIdx: b.hiddenIdx,
    // 隠し特殊能力装置（奇数ステージに1つずつ：ジャンプ／スピード／攻撃／防御）
    part: i % 2 === 1 ? [1, 2, 4, 8][(i - 1) / 2] : 0,
  };
}

export const STAGES = BOSSES.map((_, i) => makeBossStage(i));

export const INTRO_STAGE = {
  id: 'intro', name: 'オープニング：中央ハイウェイ', seed: 7, length: 110, bg: 'city', fog: 0x0c1430, accent: 0x44ccff,
  enemies: ['walker', 'drone', 'hopper', 'roller', 'bat'], density: 1, bosses: [INTRO_BOSS], tutorial: true,
  tips: [
    { x: 2, text: '← → / A D で移動　Space / K でジャンプ' },
    { x: 18, text: 'J / Z / クリックでショット　長押しでチャージ！' },
    { x: 40, text: 'Shift / L でダッシュ　ダッシュジャンプで遠くへ' },
    { x: 62, text: '壁に向かって押しながらジャンプで壁蹴り' },
    { x: 90, text: 'この先、強大な反応あり……' },
  ],
};

export const FINAL_STAGES = [
  { id: 'f1', name: 'ファイナル1：融合の門', seed: 5001, length: 140, bg: 'fortress', fog: 0x1a0820, accent: 0xff2266, enemies: ['walker', 'drone', 'shielder', 'turret', 'splitter', 'orbiter', 'sniper', 'bat'], density: 3, bosses: [FUSED] },
  { id: 'f2', name: 'ファイナル2：鋼鉄回廊', seed: 5002, length: 150, bg: 'fortress', fog: 0x201804, accent: 0xffcc44, enemies: ['hopper', 'shielder', 'turret', 'drone', 'heavy', 'mortar', 'mine', 'bomber'], density: 3, bosses: [GUARDIAN] },
  { id: 'f3', name: 'ファイナル3：再生ボスラッシュ', seed: 5003, length: 60, bg: 'fortress', fog: 0x10101c, accent: 0x9b7bff, enemies: ['drone', 'bat', 'orbiter'], density: 1, bosses: BOSSES.map((b, i) => bossDef(b, i, 18)) },
  { id: 'f4', name: 'ファイナル4：玉座', seed: 5004, length: 70, bg: 'fortress', fog: 0x200410, accent: 0xff3333, enemies: ['turret', 'drone', 'heavy', 'sniper', 'orbiter'], density: 1, bosses: [OVERLORD] },
];

export const ARENA_STAGE = { id: 'arena', name: 'バトルアリーナ', arena: true, seed: 42, length: 40, bg: 'fortress', fog: 0x120a1e, accent: 0x44ffee, enemies: [], density: 0, bosses: [] };

export function heroKit(h) {
  return { ...h };
}

export function bossKit(def) {
  return {
    id: def.id, name: def.name, model: def.model, tint: def.color, emissive: def.emissive,
    height: Math.min(def.height, 2.3), weapon: def.weapon, color: def.color || 0xff3344, hp: 28, portrait: def.portrait,
  };
}

// 運営者専用キャラ：重装破城機「宇邇宮」（トゲ鉄球を操る巨漢ロボ）
export const OVERLORD_KIT = {
  id: 'operator', name: '宇邇宮', model: 'vb-operator-brute', height: 2.1, weapon: 'spikebomb',
  color: 0xd8202a, hp: 44, portrait: 'assets/vb-p-operator.webp', flail: true, desc: 'トゲ鉄球と鉄拳の重装破城機（運営専用）',
};

// スタッフ用侵入キャラ（オリジナルデザイン）
export const STAFF_KITS = [
  {
    // 溜め斬りは上段斬り上げ→巨大な「ルナ・カッター」
    id: 'hornet', name: 'ヴェスパ', model: 'vb-staff-hornet2', height: 1.85, weapon: 'saber', cutter: true,
    color: 0x2a3a9a, hp: 36, portrait: 'assets/vb-p-hornet.webp', desc: '三日月兜の光刃剣客。斬り上げで巨大カッター',
    weapons: ['saber', 'cutter', 'homing', 'ice'],
  },
  {
    id: 'sage', name: 'ドク・ガルヴァ', model: 'vb-staff-sage', height: 1.8, weapon: 'spark',
    color: 0xff8a2a, hp: 40, portrait: 'assets/vb-p-sage.webp', desc: '片眼鏡の老発明家。地雷と回転光線',
    weapons: ['spark', 'mine', 'spinray', 'laser'],
  },
];
// 有料キャラ（購入コード／運営・スタッフキーで解放）：赤い光線弾＋正面の遠距離弾を防ぐ盾
export const PREMIUM_HERO = {
  id: 'carmine', name: 'カーマイン', model: 'vb-hero-carmine2', height: 1.75, weapon: 'buster', color: 0xff3344, hp: 28,
  portrait: 'assets/vb-p-carmine2.webp', desc: '赤い光線弾と六角盾の騎士。撃っていない間は盾を構え正面の弾を防ぐ',
  shield: true, shotColor: [0xff4a4a, 0xff2a5a, 0xff1030], premium: true,
};
// 運営専用キャラ2：老賢機「ヴェルド博士」— 緑の三連光線（上斜め→下斜め→正面）＋吸収バリア
export const OPERATOR_SAGE_KIT = {
  id: 'opsage', name: 'ヴェルド博士', model: 'vb-op-sage', height: 1.95, weapon: 'buster', color: 0x33ff77, hp: 40,
  portrait: 'assets/vb-p-opsage.webp', desc: '緑の三連光線。攻撃していない時の被弾をバリアで吸収し回復（運営専用）',
  triShot: true, absorb: true, operatorOnly: true,
};
export const OPERATOR_WEAPONS = ['spikebomb', 'boomerang', 'quake', 'spark', 'fire'];

export function versusRoster(isOperator, hasPremium = isOperator) {
  const list = [
    ...HEROES.map(heroKit),
    ...(hasPremium ? [heroKit(PREMIUM_HERO)] : []),
    ...BOSSES.map((b, i) => bossKit(bossDef(b, i))),
    ...HIDDEN.map(h => bossKit(hiddenDef(h))),
    bossKit(INTRO_BOSS), bossKit(GUARDIAN), bossKit(FUSED),
  ];
  if (isOperator) {
    list.push(OVERLORD_KIT, OPERATOR_SAGE_KIT);
  }
  return list;
}

export function findKit(id) {
  return versusRoster(true, true).find(k => k.id === id) || STAFF_KITS.find(k => k.id === id) || HEROES[0];
}

// ---- Password codec (5 chars) ----
const ALPHA = '0123456789ABCDEFGHJKLMNPQRSTUVWX';
const XOR = 0x15A5A5A;

// 6文字版：特殊能力装置(4bit)を含む
const XOR6 = 0x2A5C3B1;
export function encodePassword(s) {
  const bits = (s.hero & 1) | ((s.cleared & 255) << 1) | ((s.hidden & 7) << 9) | ((Math.min(s.etanks, 3) & 3) << 12) | ((s.intro ? 1 : 0) << 14) | (((s.parts || 0) & 15) << 15);
  const sum = (bits * 53 + 17) % 2048;
  let x = ((bits * 2048) + sum) ^ XOR6;
  let out = '';
  for (let i = 0; i < 6; i++) {
    out = ALPHA[x & 31] + out;
    x >>>= 5;
  }
  return out;
}

export function decodePassword(code) {
  code = (code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (code.length === 6) {
    let x = 0;
    for (const ch of code) {
      const v = ALPHA.indexOf(ch);
      if (v < 0) {
        return null;
      }
      x = x * 32 + v;
    }
    x = (x ^ XOR6) >>> 0;
    const bits = Math.floor(x / 2048);
    const sum = x % 2048;
    if ((bits * 53 + 17) % 2048 !== sum || bits >= 1 << 19) {
      return null;
    }
    return {
      hero: bits & 1, cleared: (bits >> 1) & 255, hidden: (bits >> 9) & 7,
      etanks: (bits >> 12) & 3, intro: !!((bits >> 14) & 1), parts: (bits >> 15) & 15,
    };
  }
  if (code.length !== 5) {
    return null;
  }
  let x = 0;
  for (const ch of code) {
    const v = ALPHA.indexOf(ch);
    if (v < 0) {
      return null;
    }
    x = x * 32 + v;
  }
  x ^= XOR;
  const bits = x >>> 10;
  const sum = x & 1023;
  if ((bits * 37 + 11) % 1024 !== sum || bits >= 1 << 15) {
    return null;
  }
  return {
    hero: bits & 1, cleared: (bits >> 1) & 255, hidden: (bits >> 9) & 7,
    etanks: (bits >> 12) & 3, intro: !!((bits >> 14) & 1),
  };
}
