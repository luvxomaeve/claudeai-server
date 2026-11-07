import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, VRMLookAtQuaternionProxy, createVRMAnimationClip } from '@pixiv/three-vrm-animation';
import { saveFile, deleteFile, listFiles } from './storage.js';
import { Stockings, STOCKING_STYLES } from './stockings.js';
import { Character, POSES, BASE_POSE } from './character.js';
import { REACTIONS, IDLE_LINES, TIERS, tierFor, pick } from './dialogue.js';

// Тестовая модель (семпл из репозитория three-vrm). Замени на свою из VRoid Studio:
// положи файл рядом, например models/waifu.vrm, и укажи путь здесь,
// или просто перетащи .vrm в окно / добавь через 👗 Гардероб.
const DEFAULT_MODEL = window.WAIFU_MODEL_URL ??
  'https://cdn.jsdelivr.net/gh/pixiv/three-vrm@v3.1.0/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm';

const $ = (id) => document.getElementById(id);
const canvas = $('scene');

// ---------- Сцена ----------

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
const cameraLookAt = new THREE.Vector3(0, 1, 0);

const light = new THREE.DirectionalLight(0xffffff, Math.PI);
light.position.set(1, 1.5, 2).normalize();
scene.add(light);
scene.add(new THREE.AmbientLight(0xffffff, 0.6));

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  frameCamera();
}
window.addEventListener('resize', resize);

let character = null;
let fullBody = false;
let camTween = 1;
const camFrom = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
const camTo = { pos: new THREE.Vector3(), look: new THREE.Vector3() };

function frameCamera() {
  // headHeight — высота кости головы (основание черепа).
  const H = character ? character.headHeight : 1.4;
  const S = H / 1.4;
  // Кадр: от макушки с запасом под облачко до середины бёдер (или до пола).
  // Во весь рост оставляем запас сверху под облачко и снизу под кнопку поз.
  const top = H + (fullBody ? 0.7 : 0.42) * S;
  const bottom = fullBody ? -0.16 * S : H * 0.38;
  const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const distV = (top - bottom) / 2 / Math.tan(halfFov);
  // На узком экране следим, чтобы влезли руки (~0.75 м в ширину).
  const distH = (0.75 * S) / 2 / (Math.tan(halfFov) * camera.aspect);
  const dist = Math.max(distV, distH);
  const cy = (top + bottom) / 2;
  camBase.dist = dist;
  camBase.cy = cy;
  camBase.S = S;
  camFrom.pos.copy(camera.position);
  camFrom.look.copy(cameraLookAt);
  orbitTarget(camTo);
  camTween = character && animateCamera ? 0 : 1;
  if (camTween === 1) {
    camera.position.copy(camTo.pos);
    cameraLookAt.copy(camTo.look);
    camera.lookAt(cameraLookAt);
  }
  camera.updateProjectionMatrix();
}
let animateCamera = false;

// Орбита камеры вокруг девушки: поворот (yaw) и приближение (zoom).
const camBase = { dist: 2, cy: 1, S: 1 };
let camYaw = 0;
let camZoom = 1; // < 1 — ближе, > 1 — дальше
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 1.8;

function orbitTarget(out) {
  const d = camBase.dist * camZoom;
  // При приближении смещаем точку взгляда к лицу.
  const headY = (character ? character.headHeight : 1.4) + 0.05 * camBase.S;
  const lookY = THREE.MathUtils.lerp(headY, camBase.cy, THREE.MathUtils.clamp((camZoom - ZOOM_MIN) / (1 - ZOOM_MIN), 0, 1));
  out.look.set(0, lookY, 0);
  out.pos.set(Math.sin(camYaw) * d, lookY + 0.05 * camBase.S, Math.cos(camYaw) * d);
  return out;
}

// Мгновенно применить yaw/zoom (при жестах и кнопках).
function applyOrbit() {
  orbitTarget(camTo);
  camTween = 1;
  camera.position.copy(camTo.pos);
  cameraLookAt.copy(camTo.look);
  camera.lookAt(cameraLookAt);
}

function rotateBy(delta) {
  camYaw = (camYaw + delta) % (Math.PI * 2);
  applyOrbit();
}

function zoomBy(factor) {
  camZoom = THREE.MathUtils.clamp(camZoom * factor, ZOOM_MIN, ZOOM_MAX);
  applyOrbit();
}

// Плавный переезд камеры между «крупно» и «во весь рост».
function updateCamera(dt) {
  if (camTween >= 1) return;
  camTween = Math.min(1, camTween + dt / 0.6);
  const k = camTween < 0.5 ? 2 * camTween * camTween : 1 - Math.pow(-2 * camTween + 2, 2) / 2;
  camera.position.lerpVectors(camFrom.pos, camTo.pos, k);
  cameraLookAt.lerpVectors(camFrom.look, camTo.look, k);
  camera.lookAt(cameraLookAt);
}

// ---------- Загрузка модели ----------

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));
loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

let hitboxGroup = null;

