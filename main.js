// Game flow: title, menu, story, stage select, password, options, online, invasion.
import { Game } from './game.js';
import {
  WEAPONS, HEROES, BOSSES, STAGES, INTRO_STAGE, FINAL_STAGES, ARENA_STAGE,
  heroKit, versusRoster, findKit, OVERLORD_KIT, encodePassword, decodePassword,
} from './data.js';
import { input } from './input.js';
import { unlock, play, setVolumes, playMusic, stopMusic } from './audio.js';
import { loadAll, loadDeferred } from './assets.js';
import { Room, myId, preloadNet } from './net.js';
import { ui, show, btn, cutscene, clearScreen, addCleanup, setupTouch, touchPref, applyTouch } from './screens.js';

const $ = s => document.querySelector(s);
const OP_KEY = 'OVERLORD-ADMIN';
const BG = img => `background-image:linear-gradient(rgba(0,0,0,.35),rgba(0,0,0,.7)),url('${img}')`;

// ---------- save ----------
const DEFAULTS = { hero: 0, cleared: 0, hidden: 0, etanks: 0, intro: false, bgm: 0.55, sfx: 0.8, touch: 'auto', operator: false };
let save;
try {
  save = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('nih-save') || '{}') };
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
      ${btn('online', 'オンライン')}
      ${btn('opt', 'オプション')}
      ${save.operator ? btn('invade', '⚠ 侵入（運営）') : ''}
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
      } else if (act === 'online') {
        onlineMenu();
      } else if (act === 'opt') {
        options();
      } else if (act === 'invade') {
        invadeScreen();
      }
    },
  });
}

function charSelect(done, back) {
  show(`<h2>キャラクターセレクト</h2>
    <div class="cards">
      ${HEROES.map((h, i) => `<div class="panel card" data-act="${i}"><img src="${h.portrait}" alt=""><h2 style="font-size:22px;margin-top:6px">${h.name}</h2><div class="sub">${h.desc}</div></div>`).join('')}
    </div>${btn('back', '戻る')}`, {
    back,
    on: act => (act === 'back' ? back() : done(+act)),
  });
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
    <div class="row"><input type="text" id="o-key" placeholder="運営キー" style="font-size:14px;letter-spacing:1px;width:180px">${btn('key', '登録', 'style="min-width:0"')}</div>
    <div class="sub" id="o-msg">${save.operator ? '運営モード：有効' : ''}</div>
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
        const ok = $('#o-key').value.trim().toUpperCase() === OP_KEY;
        save.operator = ok || save.operator;
        persist();
        $('#o-msg').textContent = ok ? '運営モード：有効' : 'キーが違います';
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
      let code = $('#code').value.trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
      if (act === 'rand' || !code) {
        code = Math.random().toString(36).slice(2, 7).toUpperCase();
      }
      lobby(code);
    },
  });
  root.querySelector('#code').focus();
}

const MODES = { coop: { label: '協力 2人', max: 2 }, vs2: { label: '対戦 2人', max: 2 }, vs4: { label: '対戦 4人', max: 4 } };
const COOP_STAGES = [INTRO_STAGE, ...STAGES];

function lobby(code) {
  let room;
  try {
    room = new Room('lobby-' + code);
  } catch (e) {
    ui.toast('接続できませんでした', 2);
    onlineMenu();
    return;
  }
  const me = { lobby: true, kit: null, mode: 'coop', stage: 0, ready: true };
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
    const members = [myId, ...Object.keys(peers)].sort();
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
    const roster = s.mode === 'coop' ? HEROES.map(heroKit) : versusRoster(save.operator);
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
  room.on('start', e => launch(e));
  addCleanup(() => unPeers());
  room.presence(me);
  render();

  function launch(e) {
    if (launched || !me.kit) {
      return;
    }
    launched = true;
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
      lives: 3, etanks: 0, room: proom, hostile: versus, onPause: openPause,
      onEnd: (kind, r) => {
        done();
        const msg = kind === 'versus' ? (r.win ? 'YOU WIN!' : 'YOU LOSE…') : kind === 'clear' ? 'MISSION COMPLETE' : 'GAME OVER';
        show(`<h1 class="logo">${msg}</h1>${btn('ok', 'オンラインメニューへ')}`, { lock: 1000, on: onlineMenu });
      },
    });
  }
}

// ---------- operator invasion ----------
const ALL_STAGES = [INTRO_STAGE, ...STAGES, ...FINAL_STAGES];
function invadeScreen() {
  const h = getHub();
  if (!h) {
    ui.toast('接続できませんでした', 2);
    menu();
    return;
  }
  h.presence({ inGame: false, operator: true });
  show(`<h2 style="color:#ff4a5a">⚠ 侵入モード</h2><div class="panel col"><div class="sub">プレイ中のソロプレイヤーを選んで乱入します</div><div id="tg" class="col"></div>${btn('back', '戻る')}</div>`, {
    back: menu,
    on: act => {
      if (act === 'back') {
        menu();
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
        stage: st, kit: { ...OVERLORD_KIT }, mode: 'invader', weapons: ['spikebomb', 'boomerang', 'quake', 'spark', 'fire'], lives: 0, etanks: 0,
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
      ? list.map(p => `<button class="btn" data-act="i:${p.pid}">${p.name || '???'} ─ ${(ALL_STAGES.find(s => s.id === p.stage) || {}).name || p.stage}</button>`).join('')
      : '<div class="sub">現在プレイ中のプレイヤーはいません…</div>';
  };
  const un = h.onPeers(render);
  addCleanup(() => un());
}

boot();
