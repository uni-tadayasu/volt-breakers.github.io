// Game flow: title, menu, story, stage select, password, options, online, invasion.
import { Game } from './game.js';
import {
  WEAPONS, HEROES, BOSSES, STAGES, INTRO_STAGE, FINAL_STAGES, ARENA_STAGE,
  heroKit, versusRoster, findKit, OVERLORD_KIT, STAFF_KITS, OPERATOR_WEAPONS, encodePassword, decodePassword,
} from './data.js';
import { isOperatorKey, isStaffKey, issueStaffKey, normKey, isPremiumCode, issuePremiumCode, PREMIUM_URL, newSyncCode, isSyncCode } from './keys.js';
import { PREMIUM_HERO, OPERATOR_SAGE_KIT } from './data.js';
import { pushSync, pullSync } from './net.js';
import { input } from './input.js';
import { unlock, play, setVolumes, playMusic, stopMusic } from './audio.js';
import { loadAll, loadDeferred } from './assets.js';
import { Room, myId, preloadNet } from './net.js';
import { LocalRoom } from './bots.js';
import { ui, show, btn, cutscene, clearScreen, addCleanup, setupTouch, touchPref, applyTouch } from './screens.js';

const $ = s => document.querySelector(s);
// XSS対策：外部（ネットワーク）由来の文字列はHTMLエスケープしてから表示
const esc = v => String(v).slice(0, 40).replace(/[&<>"'`]/g, c => `&#${c.charCodeAt(0)};`);
const BG = img => `background-image:linear-gradient(rgba(0,0,0,.35),rgba(0,0,0,.7)),url('${img}')`;

// ---------- save ----------
const DEFAULTS = { hero: 0, cleared: 0, hidden: 0, etanks: 0, intro: false, bgm: 0.55, sfx: 0.8, touch: 'auto', operator: false, staffKey: '', premiumCode: '', syncCode: '' };
// スタッフ権限は保存されたキー文字列を毎回検証（フラグ書き換えだけでは有効にならない）
const isStaff = () => isStaffKey(save.staffKey);
const canInvade = () => save.operator || isStaff();
// 有料キャラ：購入コード、または運営／スタッフキー登録済みなら使用可
const hasPremium = () => save.operator || isStaff() || isPremiumCode(save.premiumCode);
// 改ざん・破損対策：既知キーのみ、型と範囲を検証して取り込む（プロトタイプ汚染も防止）
// localStorage と端末間同期の両方で同じ検証を通す
function sanitizeSave(raw, base = DEFAULTS) {
  const out = { ...base };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return out;
  }
  const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : undefined);
  const vol = v => (typeof v === 'number' && v >= 0 && v <= 1 ? v : undefined);
  const chk = {
    hero: v => int(v, 0, 2), cleared: v => int(v, 0, 255), hidden: v => int(v, 0, 7), etanks: v => int(v, 0, 9), parts: v => int(v, 0, 15),
    intro: v => (typeof v === 'boolean' ? v : undefined), bgm: vol, sfx: vol,
    touch: v => (['auto', 'on', 'off'].includes(v) ? v : undefined), operator: v => (typeof v === 'boolean' ? v : undefined),
    staffKey: v => (typeof v === 'string' && isStaffKey(v) ? normKey(v) : undefined),
    premiumCode: v => (typeof v === 'string' && isPremiumCode(v) ? normKey(v) : undefined),
    syncCode: v => (typeof v === 'string' && isSyncCode(v) ? normKey(v) : undefined),
  };
  for (const k of Object.keys(chk)) {
    if (Object.prototype.hasOwnProperty.call(raw, k)) {
      const v = chk[k](raw[k]);
      if (v !== undefined) {
        out[k] = v;
      }
    }
  }
  return out;
}
let save;
try {
  save = sanitizeSave(JSON.parse(localStorage.getItem('nih-save') || '{}'));
} catch (e) {
  save = { ...DEFAULTS };
}
function persist() {
  try {
    localStorage.setItem('nih-save', JSON.stringify(save));
  } catch (e) {
    // ignore
  }
}
setVolumes(save.bgm, save.sfx);
touchPref.mode = save.touch;
setupTouch();

// ---------- game ----------
const game = new Game($('#game-container'), ui);
game.renderer.domElement.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && input.enabled && e.button === 0) {
    input.press('shoot');
  }
});
window.addEventListener('pointerup', e => {
  if (e.pointerType === 'mouse') {
    input.release('shoot');
  }
});
$('#pausebtn').addEventListener('click', () => openPause());

let exitStage = null;
let hub = null;
function getHub() {
  if (hub) {
    return hub;
  }
  try {
    hub = new Room('hub-v1');
    hub.on('invade', e => {
      if (e.target === myId && game.running && game.mode === 'solo') {
        game.setInvader(e.from);
      }
    });
  } catch (e) {
    console.warn('hub unavailable', e);
    hub = null;
  }
  return hub;
}

function hero() {
  if (save.hero === 2) {
    return hasPremium() ? PREMIUM_HERO : HEROES[0];
  }
  return HEROES[save.hero] || HEROES[0];
}
function ownedWeapons(all = false) {
  const w = [hero().weapon];
  BOSSES.forEach((b, i) => {
    if (all || save.cleared & (1 << i)) {
      w.push(b.weapon);
    }
  });
  return w;
}