// Модель, упакованная в JSON как base64 ({ "vrm": "..." }) — для хостингов,
// которые не отдают бинарные .vrm/.glb файлы.
async function loadPackedModel(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { vrm } = await res.json();
  return Uint8Array.from(atob(vrm), (c) => c.charCodeAt(0)).buffer;
}

// source: { url } — ссылка на .vrm (или упакованный .json), { buffer } — содержимое файла.
async function parseModel(source) {
  if (source.buffer) return loader.parseAsync(source.buffer.slice(0), '');
  if (source.url.endsWith('.json')) return loader.parseAsync(await loadPackedModel(source.url), '');
  return loader.loadAsync(source.url, (e) => {
    if (e.total) $('loading-text').textContent = `Загрузка… ${Math.round((e.loaded / e.total) * 100)}%`;
  });
}

let firstLoad = true;

async function loadModel(source) {
  if (firstLoad) {
    $('loading').classList.remove('done');
    $('loading-text').textContent = 'Загрузка…';
  } else {
    $('flash').classList.add('on'); // вспышка, пока переодевается
  }
  try {
    const gltf = await parseModel(source);
    const vrm = gltf.userData.vrm;
    if (!vrm) throw new Error('Это не VRM-файл');

    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    (VRMUtils.combineSkeletons ?? VRMUtils.removeUnnecessaryJoints)?.(gltf.scene);
    VRMUtils.rotateVRM0(vrm); // VRM 0.x смотрит назад — разворачиваем к камере
    vrm.scene.traverse((o) => { o.frustumCulled = false; });
    // Нужен, чтобы mocap-анимации могли управлять взглядом.
    if (vrm.lookAt) {
      const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt);
      proxy.name = 'VRMLookAtQuaternionProxy';
      vrm.scene.add(proxy);
    }

    // Переносим состояние со старой модели на новую.
    const prev = character;
    if (prev) {
      scene.remove(prev.vrm.scene);
      VRMUtils.deepDispose(prev.vrm.scene);
    }
    scene.add(vrm.scene);
    character = new Character(vrm);
    window.__waifu = character; // для отладки из консоли
    if (prev) {
      character.setPose(prev.poseName);
      character.poseT = 1;
      character.dancing = prev.dancing;
    } else {
      setActivePoseButton('stand');
    }
    if (currentAnim) character.playClip(createVRMAnimationClip(currentAnim.animation, vrm));
    stockings = new Stockings(vrm);
    loadLookFor(currentOutfit);
    applyLook();
    if (!$('wardrobe').classList.contains('hidden')) renderWardrobe();
    buildHitboxes();
    frameCamera();
    $('loading').classList.add('done');
    if (firstLoad) {
      setTimeout(() => say(pick(IDLE_LINES[tier()])), 600);
    } else {
      character.react({ expression: 'happy', motion: 'tiltHead' });
      setTimeout(() => say(pick(['Ну как я тебе? ♥', 'Та-дам! Нравится?', 'Хе-хе, переоделась~', 'Мне идёт?'])), 300);
    }
    firstLoad = false;
  } catch (err) {
    console.error(err);
    if (firstLoad) $('loading-text').textContent = `Не удалось загрузить модель: ${err.message}`;
    else say('Ой… этот наряд не открывается. Точно .vrm?', 'sad');
  } finally {
    setTimeout(() => $('flash').classList.remove('on'), 150);
  }
}

// ---------- Симпатия ----------

const STORAGE_KEY = 'waifu-affection';
let affection = 10;
try {
  const saved = Number(localStorage.getItem(STORAGE_KEY));
  if (Number.isFinite(saved) && saved > 0) affection = saved;
} catch { /* приватный режим — живём без сохранения */ }

const tier = () => tierFor(affection);

function changeAffection(delta) {
  const before = tier();
  affection = THREE.MathUtils.clamp(affection + delta, 0, 100);
  try { localStorage.setItem(STORAGE_KEY, String(affection)); } catch { /* ignore */ }
  renderAffection();
  if (tier() > before) say(tier() === 2 ? 'Кажется… ты мне правда нравишься ♥' : 'Слушай, а с тобой весело!', 'happy');
}

function renderAffection() {
  $('affection-fill').style.width = `${affection}%`;
  $('affection-label').textContent = TIERS[tier()].label;
}
renderAffection();

// ---------- Реплики и озвучка ----------

let voiceOn = true;
let bubbleTimer = 0;
let lastSpokeAt = 0;

function say(text, expression) {
  const bubble = $('bubble');
  bubble.textContent = text;
  bubble.classList.remove('hidden');
  bubbleTimer = 2.2 + text.length * 0.05;
  lastSpokeAt = performance.now();
  if (expression) character?.setExpression(expression);
  character?.talk(Math.min(0.15 + text.length * 0.06, 2.5));
  speak(text);
}

function speak(text) {
  if (!voiceOn || !('speechSynthesis' in window)) return;
  const clean = text.replace(/[♥~*]/g, '').trim();
  if (!clean || clean === '…') return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = 'ru-RU';
  u.pitch = 1.6;
  u.rate = 1.05;
  const voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith('ru'));
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}

