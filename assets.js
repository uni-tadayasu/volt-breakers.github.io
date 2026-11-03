// Loading + model factory.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// 起動時に必須のモデルのみ先に読み込み、終盤・特殊キャラ用は後から裏で読み込む（初回表示を高速化）
const MODELS = ['vb-hero-van', 'vb-hero-rei', 'enemy-walker'];
const DEFERRED = ['overlord', 'vb-operator-brute'];
const pendingModels = {};
const TEXTURES = ['vb-tile-floor', 'vb-tile-wall', 'vb-bossroom-wall', 'vb-bg-city', 'vb-bg-fortress', 'vb-i-hs', 'vb-i-hl', 'vb-i-en', 'vb-i-up', 'vb-i-tank'];

const models = {};
const textures = {};

export async function loadAll(onProgress) {
  const gl = new GLTFLoader();
  const tl = new THREE.TextureLoader();
  let done = 0;
  const total = MODELS.length + TEXTURES.length;
  const tick = () => {
    done++;
    onProgress(done / total);
  };
  const tasks = [
    ...MODELS.map(n => gl.loadAsync(`assets/models/${n}.glb`).then(g => {
      models[n] = g;
    }).catch(() => console.warn('model failed', n)).finally(tick)),
    ...TEXTURES.map(n => tl.loadAsync(`assets/${n}.webp`).then(t => {
      t.colorSpace = THREE.SRGBColorSpace;
      if (n.includes('tile') || n.includes('wall')) {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = 8;
      }
      textures[n] = t;
    }).catch(() => console.warn('tex failed', n)).finally(tick)),
  ];
  await Promise.all(tasks);
}

let gltfLoader = null;
export function ensureModel(name) {
  if (models[name]) {
    return Promise.resolve(models[name]);
  }
  if (!pendingModels[name]) {
    gltfLoader = gltfLoader || new GLTFLoader();
    pendingModels[name] = gltfLoader.loadAsync(`assets/models/${name}.glb`).then(g => {
      models[name] = g;
      return g;
    }).catch(() => {
      console.warn('model failed', name);
      delete pendingModels[name];
      return null;
    });
  }
  return pendingModels[name];
}

export function hasModel(name) {
  return !!models[name];
}

export function loadDeferred() {
  const go = () => DEFERRED.reduce((p, n) => p.then(() => ensureModel(n)), Promise.resolve());
  if ('requestIdleCallback' in window) {
    requestIdleCallback(go, { timeout: 3000 });
  } else {
    setTimeout(go, 800);
  }
}

export function getTexture(name) {
  return textures[name] || null;
}

function fallbackRobot(height, tint) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: tint || 0x4488ff, metalness: 0.6, roughness: 0.35 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.6, 4, 8), mat);
  body.position.y = 0.75;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 10), mat);
  head.position.y = 1.4;
  g.add(body, head);
  g.scale.setScalar(height / 1.7);
  return g;
}

export function makeModel(name, { height = 1.7, tint = null, emissive = null } = {}) {
  const group = new THREE.Group();
  const inner = new THREE.Group();
  group.add(inner);
  const src = models[name];
  if (!src && DEFERRED.includes(name)) {
    ensureModel(name); // 未読込なら読み込み開始（呼び出し側が後で作り直す）
  }
  if (!src) {
    inner.add(fallbackRobot(height, tint));
    return { group, inner, mixer: null, actions: {}, current: null };
  }
  const obj = SkeletonUtils.clone(src.scene);
  obj.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  obj.scale.setScalar(height / Math.max(0.01, size.y));
  obj.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  obj.position.set(-c.x, -box.min.y, -c.z);
  const tintColor = tint !== null && tint !== undefined ? new THREE.Color(tint) : null;
  obj.traverse(o => {
    if (o.isMesh) {
      o.frustumCulled = false;
      o.material = o.material.clone();
      if (tintColor && o.material.color) {
        o.material.color.lerp(tintColor, 0.6);
      }
      if (emissive && o.material.emissive) {
        o.material.emissive = new THREE.Color(emissive);
        o.material.emissiveIntensity = 0.45;
      }
    }
  });
  inner.add(obj);
  const mixer = src.animations && src.animations.length ? new THREE.AnimationMixer(obj) : null;
  const actions = {};
  if (mixer) {
    src.animations.forEach(clip => {
      actions[clip.name.toLowerCase()] = mixer.clipAction(clip);
    });
  }
  return { group, inner, mixer, actions, current: null };
}

export function playAnim(rig, keyword) {
  if (!rig.mixer || rig.currentKey === keyword) {
    return;
  }
  const key = Object.keys(rig.actions).find(k => k.includes(keyword));
  if (!key) {
    return;
  }
  rig.currentKey = keyword;
  const next = rig.actions[key];
  if (rig.current && rig.current !== next) {
    rig.current.fadeOut(0.15);
  }
  next.reset().fadeIn(0.15).play();
  rig.current = next;
}
