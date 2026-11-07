import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, VRMLookAtQuaternionProxy, createVRMAnimationClip } from '@pixiv/three-vrm-animation';
import { saveFile, deleteFile, listFiles } from './storage.js';
import { Stockings, STOCKING_STYLES } from './stockings.js';
import { parseMixamo, mixamoClip } from './mixamo.js';
import { MOCAP, loadMocap, mocapClip, mocapUpperClip } from './mocap.js';
import { Character, POSES, LOOPS } from './character.js';
import { REACTIONS, STROKES, IDLE_LINES, TIERS, tierFor, pick } from './dialogue.js';

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

// Свет как в студии: основной (с мягкой тенью на пол) + розоватый контровой
// сзади — силуэт отделяется от фона и выглядит объёмнее.
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const light = new THREE.DirectionalLight(0xffffff, Math.PI);
light.position.set(1.1, 3.2, 2.4);
light.castShadow = true;
light.shadow.mapSize.set(1024, 1024);
Object.assign(light.shadow.camera, { left: -1.6, right: 1.6, top: 1.6, bottom: -1.6, near: 0.5, far: 8 });
light.shadow.bias = -0.0006;
light.shadow.normalBias = 0.02;
scene.add(light);
const rim = new THREE.DirectionalLight(0xffd2ec, 0.9);
rim.position.set(-1.2, 1.8, -2.2);
scene.add(rim);
scene.add(new THREE.AmbientLight(0xffffff, 0.6));