// ---------- boot ----------
async function boot() {
  show(`<h1 class="logo">VOLT<br>BREAKERS</h1><div class="sub" id="ld">LOADING 0%</div>`);
  await loadAll(f => {
    const el = $('#ld');
    if (el) {
      el.textContent = `LOADING ${Math.round(f * 100)}%`;
    }
  });
  title();
  // タイトル表示後、残りのモデルとオンライン機能をアイドル時に先読み
  loadDeferred();
  preloadNet();
}

function title() {
  game.stop();
  stopMusic();
  const root = show(`<h1 class="logo">VOLT<br>BREAKERS</h1>
    <div class="sub">ヴォルト・ブレイカーズ</div>
    <div class="blink" id="tap">TAP TO START</div>`, { cls: 'bgimg', style: BG('assets/vb-title2.webp'), lock: 300 });
  let done = false;
  const go = () => {
    if (done) {
      return;
    }
    done = true;
    unlock();
    playMusic(1);
    play('confirm');
    const t = $('#tap');
    t.textContent = '― START ―';
    t.style.animation = 'none';
    setTimeout(menu, 1000);
  };
  root.addEventListener('pointerdown', go);
  const k = e => {
    if (e.code === 'Enter' || e.code === 'Space') {
      go();
    }
  };
  window.addEventListener('keydown', k);
  addCleanup(() => window.removeEventListener('keydown', k));
}

function menu() {
  game.stop();
  show(`<h1 class="logo" style="font-size:clamp(26px,5vw,48px)">VOLT BREAKERS</h1>
    <div class="panel col">
      ${btn('new', 'ニューゲーム')}
      ${save.intro ? btn('cont', 'コンティニュー') : ''}
      ${btn('pass', 'パスワード')}
      ${btn('offline', 'オフライン')}
      ${btn('online', 'オンライン')}
      ${btn('opt', 'オプション')}
      ${canInvade() ? btn('invade', save.operator ? '⚠ 侵入（運営）' : '⚠ 侵入（スタッフ）') : ''}
    </div>`, {
    cls: 'bgimg', style: BG('assets/vb-title2.webp'),
    on: act => {
      if (act === 'new') {
        charSelect(i => {
          Object.assign(save, { hero: i, cleared: 0, hidden: 0, etanks: 0, intro: false, parts: 0 });
          persist();
          opening();
        }, menu);
      } else if (act === 'cont') {
        stageSelect();
      } else if (act === 'pass') {
        passwordScreen();
      } else if (act === 'offline') {
        offlineMenu();
      } else if (act === 'online') {
        onlineMenu();
      } else if (act === 'opt') {
        options();
      } else if (act === 'invade') {
        invadePick();
      }
    },
  });
}

function charSelect(done, back) {
  show(`<h2>キャラクターセレクト</h2>
    <div class="cards">
      ${HEROES.map((h, i) => `<div class="panel card" data-act="${i}"><img src="${h.portrait}" alt=""><h2 style="font-size:22px;margin-top:6px">${h.name}</h2><div class="sub">${h.desc}</div></div>`).join('')}
      <div class="panel card ${hasPremium() ? '' : 'locked'}" data-act="${hasPremium() ? 2 : 'buy'}"><img src="${PREMIUM_HERO.portrait}" alt="" style="${hasPremium() ? '' : 'filter:grayscale(.8) brightness(.6)'}"><h2 style="font-size:22px;margin-top:6px">${PREMIUM_HERO.name}${hasPremium() ? '' : ' 🔒'}</h2><div class="sub">${hasPremium() ? PREMIUM_HERO.desc : '有料キャラ（買い切り）。タップで購入／コード入力'}</div></div>
    </div>${btn('back', '戻る')}`, {
    back,
    on: act => (act === 'back' ? back() : act === 'buy' ? premiumScreen(() => charSelect(done, back)) : done(+act)),
  });
}

// 有料キャラ購入・解放画面
function premiumScreen(back) {
  const root = show(`<h2>${PREMIUM_HERO.name} を解放</h2><div class="panel col">
    <img src="${PREMIUM_HERO.portrait}" alt="${PREMIUM_HERO.name}" style="width:140px;margin:0 auto" loading="lazy">
    <div class="sub">赤い光線弾（チャージ可）と、正面の遠距離攻撃を防ぐ盾を持つ戦士。<br>ソロ・オフライン・オンラインで使用できます（1回限りの購入）。</div>
    ${btn('buy', '購入ページへ（Stripe）')}
    <div class="sub">購入後に届く購入コードを入力してください</div>
    <div class="row"><input type="text" id="pc" maxlength="32" autocomplete="off" spellcheck="false" placeholder="VBP-XXXXXX-XXXX" style="font-size:14px;letter-spacing:1px;width:200px">${btn('code', '解放', 'style="min-width:0"')}</div>
    <div class="sub" id="pcmsg"></div>
    ${btn('back', '戻る')}</div>`, {
    back,
    on: act => {
      if (act === 'back') {
        back();
      } else if (act === 'buy') {
        // 決済は外部の Stripe ページで行う（カード情報はこのサイトに一切渡らない）
        window.open(PREMIUM_URL, '_blank', 'noopener,noreferrer');
      } else if (act === 'code') {
        const v = normKey($('#pc').value);
        if (isPremiumCode(v)) {
          save.premiumCode = v;
          persist();
          play('select');
          ui.toast(`${PREMIUM_HERO.name} を解放しました！`, 2);
          back();
        } else {
          play('buzz');
          $('#pcmsg').textContent = '購入コードが違います';
        }
      }
    },
  });
  root.querySelector('#pc')?.focus();
}