$('btn-voice').addEventListener('click', () => {
  voiceOn = !voiceOn;
  $('btn-voice').classList.toggle('off', !voiceOn);
  if (!voiceOn && 'speechSynthesis' in window) speechSynthesis.cancel();
});

// ---------- Касания ----------

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerActive = false;
let petting = null; // { lastX, lastY, dist, ticks }
let recentTaps = [];
let lastZoneLineAt = 0;

function toNdc(e) {
  const r = canvas.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
}

function zoneAt(e) {
  if (!character) return null;
  toNdc(e);
  raycaster.setFromCamera(pointer, camera);
  return character.hitTest(raycaster.ray);
}

// Активные касания: для щипка (зум) двумя пальцами и поворота свайпом по фону.
const touches = new Map();
let orbitDrag = null; // { lastX }
let pinchDist = 0;

function pinchDistance() {
  const [a, b] = [...touches.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

canvas.addEventListener('pointerdown', (e) => {
  if (!character) return;
  canvas.setPointerCapture(e.pointerId);
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  pointerActive = true;
  $('hint').style.opacity = 0;

  if (touches.size === 2) {
    // Второй палец: начинаем щипок, отменяем поглаживание и поворот.
    pinchDist = pinchDistance();
    petting = null;
    orbitDrag = null;
    canvas.classList.remove('petting');
    return;
  }
  if (touches.size > 2) return;

  const hit = zoneAt(e);
  if (!hit) {
    orbitDrag = { lastX: e.clientX };
    return;
  }

  if (hit.zone === 'headpat') {
    petting = { lastX: e.clientX, lastY: e.clientY, dist: 0, ticks: 0 };
    canvas.classList.add('petting');
    return;
  }

  // Слишком частые тычки — обижается.
  const now = performance.now();
  recentTaps = recentTaps.filter((t) => now - t < 2500);
  recentTaps.push(now);
  if (recentTaps.length >= 6) {
    recentTaps = [];
    triggerReaction('spam', hit, e);
    return;
  }
  triggerReaction(hit.zone, hit, e);
});

canvas.addEventListener('pointermove', (e) => {
  toNdc(e);
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 2 && pinchDist > 0) {
    const d = pinchDistance();
    zoomBy(pinchDist / d);
    pinchDist = d;
    return;
  }
  if (orbitDrag) {
    rotateBy(-(e.clientX - orbitDrag.lastX) * 0.01);
    orbitDrag.lastX = e.clientX;
    return;
  }
  if (!petting) return;
  const dx = e.clientX - petting.lastX;
  const dy = e.clientY - petting.lastY;
  petting.dist += Math.hypot(dx, dy);
  petting.lastX = e.clientX;
  petting.lastY = e.clientY;
  // Каждые ~70px поглаживания — «тик»: симпатия и сердечко.
  while (petting.dist > 70) {
    petting.dist -= 70;
    petting.ticks++;
    changeAffection(0.4);
    floatHeart(e.clientX, e.clientY);
    if (petting.ticks % 6 === 1 && performance.now() - lastSpokeAt > 2500) {
      say(pick(REACTIONS.headpat.lines[tier()]));
    }
  }
});

function endPointer(e) {
  touches.delete(e.pointerId);
  if (touches.size < 2) pinchDist = 0;
  orbitDrag = null;
  if (touches.size > 0) return;
  pointerActive = false;
  canvas.classList.remove('petting');
  if (petting) {
    // Просто нажали на голову без движения — одиночное поглаживание.
    if (petting.ticks === 0) triggerReaction('headpat', null, e);
    petting = null;
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoomBy(Math.exp(e.deltaY * 0.001));
}, { passive: false });

// Кнопки камеры: зажал — крутится/приближается непрерывно.
function holdButton(id, action) {
  const btn = $(id);
  let timer = null;
  const stop = () => { clearInterval(timer); timer = null; };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    action();
    stop();
    timer = setInterval(action, 40);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, stop);
}
holdButton('cam-left', () => rotateBy(-0.06));
holdButton('cam-right', () => rotateBy(0.06));
holdButton('cam-in', () => zoomBy(0.96));
holdButton('cam-out', () => zoomBy(1.04));
$('cam-reset').addEventListener('click', () => {
  camYaw = 0;
  camZoom = 1;
  animateCamera = true;
  frameCamera();
  animateCamera = false;
});
canvas.addEventListener('pointercancel', endPointer);

function triggerReaction(zone, hit, e) {
  const r = REACTIONS[zone];
  if (!r) return;
  const t = tier();
  const expression = r.expressionByTier ? r.expressionByTier[t] : r.expression;
  const delta = r.affectionByTier ? r.affectionByTier[t] : r.affection;
  character.react({ expression, motion: r.motion, side: hit?.side });
  changeAffection(delta);
  if (delta > 0) floatHeart(e.clientX, e.clientY);
  const now = performance.now();
  if (zone === 'spam' || now - lastZoneLineAt > 700) {
    lastZoneLineAt = now;
    say(pick(r.lines[t]));
  }
}

