// Unified keyboard / mouse / touch input with edge detection.
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  Space: 'jump', KeyK: 'jump', ShiftLeft: 'dash', ShiftRight: 'dash', KeyL: 'dash',
  KeyJ: 'shoot', KeyZ: 'shoot', KeyQ: 'prev', KeyE: 'next', KeyT: 'tank', KeyX: 'special', KeyI: 'special',
  Escape: 'pause', KeyP: 'pause',
};

const held = {};
const pressed = new Set();
const released = new Set();

export const input = {
  enabled: false,
  isDown(a) {
    return !!held[a];
  },
  wasPressed(a) {
    return pressed.has(a);
  },
  wasReleased(a) {
    return released.has(a);
  },
  press(a) {
    if (!held[a]) {
      pressed.add(a);
    }
    held[a] = true;
  },
  release(a) {
    if (held[a]) {
      released.add(a);
    }
    held[a] = false;
  },
  clearEdges() {
    pressed.clear();
    released.clear();
  },
  reset() {
    for (const k in held) {
      held[k] = false;
    }
    pressed.clear();
    released.clear();
  },
};

window.addEventListener('keydown', e => {
  const a = KEYMAP[e.code];
  if (!a || !input.enabled) {
    return;
  }
  if (e.target && e.target.tagName === 'INPUT') {
    return;
  }
  e.preventDefault();
  if (!e.repeat) {
    input.press(a);
  }
});

window.addEventListener('keyup', e => {
  const a = KEYMAP[e.code];
  if (a) {
    input.release(a);
  }
});

window.addEventListener('blur', () => input.reset());

// ---- Gamepad (standard mapping, PC) ----
// In-game: buttons drive actions. In menus: D-pad/stick = arrows, A = Enter, B = Escape.
const PAD_ACTIONS = { 0: 'jump', 2: 'shoot', 1: 'dash', 7: 'special', 6: 'dash', 4: 'prev', 5: 'next', 3: 'tank', 9: 'pause' };
const padHeld = {};
const padPrevBtn = [];
let menuRepeat = 0;
function setPad(action, on) {
  if (on && !padHeld[action]) {
    input.press(action);
  } else if (!on && padHeld[action]) {
    input.release(action);
  }
  padHeld[action] = on;
}
function sendKey(code) {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true }));
}
function pollPads() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = [...pads].find(p => p && p.connected);
  if (gp) {
    const b = i => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5));
    const ax = gp.axes[0] || 0;
    const ay = gp.axes[1] || 0;
    const left = b(14) || ax < -0.5;
    const right = b(15) || ax > 0.5;
    const up = b(12) || ay < -0.5;
    const down = b(13) || ay > 0.5;
    if (input.enabled) {
      setPad('left', left);
      setPad('right', right);
      setPad('up', up);
      setPad('down', down);
      const acts = {};
      for (const i in PAD_ACTIONS) {
        acts[PAD_ACTIONS[i]] = acts[PAD_ACTIONS[i]] || b(+i);
      }
      for (const a in acts) {
        setPad(a, acts[a]);
      }
    } else {
      for (const a in padHeld) {
        setPad(a, false);
      }
      const edge = i => b(i) && !padPrevBtn[i];
      if (edge(0) || edge(9)) {
        sendKey('Enter');
      }
      if (edge(1)) {
        sendKey('Escape');
      }
      const dir = left ? 'ArrowLeft' : right ? 'ArrowRight' : up ? 'ArrowUp' : down ? 'ArrowDown' : null;
      const now = performance.now();
      if (dir && now > menuRepeat) {
        sendKey(dir);
        menuRepeat = now + 220;
      } else if (!dir) {
        menuRepeat = 0;
      }
    }
    for (let i = 0; i < gp.buttons.length; i++) {
      padPrevBtn[i] = b(i);
    }
  }
  requestAnimationFrame(pollPads);
}
requestAnimationFrame(pollPads);

export function bindTouchButton(el, action) {
  const down = e => {
    e.preventDefault();
    el.classList.add('pressed');
    try {
      el.setPointerCapture(e.pointerId);
    } catch (err) {
      // ignore
    }
    input.press(action);
  };
  const up = e => {
    e.preventDefault();
    el.classList.remove('pressed');
    input.release(action);
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('lostpointercapture', up);
}