function opening() {
  cutscene('assets/vb-opening.webp', [
    '機械都市ネオ・ヴォルタ――自律機兵「オートノイド」の暴走事件が相次いでいた。',
    '都市防衛を担う8体の守護機が離反し、首謀者オーバーロード・ザインのもとに集結した。',
    `特殊鎮圧部隊ブレイカーズ所属「${hero().name}」、出撃せよ！`,
  ], () => playSolo(INTRO_STAGE, () => {
    save.intro = true;
    persist();
    cutscene('assets/vb-opening.webp', [
      'ゲイル・ランサーは撤退した……。',
      '8体のボスを倒し、オーバーロードの要塞への道を開け！',
    ], () => passwordNotice('OPENING CLEAR', stageSelect));
  }));
}

// ---------- solo play ----------
function playSolo(stage, onClear, weapons = ownedWeapons()) {
  clearScreen();
  const room = getHub();
  const retry = () => playSolo(stage, onClear, weapons);
  exitStage = () => (save.intro ? stageSelect() : menu());
  game.start({
    stage, kit: heroKit(hero()), mode: 'solo', weapons, lives: 2, etanks: save.etanks, parts: save.parts || 0,
    room, hostile: true, targetPid: '__none__', quiet: true,
    hiddenDone: stage.hiddenIdx !== null && stage.hiddenIdx !== undefined && !!(save.hidden & (1 << stage.hiddenIdx)),
    onPause: openPause,
    onEnd: (kind, r) => {
      save.etanks = r.etanks;
      save.parts = (save.parts || 0) | (r.parts || 0);
      (r.hidden || []).forEach(i => {
        save.hidden |= 1 << i;
      });
      persist();
      game.stop();
      if (kind === 'clear') {
        onClear(r);
      } else {
        gameOver(retry);
      }
    },
  });
}

function gameOver(retry) {
  show(`<h1 class="logo" style="color:#ff5a6a">GAME OVER</h1>
    <div class="panel col"><div class="sub">パスワード：<b style="font-family:'Russo One';font-size:24px;color:#ffd25a">${encodePassword(save)}</b></div>
    ${btn('retry', 'リトライ')}${save.intro ? btn('sel', 'ステージセレクト') : ''}${btn('title', 'タイトルへ')}</div>`, {
    on: act => (act === 'retry' ? retry() : act === 'sel' ? stageSelect() : title()),
  });
}

function openPause() {
  if (!game.running || game.paused) {
    return;
  }
  game.setPaused(true);
  const multi = game.mode !== 'solo';
  const p = game.player;
  const specials = p ? p.weapons.slice(1) : [];
  const wlist = specials.length
    ? `<div class="sub">特殊武器を選択（SPボタン / X / I / RTで使用）</div><div class="row" style="flex-wrap:wrap;justify-content:center">${specials.map((w, i) => {
      const d = WEAPONS[w] || { name: w, color: 0xffffff };
      const col = '#' + d.color.toString(16).padStart(6, '0');
      return `<button class="btn small ${p.wi === i + 1 ? 'sel' : ''}" data-act="w:${i + 1}" style="border-left:6px solid ${col}">${d.name} ${Math.round(p.energy[w] || 0)}</button>`;
    }).join('')}</div>`
    : '<div class="sub">ボスを倒すと特殊武器を入手できます</div>';
  show(`<h2>PAUSE</h2><div class="panel col">
    ${btn('resume', '再開')}${wlist}${btn('exit', multi ? '退出する' : 'ステージを出る')}</div>
    <div class="sub">移動 ←→/AD　ジャンプ Space/K　ダッシュ Shift/L<br>ショット J/Z/クリック　特殊武器 X/I　特殊武器切替 Q/E　セル T<br>パッド：A ジャンプ／X ショット／RT 特殊武器／B・LT ダッシュ／LB・RB 切替／Y セル／START ポーズ</div>`, {
    back: () => resume(),
    on: act => {
      if (act === 'resume') {
        resume();
      } else if (act.startsWith('w:')) {
        game.selectSpecial(+act.slice(2));
        resume();
      } else {
        game.stop();
        clearScreen();
        (exitStage || menu)();
      }
    },
  });
  function resume() {
    clearScreen();
    game.setPaused(false);
  }
}