function floatHeart(x, y) {
  const el = document.createElement('div');
  el.className = 'float-heart';
  el.textContent = '♥';
  el.style.left = `${x + (Math.random() - 0.5) * 30}px`;
  el.style.top = `${y - 10}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1100);
}

// ---------- Зоны касаний (отладка) ----------

let showHitboxes = false;
function buildHitboxes() {
  if (hitboxGroup) scene.remove(hitboxGroup);
  hitboxGroup = new THREE.Group();
  hitboxGroup.visible = showHitboxes;
  const colors = { headpat: 0xff66aa, face: 0xffaa00, hand: 0x00cc88, arm: 0x66aaff, body: 0xff3333, belly: 0xaa66ff, legs: 0x3366ff };
  for (const z of character.zones) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: colors[z.zone], wireframe: true, transparent: true, opacity: 0.6, depthTest: false }),
    );
    m.userData.zone = z;
    hitboxGroup.add(m);
  }
  scene.add(hitboxGroup);
}
$('btn-hitbox').classList.add('off');
$('btn-hitbox').addEventListener('click', () => {
  showHitboxes = !showHitboxes;
  $('btn-hitbox').classList.toggle('off', !showHitboxes);
  if (hitboxGroup) hitboxGroup.visible = showHitboxes;
});

// ---------- Позы ----------

const POSE_LINES = {
  stand: 'Ну, стою. И?',
  hips: 'Хмф! Ну и чего ты хочешь?',
  shy: 'Н-не смотри так пристально…',
  behind: 'Хе-хе, а что у меня за спиной? Не скажу~',
  think: 'Хм-м… дай подумать.',
  hello: 'Приве-е-ет!',
};

function setActivePoseButton(name) {
  for (const btn of document.querySelectorAll('#pose-list button')) {
    btn.classList.toggle('active', btn.dataset.pose === name);
  }
  $('pose-current').textContent = POSES[name]?.label ?? 'Своя';
}

function setPoseListOpen(open) {
  $('pose-list').hidden = !open;
  $('poses-toggle').setAttribute('aria-expanded', String(open));
  $('poses-toggle').classList.toggle('open', open);
  if (open) $('hint').style.opacity = 0;
}
$('poses-toggle').addEventListener('click', () => setPoseListOpen($('pose-list').hidden));

function addPoseButton(name, def) {
  const btn = document.createElement('button');
  btn.textContent = def.label;
  btn.dataset.pose = name;
  btn.addEventListener('click', () => {
    if (!character) return;
    if (currentAnim) stopAnim();
    character.dancing = false;
    character.setPose(name);
    setActivePoseButton(name);
    setPoseListOpen(false);
    say(POSE_LINES[name] ?? pick(['Так?', 'Ну как я тебе?', 'Вот так нормально?']));
  });
  $('pose-list').appendChild(btn);
}
for (const [name, def] of Object.entries(POSES)) addPoseButton(name, def);

// ---------- Редактор поз ----------

const POSES_KEY = 'waifu-poses';
let savedPoses = {};
try { savedPoses = JSON.parse(localStorage.getItem(POSES_KEY) || '{}'); } catch { savedPoses = {}; }
for (const [name, params] of Object.entries(savedPoses)) {
  POSES[`saved:${name}`] = { label: `★ ${name}`, ...params };
  addPoseButton(`saved:${name}`, POSES[`saved:${name}`]);
}

// Ползунки: показываем «человеческие» значения и пересчитываем в углы костей.
// Правая и левая рука зеркальны, поэтому у них разные знаки.
const direct = (key) => ({ get: (p) => p[key], set: (p, v) => { p[key] = v; } });
const SLIDERS = [
  { group: 'Голова', label: 'Кивок', min: -0.6, max: 0.6, ...direct('headX') },
  { group: 'Голова', label: 'Поворот', min: -0.9, max: 0.9, ...direct('headY') },
  { group: 'Голова', label: 'Наклон вбок', min: -0.5, max: 0.5, ...direct('headZ') },
  { group: 'Корпус', label: 'Наклон вперёд', min: -0.4, max: 0.5, ...direct('spineX') },
  { group: 'Корпус', label: 'Поворот', min: -0.8, max: 0.8, ...direct('spineY') },
  { group: 'Корпус', label: 'Изгиб вбок', min: -0.4, max: 0.4, ...direct('spineZ') },
  { group: 'Корпус', label: 'Бёдра', min: -0.2, max: 0.2, ...direct('hipsZ') },
  ...[['l', 'Левая рука (её)', 1], ['r', 'Правая рука (её)', -1]].flatMap(([k, group, m]) => [
    { group, label: 'Поднять', min: -0.3, max: 2.9,
      get: (p) => m * p[`${k}UpperZ`] + 1.22, set: (p, v) => { p[`${k}UpperZ`] = m * (v - 1.22); } },
    { group, label: 'Вперёд / назад', min: -0.8, max: 1.6,
      get: (p) => -p[`${k}UpperX`], set: (p, v) => { p[`${k}UpperX`] = -v; } },
    { group, label: 'Вращение плеча', min: -1.6, max: 1.6, ...direct(`${k}UpperTwist`) },
    { group, label: 'Локоть', min: 0, max: 2.7,
      get: (p) => -m * p[`${k}LowerY`], set: (p, v) => { p[`${k}LowerY`] = -m * v; } },
    { group, label: 'Предплечье вверх', min: -1, max: 2,
      get: (p) => m * p[`${k}LowerZ`], set: (p, v) => { p[`${k}LowerZ`] = m * v; } },
  ]),
];

let editorParams = null;

function openEditor() {
  if (!character) return;
  editorParams = { ...character.getPoseParams() };
  character.setCustomPose(editorParams);
  setActivePoseButton('custom');
  renderSliders();
}

function renderSliders() {
  const box = $('editor-sliders');
  box.innerHTML = '';
  let group = null;
  for (const sl of SLIDERS) {
    if (sl.group !== group) {
      group = sl.group;
      const h = document.createElement('div');
      h.className = 'editor-group';
      h.textContent = group;
      box.appendChild(h);
    }
    const row = document.createElement('label');
    row.className = 'editor-row';
    const name = document.createElement('span');
    name.textContent = sl.label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = sl.min;
    input.max = sl.max;
    input.step = 0.01;
    input.value = sl.get(editorParams);
    input.addEventListener('input', () => {
      sl.set(editorParams, Number(input.value));
      character.setCustomPose(editorParams);
    });
    row.append(name, input);
    box.appendChild(row);
  }
}

$('btn-editor').addEventListener('click', () => togglePanel('editor', openEditor));
$('editor-reset').addEventListener('click', () => {
  editorParams = { ...BASE_POSE };
  character.setCustomPose(editorParams);
  renderSliders();
});
$('editor-save').addEventListener('click', () => {
  $('editor-save-row').hidden = false;
  $('pose-name').focus();
});
$('editor-save-row').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('pose-name').value.trim().slice(0, 20);
  if (!name) return;
  const key = `saved:${name}`;
  const isNew = !POSES[key];
  savedPoses[name] = { ...editorParams };
  POSES[key] = { label: `★ ${name}`, ...editorParams };
  try { localStorage.setItem(POSES_KEY, JSON.stringify(savedPoses)); } catch { /* ignore */ }
  if (isNew) addPoseButton(key, POSES[key]);
  character.setPose(key);
  setActivePoseButton(key);
  $('pose-name').value = '';
  $('editor-save-row').hidden = true;
  say('Запомнила эту позу~');
});

// Удаление в два нажатия: первое спрашивает, второе удаляет.
let clearArmed = false;
$('editor-clear').addEventListener('click', () => {
  if (!clearArmed) {
    clearArmed = true;
    $('editor-clear').textContent = 'Точно удалить?';
    setTimeout(() => { clearArmed = false; $('editor-clear').textContent = 'Удалить сохранённые'; }, 3000);
    return;
  }
  clearArmed = false;
  $('editor-clear').textContent = 'Удалить сохранённые';
  for (const name of Object.keys(savedPoses)) {
    delete POSES[`saved:${name}`];
    document.querySelector(`#pose-list button[data-pose="saved:${CSS.escape(name)}"]`)?.remove();
  }
  savedPoses = {};
  try { localStorage.removeItem(POSES_KEY); } catch { /* ignore */ }
});