// Пол: невидимый, только тень от неё + мягкая «контактная» тень под телом,
// чтобы она стояла, сидела и лежала на полу, а не парила.
const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.ShadowMaterial({ opacity: 0.18 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const blobTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(60,20,70,0.55)');
  grd.addColorStop(0.5, 'rgba(60,20,70,0.22)');
  grd.addColorStop(1, 'rgba(60,20,70,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
blob.rotation.x = -Math.PI / 2;
blob.position.y = 0.003;
blob.renderOrder = -1;
scene.add(blob);
const blobHips = new THREE.Vector3();
function updateBlob() {
  if (!character?.bones.hips) return;
  character.bones.hips.getWorldPosition(blobHips);
  // Сидит/лежит — пятно шире и темнее (тело ближе к полу).
  const low = THREE.MathUtils.clamp(1 - blobHips.y / 0.95, 0, 1);
  blob.position.x = blobHips.x;
  blob.position.z = blobHips.z;
  blob.scale.set(0.55 + low * 0.9, 0.42 + low * 0.5, 1);
  blob.material.opacity = 0.7 + low * 0.3;
}

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
let camPitch = 0.05; // наклон камеры: < 0 — снизу, > 0 — сверху
let camZoom = 1; // < 1 — ближе, > 1 — дальше
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 3;

function orbitTarget(out) {
  const d = camBase.dist * camZoom;
  // При приближении смещаем точку взгляда к лицу.
  const headY = (character ? character.headHeight : 1.4) + 0.05 * camBase.S;
  let lookY = THREE.MathUtils.lerp(headY, camBase.cy, THREE.MathUtils.clamp((camZoom - ZOOM_MIN) / (1 - ZOOM_MIN), 0, 1));
  // Когда она садится, камера опускается вместе с ней.
  if (character) lookY -= (character.sitDropNow ?? 0) * 0.6;
  out.look.set(0, lookY, 0);
  const cp = Math.cos(camPitch);
  out.pos.set(Math.sin(camYaw) * d * cp, lookY + Math.sin(camPitch) * d, Math.cos(camYaw) * d * cp);
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

function rotateBy(delta, dPitch = 0) {
  camYaw = (camYaw + delta) % (Math.PI * 2);
  camPitch = THREE.MathUtils.clamp(camPitch + dPitch, -0.35, 1.35);
  applyOrbit();
}

function zoomBy(factor) {
  camZoom = THREE.MathUtils.clamp(camZoom * factor, ZOOM_MIN, ZOOM_MAX);
  applyOrbit();
}

// Плавный переезд камеры между «крупно» и «во весь рост».
let camSitSeen = 0;
function updateCamera(dt) {
  // Следим за посадкой: если она садится/встаёт, плавно ведём камеру.
  if (character && camTween >= 1 && Math.abs(character.sitS - camSitSeen) > 0.002) {
    camSitSeen = character.sitS;
    applyOrbit();
  }
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
    vrm.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    scene.add(vrm.scene);
    character = new Character(vrm);
    window.__waifu = character; // для отладки из консоли
    window.__cam = camera;
    if (prev) {
      character.setPose(prev.poseName);
      character.poseT = 1;
      character.dancing = prev.dancing;
    } else {
      setActivePoseButton('stand');
    }
    if (currentAnim) character.playClip(clipFor(currentAnim, vrm));
    else if (currentMocap) playMocap(currentMocap);
    stockings = new Stockings(vrm);
    loadLookFor(currentOutfit);
    applyLook();
    if (!$('wardrobe').classList.contains('hidden')) renderWardrobe();
    buildHitboxes();
    frameCamera();
    $('loading').classList.add('done');
    if (firstLoad) {
      setTimeout(() => say(pick(IDLE_LINES[tier()])), 600);
      // По умолчанию — живое ожидание на записях живых людей.
      setTimeout(() => { if (!currentAnim && !currentMocap && !character.loop && !character.dancing) { liveIdle = true; playMocap(nextIdle()); } }, 300);
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
let stroking = null;
let bgSwipe = null; // свайп по пустому месту в обычном режиме // поглаживание не головы: { hit, lastX, lastY, moved, dist, ticks }
let pinchDist = 0;

function pinchDistance() {
  const [a, b] = [...touches.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

canvas.addEventListener('pointerdown', (e) => {
  if (!character) return;
  // Открыт список поз — касание по сцене просто закрывает его.
  if (!$('pose-list').hidden) { setPoseListOpen(false); return; }
  canvas.setPointerCapture(e.pointerId);
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  pointerActive = true;
  $('hint').style.opacity = 0;

  // Два пальца в любом режиме — щипок: приблизить/отдалить.
  if (touches.size === 2) {
    pinchDist = pinchDistance();
    poseDrag = null;
    orbitDrag = null;
    bgSwipe = null;
    petting = null;
    stroking = null;
    canvas.classList.remove('petting');
    return;
  }
  if (touches.size > 2) return;

  // Режим позы: хватаем руку или голову.
  if (poseMode) {
    poseDragStart(e);
    return;
  }

  // Режим камеры: пальцы крутят и приближают, реакций нет.
  if (cameraMode) {
    if (touches.size === 1 && zoneAt(e) && performance.now() - camHintAt > 5000) {
      camHintAt = performance.now();
      showToast('Касания выключены — нажми 🎥 ещё раз');
    }
    if (touches.size === 2) {
      pinchDist = pinchDistance();
      orbitDrag = null;
    } else if (touches.size === 1) {
      orbitDrag = { lastX: e.clientX, lastY: e.clientY, sx: e.clientX, sy: e.clientY, axis: null };
    }
    return;
  }

  if (touches.size === 2) {
    // Второй палец в обычном режиме: отменяем поглаживание.
    pinchDist = pinchDistance();
    petting = null;
    stroking = null;
    orbitDrag = null;
    canvas.classList.remove('petting');
    return;
  }
  if (touches.size > 2) return;

  const hit = zoneAt(e);
  if (!hit) {
    // Пустое место в обычном режиме: ничего не делаем (сесть/встать — ползунком слева).
    bgSwipe = { sy: e.clientY, sx: e.clientX, lastY: e.clientY, axis: null };
    return;
  }

  // Одежда и волосы рядом с пальцем качнулись от прикосновения.
  character.poke(hit.point, raycaster.ray.direction, 0.8);

  if (hit.zone === 'headpat') {
    petting = { lastX: e.clientX, lastY: e.clientY, dist: 0, ticks: 0 };
    canvas.classList.add('petting');
    return;
  }
  // Ждём: если палец поведут — это поглаживание, если отпустят — тычок.
  stroking = { hit, lastX: e.clientX, lastY: e.clientY, moved: 0, dist: 0, ticks: 0 };
});

// Тычок: срабатывает, когда палец отпустили, не поведя им.
function tapReaction(hit, e) {
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
}

// Поглаживание любой зоны, кроме головы: мягкая реакция раз в ~80px.
let lastStrokeLineAt = 0;
function strokeTick(e) {
  const r = STROKES[stroking.hit.zone];
  if (!r) return;
  const t = tier();
  stroking.ticks++;
  // Одежду ведёт за пальцем.
  const hit = zoneAt(e);
  if (hit) character.poke(hit.point, dragDirection(e), 0.7);
  if (stroking.ticks % 3 === 1 && !character.motions.some((m) => m.name === r.motion)) {
    character.react({ expression: r.expression[t], motion: r.motion, side: stroking.hit.side, strength: 0.7 });
  }
  changeAffection(r.affection[t]);
  if (r.affection[t] > 0 && stroking.ticks % 2 === 0) floatHeart(e.clientX, e.clientY);
  const now = performance.now();
  if (now - lastStrokeLineAt > 2600 && now - lastSpokeAt > 1800) {
    lastStrokeLineAt = now;
    say(pick(r.lines[t]));
  }
}

// Направление движения пальца в мире (по горизонтали).
const dragVec = new THREE.Vector3();
function dragDirection(e) {
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const fwd = raycaster.ray.direction.clone();
  const dx = Math.sign(e.clientX - stroking.lastX) || 0;
  return dragVec.copy(fwd).multiplyScalar(0.6).addScaledVector(right, dx);
}

canvas.addEventListener('pointermove', (e) => {
  toNdc(e);
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 2 && pinchDist > 0) {
    const d = pinchDistance();
    zoomBy(pinchDist / d);
    pinchDist = d;
    return;
  }
  if (poseDrag) {
    poseDragMove(e);
    return;
  }
  if (orbitDrag) {
    // Сначала понимаем направление жеста: вбок — крутим камеру (сесть/встать — только ползунком).
    rotateBy(-(e.clientX - orbitDrag.lastX) * 0.01, (e.clientY - orbitDrag.lastY) * 0.005);
    orbitDrag.lastX = e.clientX;
    orbitDrag.lastY = e.clientY;
    return;
  }
  if (bgSwipe) {
    if (!bgSwipe.axis && Math.hypot(e.clientX - bgSwipe.sx, e.clientY - bgSwipe.sy) > 10) {
      bgSwipe.axis = Math.abs(e.clientY - bgSwipe.sy) > Math.abs(e.clientX - bgSwipe.sx) ? 'y' : 'x';
    }
    bgSwipe.lastY = e.clientY;
    return;
  }
  if (stroking) {
    const d = Math.hypot(e.clientX - stroking.lastX, e.clientY - stroking.lastY);
    stroking.moved += d;
    stroking.dist += d;
    if (stroking.moved > 18) {
      while (stroking.dist > 80) {
        stroking.dist -= 80;
        strokeTick(e);
      }
    }
    stroking.lastX = e.clientX;
    stroking.lastY = e.clientY;
    return;
  }
  if (!petting) return;
  // Поглаживание головы тоже качает волосы.
  if (petting.dist > 35) {
    const hit = zoneAt(e);
    if (hit) character.poke(hit.point, raycaster.ray.direction, 0.4);
  }
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
  poseDrag = null;
  bgSwipe = null;
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
  if (stroking) {
    if (stroking.moved <= 18) tapReaction(stroking.hit, e);
    stroking = null;
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
holdButton('cam-in', () => zoomBy(0.96));
holdButton('cam-out', () => zoomBy(1.04));
$('cam-reset').addEventListener('click', () => {
  camYaw = 0;
  camPitch = 0.05;
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
  // Тело чуть откачивается от касания и пружинисто возвращается.
  if (hit) character.nudge(raycaster.ray.direction, zone === 'spam' ? 1.2 : 0.8);
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
  flirty: 'Ну как я тебе? ♥',
  hips: 'Хмф! Ну и чего ты хочешь?',
  crossed: 'Ну и? Я жду объяснений.',
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
  if (open) {
    $('hint').style.opacity = 0;
    $('pose-list').querySelector('button.active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }
}
$('poses-toggle').addEventListener('click', () => setPoseListOpen($('pose-list').hidden));

function addPoseButton(name, def) {
  const btn = document.createElement('button');
  btn.textContent = def.label;
  btn.dataset.pose = name;
  if (name.startsWith('saved:')) {
    // Своя поза: крестик удаляет (второе нажатие подтверждает).
    const del = document.createElement('span');
    del.className = 'del';
    del.textContent = '×';
    btn.appendChild(del);
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!btn.classList.contains('armed')) {
        btn.classList.add('armed');
        setTimeout(() => btn.classList.remove('armed'), 2500);
        showToast('Нажми × ещё раз — удалить');
        return;
      }
      const n = name.slice(6);
      delete savedPoses[n];
      delete POSES[name];
      try { localStorage.setItem(POSES_KEY, JSON.stringify(savedPoses)); } catch { /* ignore */ }
      btn.remove();
      showToast('Поза удалена');
    });
  }
  btn.addEventListener('click', () => {
    if (!character) return;
    if (currentAnim) stopAnim();
    if (currentMocap) stopMocap();
    character.dancing = false;
    character.loop = null;
    character.setPose(name);
    if (character.sit > 0) sitBy(-character.sit / 0.004);
    setActivePoseButton(name);
    // Список не закрываем — можно быстро перебирать позы одну за другой.
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

// ---------- Поза пальцем ----------
// Режим ✏️: тянешь за руку — рука идёт за пальцем (локоть сгибается сам);
// за голову — поворачивает голову; за грудь — наклоняет корпус;
// за таз/живот — сдвигает бёдра (вниз — приседает, колени сгибаются сами).

let poseMode = false;
let poseDrag = null; // { kind: 'hand' | 'head' | 'spine' | 'hips', side, plane, lastX, lastY }

function setPoseMode(on) {
  if (on && cameraMode) setCameraMode(false);
  if (on && currentMocap) stopMocap(); // позу выставляем на «живом» скелете, без записи
  poseMode = on;
  poseDrag = null;
  $('btn-editor').classList.toggle('active', on);
  $('pose-bar').hidden = !on;
  document.body.classList.toggle('posing', on);
  $('cam-controls').hidden = !(on || cameraMode);
  closePoseSaveForm();
  if (on) {
    setPoseListOpen(false);
    // Позируем во весь рост — видно и руки, и ноги.
    if (!fullBody) setFullBody(true);
    $('hint').style.opacity = 0;
    hintOnce('pose', 'Тяни за точки · таз вниз — сесть · фон — камера');
  }
}
$('btn-editor').addEventListener('click', () => setPoseMode(!poseMode));
$('pose-done').addEventListener('click', () => setPoseMode(false));
$('pose-reset').addEventListener('click', () => {
  character?.clearTouchPose();
  showToast('Поза сброшена');
});
// Сохранение прямо в нижней панели: кнопки сменяются полем для названия.
$('pose-save').addEventListener('click', () => {
  $('pose-bar-buttons').hidden = true;
  $('pose-save-form').hidden = false;
  $('pose-save-name').focus();
});
function closePoseSaveForm() {
  $('pose-save-form').hidden = true;
  $('pose-bar-buttons').hidden = false;
  $('pose-save-name').value = '';
}
$('pose-save-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (savePoseAs($('pose-save-name').value)) {
    closePoseSaveForm();
    showToast('Поза сохранена — она в списке «Поза»');
  }
});
$('pose-save-cancel').addEventListener('click', closePoseSaveForm);

// Светящиеся точки-ручки в режиме позы: показывают, за что можно тянуть.
const HANDLE_KEYS = ['handL', 'handR', 'head', 'chest', 'belly', 'hips', 'footL', 'footR'];
const handleEls = {};
for (const k of HANDLE_KEYS) {
  const el = document.createElement('div');
  el.className = 'handle';
  $('handles').appendChild(el);
  handleEls[k] = el;
}
const handleV = new THREE.Vector3();
function handleWorld(key) {
  const c = character;
  const zone = (z, bone) => c.zones.find((q) => q.zone === z && (!bone || q.bone === bone))?.center;
  switch (key) {
    case 'handL': return c.handWorld('left');
    case 'handR': return c.handWorld('right');
    case 'head': return zone('face');
    case 'chest': return zone('body', 'chest');
    case 'belly': return zone('belly');
    case 'hips': return zone('body', 'hips');
    case 'footL': return c.footWorld('left');
    case 'footR': return c.footWorld('right');
  }
  return null;
}
function updateHandles() {
  const show = poseMode && !!character;
  $('handles').hidden = !show;
  if (!show) return;
  for (const k of HANDLE_KEYS) {
    const p = handleWorld(k);
    if (!p) continue;
    handleV.copy(p).project(camera);
    const el = handleEls[k];
    el.style.left = `${(handleV.x * 0.5 + 0.5) * window.innerWidth}px`;
    el.style.top = `${(-handleV.y * 0.5 + 0.5) * window.innerHeight}px`;
  }
}

// Левый край экрана (обычный режим и камера): почти невидимая полоса —
// веди вниз — присед → на колени → боком → лежит, вверх — встаёт.
const SIT_MAX = 1.3;
const sitSlider = $('sit-slider');
// Палец ведёт относительно (без скачка к месту касания): вся высота полосы = от «стоит» до «лежит».
let sliderDrag = null;
sitSlider.addEventListener('pointerdown', (e) => {
  if (!character) return;
  e.preventDefault();
  e.stopPropagation();
  sitSlider.setPointerCapture(e.pointerId);
  sliderDrag = { y: e.clientY };
  sitSlider.classList.add('active');
});
sitSlider.addEventListener('pointermove', (e) => {
  if (!sliderDrag || !character) return;
  const h = sitSlider.querySelector('.track').getBoundingClientRect().height || 200;
  const dv = ((e.clientY - sliderDrag.y) / h) * SIT_MAX;
  sliderDrag.y = e.clientY;
  sitBy(dv / 0.004);
});
for (const ev of ['pointerup', 'pointercancel']) {
  sitSlider.addEventListener(ev, () => { sliderDrag = null; sitSlider.classList.remove('active'); });
}
function updateSitSlider() {
  if (!character) return;
  sitSlider.style.setProperty('--k', THREE.MathUtils.clamp(character.sitS / SIT_MAX, 0, 1).toFixed(3));
}

// Свайп вниз по пустому месту — садится на пол, вверх — встаёт.
let sitLineAt = 0;
function sitBy(dy) {
  if (!character) return;
  if (dy > 0 && character.mixer && currentMocap) stopMocap();
  const before = character.sit;
  character.sit = THREE.MathUtils.clamp(character.sit + dy * 0.004, 0, 1.3); // до 1.3 — лечь на бок
  const now = performance.now();
  if (now - sitLineAt > 4000) {
    if (before < 0.9 && character.sit >= 0.9) { sitLineAt = now; say(pick(['Посижу немножко~', 'Ух, устала…', 'Сядешь рядом?'])); }
    if (before > 0.1 && character.sit <= 0.1) { sitLineAt = now; say(pick(['Ладно, встаю!', 'Опа!', 'Всё, отдохнула~'])); }
    if (before < 1.25 && character.sit >= 1.25) { sitLineAt = now; say(pick(['Полежу немножко~', 'Как уютно…', 'Ммм, хорошо~'])); }
  }
}

// Ближайшая точка-ручка под пальцем (с запасом ~60px): хватать легко.
const HANDLE_HIT = {
  handL: { zone: 'hand', side: 'left' }, handR: { zone: 'hand', side: 'right' },
  head: { zone: 'face' }, chest: { zone: 'body', bone: 'chest' }, belly: { zone: 'belly' },
  hips: { zone: 'body', bone: 'hips' }, footL: { zone: 'legs', bone: 'leftFoot' }, footR: { zone: 'legs', bone: 'rightFoot' },
};
function nearestHandle(e) {
  let best = null;
  let bestD = 60;
  for (const k of HANDLE_KEYS) {
    const p = handleWorld(k);
    if (!p) continue;
    handleV.copy(p).project(camera);
    const d = Math.hypot((handleV.x * 0.5 + 0.5) * window.innerWidth - e.clientX, (-handleV.y * 0.5 + 0.5) * window.innerHeight - e.clientY);
    if (d < bestD) { bestD = d; best = HANDLE_HIT[k]; }
  }
  return best;
}
function poseDragStart(e) {
  const hit = nearestHandle(e) ?? zoneAt(e);
  if (!hit) {
    // Пустое место: вбок — крутим камеру (сесть/встать — только ползунком).
    poseDrag = { kind: 'bg', sx: e.clientX, sy: e.clientY, lastX: e.clientX, lastY: e.clientY, axis: null };
    return;
  }
  if (hit.zone === 'hand' || hit.zone === 'arm') {
    const handPos = character.handWorld(hit.side);
    const normal = new THREE.Vector3();
    camera.getWorldDirection(normal);
    poseDrag = { kind: 'hand', side: hit.side, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, handPos) };
    poseDragMove(e);
  } else if (hit.zone === 'headpat' || hit.zone === 'face') {
    poseDrag = { kind: 'head', lastX: e.clientX, lastY: e.clientY };
  } else if (hit.zone === 'legs') {
    const side = /left/i.test(hit.bone) ? 'left' : 'right';
    const footPos = character.footWorld(side);
    const normal = new THREE.Vector3();
    camera.getWorldDirection(normal);
    poseDrag = { kind: 'foot', side, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, footPos) };
  } else if (hit.zone === 'belly') {
    poseDrag = { kind: 'twist', lastX: e.clientX, lastY: e.clientY };
  } else if (hit.zone === 'body' && hit.bone === 'chest') {
    poseDrag = { kind: 'spine', lastX: e.clientX, lastY: e.clientY };
  } else if (hit.zone === 'body') {
    poseDrag = { kind: 'hips', lastX: e.clientX, lastY: e.clientY };
  }
}

const dragPoint = new THREE.Vector3();
function poseDragMove(e) {
  if (!poseDrag) return;
  if (poseDrag.kind === 'hand' || poseDrag.kind === 'foot') {
    toNdc(e);
    raycaster.setFromCamera(pointer, camera);
    if (raycaster.ray.intersectPlane(poseDrag.plane, dragPoint)) {
      if (poseDrag.kind === 'hand') character.setHandTarget(poseDrag.side, dragPoint);
      else character.setFootTarget(poseDrag.side, dragPoint);
    }
    return;
  }
  if (poseDrag.kind === 'bg') {
    // Пустое место в режиме позы — камера вращается во все стороны.
    rotateBy(-(e.clientX - poseDrag.lastX) * 0.01, (e.clientY - poseDrag.lastY) * 0.005);
    poseDrag.lastX = e.clientX;
    poseDrag.lastY = e.clientY;
    return;
  }
  const dx = e.clientX - poseDrag.lastX;
  const dy = e.clientY - poseDrag.lastY;
  poseDrag.lastX = e.clientX;
  poseDrag.lastY = e.clientY;
  const facing = Math.cos(camYaw) >= 0 ? 1 : -1; // если смотрим сзади — влево/вправо наоборот
  const clamp = THREE.MathUtils.clamp;
  if (poseDrag.kind === 'head') {
    const o = character.headOffset;
    o.y = clamp(o.y + dx * 0.006 * facing, -0.9, 0.9);
    o.x = clamp(o.x + dy * 0.005, -0.5, 0.5);
  } else if (poseDrag.kind === 'spine') {
    // Вниз — наклон вперёд как у человека: в основном в тазобедренных (таз уходит
    // назад для баланса, ноги на полу) и немного в спине; вверх — прогиб назад.
    const o = character.bodyOffset;
    o.hipsRotX = clamp(o.hipsRotX + dy * 0.0035, -0.2, 1.0);
    o.spineX = clamp(o.spineX + dy * 0.002, -0.5, 0.6);
    o.spineZ = clamp(o.spineZ - dx * 0.004 * facing, -0.5, 0.5);
  } else if (poseDrag.kind === 'twist') {
    // Живот: вбок — поворот корпуса, вверх/вниз — наклон.
    const o = character.bodyOffset;
    o.spineY = clamp(o.spineY + dx * 0.005 * facing, -0.8, 0.8);
    o.spineX = clamp(o.spineX + dy * 0.004, -0.5, 1.1);
  } else {
    // Таз: тянешь вниз — опускается (присед → на колени → сидит → лежит), вверх — встаёт;
    // вбок — бёдра в сторону (стоя), с противовесом плеч и головы.
    const o = character.bodyOffset;
    const S = character.scale;
    if (Math.abs(dy) > Math.abs(dx) * 0.6) sitBy(dy * 0.85);
    if (character.sit < 0.15) {
      o.hipsX = clamp(o.hipsX + dx * 0.0006 * facing * S, -0.08 * S, 0.08 * S);
      o.hipsZ = clamp(o.hipsX / S * 1.6, -0.14, 0.14);
    }
  }
}

function savePoseAs(rawName) {
  const name = rawName.trim().slice(0, 20);
  if (!name || !character) return false;
  const key = `saved:${name}`;
  const isNew = !POSES[key];
  const params = { ...character.getPoseParams() };
  const touch = character.exportTouchPose();
  savedPoses[name] = { ...params, touch };
  POSES[key] = { label: `★ ${name}`, ...params, touch };
  try { localStorage.setItem(POSES_KEY, JSON.stringify(savedPoses)); } catch { /* ignore */ }
  if (isNew) addPoseButton(key, POSES[key]);
  character.setPose(key);
  setActivePoseButton(key);
  say('Запомнила эту позу~');
  return true;
}

// ---------- Режим камеры ----------

let cameraMode = false;
let camHintAt = 0;
function setCameraMode(on) {
  if (on && poseMode) setPoseMode(false);
  cameraMode = on;
  $('btn-camera').classList.toggle('active', on);
  $('cam-controls').hidden = !(on || poseMode);
  canvas.classList.toggle('camera', on);
  petting = null;
  stroking = null;
  orbitDrag = null;
  if (on) hintOnce('cam', 'Крути пальцем · два пальца — зум');
}
$('btn-camera').addEventListener('click', () => setCameraMode(!cameraMode));

// Подсказка режима — только в первый раз, чтобы не мешала.
const hintsShown = new Set();
function hintOnce(key, text) {
  if (hintsShown.has(key)) return;
  hintsShown.add(key);
  showToast(text);
}

let toastTimer = 0;
function showToast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2200);
}

function setFullBody(on) {
  fullBody = on;
  camZoom = 1;
  $('btn-zoom').classList.toggle('off', !fullBody);
  animateCamera = true;
  frameCamera();
  animateCamera = false;
}
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

const isFbx = (a) => a.format === 'fbx' || /\.fbx$/i.test(a.file ?? '');

// Клип для конкретной модели: .vrma переносится библиотекой three-vrm,
// .fbx из Mixamo — нашим переносом скелета (src/mixamo.js).
function clipFor(a, vrm) {
  if (isFbx(a)) return mixamoClip(a.asset, vrm);
  return createVRMAnimationClip(a.animation, vrm);
}

async function prepareAnim(a) {
  if (isFbx(a)) a.asset ??= parseMixamo(a.data.slice(0));
  else a.animation ??= await parseAnimation(a.data);
}

async function parseAnimation(buffer) {
  const gltf = await loader.parseAsync(buffer.slice(0), '');
  const animation = gltf.userData.vrmAnimations?.[0];
  if (!animation) throw new Error('В файле нет VRM-анимации');
  return animation;
}

// ---------- База движений (mocap CMU) ----------

let currentMocap = null;
let liveIdle = false;
let mocapOnceTimer = 0;

async function playMocap(id) {
  if (!character) return;
  const entry = MOCAP.find((m) => m.id === id);
  if (!entry) return;
  try {
    const data = await loadMocap(id);
    if (currentAnim) { currentAnim = null; }
    character.dancing = false;
    character.loop = null;
    if (entry.idle) {
      // Живое ожидание: только верх тела из записи, ноги свои — не ходит и не скользит.
      if (character.mixer) character.stopClip();
      character.playUpperIdle(mocapUpperClip(data, character.vrm));
      currentMocap = id;
      clearTimeout(mocapOnceTimer);
      renderAnims();
      return;
    }
    character.stopUpperIdle();
    character.sit = 0;
    const loop = entry.idle || /Танец|Сальса|Чарльстон|походка/.test(entry.name);
    character.playClip(mocapClip(data, character.vrm), { loop });
    currentMocap = id;
    clearTimeout(mocapOnceTimer);
    // Жест играет один раз, потом — обратно в живое ожидание или обычный покой.
    if (!loop) {
      mocapOnceTimer = setTimeout(() => {
        if (currentMocap !== id) return;
        if (liveIdle) playMocap(nextIdle());
        else stopMocap();
      }, (data.frames / data.fps - 0.5) * 1000);
    }
  } catch (err) {
    console.error(err);
    say('Не получилось загрузить движение…', 'sad');
  }
  renderAnims();
}

function stopMocap() {
  clearTimeout(mocapOnceTimer);
  currentMocap = null;
  liveIdle = false;
  character?.stopClip();
  character?.stopUpperIdle();
  renderAnims();
}

function nextIdle() {
  const idles = MOCAP.filter((m) => m.idle && m.id !== currentMocap);
  return idles[Math.floor(Math.random() * idles.length)].id;
}

// Живое ожидание: сама сменяет записи ожидания перед их концом.
function updateLiveIdle() {
  if (!liveIdle || !character || !currentMocap) return;
  if (MOCAP.find((m) => m.id === currentMocap)?.idle && character.clipTimeLeft() < 1.8) playMocap(nextIdle());
}

function renderMocap() {
  const box = $('mocap-list');
  box.innerHTML = '';
  for (const m of MOCAP) {
    if (m.idle) continue; // записи ожидания — через «✨ Живое ожидание»
    const b = document.createElement('button');
    b.className = 'chip' + (currentMocap === m.id ? ' active' : '');
    b.textContent = m.name;
    b.addEventListener('click', () => (currentMocap === m.id ? stopMocap() : playMocap(m.id)));
    box.appendChild(b);
  }
  $('btn-live-idle').classList.toggle('active', liveIdle);
  $('btn-live-idle').textContent = liveIdle ? '✨ Живое ожидание — выключить' : '✨ Живое ожидание';
}

$('btn-live-idle').addEventListener('click', () => {
  if (liveIdle) { stopMocap(); return; }
  liveIdle = true;
  playMocap(nextIdle());
});

function setLoop(id) {
  if (!character) return;
  if (currentMocap) stopMocap();
  if (currentAnim) stopAnim();
  character.dancing = false;
  character.loop = character.loop === id ? null : id;
  if (character.loop) {
    const lines = {
      cute: 'Хи-хи, я тут~', flirty: 'Ну что, нравлюсь? ♥', shy: 'Н-не смотри так…',
      happy: 'Ура-а! ♥', dance2: 'Ля-ля-ля~',
    };
    say(lines[id]);
  }
  renderAnims();
}

function renderAnims() {
  renderMocap();
  $('btn-dance').classList.toggle('active', !!character?.dancing && !currentAnim);
  $('btn-dance').textContent = character?.dancing && !currentAnim ? '💃 Танцует — остановить' : '💃 Танцевать';
  const loops = $('loop-list');
  loops.innerHTML = '';
  for (const l of LOOPS) {
    const b = document.createElement('button');
    b.className = 'chip' + (character?.loop === l.id ? ' active' : '');
    b.textContent = l.label;
    b.addEventListener('click', () => setLoop(l.id));
    loops.appendChild(b);
  }
  const list = $('anim-list');
  list.innerHTML = '';
  if (!anims.length) {
    const empty = document.createElement('p');
    empty.className = 'panel-note';
    empty.textContent = 'Пока пусто. Добавь анимацию: .vrma (VRoid / Booth) или .fbx из Mixamo («Without Skin»).';
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
    await prepareAnim(a);
    clearTimeout(mocapOnceTimer);
    currentMocap = null;
    liveIdle = false;
    character.stopUpperIdle();
    character.dancing = false;
    character.loop = null;
    character.playClip(clipFor(a, character.vrm));
    currentAnim = a;
  } catch (err) {
    console.error(err);
    say('Не получается так двигаться… нужен .vrma или .fbx из Mixamo', 'sad');
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
  const format = /\.fbx$/i.test(file.name) ? 'fbx' : 'vrma';
  const record = { id: `anim-${Date.now()}`, kind: 'anim', format, name: file.name.replace(/\.(vrma|fbx)$/i, '').slice(0, 24), data, created: Date.now() };
  await saveFile(record);
  anims.push(record);
  await playAnim(record);
}

$('btn-anims').addEventListener('click', () => togglePanel('anims', renderAnims));
$('btn-dance').addEventListener('click', () => {
  if (!character) return;
  if (currentAnim) stopAnim();
  if (currentMocap) stopMocap();
  character.loop = null;
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
  if (name.endsWith('.vrma') || name.endsWith('.fbx')) addAnim(file);
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

let saccadeT = 1;
const saccade = new THREE.Vector3();
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);

  updateCamera(dt);
  updateSitSlider();
  updateHandles();
  updateBlob();
  updateLiveIdle();
  if (character) {
    // Взгляд за пальцем/курсором: точка на плоскости перед моделью.
    raycaster.setFromCamera(pointer, camera);
    raycaster.ray.at(camera.position.distanceTo(cameraLookAt) - 0.3, lookPoint);
    // Микродвижения глаз (саккады): живой взгляд быстро «перескакивает» на чуть другую точку.
    saccadeT -= dt;
    if (saccadeT <= 0) {
      saccadeT = 0.6 + Math.random() * 2.2;
      saccade.set((Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.04, 0);
    }
    lookPoint.add(saccade);
    character.lookTarget.position.lerp(lookPoint, 1 - Math.exp(-dt * 18));
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