// ---------- stage select ----------
function stageSelect() {
  game.stop();
  playMusic(1);
  const order = [0, 1, 2, 3, 'F', 4, 5, 6, 7];
  const allClear = save.cleared === 255;
  const cells = order.map(i => {
    if (i === 'F') {
      return `<button class="cell ${allClear ? '' : 'locked'}" data-act="F" ${allClear ? '' : 'disabled'}><img src="assets/vb-p-overlord.webp" alt=""><div class="lbl">${allClear ? 'FINAL' : 'LOCKED'}</div></button>`;
    }
    const b = BOSSES[i];
    const done = save.cleared & (1 << i);
    return `<button class="cell ${done ? 'done' : ''}" data-act="${i}"><img src="assets/vb-p-${b.id}.webp" alt=""><div class="lbl">${b.name}</div></button>`;
  }).join('');
  show(`<h2>STAGE SELECT</h2><div class="grid3">${cells}</div>
    <div class="row"><div class="panel sub">PASSWORD <b style="font-family:'Russo One';color:#ffd25a;letter-spacing:3px">${encodePassword(save)}</b>　セル ${save.etanks}</div>${btn('title', 'タイトルへ')}</div>`, {
    cols: 3, back: title,
    on: act => {
      if (act === 'title') {
        title();
      } else if (act === 'F') {
        finalStage(0);
      } else {
        const i = +act;
        playSolo(STAGES[i], r => weaponGet(i, r));
      }
    },
  });
}

function weaponGet(i) {
  const b = BOSSES[i];
  save.cleared |= 1 << i;
  persist();
  const w = WEAPONS[b.weapon];
  const col = '#' + w.color.toString(16).padStart(6, '0');
  show(`<div class="panel col" style="text-align:center">
    <img src="assets/vb-p-${b.id}.webp" style="width:160px;border:3px solid #000;border-radius:6px" alt="">
    <h1 class="logo" style="font-size:clamp(28px,6vw,48px)">NEW ARMS</h1>
    <h2 style="color:${col}">${w.name}</h2>
    <div class="sub">Q / E（スマホはWPN）・ポーズメニューで選択、X / I（スマホはSP）で使用</div>${btn('ok', 'OK')}</div>`, { lock: 900, on: () => passwordNotice('STAGE CLEAR', stageSelect) });
}

// ステージクリアごとにパスワードを表示
function passwordNotice(head, next) {
  show(`<div class="panel col" style="text-align:center">
    <h1 class="logo" style="font-size:clamp(26px,5vw,44px)">${head}</h1>
    <div class="sub">パスワード（次回起動時に「パスワード」から入力すると続きから遊べます）</div>
    <b style="font-family:'Russo One';font-size:clamp(30px,7vw,52px);color:#ffd25a;letter-spacing:8px">${encodePassword(save)}</b>
    ${btn('ok', 'ステージセレクトへ')}</div>`, { lock: 900, on: next });
}

function finalStage(n) {
  const st = FINAL_STAGES[n];
  const intro = [
    ['隠しボスたちの残骸が融合し、異形の兵器となって立ちはだかる……！'],
    ['要塞中枢へ続く鋼鉄の回廊。門番が待ち受ける。'],
    ['ザインの技術によって、8体のボスが再生された！'],
    ['玉座の間。ついにオーバーロード・ザインと対峙する。'],
  ][n];
  cutscene('assets/vb-opening.webp', [st.name, ...intro], () => playSolo(st, () => {
    if (n < 3) {
      finalStage(n + 1);
    } else {
      ending();
    }
  }, ownedWeapons(true)));
}

function ending() {
  cutscene('assets/vb-ending.webp', [
    'オーバーロード・ザインは崩れ落ち、要塞は炎に包まれた。',
    `${hero().name}は朝焼けの街を見下ろす。戦いは終わった――今は、まだ。`,
    'THANK YOU FOR PLAYING!',
  ], () => show(`<h1 class="logo">THE END</h1><div class="panel sub" style="line-height:2">
    VOLT BREAKERS<br>GAME DESIGN & CODE ── Rosie<br>3D MODELS / ART / MUSIC ── Generated<br>AND YOU!</div>${btn('t', 'タイトルへ')}`,
  { lock: 1500, on: title }));
}

// ---------- password / options ----------
function passwordScreen() {
  const root = show(`<h2>パスワード</h2><div class="panel col">
    <input type="text" id="pw" maxlength="6" placeholder="??????" autocomplete="off">
    <div class="sub" id="pwmsg">6文字のパスワードを入力</div>
    ${btn('ok', '決定')}${btn('back', '戻る')}</div>`, {
    back: menu,
    on: act => {
      if (act === 'back') {
        menu();
        return;
      }
      const d = decodePassword($('#pw').value);
      if (!d) {
        play('buzz');
        $('#pwmsg').textContent = 'パスワードが違います';
        return;
      }
      Object.assign(save, d);
      persist();
      if (save.intro) {
        stageSelect();
      } else {
        playSolo(INTRO_STAGE, () => {
          save.intro = true;
          persist();
          stageSelect();
        });
      }
    },
  });
  root.querySelector('#pw').focus();
}