$('btn-zoom').addEventListener('click', () => {
  fullBody = !fullBody;
  camZoom = 1;
  $('btn-zoom').classList.toggle('off', !fullBody);
  animateCamera = true;
  frameCamera();
  animateCamera = false;
});
$('btn-zoom').classList.add('off');

// ---------- Панели ----------

function togglePanel(id, onOpen) {
  const panel = $(id);
  const willOpen = panel.classList.contains('hidden');
  for (const p of document.querySelectorAll('.panel')) p.classList.add('hidden');
  if (willOpen) {
    onOpen?.();
    panel.classList.remove('hidden');
  }
}
for (const btn of document.querySelectorAll('.panel-close')) {
  btn.addEventListener('click', () => btn.closest('.panel').classList.add('hidden'));
}

// ---------- Гардероб ----------

const DEFAULT_OUTFIT = { id: 'default', name: 'Базовый', source: { url: DEFAULT_MODEL } };
let outfits = [DEFAULT_OUTFIT];
let currentOutfit = 'default';

const CLOTH_COLORS = [
  { id: 'original', name: 'Оригинал', color: null },
  { id: 'black', name: 'Готика', color: 0x2b2530 },
  { id: 'wine', name: 'Бордо', color: 0x6e1f33 },
  { id: 'violet', name: 'Фиалка', color: 0x5b3a8c },
  { id: 'rose', name: 'Роза', color: 0xf2a7c3 },
  { id: 'red', name: 'Алый', color: 0xc8283c },
  { id: 'sky', name: 'Небо', color: 0x8fc4ee },
  { id: 'white', name: 'Белый', color: 0xf4f1f6 },
];
let clothColor = 'original'; // хранится в образе модели (см. loadLookFor)

