// HUD object, touch setup and generic screen helpers.
import { bindTouchButton } from './input.js';
import { play } from './audio.js';

const $ = s => document.querySelector(s);
const screensEl = $('#screens');

export const touchPref = { mode: 'auto' };

const hudState = { wname: '', lives: 2, tanks: 0 };
let bannerTimer = 0;
let toastTimer = 0;
// 軽量化：要素参照と最終値をキャッシュし、値が変わった時だけDOMを書き換える
const elCache = {};
const q = sel => elCache[sel] || (elCache[sel] = $(sel));
const last = {};
function put(key, el, prop, val, style = true) {
  if (last[key] === val || !el) {
    return;
  }
  last[key] = val;
  if (style) {
    el.style[prop] = val;
  } else {
    el[prop] = val;
  }
}
function setBar(sel, frac) {
  const f = Math.max(0, Math.min(1, frac || 0));
  put(sel + 'h', q(sel + ' i'), 'height', `calc(${(f * 100).toFixed(1)}% - ${f > 0 ? 4 : 0}px)`);
}
function hudInfo() {
  const lives = hudState.lives === null ? '' : `残機 ×${Math.max(0, hudState.lives)}　`;
  const el = q('#hudinfo');
  const key = `${hudState.wname}\n${lives}セル ${hudState.tanks}`;
  if (last.info === key || !el) {
    return;
  }
  last.info = key;
  el.textContent = '';
  el.append(String(hudState.wname), document.createElement('br'), `${lives}セル ${hudState.tanks}`);
}

export function applyTouch() {
  const coarse = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  const on = touchPref.mode === 'on' || (touchPref.mode === 'auto' && coarse);
  $('#touch').classList.toggle('on', on);
}

export const ui = {
  hud(on) {
    $('#hud').classList.toggle('on', on);
    applyTouch();
  },
  setHP(v, m) {
    setBar('#hpbar', v / m);
  },
  setWeapon(name, color, en, max, free) {
    hudState.wname = name;
    const c = '#' + color.toString(16).padStart(6, '0');
    put('wpd', q('#wpbar'), 'display', free ? 'none' : 'block');
    put('wpc', q('#wpbar i'), 'background', c);
    setBar('#wpbar', en / max);
    put('hib', q('#hudinfo'), 'borderLeft', `4px solid ${c}`);
    hudInfo();
  },
  setBoss(v, m, name) {
    const on = !!name;
    put('bbd', q('#bossbar'), 'display', on ? 'block' : 'none');
    put('bnd', q('#bossname'), 'display', on ? 'block' : 'none');
    if (on) {
      setBar('#bossbar', v / m);
      put('bnt', q('#bossname'), 'textContent', String(name), false);
    }
  },
  setLives(n) {
    hudState.lives = n;
    hudInfo();
  },
  setTanks(n) {
    hudState.tanks = n;
    hudInfo();
  },
  banner(text, kind = '', dur = 2) {
    const b = $('#banner');
    b.textContent = text;
    b.className = kind;
    b.style.opacity = 1;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => {
      b.style.opacity = 0;
    }, dur * 1000);
  },
  toast(text, dur = 2) {
    const t = $('#toast');
    t.textContent = text;
    t.style.opacity = 1;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.style.opacity = 0;
    }, dur * 1000);
  },
  setScore(t) {
    $('#score').textContent = t || '';
  },
};

export function setupTouch() {
  [['#t-left', 'left'], ['#t-right', 'right'], ['#t-jump', 'jump'], ['#t-shot', 'shoot'], ['#t-dash', 'dash'], ['#t-wpn', 'next'], ['#t-tank', 'tank'], ['#t-sp', 'special']]
    .forEach(([s, a]) => bindTouchButton($(s), a));
}

let screenCleanup = null;
export function clearScreen() {
  if (screenCleanup) {
    screenCleanup();
    screenCleanup = null;
  }
  screensEl.innerHTML = '';
}
export function addCleanup(fn) {
  const prev = screenCleanup;
  screenCleanup = () => {
    fn();
    if (prev) {
      prev();
    }
  };
}

// Renders a screen; elements with data-act are clickable and keyboard-navigable.
export function show(html, { cls = '', style = '', on = null, back = null, cols = 1, lock = 450 } = {}) {
  clearScreen();
  screensEl.innerHTML = `<div class="screen ${cls}" style="${style}">${html}</div>`;
  const root = screensEl.firstElementChild;
  const lockUntil = performance.now() + lock;
  let sel = -1;
  const items = () => [...root.querySelectorAll('[data-act]')].filter(b => !b.disabled && !b.classList.contains('taken'));
  const activate = b => {
    if (!b || b.disabled || performance.now() < lockUntil) {
      return;
    }
    play('confirm');
    if (on) {
      on(b.dataset.act, b);
    }
  };
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (b) {
      activate(b);
    }
  });
  const key = e => {
    const inInput = e.target && e.target.tagName === 'INPUT';
    const list = items();
    let d = 0;
    if (!inInput) {
      if (e.code === 'ArrowDown') {
        d = cols;
      } else if (e.code === 'ArrowUp') {
        d = -cols;
      } else if (e.code === 'ArrowRight') {
        d = 1;
      } else if (e.code === 'ArrowLeft') {
        d = -1;
      }
    }
    if (d && list.length) {
      e.preventDefault();
      sel = sel < 0 ? 0 : (sel + d + list.length) % list.length;
      play('select');
      list.forEach((b, i) => b.classList.toggle('sel', i === sel));
    } else if (e.code === 'Enter' && !inInput && list.length) {
      e.preventDefault();
      activate(list[Math.max(0, sel)]);
    } else if (e.code === 'Escape' && back && performance.now() >= lockUntil) {
      back();
    }
  };
  window.addEventListener('keydown', key);
  screenCleanup = () => window.removeEventListener('keydown', key);
  return root;
}

export const btn = (act, label, extra = '') => `<button class="btn" data-act="${act}" ${extra}>${label}</button>`;

// Typewriter cutscene; tap/Enter advances.
export function cutscene(img, lines, next) {
  let i = 0;
  let typing = null;
  let finished = false;
  const done = () => {
    if (!finished) {
      finished = true;
      clearInterval(typing);
      next();
    }
  };
  const root = show(`<button class="btn small skip" data-act="skip">SKIP ▶▶</button><div class="panel" id="cuttext"></div>`, {
    cls: 'cut', style: `background-image:url('${img}')`, lock: 300, on: done,
  });
  const el = root.querySelector('#cuttext');
  const showLine = () => {
    clearInterval(typing);
    const txt = lines[i];
    let n = 0;
    typing = setInterval(() => {
      n++;
      el.textContent = txt.slice(0, n);
      if (n >= txt.length) {
        clearInterval(typing);
        typing = null;
      }
    }, 35);
  };
  const adv = () => {
    if (typing) {
      clearInterval(typing);
      typing = null;
      el.textContent = lines[i];
      return;
    }
    i++;
    if (i >= lines.length) {
      done();
    } else {
      play('select');
      showLine();
    }
  };
  root.addEventListener('pointerdown', e => {
    if (!e.target.closest('[data-act]')) {
      adv();
    }
  });
  const k = e => {
    if (e.code === 'Enter' || e.code === 'Space') {
      adv();
    }
  };
  window.addEventListener('keydown', k);
  addCleanup(() => {
    clearInterval(typing);
    window.removeEventListener('keydown', k);
  });
  showLine();
}