function options() {
  const root = show(`<h2>オプション</h2><div class="panel col">
    <label>BGM <input type="range" id="o-bgm" min="0" max="1" step="0.05" value="${save.bgm}"></label>
    <label>効果音 <input type="range" id="o-sfx" min="0" max="1" step="0.05" value="${save.sfx}"></label>
    <div class="row">タッチ操作 ${['auto', 'on', 'off'].map(m => `<button class="btn small ${save.touch === m ? 'sel' : ''}" data-act="t:${m}">${m.toUpperCase()}</button>`).join('')}</div>
    <div class="row"><input type="text" id="o-key" maxlength="32" autocomplete="off" spellcheck="false" placeholder="運営キー" style="font-size:14px;letter-spacing:1px;width:180px">${btn('key', '登録', 'style="min-width:0"')}</div>
    <div class="row"><input type="text" id="o-skey" maxlength="32" autocomplete="off" spellcheck="false" placeholder="スタッフキー VBS-XXXXXX-XXXX" style="font-size:14px;letter-spacing:1px;width:180px">${btn('skey', '登録', 'style="min-width:0"')}</div>
    <div class="sub" id="o-msg">${save.operator ? '運営モード：有効' : isStaff() ? 'スタッフモード：有効' : ''}</div>
    ${save.operator ? `<div class="row">${btn('issue', 'スタッフキー発行', 'style="min-width:0"')}<input type="text" id="o-issued" readonly style="font-size:14px;letter-spacing:1px;width:180px"></div>` : ''}
    ${isStaff() ? btn('unstaff', 'スタッフ登録を解除') : ''}
    ${save.operator ? `<div class="row">${btn('issuep', '購入コード発行', 'style="min-width:0"')}<input type="text" id="o-pissued" readonly style="font-size:14px;letter-spacing:1px;width:180px"></div>` : ''}
    <div class="sub">${PREMIUM_HERO.name}：${hasPremium() ? '解放済み' : '未購入'}</div>
    ${hasPremium() ? '' : btn('premium', `${PREMIUM_HERO.name} を購入／コード入力`)}
    <h3 style="margin:8px 0 0">端末間同期</h3>
    <div class="sub">同期コードを他の端末に入力すると、進行・購入・キーを共有できます。コードは他人に教えないでください。</div>
    <div class="row"><input type="text" id="o-sync" maxlength="19" autocomplete="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX" value="${save.syncCode}" style="font-size:14px;letter-spacing:1px;width:210px"></div>
    <div class="row">${btn('sup', 'この端末を保存', 'style="min-width:0"')}${btn('sdown', 'コードから読込', 'style="min-width:0"')}</div>
    <div class="sub" id="o-smsg"></div>
    ${btn('back', '戻る')}</div>`, {
    back: menu,
    on: act => {
      if (act === 'back') {
        menu();
      } else if (act.startsWith('t:')) {
        save.touch = act.slice(2);
        touchPref.mode = save.touch;
        persist();
        options();
      } else if (act === 'key') {
        const ok = isOperatorKey($('#o-key').value);
        save.operator = ok || save.operator;
        persist();
        $('#o-msg').textContent = ok ? '運営モード：有効' : 'キーが違います';
      } else if (act === 'skey') {
        const v = normKey($('#o-skey').value);
        if (isStaffKey(v)) {
          save.staffKey = v;
          persist();
          options();
        } else {
          $('#o-msg').textContent = 'スタッフキーが違います';
        }
      } else if (act === 'unstaff') {
        save.staffKey = '';
        persist();
        options();
      } else if (act === 'issuep') {
        const out = $('#o-pissued');
        out.value = issuePremiumCode();
        out.select();
        navigator.clipboard?.writeText(out.value).then(() => ui.toast('コピーしました', 1.5), () => {});
      } else if (act === 'premium') {
        premiumScreen(options);
      } else if (act === 'sup') {
        const msg = $('#o-smsg');
        let code = normKey($('#o-sync').value);
        if (!isSyncCode(code)) code = newSyncCode();
        msg.textContent = '保存中…';
        pushSync(code, save).then(() => {
          save.syncCode = code;
          persist();
          $('#o-sync').value = code;
          msg.textContent = '保存しました。他の端末でこのコードを入力してください';
          navigator.clipboard?.writeText(code).catch(() => {});
        }, () => { msg.textContent = '保存に失敗しました（通信を確認）'; });
      } else if (act === 'sdown') {
        const msg = $('#o-smsg');
        const code = normKey($('#o-sync').value);
        if (!isSyncCode(code)) {
          msg.textContent = '同期コードの形式が違います';
          return;
        }
        msg.textContent = '読込中…';
        pullSync(code).then(data => {
          if (!data) {
            msg.textContent = 'データが見つかりません';
            return;
          }
          // 音量・タッチ設定は端末ごとに保持し、進行と権限のみ取り込む（必ず検証を通す）
          const keep = { bgm: save.bgm, sfx: save.sfx, touch: save.touch };
          save = { ...sanitizeSave(data), ...keep, syncCode: code };
          persist();
          ui.toast('同期しました', 1.5);
          options();
        }, () => { msg.textContent = '読込に失敗しました（通信を確認）'; });
      } else if (act === 'issue') {
        const out = $('#o-issued');
        out.value = issueStaffKey();
        out.select();
        navigator.clipboard?.writeText(out.value).then(() => ui.toast('コピーしました', 1.5), () => {});
      }
    },
  });
  const upd = () => {
    save.bgm = +$('#o-bgm').value;
    save.sfx = +$('#o-sfx').value;
    setVolumes(save.bgm, save.sfx);
    persist();
  };
  root.querySelector('#o-bgm').addEventListener('input', upd);
  root.querySelector('#o-sfx').addEventListener('input', () => {
    upd();
    play('select');
  });
}