// Перекрашивает материалы одежды (в моделях VRoid в их имени есть «CLOTH»).
function applyClothColor() {
  if (!character) return;
  const def = CLOTH_COLORS.find((c) => c.id === clothColor) ?? CLOTH_COLORS[0];
  character.vrm.scene.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!/CLOTH/i.test(m.name) || !m.color) continue;
      m.userData.origColor ??= m.color.clone();
      if (m.shadeColorFactor) m.userData.origShade ??= m.shadeColorFactor.clone();
      if (def.color === null) {
        m.color.copy(m.userData.origColor);
        if (m.shadeColorFactor) m.shadeColorFactor.copy(m.userData.origShade);
      } else {
        const c = new THREE.Color(def.color);
        m.color.copy(c);
        if (m.shadeColorFactor) m.shadeColorFactor.copy(c).multiplyScalar(0.55);
      }
    }
  });
}

// ---------- Образ: волосы, чулки, атмосфера ----------

let stockings = null;
const HAIR_COLORS = [
  { id: 'original', name: 'Свои', color: null },
  { id: 'black', name: 'Чёрные', color: 0x2a2230 },
  { id: 'plum', name: 'Слива', color: 0x4a2a5e },
  { id: 'silver', name: 'Пепел', color: 0xc9c4d4 },
  { id: 'pink', name: 'Розовые', color: 0xf0a0c8 },
  { id: 'red', name: 'Алые', color: 0x8c1c30 },
];
const look = { hair: 'original', stockings: 'off', dark: false };
// Образ запоминается отдельно для каждой модели: у одной чёрные волосы и чулки,
// у другой — свои цвета.
function loadLookFor(id) {
  Object.assign(look, { hair: 'original', stockings: 'off', dark: false, cloth: 'original' });
  try { Object.assign(look, JSON.parse(localStorage.getItem(`waifu-look:${id}`) || '{}')); } catch { /* ignore */ }
  clothColor = look.cloth;
}
const saveLook = () => {
  look.cloth = clothColor;
  try { localStorage.setItem(`waifu-look:${currentOutfit}`, JSON.stringify(look)); } catch { /* ignore */ }
};

function tintMaterials(test, colorHex, shadeK) {
  character.vrm.scene.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!test.test(m.name) || !m.color) continue;
      m.userData.origColor ??= m.color.clone();
      if (m.shadeColorFactor) m.userData.origShade ??= m.shadeColorFactor.clone();
      if (colorHex === null) {
        m.color.copy(m.userData.origColor);
        if (m.shadeColorFactor) m.shadeColorFactor.copy(m.userData.origShade);
      } else {
        const c = new THREE.Color(colorHex);
        m.color.copy(c);
        if (m.shadeColorFactor) m.shadeColorFactor.copy(c).multiplyScalar(shadeK);
      }
    }
  });
}

function applyLook() {
  if (!character) return;
  applyClothColor();
  tintMaterials(/HAIR/i, HAIR_COLORS.find((c) => c.id === look.hair)?.color ?? null, 0.6);
  stockings?.apply(look.stockings);
  document.body.classList.toggle('dark', look.dark);
}

function renderSwatches(boxId, items, current, onPick) {
  const box = $(boxId);
  box.innerHTML = '';
  for (const c of items) {
    const b = document.createElement('button');
    b.className = 'swatch' + (c.id === current ? ' active' : '');
    b.title = c.name;
    const col = c.color === null || c.color === undefined ? 'transparent' : `#${c.color.toString(16).padStart(6, '0')}`;
    b.style.setProperty('--swatch', col);
    b.innerHTML = `<span></span>${c.name}`;
    b.addEventListener('click', () => onPick(c));
    box.appendChild(b);
  }
}