// ---------- online ----------
function onlineMenu() {
  game.stop();
  const root = show(`<h2>オンライン</h2><div class="panel col">
    <div class="sub">ルームコードを入力して参加（同じコードの人と遊べます）</div>
    <input type="text" id="code" maxlength="5" autocomplete="off">
    ${btn('join', '参加')}${btn('rand', 'ルームを作成')}${btn('back', '戻る')}</div>`, {
    back: menu,
    on: act => {
      if (act === 'back') {
        menu();
        return;
      }
      let code = $('#code').value.trim().toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 5);
      const create = act === 'rand' || !code;
      if (create) {
        // 推測されにくい安全な乱数でルームコードを生成
        const A = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
        code = [...crypto.getRandomValues(new Uint8Array(5))].map(b => A[b % A.length]).join('');
      }
      lobby(code, create);
    },
  });
  root.querySelector('#code').focus();
}

const MODES = { coop: { label: '協力 2人', max: 2 }, vs2: { label: '対戦 2人', max: 2 }, vs4: { label: '対戦 4人', max: 4 } };
const COOP_STAGES = [INTRO_STAGE, ...STAGES];

function lobby(code, creator = false) {
  let room;
  try {
    room = new Room('lobby-' + code);
  } catch (e) {
    ui.toast('接続できませんでした', 2);
    onlineMenu();
    return;
  }
  // ホスト判定用：ルーム作成者フラグと入室時刻
  const me = { lobby: true, kit: null, mode: 'coop', stage: 0, ready: true, creator: !!creator, joined: Date.now() };
  let launched = false;
  const leave = () => {
    room.leave();
  };
  show(`<h2>ルーム ${code}</h2><div id="lb" class="col" style="width:100%"></div>`, {
    back: () => {
      leave();
      onlineMenu();
    },
    on: (act) => {
      const info = state();
      if (act === 'back') {
        leave();
        onlineMenu();
      } else if (act.startsWith('m:') && info.host) {
        me.mode = act.slice(2);
        me.kit = null;
      } else if (act.startsWith('s:') && info.host) {
        me.stage = +act.slice(2);
      } else if (act.startsWith('k:')) {
        me.kit = act.slice(2);
      } else if (act === 'start' && info.canStart) {
        const e = { mode: info.mode, stage: info.stage, t: Date.now() };
        room.emit('start', e);
        launch(e);
        return;
      }
      room.presence(me);
      render();
    },
  });
  function state() {
    const peers = room.peers;
    // 並び順：ルーム作成者 → 入室の早い順 → ID（同時刻のみ）。先頭がホスト
    const info = id => (id === myId ? me : peers[id] || {});
    const members = [myId, ...Object.keys(peers)].sort((a, b) => {
      const A = info(a);
      const B = info(b);
      if (!!A.creator !== !!B.creator) {
        return A.creator ? -1 : 1;
      }
      const ja = A.joined || Infinity;
      const jb = B.joined || Infinity;
      if (ja !== jb) {
        return ja - jb;
      }
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const host = members[0] === myId;
    const hp = host ? me : peers[members[0]] || me;
    const mode = MODES[hp.mode] ? hp.mode : 'coop';
    const stage = hp.stage || 0;
    const taken = new Set(Object.values(peers).map(p => p.kit).filter(Boolean));
    if (me.kit && taken.has(me.kit)) {
      me.kit = null;
    }
    const all = members.every(id => (id === myId ? me.kit : peers[id] && peers[id].kit));
    const n = members.length;
    const canStart = host && n >= 2 && n <= MODES[mode].max && all;
    return { peers, members, host, mode, stage, taken, canStart };
  }
  function render() {
    const el = $('#lb');
    if (!el) {
      return;
    }
    const s = state();
    const roster = s.mode === 'coop'
      ? [...HEROES.map(heroKit), ...(hasPremium() ? [heroKit(PREMIUM_HERO)] : [])]
      : versusRoster(save.operator, hasPremium());
    if (me.mode !== s.mode && !s.host) {
      me.mode = s.mode;
    }
    const players = s.members.map((id, i) => {
      const k = id === myId ? me.kit : s.peers[id] && s.peers[id].kit;
      return `<div>P${i + 1}${id === myId ? '（あなた）' : ''}${i === 0 ? ' ★HOST' : ''}：${k ? findKit(k).name : '選択中…'}</div>`;
    }).join('');
    el.innerHTML = `
      <div class="panel col">
        <div class="row">${Object.entries(MODES).map(([k, m]) => `<button class="btn small ${s.mode === k ? 'sel' : ''}" data-act="m:${k}" ${s.host ? '' : 'disabled'}>${m.label}</button>`).join('')}</div>
        ${s.mode === 'coop' ? `<div class="row">${COOP_STAGES.map((st, i) => `<button class="btn small ${s.stage === i ? 'sel' : ''}" data-act="s:${i}" ${s.host ? '' : 'disabled'}>${i === 0 ? 'OP' : BOSSES[i - 1].name.split('・')[0]}</button>`).join('')}</div>` : '<div class="sub">ステージ：バトルアリーナ（3KO先取）</div>'}
        <div class="sub" style="text-align:left">${players}</div>
      </div>
      <div class="rgrid">${roster.map(k => `<div class="rcell ${me.kit === k.id ? 'sel' : ''} ${s.taken.has(k.id) ? 'taken' : ''}" data-act="k:${k.id}"><img src="${k.portrait}" alt=""><div>${k.name}</div></div>`).join('')}</div>
      <div class="row">${s.host ? btn('start', 'スタート', s.canStart ? '' : 'disabled') : '<div class="sub">ホストの開始を待っています…</div>'}${btn('back', '退出')}</div>`;
  }
  const unPeers = room.onPeers(render);
  room.on('start', e => {
    // ホスト以外からの開始指示・不正な値は無視
    const s = state();
    if (!e || e.from !== s.members[0] || !MODES[e.mode] || !Number.isInteger(e.stage) || e.stage < 0 || e.stage >= COOP_STAGES.length || !Number.isFinite(e.t)) {
      return;
    }
    launch(e);
  });
  addCleanup(() => unPeers());
  room.presence(me);
  render();

  function launch(e) {
    if (launched || !me.kit) {
      return;
    }
    launched = true;
    const order = state().members;
    const spawnIdx = Math.max(0, order.indexOf(myId));
    leave();
    clearScreen();
    const proom = new Room(`play-${code}-${e.t}`);
    const versus = e.mode !== 'coop';
    const kit = findKit(me.kit);
    const stage = versus ? ARENA_STAGE : COOP_STAGES[e.stage] || INTRO_STAGE;
    const done = () => {
      proom.leave();
      game.stop();
    };
    exitStage = () => {
      proom.leave();
      onlineMenu();
    };
    game.start({
      stage, kit, mode: versus ? 'versus' : 'coop', weapons: versus ? [kit.weapon] : [kit.weapon, ...ownedWeapons().slice(1)],
      lives: 3, etanks: 0, room: proom, hostile: versus, onPause: openPause, spawnIdx, spawnCount: order.length,
      onEnd: (kind, r) => {
        done();
        const msg = kind === 'versus' ? (r.win ? 'YOU WIN!' : 'YOU LOSE…') : kind === 'clear' ? 'MISSION COMPLETE' : 'GAME OVER';
        show(`<h1 class="logo">${msg}</h1>${btn('ok', 'オンラインメニューへ')}`, { lock: 1000, on: onlineMenu });
      },
    });
  }
}

// ---------- offline versus (自分 + COM 最大3体) ----------
const offline = { kit: null, coms: 1, diff: 'normal', comKits: [] };
const OFF_DIFF = { easy: 'かんたん', normal: 'ふつう', hard: 'つよい' };
function offlineRoster() {
  // operatorOnly のキャラは運営キー登録者のみ
  return [...versusRoster(true, hasPremium()).filter(k => !k.operatorOnly || save.operator), ...STAFF_KITS];
}
function rollComs() {
  // 自分と被らないキャラをランダムに選ぶ（COM同士も重複なし）
  const pool = offlineRoster().filter(k => k.id !== offline.kit);
  const pick = [];
  while (pick.length < offline.coms && pool.length) {
    pick.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0].id);
  }
  offline.comKits = pick;
}
function offlineMenu() {
  const roster = offlineRoster();
  if (offline.comKits.length !== offline.coms || offline.comKits.includes(offline.kit)) {
    rollComs();
  }
  const coms = offline.comKits.map((id, i) => `<div>COM${i + 1}：${esc(findKit(id).name)}</div>`).join('');
  show(`<h2>オフライン</h2>
    <div class="panel col">
      <div class="row">人数 ${[1, 2, 3].map(n => `<button class="btn small ${offline.coms === n ? 'sel' : ''}" data-act="n:${n}">${n + 1}人</button>`).join('')}</div>
      <div class="row">COMの強さ ${Object.entries(OFF_DIFF).map(([k, l]) => `<button class="btn small ${offline.diff === k ? 'sel' : ''}" data-act="d:${k}">${l}</button>`).join('')}</div>
      <div class="sub" style="text-align:left">あなた：${offline.kit ? esc(findKit(offline.kit).name) : '選択してください'}${coms}</div>
      <div class="row">${btn('roll', 'COMを再抽選', 'style="min-width:0"')}</div>
      <div class="sub">ステージ：バトルアリーナ（3KO先取）</div>
    </div>
    <div class="rgrid">${roster.map(k => `<div class="rcell ${offline.kit === k.id ? 'sel' : ''}" data-act="k:${k.id}"><img src="${k.portrait}" alt="${k.name}" loading="lazy"><div>${k.name}</div></div>`).join('')}</div>
    <div class="row">${btn('start', 'スタート', offline.kit ? '' : 'disabled')}${btn('back', '戻る')}</div>`, {
    back: menu,
    on: act => {
      if (act === 'back') {
        menu();
      } else if (act === 'roll') {
        rollComs();
        offlineMenu();
      } else if (act.startsWith('n:')) {
        offline.coms = Math.max(1, Math.min(3, +act.slice(2) || 1));
        rollComs();
        offlineMenu();
      } else if (act.startsWith('d:')) {
        offline.diff = OFF_DIFF[act.slice(2)] ? act.slice(2) : 'normal';
        offlineMenu();
      } else if (act.startsWith('k:')) {
        const id = act.slice(2);
        if (roster.some(k => k.id === id)) {
          offline.kit = id;
          offlineMenu();
        }
      } else if (act === 'start' && offline.kit) {
        startOffline();
      }
    },
  });
}
function startOffline() {
  const kit = findKit(offline.kit);
  const comKits = offline.comKits.map(findKit);
  const room = new LocalRoom(comKits.map(k => ({ kit: k })), offline.diff, comKits.length + 1);
  exitStage = () => {
    room.leave();
    offlineMenu();
  };
  clearScreen();
  game.start({
    stage: ARENA_STAGE, kit, mode: 'versus', weapons: kit.weapons ? [...kit.weapons] : [kit.weapon], lives: 3, etanks: 0,
    room, hostile: true, onPause: openPause, spawnIdx: 0, spawnCount: comKits.length + 1,
    onEnd: (kind, r) => {
      room.leave();
      game.stop();
      show(`<h1 class="logo">${r.win ? 'YOU WIN!' : 'YOU LOSE…'}</h1>${btn('again', 'もう一度')}${btn('ok', 'オフラインメニューへ')}`, {
        lock: 1000,
        on: act => (act === 'again' ? startOffline() : offlineMenu()),
      });
    },
  });
}

// ---------- operator invasion ----------
const ALL_STAGES = [INTRO_STAGE, ...STAGES, ...FINAL_STAGES];
let invaderKit = null;
function invaderChoices() {
  return [...(save.operator ? [{ ...OVERLORD_KIT, weapons: OPERATOR_WEAPONS }, OPERATOR_SAGE_KIT] : []), ...STAFF_KITS];
}
function invadePick() {
  if (!canInvade()) {
    menu();
    return;
  }
  const list = invaderChoices();
  show(`<h2 style="color:#ff4a5a">侵入キャラ選択</h2><div class="cards">${list.map((k, i) => `<button class="btn card" data-act="k:${i}"><img src="${k.portrait}" alt="${k.name}" loading="lazy" style="object-fit:contain"><b>${k.name}</b><div class="sub">${k.desc}</div><div class="sub">HP ${k.hp}</div></button>`).join('')}</div>${btn('back', '戻る')}`, {
    back: menu,
    on: act => {
      if (act === 'back') {
        menu();
        return;
      }
      const k = list[+act.slice(2)];
      if (k) {
        invaderKit = k;
        invadeScreen();
      }
    },
  });
}
function invadeScreen() {
  // 権限と選択キャラを毎回再確認（選択肢外のキャラは使えない）
  if (!canInvade() || !invaderKit || !invaderChoices().some(k => k.id === invaderKit.id)) {
    invadePick();
    return;
  }
  const h = getHub();
  if (!h) {
    ui.toast('接続できませんでした', 2);
    menu();
    return;
  }
  h.presence({ inGame: false, operator: true });
  show(`<h2 style="color:#ff4a5a">⚠ 侵入モード</h2><div class="panel col"><div class="sub">${esc(invaderKit.name)} でプレイ中のソロプレイヤーに乱入します</div><div id="tg" class="col"></div>${btn('back', '戻る')}</div>`, {
    back: invadePick,
    on: act => {
      if (act === 'back') {
        invadePick();
        return;
      }
      const pid = act.slice(2);
      const p = h.peers[pid];
      const st = p && ALL_STAGES.find(s => s.id === p.stage);
      if (!st) {
        return;
      }
      h.emit('invade', { target: pid });
      exitStage = invadeScreen;
      clearScreen();
      game.start({
        stage: st, kit: { ...invaderKit }, mode: 'invader', weapons: [...invaderKit.weapons], lives: 0, etanks: 0,
        room: h, hostile: true, targetPid: pid, onPause: openPause,
        onEnd: (kind, r) => {
          game.stop();
          show(`<h1 class="logo">${r.win ? '侵入成功' : r.lost ? '目標ロスト' : '撃退された'}</h1>${btn('ok', '戻る')}`, { lock: 800, on: invadeScreen });
        },
      });
    },
  });
  const render = peers => {
    const el = $('#tg');
    if (!el) {
      return;
    }
    const list = Object.values(peers).filter(p => p.inGame && p.mode === 'solo');
    el.innerHTML = list.length
      ? list.filter(p => typeof p.pid === 'string' && /^[0-9a-f-]{8,64}$/i.test(p.pid)).map(p => `<button class="btn" data-act="i:${esc(p.pid)}">${esc(p.name || '???')} ─ ${esc((ALL_STAGES.find(s => s.id === p.stage) || {}).name || '???')}</button>`).join('')
      : '<div class="sub">現在プレイ中のプレイヤーはいません…</div>';
  };
  const un = h.onPeers(render);
  addCleanup(() => un());
}

boot();