function renderWardrobe() {
  const list = $('outfit-list');
  list.innerHTML = '';
  for (const o of outfits) {
    const row = document.createElement('div');
    row.className = 'outfit' + (o.id === currentOutfit ? ' active' : '');
    const wear = document.createElement('button');
    wear.className = 'outfit-wear';
    wear.textContent = o.name;
    wear.addEventListener('click', () => wearOutfit(o.id));
    row.appendChild(wear);
    if (o.id !== 'default') {
      const del = document.createElement('button');
      del.className = 'outfit-del';
      del.title = 'Убрать наряд';
      del.textContent = '✕';
      del.addEventListener('click', async () => {
        await deleteFile(o.id);
        outfits = outfits.filter((x) => x.id !== o.id);
        if (currentOutfit === o.id) wearOutfit('default');
        else renderWardrobe();
      });
      row.appendChild(del);
    }
    list.appendChild(row);
  }

  const sw = $('color-list');
  sw.innerHTML = '';
  for (const c of CLOTH_COLORS) {
    const b = document.createElement('button');
    b.className = 'swatch' + (c.id === clothColor ? ' active' : '');
    b.title = c.name;
    b.style.setProperty('--swatch', c.color === null ? 'transparent' : `#${c.color.toString(16).padStart(6, '0')}`);
    b.innerHTML = `<span></span>${c.name}`;
    b.addEventListener('click', () => {
      clothColor = c.id;
      saveLook();
      applyClothColor();
      renderWardrobe();
      if (character) {
        character.react({ expression: 'happy', motion: 'sway' });
        say(c.id === 'black' ? 'Мрачненько… мне нравится ♥' : pick(['Ну как?', 'Мне идёт этот цвет?', 'Хе-хе, обновочка~']));
      }
    });
    sw.appendChild(b);
  }

  renderSwatches('hair-list', HAIR_COLORS, look.hair, (c) => {
    look.hair = c.id;
    saveLook();
    applyLook();
    renderWardrobe();
    character?.react({ expression: 'happy', motion: 'touchHair' });
    say(pick(['Новый цвет волос! Ну как?', 'Мне идёт?', 'Хе-хе, перекрасилась~']));
  });

  const st = $('stocking-list');
  st.innerHTML = '';
  if (stockings && !stockings.available) {
    st.innerHTML = '<p class="panel-note">У этой модели чулки нарисовать не получится (нужна модель из VRoid).</p>';
  } else {
    for (const c of STOCKING_STYLES) {
      const b = document.createElement('button');
      b.className = 'chip' + (c.id === look.stockings ? ' active' : '');
      b.textContent = c.name;
      b.addEventListener('click', () => {
        look.stockings = c.id;
        saveLook();
        applyLook();
        renderWardrobe();
        character?.react({ expression: 'happy', motion: 'sway' });
        say(c.id === 'off' ? 'Так удобнее~' : pick(['Чулочки — моя слабость ♥', 'Красивые, правда?', 'Хи, нравятся?']));
      });
      st.appendChild(b);
    }
  }

  $('dark-toggle').classList.toggle('active', look.dark);
  $('dark-toggle').textContent = look.dark ? '🌙 Готичная атмосфера: вкл' : '🌙 Готичная атмосфера: выкл';
}

$('dark-toggle').addEventListener('click', () => {
  look.dark = !look.dark;
  saveLook();
  applyLook();
  renderWardrobe();
});

$('goth-preset').addEventListener('click', () => {
  clothColor = 'black';
  saveLook();
  Object.assign(look, { hair: 'black', stockings: 'black', dark: true });
  saveLook();
  applyLook();
  renderWardrobe();
  character?.react({ expression: 'relaxed', motion: 'tiltHead' });
  say('Тьма мне к лицу, не находишь? ♥');
});

async function wearOutfit(id) {
  const o = outfits.find((x) => x.id === id);
  if (!o || !character) return;
  currentOutfit = id;
  try { localStorage.setItem('waifu-outfit', id); } catch { /* ignore */ }
  renderWardrobe();
  await loadModel(o.source);
}

async function addOutfit(file) {
  const buffer = await file.arrayBuffer();
  const record = { id: `outfit-${Date.now()}`, kind: 'outfit', name: file.name.replace(/\.vrm$/i, '').slice(0, 24), data: buffer, created: Date.now() };
  await saveFile(record);
  outfits.push({ id: record.id, name: record.name, source: { buffer } });
  await wearOutfit(record.id);
}

$('btn-wardrobe').addEventListener('click', () => togglePanel('wardrobe', renderWardrobe));
$('outfit-input').addEventListener('change', (e) => {
  if (e.target.files[0]) addOutfit(e.target.files[0]);
  e.target.value = '';
});

// ---------- Анимации ----------

let anims = [];
let currentAnim = null; // { id, name, animation }

async function parseAnimation(buffer) {
  const gltf = await loader.parseAsync(buffer.slice(0), '');
  const animation = gltf.userData.vrmAnimations?.[0];
  if (!animation) throw new Error('В файле нет VRM-анимации');
  return animation;
}

function renderAnims() {
  $('btn-dance').classList.toggle('active', !!character?.dancing && !currentAnim);
  $('btn-dance').textContent = character?.dancing && !currentAnim ? '💃 Танцует — остановить' : '💃 Танцевать';
  const list = $('anim-list');
  list.innerHTML = '';
  if (!anims.length) {
    const empty = document.createElement('p');
    empty.className = 'panel-note';
    empty.textContent = 'Пока пусто. Добавь mocap-анимацию в формате .vrma — она заменит позы.';
    list.appendChild(empty);
  }
  for (const a of anims) {
    const row = document.createElement('div');
    row.className = 'outfit' + (currentAnim?.id === a.id ? ' active' : '');
    const play = document.createElement('button');
    play.className = 'outfit-wear';
    play.textContent = (currentAnim?.id === a.id ? '■ ' : '▶ ') + a.name;
    play.addEventListener('click', () => (currentAnim?.id === a.id ? stopAnim() : playAnim(a)));
    const del = document.createElement('button');
    del.className = 'outfit-del';
    del.title = 'Удалить анимацию';
    del.textContent = '✕';
    del.addEventListener('click', async () => {
      if (currentAnim?.id === a.id) stopAnim();
      await deleteFile(a.id);
      anims = anims.filter((x) => x.id !== a.id);
      renderAnims();
    });
    row.append(play, del);
    list.appendChild(row);
  }
}

async function playAnim(a) {
  if (!character) return;
  try {
    a.animation ??= await parseAnimation(a.data);
    currentAnim = a;
    character.dancing = false;
    character.playClip(createVRMAnimationClip(a.animation, character.vrm));
  } catch (err) {
    console.error(err);
    say('Не получается так двигаться… файл точно .vrma?', 'sad');
  }
  renderAnims();
}

function stopAnim() {
  currentAnim = null;
  character?.stopClip();
  renderAnims();
}

async function addAnim(file) {
  const data = await file.arrayBuffer();
  const record = { id: `anim-${Date.now()}`, kind: 'anim', name: file.name.replace(/\.vrma$/i, '').slice(0, 24), data, created: Date.now() };
  await saveFile(record);
  anims.push(record);
  await playAnim(record);
}

$('btn-anims').addEventListener('click', () => togglePanel('anims', renderAnims));
$('btn-dance').addEventListener('click', () => {
  if (!character) return;
  if (currentAnim) stopAnim();
  character.dancing = !character.dancing;
  if (character.dancing) say(pick(['Смотри, как я умею~', 'Музыку погромче!', 'Танцуем! ♥']), 'happy');
  renderAnims();
});
$('anim-input').addEventListener('change', (e) => {
  if (e.target.files[0]) addAnim(e.target.files[0]);
  e.target.value = '';
});

// ---------- Перетаскивание файлов ----------

window.addEventListener('dragover', (e) => { e.preventDefault(); $('drop-overlay').classList.remove('hidden'); });
window.addEventListener('dragleave', () => $('drop-overlay').classList.add('hidden'));
window.addEventListener('drop', (e) => {
  e.preventDefault();
  $('drop-overlay').classList.add('hidden');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const name = file.name.toLowerCase();
  if (name.endsWith('.vrma')) addAnim(file);
  else if (name.endsWith('.vrm')) addOutfit(file);
});

// Сохранённые наряды и анимации из прошлых сессий.
async function restoreLibrary() {
  for (const r of await listFiles('outfit')) outfits.push({ id: r.id, name: r.name, source: { buffer: r.data } });
  anims = await listFiles('anim');
  let saved = 'default';
  try { saved = localStorage.getItem('waifu-outfit') || 'default'; } catch { /* ignore */ }
  const start = outfits.find((o) => o.id === saved) ?? DEFAULT_OUTFIT;
  currentOutfit = start.id;
  await loadModel(start.source);
}

// ---------- Цикл ----------

const clock = new THREE.Clock();
const anchor = new THREE.Vector3();
const lookPoint = new THREE.Vector3();
const lookNdc = new THREE.Vector2();
let idleTime = 0;

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);

  updateCamera(dt);
  if (character) {
    // Взгляд за пальцем/курсором: точка на плоскости перед моделью.
    raycaster.setFromCamera(pointer, camera);
    raycaster.ray.at(camera.position.distanceTo(cameraLookAt) - 0.3, lookPoint);
    character.lookTarget.position.lerp(lookPoint, 1 - Math.exp(-dt * 10));
    // Головой за пальцем следит только когда мы перед ней.
    const facing = Math.max(0, Math.cos(camYaw));
    lookNdc.set(pointer.x * facing, pointer.y * facing);
    character.headLook.lerp(lookNdc, 1 - Math.exp(-dt * 4));

    const patTarget = petting && petting.ticks > 0 ? 1 : 0;
    character.patAmount += (patTarget - character.patAmount) * (1 - Math.exp(-dt * 5));

    character.update(dt);

    if (hitboxGroup?.visible) {
      for (const m of hitboxGroup.children) {
        m.position.copy(m.userData.zone.center);
        m.scale.setScalar(m.userData.zone.worldRadius);
      }
    }

    // Облачко с репликой над головой.
    bubbleTimer -= dt;
    const bubble = $('bubble');
    if (bubbleTimer <= 0) bubble.classList.add('hidden');
    character.headScreenAnchor(anchor).project(camera);
    const x = (anchor.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-anchor.y * 0.5 + 0.5) * window.innerHeight;
    const half = bubble.offsetWidth / 2 + 8;
    bubble.style.left = `${THREE.MathUtils.clamp(x, half, window.innerWidth - half)}px`;
    // Не залезаем под верхнюю панель (на телефоне она в две строки).
    const hudBottom = $('hud').getBoundingClientRect().bottom + 12;
    bubble.style.top = `${Math.max(y, bubble.offsetHeight + hudBottom)}px`;

    // Если долго не трогают — скучает.
    idleTime = pointerActive ? 0 : idleTime + dt;
    if (idleTime > 18) {
      idleTime = 0;
      say(pick(IDLE_LINES[tier()]), tier() === 2 ? 'relaxed' : 'sad');
    }
  }

  renderer.render(scene, camera);
}

resize();
tick();
restoreLibrary();
