import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, VRMLookAtQuaternionProxy, createVRMAnimationClip } from '@pixiv/three-vrm-animation';
import { saveFile, deleteFile, listFiles } from './storage.js';
import { Stockings, STOCKING_STYLES } from './stockings.js';
import { parseMixamo, mixamoClip } from './mixamo.js';
import { MOCAP, loadMocap, mocapClip, mocapUpperClip } from './mocap.js';
import { Character, POSES, LOOPS } from './character.js';
import { REACTIONS, STROKES, IDLE_LINES, pick } from './dialogue.js';

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
const camera = new THREE.PerspectiveCamera(32, 1, 0.02, 20);
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
const ambient = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambient);

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
  camTween = character && animateCamera && !freeCam ? 0 : 1;
  if (camTween === 1 && !freeCam) {
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
let camLift = 0; // сдвиг кадра вверх/вниз (двумя пальцами)
let camPitch = 0.05; // наклон камеры: < 0 — снизу, > 0 — сверху
let camZoom = 1; // < 1 — ближе, > 1 — дальше
const ZOOM_MIN = 0.05; // можно подлететь вплотную к лицу
const ZOOM_MAX = 3;

// Середина тела лёжа (сглаженная, чтобы камера не дрожала от дыхания).
const lieMid = new THREE.Vector3(0, 0.3, 0);
// Голова (сглаженно): при приближении камера ведёт за лицом — наклонилась, села,
// повернулась — лицо остаётся в кадре.
const headTrack = new THREE.Vector3(0, 1.4, 0);
let headTrackInit = false;
function updateLieMid(dt) {
  if (!character?.bones.hips || !character.bones.head) return;
  const hp = character.bones.head.getWorldPosition(new THREE.Vector3());
  hp.y += 0.05 * camBase.S;
  if (!headTrackInit) { headTrack.copy(hp); headTrackInit = true; }
  headTrack.lerp(hp, 1 - Math.exp(-dt * 4));
  const m = character.bones.hips.getWorldPosition(new THREE.Vector3())
    .add(character.bones.head.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
  lieMid.lerp(m, 1 - Math.exp(-dt * 3));
}
function orbitTarget(out) {
  const d = camBase.dist * camZoom;
  // При приближении смещаем точку взгляда к лицу.
  const headY = (character ? character.headHeight : 1.4) + 0.05 * camBase.S;
  let lookY = THREE.MathUtils.lerp(headY, camBase.cy, THREE.MathUtils.clamp((camZoom - ZOOM_MIN) / (1 - ZOOM_MIN), 0, 1));
  // Когда она садится, камера опускается вместе с ней.
  if (character) lookY -= (character.sitDropNow ?? 0) * 0.6;
  // Лёжа тело вытянуто по полу: камера смотрит на середину тела, отъезжает и
  // чуть приподнимается — видна вся, а не одна голова у края экрана.
  let cx = 0;
  let cz = 0;
  let dd = d;
  let pitch = camPitch;
  if (character?.bones.hips && character.bones.head) {
    const lie = THREE.MathUtils.smoothstep(character.sitS, 0.8, 1.25);
    if (lie > 0) {
      // Ближе к лицу: смотрим между серединой тела и головой.
      const mid = lieMid.clone().lerp(headTrack, 0.45);
      cx = mid.x * lie;
      cz = mid.z * lie;
      lookY = THREE.MathUtils.lerp(lookY, mid.y + 0.05 * camBase.S, lie);
      dd = d * (1 + 0.1 * lie);
      pitch = camPitch + 0.3 * lie;
    }
  }
  // Приближено — смотрим на реальное положение головы (а не на «где голова стоя»).
  if (character && headTrackInit) {
    const zoomK = 1 - THREE.MathUtils.clamp((camZoom - ZOOM_MIN) / (1 - ZOOM_MIN), 0, 1);
    const k = THREE.MathUtils.smoothstep(zoomK, 0.1, 0.8);
    if (k > 0) {
      cx = THREE.MathUtils.lerp(cx, headTrack.x, k);
      cz = THREE.MathUtils.lerp(cz, headTrack.z, k);
      lookY = THREE.MathUtils.lerp(lookY, headTrack.y, k);
    }
  }
  lookY += camLift;
  out.look.set(cx, lookY, cz);
  const cp = Math.cos(pitch);
  out.pos.set(cx + Math.sin(camYaw) * dd * cp, Math.max(0.06 * camBase.S, lookY + Math.sin(pitch) * dd), cz + Math.cos(camYaw) * dd * cp);
  return out;
}

// Мгновенно применить yaw/zoom (при жестах и кнопках).
// Свободная камера (как дрон): фиолетовый шарик — лететь вперёд/назад и вбок,
// розовый — вверх/вниз и поворот; палец по фону — оглядеться; щипок — вперёд/назад.
let freeCam = null; // { yaw, pitch } — куда смотрит камера
function freeDir(out = new THREE.Vector3()) {
  const cp = Math.cos(freeCam.pitch);
  return out.set(Math.sin(freeCam.yaw) * cp, Math.sin(freeCam.pitch), Math.cos(freeCam.yaw) * cp);
}
function enterFreeCam() {
  if (freeCam) return;
  if (typeof faceCam !== 'undefined' && faceCam) setFaceCam(false);
  const d = cameraLookAt.clone().sub(camera.position).normalize();
  freeCam = { yaw: Math.atan2(d.x, d.z), pitch: Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) };
  camTween = 1;
  showToast('🛸 Свободная камера · ⌂ — вернуть');
}
function exitFreeCam() { freeCam = null; }
function applyFree() {
  camera.position.y = Math.max(0.05 * camBase.S, camera.position.y);
  cameraLookAt.copy(camera.position).add(freeDir());
  camera.lookAt(cameraLookAt);
}
// Скорость: у неё вблизи — медленно и точно, издалека — быстрее.
function freeSpeed() {
  const h = character?.bones.head?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(0, 1.4, 0);
  return THREE.MathUtils.clamp(camera.position.distanceTo(h) * 0.9, 0.12, 1.6);
}

function applyOrbit() {
  if (freeCam) { applyFree(); return; }
  orbitTarget(camTo);
  camTween = 1;
  camera.position.copy(camTo.pos);
  cameraLookAt.copy(camTo.look);
  camera.lookAt(cameraLookAt);
}

// Для отладки и записи кадров.
window.__setYaw = (y, pitch) => { camYaw = y; if (pitch != null) camPitch = pitch; applyOrbit(); };

function rotateBy(delta, dPitch = 0) {
  if (freeCam) {
    // Свободная камера: палец по фону — оглядеться.
    freeCam.yaw += delta * 0.6;
    freeCam.pitch = THREE.MathUtils.clamp(freeCam.pitch - dPitch * 0.8, -1.4, 1.4);
    applyFree();
    return;
  }
  if (faceCam) setFaceCam(false); // крутишь сам — слежение за лицом выключается
  camYaw = (camYaw + delta) % (Math.PI * 2);
  camPitch = THREE.MathUtils.clamp(camPitch + dPitch, -0.6, 1.35);
  applyOrbit();
}

function zoomBy(factor) {
  if (freeCam) {
    camera.position.addScaledVector(freeDir(), (1 - factor) * freeSpeed() * 1.5);
    applyFree();
    return;
  }
  camZoom = THREE.MathUtils.clamp(camZoom * factor, ZOOM_MIN, ZOOM_MAX);
  applyOrbit();
}

// Плавный переезд камеры между «крупно» и «во весь рост».
let camSitSeen = 0;
function updateCamera(dt) {
  // Следим за посадкой: если она садится/встаёт, плавно ведём камеру.
  updateLieMid(dt);
  updateStick(dt);
  if (freeCam) return; // свободная камера — орбита не вмешивается
  updateFaceCam(dt);
  const lying = character && character.sitS > 0.8;
  const zoomedIn = camZoom < 0.9;
  if (character && camTween >= 1 && (lying || zoomedIn || Math.abs(character.sitS - camSitSeen) > 0.002)) {
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
// Скачанная модель запоминается в браузере (Cache Storage): со второго раза — мгновенно.
const MODEL_CACHE = 'waifu-model-v1';
async function cachedModel(url) {
  try {
    const cache = await caches.open(MODEL_CACHE);
    const hit = await cache.match(url);
    return hit ? await hit.arrayBuffer() : null;
  } catch { return null; }
}
async function storeModel(url, buffer) {
  try {
    const cache = await caches.open(MODEL_CACHE);
    await cache.put(url, new Response(buffer, { headers: { 'Content-Type': 'application/octet-stream' } }));
  } catch { /* нет места или приватный режим — просто без кэша */ }
}

async function loadPackedModel(url) {
  const cached = await cachedModel(url);
  if (cached) {
    $('loading-text').textContent = 'Загрузка… почти готово';
    return cached;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // Читаем по кусочкам и показываем, сколько скачано, — чтобы было видно, что идёт.
  const total = Number(res.headers.get('Content-Length')) || 0;
  const reader = res.body?.getReader();
  let text;
  if (reader) {
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      $('loading-text').textContent = total
        ? `Загрузка… ${Math.round((got / total) * 100)}%`
        : `Загрузка… ${(got / 1048576).toFixed(1)} МБ`;
    }
    const all = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    text = new TextDecoder().decode(all);
  } else {
    text = await res.text();
  }
  $('loading-text').textContent = 'Загрузка… распаковка';
  const b64 = JSON.parse(text).vrm;
  // Быстрая распаковка base64 средствами браузера.
  let buffer;
  try {
    buffer = await (await fetch(`data:application/octet-stream;base64,${b64}`)).arrayBuffer();
  } catch {
    // Если data:-ссылки запрещены — распаковываем вручную.
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    buffer = u8.buffer;
  }
  storeModel(url, buffer.slice(0));
  return buffer;
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
    if (typeof lieMode !== 'undefined' && lieMode !== 'off') character.lieStyle = lieMode;
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

// Очки симпатии 0…1000 и уровни. Реплики по-прежнему берутся по трём тирам
// (незнакомец / друг / близкий), а уровней больше — прокачка дольше и интереснее.
const STORAGE_KEY = 'waifu-love';
const LEVELS = [
  { min: 0, label: 'Незнакомец' },
  { min: 60, label: 'Знакомый' },
  { min: 150, label: 'Друг' },
  { min: 300, label: 'Подруга' },
  { min: 500, label: 'Близкий человек' },
  { min: 750, label: 'Любимый' },
  { min: 1000, label: 'Родная душа' },
];
const LOVE_MAX = 1000;
let love = 50;
try {
  const saved = Number(localStorage.getItem(STORAGE_KEY));
  if (Number.isFinite(saved) && localStorage.getItem(STORAGE_KEY) !== null) love = saved;
  else {
    const old = Number(localStorage.getItem('waifu-affection')); // старая шкала 0…100
    if (Number.isFinite(old) && old > 0) love = old * 6;
  }
} catch { /* приватный режим — живём без сохранения */ }
const levelOf = (v) => { let l = 0; LEVELS.forEach((x, i) => { if (v >= x.min) l = i; }); return l; };
// Тир для реплик: 0 — до «Друга», 1 — до «Близкого», 2 — дальше.
const tier = () => (love >= 500 ? 2 : love >= 150 ? 1 : 0);

const LEVEL_UP_LINES = ['', 'Мы ведь уже знакомы~', 'Слушай, а с тобой весело!', 'Ты мне нравишься, правда-правда~',
  'Кажется… ты мне правда нравишься ♥', 'Я тебя люблю… вот. Сказала ♥', 'Ты — самый родной ♥♥♥'];
function setLove(v, silent = false) {
  const before = levelOf(love);
  love = THREE.MathUtils.clamp(v, 0, LOVE_MAX);
  try { localStorage.setItem(STORAGE_KEY, String(love)); } catch { /* ignore */ }
  renderAffection();
  const after = levelOf(love);
  if (!silent && after > before) {
    say(LEVEL_UP_LINES[after], 'happy');
    $('affection').classList.remove('levelup');
    void $('affection').offsetWidth;
    $('affection').classList.add('levelup');
  }
}
// Шкала стала в 10 раз длиннее, а прирост — только вдвое: прокачка идёт примерно в 5 раз дольше.
function changeAffection(delta) {
  setLove(love + delta * 2);
}

function renderAffection() {
  const l = levelOf(love);
  const cur = LEVELS[l].min;
  const next = LEVELS[l + 1]?.min ?? LOVE_MAX;
  const k = l === LEVELS.length - 1 ? 1 : (love - cur) / (next - cur);
  $('affection-fill').style.width = `${(k * 100).toFixed(1)}%`;
  $('affection-label').textContent = LEVELS[l].label;
  $('affection-lvl').textContent = String(l + 1);
  $('affection').title = `${Math.round(love)} / ${LOVE_MAX}`;
}
// Тап по шкале — маленькое меню: макс / сброс.
$('affection').addEventListener('click', (e) => {
  e.stopPropagation();
  $('love-menu').hidden = !$('love-menu').hidden;
});
$('love-max').addEventListener('click', (e) => { e.stopPropagation(); setLove(LOVE_MAX); $('love-menu').hidden = true; showToast('♥ Максимум'); });
$('love-reset').addEventListener('click', (e) => { e.stopPropagation(); setLove(0, true); $('love-menu').hidden = true; showToast('Симпатия сброшена'); });
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#affection, #love-menu')) $('love-menu').hidden = true; });
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

function zoneAt(e, deep = false) {
  if (!character) return null;
  toNdc(e);
  raycaster.setFromCamera(pointer, camera);
  const hit = character.hitTest(raycaster.ray);
  if (hit || !deep) return hit;
  // Не попали в зону — проверяем саму модель (край юбки, бёдра, плечи, волосы…).
  return character.hitTestMesh(raycaster);
}

// Отклик под пальцем: касание засчитано.
function touchRipple(x, y) {
  const el = document.createElement('div');
  el.className = 'ripple';
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 600);
}

// Активные касания: для щипка (зум) двумя пальцами и поворота свайпом по фону.
const touches = new Map();
let orbitDrag = null; // { lastX }
let stroking = null;
let bgSwipe = null; // свайп по пустому месту в обычном режиме // поглаживание не головы: { hit, lastX, lastY, moved, dist, ticks }
let pinchDist = 0;
let pinchMidY = null;

function pinchDistance() {
  const [a, b] = [...touches.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

canvas.addEventListener('pointerdown', (e) => {
  if (!character) return;
  // Открыт список поз — касание по сцене просто закрывает его.
  if (!$('pose-list').hidden && !poseMode) { setPoseListOpen(false); return; }
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

  const hit = zoneAt(e, true);
  if (hit) touchRipple(e.clientX, e.clientY);
  if (!hit) {
    // Пустое место в обычном режиме: свайп крутит камеру (сесть/встать — у левого края).
    bgSwipe = { sy: e.clientY, sx: e.clientX, lastX: e.clientX, lastY: e.clientY, axis: null };
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
    // Два пальца вверх/вниз — сдвинуть кадр: смотреть ниже или выше.
    const [a, b] = [...touches.values()];
    const midY = (a.y + b.y) / 2;
    if (pinchMidY != null) {
      camLift = THREE.MathUtils.clamp(camLift + (midY - pinchMidY) * 0.0025 * camBase.S * Math.max(0.3, camZoom), -1.3, 0.6);
      applyOrbit();
    }
    pinchMidY = midY;
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
    // Пустое место в обычном режиме — камера свободно вращается (со всех ракурсов).
    rotateBy(-(e.clientX - bgSwipe.lastX) * 0.01, (e.clientY - bgSwipe.lastY) * 0.005);
    bgSwipe.lastX = e.clientX;
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
  activeHandle = null;
  snapAnchor = null;
  touches.delete(e.pointerId);
  poseDrag = null;
  bgSwipe = null;
  if (touches.size < 2) { pinchDist = 0; pinchMidY = null; }
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
// ---------- Быстрые ракурсы ----------
// 🙂 «К лицу»: камера встаёт перед её лицом и держится там, как бы она ни
// наклонялась, ни садилась и ни ложилась. Крутишь пальцем — слежение выключается.
let faceCam = false;
function setFaceCam(on) {
  if (on) exitFreeCam();
  faceCam = on;
  $('cam-face').classList.toggle('active', on);
  if (on) {
    camZoom = Math.min(camZoom, 0.28);
    showToast('🙂 Близко к лицу · щипок — ещё ближе');
  }
}
function wrapAngle(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
function updateFaceCam(dt) {
  if (!faceCam || !character) return;
  const f = character.faceDir();
  const yaw = Math.atan2(f.x, f.z);
  // Лицо смотрит вниз (наклон) — камера опускается под лицо, к самому полу.
  const pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(f.y, -1, 1)) + 0.08, -1.35, 1.35);
  const k = 1 - Math.exp(-dt * 3);
  camYaw += wrapAngle(yaw - camYaw) * k;
  camPitch += (pitch - camPitch) * k;
  if (camTween >= 1) applyOrbit();
}
// 🎥 Ракурсы по кругу: спереди → сбоку → сзади → сверху → снизу.
const VIEWS = [
  { name: 'Спереди', yaw: 0, pitch: 0.05 },
  { name: 'Сбоку', yaw: Math.PI / 2, pitch: 0.1 },
  { name: 'Сзади', yaw: Math.PI, pitch: 0.15 },
  { name: 'Сверху', yaw: 0.3, pitch: 1.2 },
  { name: 'Снизу', yaw: -0.4, pitch: -0.45 },
];
let viewIdx = 0;
function setView(v) {
  exitFreeCam();
  setFaceCam(false);
  // Ракурс — относительно того, куда она повёрнута телом.
  const f = character ? character.faceDir() : new THREE.Vector3(0, 0, 1);
  const base = Math.abs(f.y) > 0.8 ? 0 : Math.atan2(f.x, f.z);
  camYaw = base + v.yaw;
  camPitch = v.pitch;
  animateCamera = true;
  frameCamera();
  animateCamera = false;
  showToast(`🎥 ${v.name}`);
}
$('cam-face').addEventListener('click', () => setFaceCam(!faceCam));
// 🕹 Шарик-джойстик: держишь и ведёшь — камера плавно облетает её (вбок)
// и опускается/поднимается (вверх-вниз). Отпустил — стоит на месте.
// Два шарика: 🕹 «облёт» — вбок облететь, вверх/вниз опустить/поднять камеру;
// 🎯 «ближе» — вверх подлететь вплотную (к лицу), вниз отлететь; вбок — смотреть сверху/снизу.
function makeStick(el) {
  const st = { x: 0, y: 0, on: false, el };
  const move = (e) => {
    const r = el.getBoundingClientRect();
    const R = r.width / 2;
    let dx = e.clientX - (r.left + R);
    let dy = e.clientY - (r.top + R);
    const len = Math.hypot(dx, dy);
    if (len > R) { dx *= R / len; dy *= R / len; }
    st.x = dx / R;
    st.y = dy / R;
    el.querySelector('b').style.transform = `translate(${dx}px, ${dy}px)`;
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    st.on = true;
    move(e);
  });
  el.addEventListener('pointermove', (e) => { if (st.on) move(e); });
  for (const ev of ['pointerup', 'pointercancel']) {
    el.addEventListener(ev, () => { st.on = false; st.x = 0; st.y = 0; el.querySelector('b').style.transform = ''; });
  }
  return st;
}
const stick = makeStick($('cam-stick'));
const stick2 = makeStick($('cam-stick2'));
const dz = (v) => (Math.abs(v) < 0.08 ? 0 : v * Math.abs(v));
function updateStick(dt) {
  const a = stick.on && (dz(stick.x) || dz(stick.y));
  const b = stick2.on && (dz(stick2.x) || dz(stick2.y));
  if (!a && !b) return;
  enterFreeCam();
  const v = freeSpeed() * dt;
  const fwd = freeDir();
  const flat = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
  const right = new THREE.Vector3(-flat.z, 0, flat.x);
  if (b) {
    // 🎯 Фиолетовый: вверх — лететь вперёд (куда смотришь), вниз — назад, вбок — в сторону.
    camera.position.addScaledVector(fwd, -dz(stick2.y) * v);
    camera.position.addScaledVector(right, dz(stick2.x) * v);
  }
  if (a) {
    // 🕹 Розовый: вверх/вниз — подняться/опуститься, вбок — повернуться.
    camera.position.y -= dz(stick.y) * v;
    freeCam.yaw -= dz(stick.x) * 1.3 * dt;
  }
  applyFree();
}
// 🎥 внизу: одна кнопка раскрывает маленькую строку камеры (к лицу, ракурс, ±, вид по умолчанию).
$('btn-cam').addEventListener('click', (e) => {
  e.stopPropagation();
  $('cam-controls').hidden = !$('cam-controls').hidden;
  $('btn-cam').classList.toggle('active', !$('cam-controls').hidden);
});
document.addEventListener('pointerdown', (e) => {
  if (!$('cam-controls').hidden && !e.target.closest('#cam-controls, #btn-cam, #scene')) {
    $('cam-controls').hidden = true;
    $('btn-cam').classList.remove('active');
  }
});
$('cam-view').addEventListener('click', () => {
  viewIdx = (viewIdx + 1) % VIEWS.length;
  setView(VIEWS[viewIdx]);
});

function resetView() {
  exitFreeCam();
  setFaceCam(false);
  camLift = 0;
  viewIdx = 0;
  camYaw = 0;
  camPitch = 0.05;
  camZoom = 1;
  animateCamera = true;
  frameCamera();
  animateCamera = false;
}
$('cam-reset').addEventListener('click', resetView);
// ⌂ на главном экране: камера спереди, она лицом к тебе и сразу встаёт.
// Нижние вкладки: ⌂ «Домой» и ✏️ «Позы».
$('btn-tab-pose').addEventListener('click', () => { if (!poseMode) setPoseMode(true); });
$('btn-home').addEventListener('click', () => {
  // Из вкладки «Позы» — просто домой (поза остаётся). Уже дома — вид спереди и встать.
  if (poseMode) { setPoseMode(false); return; }
  resetView();
  if (character && character.sit > 0) sitBy(-character.sit / 0.004);
});
canvas.addEventListener('pointercancel', endPointer);

// Сидя и лёжа — свои реакции: лёжа поворачивается к тебе, спящая сонно просыпается.
const LYING_LINES = {
  sleep: ['Ммм… ещё пять минуточек…', 'Ты меня разбудил~', 'М?.. это ты… 😴'],
  lie: ['Ложись рядом~', 'Мне так уютно…', 'Хи, щекотно~', 'Не мешай отдыхать… шучу ♥'],
  sit: ['Посиди со мной~', 'Ой, не тяни так ♥', 'Хи, я тут сижу~', 'Ты такой милый…'],
};
function triggerReaction(zone, hit, e) {
  const r = REACTIONS[zone];
  if (!r) return;
  if (character.sitS > 0.6 && zone !== 'spam') {
    const lying = character.sitS > 1.05;
    const asleep = lying && character.sleep > 0.5;
    character.react({ expression: asleep ? 'relaxed' : 'happy', motion: lying ? 'lieTurn' : 'squirm', side: hit?.side, strength: 0.8 });
    if (asleep) character.wake(3.5);
    if (hit) character.nudge(raycaster.ray.direction, 0.4);
    changeAffection(0.6);
    floatHeart(e.clientX, e.clientY);
    const now = performance.now();
    if (now - lastZoneLineAt > 900) {
      lastZoneLineAt = now;
      say(pick(LYING_LINES[asleep ? 'sleep' : lying ? 'lie' : 'sit']));
    }
    return;
  }
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
  hair: 'Волосы растрепались~',
  cheek: 'Хи~',
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
    const before = character.sit;
    character.setPose(name);
    // Своя сохранённая поза помнит посадку (сидит/лежит); обычные позы — стоя.
    const want = POSES[name]?.touch && typeof POSES[name].touch.sit === 'number' ? character.sit : 0;
    character.sit = before;
    if (Math.abs(want - before) > 0.001) sitBy((want - before) / 0.004);
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
let poseTabState = null; // поза во вкладке «Позы» (возвращается при входе)
let poseDrag = null; // { kind: 'hand' | 'head' | 'spine' | 'hips', side, plane, lastX, lastY }

function setPoseMode(on) {
  if (on && cameraMode) setCameraMode(false);
  if (on && currentMocap) stopMocap(); // позу выставляем на «живом» скелете, без записи
  // Вкладки разные: дома — обычная живая она (без выставленной позы), во вкладке «Позы» —
  // твоя поза. Поза запоминается при выходе и возвращается, когда снова откроешь «Позы».
  if (character) character.posing = on;
  if (on) stopAuto(true);
  if (character && on !== poseMode) {
    if (!on) {
      poseTabState = { name: character.poseName, touch: character.exportTouchPose() };
      character.importTouchPose(null);
      character.setPose('stand');
      setActivePoseButton('stand');
    } else if (poseTabState) {
      const sit = character.sit;
      character.setPose(poseTabState.name);
      character.importTouchPose(poseTabState.touch);
      character.sit = sit;
      setActivePoseButton(poseTabState.name);
    }
  }
  poseMode = on;
  poseDrag = null;
  renderPoseSliderBtn();
  $('btn-editor').classList.toggle('active', on);
  $('btn-tab-pose').classList.toggle('active', on);
  $('btn-home').classList.toggle('active', !on);
  $('btn-handles').hidden = !on;
  $('pose-bar').hidden = !on;
  document.body.classList.toggle('posing', on);
  closePoseSaveForm();
  setPoseListOpen(false);
  if (on) {
    // Позируем во весь рост — видно и руки, и ноги.
    if (!fullBody && !faceCam) setFullBody(true);
    $('hint').style.opacity = 0;
    hintOnce('pose', 'Тяни за точки · по фону — камера');
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
const HANDLE_KEYS = ['handL', 'handR', 'head', 'chest', 'belly', 'hips', 'kneeL', 'kneeR', 'footL', 'footR'];
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
    case 'kneeL': return c.bones.leftLowerLeg?.getWorldPosition(new THREE.Vector3());
    case 'kneeR': return c.bones.rightLowerLeg?.getWorldPosition(new THREE.Vector3());
    case 'footL': return c.footWorld('left');
    case 'footR': return c.footWorld('right');
  }
  return null;
}
// Точки-«магниты» для кистей: талия, поясница, бёдра, колени, щёки.
// Ведёшь руку рядом — кисть притягивается и встаёт туда красиво.
const ANCHORS = [
  { id: 'waistL', label: 'на талию', bone: 'hips', off: [0.15, 0.09, 0.02], side: 'left', preset: 'hips' },
  { id: 'waistR', label: 'на талию', bone: 'hips', off: [-0.15, 0.09, 0.02], side: 'right', preset: 'hips' },
  { id: 'backL', label: 'на поясницу', bone: 'hips', off: [0.11, 0.08, -0.1], side: 'left', preset: 'behind' },
  { id: 'backR', label: 'на поясницу', bone: 'hips', off: [-0.11, 0.08, -0.1], side: 'right', preset: 'behind' },
  { id: 'thighL', label: 'на бедро', bone: 'leftUpperLeg', off: [0.04, -0.17, 0.06] },
  { id: 'thighR', label: 'на бедро', bone: 'rightUpperLeg', off: [-0.04, -0.17, 0.06] },
  { id: 'kneeL', label: 'на колено', bone: 'leftLowerLeg', off: [0, 0.02, 0.07] },
  { id: 'kneeR', label: 'на колено', bone: 'rightLowerLeg', off: [0, 0.02, 0.07] },
  { id: 'cheekL', label: 'к щеке', bone: 'head', off: [0.07, 0.04, 0.06] },
  { id: 'cheekR', label: 'к щеке', bone: 'head', off: [-0.07, 0.04, 0.06] },
];
const anchorEls = {};
for (const a of ANCHORS) {
  const el = document.createElement('div');
  el.className = 'anchor';
  $('handles').appendChild(el);
  anchorEls[a.id] = el;
}
const anchorTmp = new THREE.Vector3();
function anchorWorld(a) {
  const c = character;
  const node = c.vrm.humanoid.getNormalizedBoneNode(a.bone);
  if (!node) return null;
  // Смещение в осях тела (вправо/вверх/вперёд модели), чтобы точка была снаружи тела.
  node.getWorldPosition(anchorTmp);
  const q = c.bones.hips.getWorldQuaternion(new THREE.Quaternion());
  const flip = c.flip;
  const off = new THREE.Vector3(a.off[0] * flip, a.off[1], a.off[2] * flip).multiplyScalar(c.scale).applyQuaternion(q);
  return anchorTmp.clone().add(off);
}
window.__anchors = () => ANCHORS.map((x) => [x.id, anchorWorld(x)]);
let snapAnchor = null;
// Магнит доступен, только если рука до него дотягивается (стоя колени далеко — их нет).
function anchorReachable(p, side) {
  const sh = character.bones[`${side}UpperArm`]?.getWorldPosition(new THREE.Vector3());
  return !sh || sh.distanceTo(p) < character.armLength(side) * 0.97;
}
// Ближайший магнит к пальцу на экране (~45px): притягивает, как только палец рядом.
function nearestAnchor(e, side) {
  let best = null;
  let bestD = 45;
  const v = new THREE.Vector3();
  for (const a of ANCHORS) {
    if (a.side && a.side !== side) continue; // талия/поясница — своей рукой
    const p = anchorWorld(a);
    if (a.preset && character.sitS > 0.5) continue; // лёжа/сидя — только бедро, колено, щека
    if (!p || (!a.preset && !anchorReachable(p, side))) continue;
    v.copy(p).project(camera);
    const d = Math.hypot((v.x * 0.5 + 0.5) * window.innerWidth - e.clientX, (-v.y * 0.5 + 0.5) * window.innerHeight - e.clientY);
    if (d < bestD) { bestD = d; best = { a, p }; }
  }
  return best;
}

let activeHandle = null; // какая точка сейчас в руке — она подсвечивается, остальные притухают
const HANDLE_LABELS = { kneeL: 'Левое колено', kneeR: 'Правое колено', handL: 'Левая рука', handR: 'Правая рука', head: 'Голова', chest: 'Наклон корпуса', belly: 'Поворот корпуса', hips: 'Бёдра', footL: 'Левая нога', footR: 'Правая нога' };
// 👁 в режиме позы: спрятать точки — смотреть на позу чисто, полоса слева всё так же наклоняет.
let handlesHidden = false;
try { handlesHidden = localStorage.getItem('waifu-handles-hidden') === '1'; } catch { /* ignore */ }
function renderHandlesBtn() {
  $('btn-handles').classList.toggle('active', !handlesHidden);
  $('btn-handles').title = handlesHidden ? 'Показать точки' : 'Спрятать точки';
}
$('btn-handles').addEventListener('click', () => {
  handlesHidden = !handlesHidden;
  try { localStorage.setItem('waifu-handles-hidden', handlesHidden ? '1' : '0'); } catch { /* ignore */ }
  renderHandlesBtn();
  showToast(handlesHidden ? 'Точки спрятаны — тянуть за тело и полоса работают' : 'Точки видны');
});
renderHandlesBtn();
$('btn-handles').hidden = true;
$('btn-home').classList.add('active');
function updateHandles() {
  const show = poseMode && !!character && (!handlesHidden || !!poseDrag);
  $('handles').hidden = !show;
  if (!show) return;
  $('handles').classList.toggle('dragging', !!activeHandle);
  const place = (el, p) => {
    handleV.copy(p).project(camera);
    el.style.left = `${(handleV.x * 0.5 + 0.5) * window.innerWidth}px`;
    el.style.top = `${(-handleV.y * 0.5 + 0.5) * window.innerHeight}px`;
  };
  for (const k of HANDLE_KEYS) {
    const p = handleWorld(k);
    if (!p) continue;
    place(handleEls[k], p);
    handleEls[k].classList.toggle('active', activeHandle === k);
  }
  // Магниты видны, только пока ведёшь руку.
  const handDrag = poseDrag?.kind === 'hand';
  for (const a of ANCHORS) {
    const el = anchorEls[a.id];
    el.hidden = !handDrag;
    if (!handDrag) continue;
    const p = anchorWorld(a);
    const ok = p && (!a.side || a.side === poseDrag.side) && !(a.preset && character.sitS > 0.5)
      && (a.preset || anchorReachable(p, poseDrag.side));
    el.hidden = !ok;
    if (ok) place(el, p);
    el.classList.toggle('hot', snapAnchor?.a === a);
  }
}

// Левый край экрана (обычный режим и камера): почти невидимая полоса —
// веди вниз — присед → на колени → боком → лежит, вверх — встаёт.
const sitSlider = $('sit-slider');
// Лечь можно отключить (кнопка под полосой): тогда ниже «сидит боком» она не опускается.
// Кнопка под полосой по кругу: на бок → на живот (спать) → не ложиться.
let lieMode = 'side';
try {
  const v = localStorage.getItem('waifu-lie');
  if (v === 'side' || v === 'belly' || v === 'back' || v === 'off') lieMode = v;
  else if (localStorage.getItem('waifu-allow-lie') === '0') lieMode = 'off';
} catch { /* ignore */ }
let allowLie = lieMode !== 'off';
const sitMax = () => (allowLie ? 1.3 : 1.0);
const LIE_ICONS = {
  side: '<path d="M3 18V8M3 14h18v4M21 14v-2.5a2.5 2.5 0 0 0-2.5-2.5H11v5"/><circle cx="7" cy="11.5" r="1.8"/>',
  belly: '<path d="M14.5 4.5a6.5 6.5 0 1 0 5 10.5A7.5 7.5 0 0 1 14.5 4.5z"/><path d="M17 4h3l-3 3h3"/>',
  back: '<path d="M3 17h18"/><circle cx="6" cy="13.5" r="2"/><path d="M8.5 14h6l3-3 2 3"/>',
  off: '<path d="M3 18V8M3 14h18v4M21 14v-2.5a2.5 2.5 0 0 0-2.5-2.5H11v5"/><path d="M4 4l16 16"/>',
};
function renderLieToggle() {
  allowLie = lieMode !== 'off';
  $('lie-toggle').classList.toggle('off', !allowLie);
  $('lie-toggle').querySelector('svg').innerHTML = LIE_ICONS[lieMode];
  $('lie-toggle').title = { side: 'Ложится на бок', belly: 'Ложится на живот, спать', back: 'Ложится на спину', off: 'Не ложится' }[lieMode];
  $('lie-toggle2').querySelector('svg').innerHTML = LIE_ICONS[lieMode];
  $('lie-toggle2').classList.toggle('off', !allowLie);
  if (character && allowLie) character.setLieStyle(lieMode);
  sitSlider.classList.toggle('no-lie', !allowLie);
  // Точки-отметки: стоит, присед, на коленях, боком, лёжа — по текущему пределу.
  const marks = [0, 0.5, 0.8, 1.0, 1.3];
  sitSlider.querySelectorAll('.track i').forEach((el, i) => { el.style.top = `${(marks[i] / sitMax()) * 100}%`; });
}
$('lie-toggle').addEventListener('pointerdown', (e) => e.stopPropagation());
// В режиме позы полоса умеет два дела: наклон (по умолчанию) или сесть/лечь, не ломая позу.
let poseSlider = 'bend';
const POSE_SLIDER_ICONS = {
  bend: '<path d="M12 4.5a1.6 1.6 0 1 1 0 .1"/><path d="M11 8l-3 5 4 2v5M8 13l-3-1"/><path d="M15 9l-4-1"/>',
  sit: '<path d="M10 4.5a1.6 1.6 0 1 1 0 .1"/><path d="M10 8v5h5l1 6M10 13l-3 6"/>',
};
function renderPoseSliderBtn() {
  const btn = $('lie-toggle');
  if (!poseMode) { renderLieToggle(); return; }
  btn.classList.remove('off');
  btn.querySelector('svg').innerHTML = POSE_SLIDER_ICONS[poseSlider];
  btn.title = poseSlider === 'bend' ? 'Полоса: наклон' : 'Полоса: сесть / лечь';
}
function cycleLie(e) {
  e.stopPropagation();
  lieMode = { side: 'belly', belly: 'back', back: 'off', off: 'side' }[lieMode];
  try { localStorage.setItem('waifu-lie', lieMode); } catch { /* ignore */ }
  renderLieToggle();
  if (!allowLie && character && character.sit > 1.0) sitBy((1.0 - character.sit) / 0.004);
  showToast({ side: 'Ляжет на бок', belly: 'Ляжет на живот — спать 😴', back: 'Ляжет на спину', off: 'Не ложится: только сидит' }[lieMode]);
}
$('lie-toggle').addEventListener('click', (e) => { if (!poseMode) cycleLie(e); });
$('lie-toggle2').addEventListener('pointerdown', (e) => e.stopPropagation());
$('lie-toggle2').addEventListener('click', cycleLie);
renderLieToggle();
// Палец ведёт относительно (без скачка к месту касания): вся высота полосы = от «стоит» до «лежит».
let sliderDrag = null;
sitSlider.addEventListener('pointerdown', (e) => {
  if (!character) return;
  e.preventDefault();
  e.stopPropagation();
  sitSlider.setPointerCapture(e.pointerId);
  sliderDrag = { y: e.clientY, t: performance.now() };
  sitSlider.classList.add('active');
});
sitSlider.addEventListener('pointermove', (e) => {
  if (!sliderDrag || !character) return;
  const h = sitSlider.querySelector('.track').getBoundingClientRect().height || 200;
  const dv = ((e.clientY - sliderDrag.y) / h) * sitMax();
  const now = performance.now();
  // Скорость пальца → скорость движения: быстро ведёшь — быстрее, медленно — плавно.
  const rate = Math.abs(dv) / Math.max(0.008, (now - sliderDrag.t) / 1000);
  character.sitRate = Math.max(character.sitRate * 0.8, Math.min(rate, 3));
  sliderDrag.y = e.clientY;
  sliderDrag.t = now;
  if (poseMode) {
    // В режиме позы левая полоса не сажает: ноги стоят, тело с бёдрами идёт вперёд
    // (наклон, таз назад) или назад (прогиб) — плавно, в темпе пальца.
    const o = character.bodyOffset;
    const bend = THREE.MathUtils.clamp(o.hipsRotX + (dv / sitMax()) * BEND_RANGE, BEND_MIN, BEND_MAX);
    o.hipsRotX = bend;
    // Назад гнётся в основном спина (S-линия), голова следует за ней.
    o.spineX = bend >= 0 ? bend * 0.45 : bend * 1.1;
    showLabel(bend > 0.05 ? 'Наклон вперёд' : bend < -0.05 ? 'Прогиб назад' : 'Прямо');
    return;
  }
  sitBy(dv / 0.004);
});
for (const ev of ['pointerup', 'pointercancel']) {
  sitSlider.addEventListener(ev, () => { sliderDrag = null; sitSlider.classList.remove('active'); });
}
// Правая полоса во вкладке «Позы»: присесть → на колени → сесть → лечь (поза остаётся).
const sitSlider2 = $('sit-slider2');
let slider2Drag = null;
sitSlider2.addEventListener('pointerdown', (e) => {
  if (!character || e.target.closest('#lie-toggle2')) return;
  e.preventDefault();
  e.stopPropagation();
  sitSlider2.setPointerCapture(e.pointerId);
  slider2Drag = { y: e.clientY, t: performance.now() };
  sitSlider2.classList.add('active');
});
sitSlider2.addEventListener('pointermove', (e) => {
  if (!slider2Drag || !character) return;
  const h = sitSlider2.querySelector('.track').getBoundingClientRect().height || 200;
  const dv = ((e.clientY - slider2Drag.y) / h) * sitMax();
  const now = performance.now();
  const rate = Math.abs(dv) / Math.max(0.008, (now - slider2Drag.t) / 1000);
  character.sitRate = Math.max(character.sitRate * 0.8, Math.min(rate, 3));
  slider2Drag.y = e.clientY;
  slider2Drag.t = now;
  sitBy(dv / 0.004);
});
for (const ev of ['pointerup', 'pointercancel']) {
  sitSlider2.addEventListener(ev, () => { slider2Drag = null; sitSlider2.classList.remove('active'); });
}

// Наклон в режиме позы: от прогиба назад (верх полосы) до глубокого наклона (низ).
const BEND_MIN = -0.45; // прогиб назад — побольше
const BEND_MAX = 1.35; // наклон вперёд поглубже
const BEND_RANGE = BEND_MAX - BEND_MIN;
function updateSitSlider() {
  if (!character) return;
  // В режиме позы стоя — наклон; если она сидит/лежит — полоса поднимает/опускает её.
  const bendMode = poseMode;
  sitSlider2.style.setProperty('--k', THREE.MathUtils.clamp(character.sitS / sitMax(), 0, 1).toFixed(3));
  sitSlider.classList.toggle('pose-mode', poseMode);
  sitSlider.classList.toggle('bend', bendMode);
  const k = bendMode
    ? (character.bodyOffset.hipsRotX - BEND_MIN) / BEND_RANGE
    : character.sitS / sitMax();
  sitSlider.style.setProperty('--k', THREE.MathUtils.clamp(k, 0, 1).toFixed(3));
}

// Свайп вниз по пустому месту — садится на пол, вверх — встаёт.
let sitLineAt = 0;
function sitBy(dy) {
  if (!character) return;
  if (dy > 0 && character.mixer && currentMocap) stopMocap();
  const before = character.sit;
  character.sit = THREE.MathUtils.clamp(character.sit + dy * 0.004, 0, sitMax()); // до 1.3 — лечь на бок
  const now = performance.now();
  if (now - sitLineAt > 4000) {
    if (before < 0.9 && character.sit >= 0.9) { sitLineAt = now; say(pick(['Посижу немножко~', 'Ух, устала…', 'Сядешь рядом?'])); }
    if (before > 0.1 && character.sit <= 0.1) { sitLineAt = now; say(pick(['Ладно, встаю!', 'Опа!', 'Всё, отдохнула~'])); }
    if (before < 1.25 && character.sit >= 1.25) {
      sitLineAt = now;
      say(character.lieStyle === 'belly' ? pick(['Посплю немножко… 😴', 'Спокойной ночи~', 'Ммм… zzz'])
        : character.lieStyle === 'back' ? pick(['Смотри, облака~', 'Как хорошо полежать…', 'Ляжешь рядом?'])
        : pick(['Полежу немножко~', 'Как уютно…', 'Ммм, хорошо~']));
    }
  }
}

// Ближайшая точка-ручка под пальцем (с запасом ~60px): хватать легко.
const HANDLE_HIT = {
  handL: { zone: 'hand', side: 'left' }, handR: { zone: 'hand', side: 'right' },
  head: { zone: 'face' }, chest: { zone: 'body', bone: 'chest' }, belly: { zone: 'belly' },
  hips: { zone: 'body', bone: 'hips' }, footL: { zone: 'legs', bone: 'leftFoot' }, footR: { zone: 'legs', bone: 'rightFoot' },
  kneeL: { zone: 'knee', side: 'left' }, kneeR: { zone: 'knee', side: 'right' },
};
function nearestHandle(e) {
  let best = null;
  let bestD = 60;
  for (const k of HANDLE_KEYS) {
    const p = handleWorld(k);
    if (!p) continue;
    handleV.copy(p).project(camera);
    const d = Math.hypot((handleV.x * 0.5 + 0.5) * window.innerWidth - e.clientX, (-handleV.y * 0.5 + 0.5) * window.innerHeight - e.clientY);
    if (d < bestD) { bestD = d; best = { ...HANDLE_HIT[k], key: k }; }
  }
  return best;
}
function handleKeyFor(hit) {
  if (!hit) return null;
  if (hit.key) return hit.key;
  if (hit.zone === 'hand' || hit.zone === 'arm') return hit.side === 'left' ? 'handL' : 'handR';
  if (hit.zone === 'headpat' || hit.zone === 'face') return 'head';
  if (hit.zone === 'belly') return 'belly';
  if (hit.zone === 'knee') return hit.side === 'left' ? 'kneeL' : 'kneeR';
  if (hit.zone === 'legs') return /left/i.test(hit.bone) ? 'footL' : 'footR';
  if (hit.zone === 'body') return hit.bone === 'chest' ? 'chest' : 'hips';
  return null;
}
// Подпись у пальца: что сейчас двигаешь.
let labelTimer = 0;
function showLabel(text) {
  const el = $('pose-label');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(labelTimer);
  labelTimer = setTimeout(() => el.classList.remove('on'), 1200);
}
function poseDragStart(e) {
  const hit = nearestHandle(e) ?? zoneAt(e, true);
  activeHandle = handleKeyFor(hit);
  snapAnchor = null;
  if (activeHandle) showLabel(HANDLE_LABELS[activeHandle]);
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
  } else if (hit.zone === 'knee') {
    // Колено: ведёшь колено — стопа идёт следом под ним (голень свисает), бедро сгибается само.
    const side = hit.side;
    const kneePos = character.bones[`${side}LowerLeg`].getWorldPosition(new THREE.Vector3());
    const footPos = character.footWorld(side);
    const normal = new THREE.Vector3();
    camera.getWorldDirection(normal);
    poseDrag = { kind: 'knee', side, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, kneePos), shin: footPos.clone().sub(kneePos) };
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
  if (poseDrag.kind === 'hand' || poseDrag.kind === 'foot' || poseDrag.kind === 'knee') {
    toNdc(e);
    raycaster.setFromCamera(pointer, camera);
    if (raycaster.ray.intersectPlane(poseDrag.plane, dragPoint)) {
      if (poseDrag.kind === 'knee') {
        // Голень свисает почти вертикально под коленом (чуть назад).
        const len = poseDrag.shin.length();
        character.setFootTarget(poseDrag.side, dragPoint.clone().add(new THREE.Vector3(0, -len * 0.97, -0.05 * character.scale)));
      } else if (poseDrag.kind === 'hand') {
        const near = nearestAnchor(e, poseDrag.side);
        if (near && snapAnchor?.a !== near.a) showLabel(`${HANDLE_LABELS[activeHandle] ?? 'Рука'} ${near.a.label}`);
        snapAnchor = near;
        if (near?.a.preset) character.setArmPreset(poseDrag.side, near.a.preset);
        else character.setHandTarget(poseDrag.side, near ? near.p : dragPoint);
      }
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
    // Только вбок (бёдра в сторону) — вертикаль не трогаем, чтобы она не приседала случайно.
    o.hipsX = clamp(o.hipsX + dx * 0.0006 * facing * S, -0.08 * S, 0.08 * S);
    o.hipsZ = clamp(o.hipsX / S * 1.6, -0.14, 0.14);
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

// ---------- Кнопки прячутся сами ----------
// Через 4 с без касаний кнопки плавно исчезают — остаётся только она.
// Любое касание возвращает их. Полосы слева/справа работают и невидимыми.
let uiIdleTimer = 0;
function wakeUi() {
  document.body.classList.remove('ui-hidden');
  clearTimeout(uiIdleTimer);
  // Во вкладке «Позы» кнопок больше — прячем быстрее.
  uiIdleTimer = setTimeout(() => {
    if (document.querySelector('.panel:not(.hidden)') || !$('pose-list').hidden || poseDrag || $('pose-save-form').hidden === false) { wakeUi(); return; }
    document.body.classList.add('ui-hidden');
  }, poseMode ? 2500 : 4000);
}
// Кнопки возвращаются от короткого касания (тап), а не от перетаскивания:
// крутишь камеру, тянешь её за руку или ведёшь полосу — экран остаётся чистым.
let tapStart = null;
window.addEventListener('pointerdown', (e) => {
  tapStart = { x: e.clientX, y: e.clientY, t: performance.now() };
  if (!document.body.classList.contains('ui-hidden')) wakeUi(); // кнопки видны — продлеваем
}, { capture: true, passive: true });
window.addEventListener('pointerup', (e) => {
  if (!tapStart) return;
  const quick = performance.now() - tapStart.t < 300 && Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) < 12;
  tapStart = null;
  if (quick || !document.body.classList.contains('ui-hidden')) wakeUi();
}, { capture: true, passive: true });
window.addEventListener('keydown', wakeUi, { capture: true });
wakeUi();

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
  const bg = look.bg ?? (look.dark ? 'night' : 'day');
  document.body.classList.toggle('dark', BG_DARK.has(bg));
  for (const b of BACKGROUNDS) document.body.classList.toggle(`bg-${b.id}`, b.id === bg);
  applyLight(bg);
}

// Фоны и свет под каждый: мягкий розовый день, закат, готика, звёздная ночь, уютная комната.
const BACKGROUNDS = [
  { id: 'day', name: '🌸 Нежный', key: 0xffffff, rim: 0xffd2ec, amb: 0.6, keyI: Math.PI },
  { id: 'sunset', name: '🌅 Закат', key: 0xffc79a, rim: 0xff7fae, amb: 0.5, keyI: Math.PI * 0.95 },
  { id: 'night', name: '🖤 Готика', key: 0xe6d8ff, rim: 0xc77dff, amb: 0.45, keyI: Math.PI * 0.85 },
  { id: 'stars', name: '✨ Звёзды', key: 0xcfd8ff, rim: 0x8fb4ff, amb: 0.4, keyI: Math.PI * 0.8 },
  { id: 'room', name: '🛋 Комната', key: 0xffe2c4, rim: 0xffb3d1, amb: 0.55, keyI: Math.PI * 0.9 },
];
const BG_DARK = new Set(['night', 'stars']);
function applyLight(bg) {
  const d = BACKGROUNDS.find((b) => b.id === bg) ?? BACKGROUNDS[0];
  light.color.setHex(d.key);
  light.intensity = d.keyI;
  rim.color.setHex(d.rim);
  ambient.intensity = d.amb;
}
function renderBackgrounds() {
  const box = $('bg-list');
  if (!box) return;
  box.innerHTML = '';
  const cur = look.bg ?? (look.dark ? 'night' : 'day');
  for (const b of BACKGROUNDS) {
    const el = document.createElement('button');
    el.className = 'chip' + (b.id === cur ? ' active' : '');
    el.textContent = b.name;
    el.addEventListener('click', () => {
      look.bg = b.id;
      look.dark = BG_DARK.has(b.id);
      saveLook();
      applyLook();
      renderWardrobe();
    });
    box.appendChild(el);
  }
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

  renderBackgrounds();
}


$('goth-preset').addEventListener('click', () => {
  clothColor = 'black';
  saveLook();
  Object.assign(look, { hair: 'black', stockings: 'black', dark: true, bg: 'night' });
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
// Взгляд (кнопка у ⌂): 'follow' — следит за пальцем, 'me' — смотрит на тебя, 'closed' — глаза закрыты.
let gazeMode = 'follow';
try { const g = localStorage.getItem('waifu-gaze'); if (g === 'me' || g === 'closed') gazeMode = g; } catch { /* ignore */ }
const GAZE_ICONS = {
  follow: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  me: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="0.9" fill="currentColor"/><path d="M12 1.5v2M12 20.5v2"/>',
  closed: '<path d="M3 11c2.5 3.5 5.5 5 9 5s6.5-1.5 9-5"/><path d="M6 14.5l-1.5 2M12 16v2.5M18 14.5l1.5 2"/>',
};
function renderGaze() {
  const b = $('btn-gaze');
  b.querySelector('svg').innerHTML = GAZE_ICONS[gazeMode];
  b.classList.toggle('active', gazeMode !== 'follow');
  b.title = { follow: 'Взгляд: за пальцем', me: 'Взгляд: на тебя', closed: 'Глаза закрыты' }[gazeMode];
}
$('btn-gaze').addEventListener('click', () => {
  gazeMode = { follow: 'me', me: 'closed', closed: 'follow' }[gazeMode];
  try { localStorage.setItem('waifu-gaze', gazeMode); } catch { /* ignore */ }
  renderGaze();
  showToast({ follow: '👀 Смотрит за пальцем', me: '💗 Смотрит на тебя', closed: '😌 Глаза закрыты' }[gazeMode]);
});
renderGaze();
const lookNdc = new THREE.Vector2();
let idleTime = 0;

let saccadeT = 1;
const saccade = new THREE.Vector3();
// ---------- Сама двигается (только на главном экране) ----------
// Когда её не трогают, иногда сама плавно исполняет красивые гибкие движения:
// наклон, прогиб, волна телом, покачивание бёдрами, присесть, на колени и потянуться.
// Любое касание — плавно возвращается.
const AUTO_ROUTINES = [
  { name: 'наклон', keys: [[0, {}], [3, { bend: 1.0 }], [4.2, { bend: 1.05 }], [7.5, {}]] },
  { name: 'прогиб', keys: [[0, {}], [2.6, { bend: -0.38 }], [3.8, { bend: -0.42 }], [6.5, {}]] },
  { name: 'волна', keys: [[0, {}], [2, { bend: 0.45 }], [4.2, { bend: -0.3 }], [6.2, { bend: 0.25 }], [8.4, {}]] },
  { name: 'бёдра', keys: [[0, {}], [1.6, { sway: 1 }], [3.2, { sway: -1 }], [4.8, { sway: 1 }], [6.4, { sway: -0.6 }], [8, {}]] },
  { name: 'присесть', keys: [[0, {}], [3, { sit: 0.42, bend: 0.25 }], [5, { sit: 0.45, bend: 0.35 }], [8.5, {}]] },
  { name: 'колени', keys: [[0, {}], [4, { sit: 0.8 }], [5.5, { sit: 0.8, bend: -0.35 }], [7.5, { sit: 0.8, bend: 0.5 }], [9, { sit: 0.8 }], [13, {}]] },
  { name: 'наклон-бёдра', keys: [[0, {}], [2.5, { bend: 0.6 }], [4, { bend: 0.6, sway: 1 }], [5.5, { bend: 0.6, sway: -1 }], [7, { bend: 0.5 }], [9.5, {}]] },
];
let autoMoves = true;
try { autoMoves = localStorage.getItem('waifu-auto') !== '0'; } catch { /* ignore */ }
let auto = null; // { keys, t, last }
let autoIdle = 0;
let autoCooldown = 6;
let autoLastName = '';
const AUTO_VALS = ['bend', 'sway', 'sit'];
function autoValuesAt(keys, t) {
  const out = { bend: 0, sway: 0, sit: 0 };
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const [t0, a] = keys[i];
  const [t1, b] = keys[Math.min(i + 1, keys.length - 1)];
  const k = t1 > t0 ? THREE.MathUtils.smoothstep(t, t0, t1) : 1;
  for (const v of AUTO_VALS) out[v] = (a[v] ?? 0) + ((b[v] ?? 0) - (a[v] ?? 0)) * k;
  return out;
}
function applyAuto(v) {
  const o = character.bodyOffset;
  const S = character.scale;
  o.hipsRotX = v.bend;
  o.spineX = v.bend >= 0 ? v.bend * 0.45 : v.bend * 1.1;
  o.hipsX = v.sway * 0.08 * S;
  o.hipsZ = THREE.MathUtils.clamp(o.hipsX / S * 1.6, -0.14, 0.14);
  o.spineZ = -v.sway * 0.16;
  character.sit = v.sit;
  character.sitRate = 0.5;
}
// Плавно вернуться из текущего положения (касание или переход во вкладку «Позы»).
function stopAuto(instant = false) {
  if (!auto || !character) return;
  if (instant) { applyAuto({ bend: 0, sway: 0, sit: 0 }); auto = null; return; }
  const cur = auto.last ?? { bend: 0, sway: 0, sit: 0 };
  auto = { keys: [[0, cur], [1.2, { sit: cur.sit }]], t: 0, returning: true };
}
function updateAuto(dt) {
  if (!character) return;
  autoIdle += dt;
  if (auto) {
    auto.t += dt;
    const end = auto.keys[auto.keys.length - 1][0];
    auto.last = autoValuesAt(auto.keys, Math.min(auto.t, end));
    if (auto.returning) {
      // При возврате посадку не трогаем — ей может управлять полоса.
      const o = character.bodyOffset;
      const S = character.scale;
      o.hipsRotX = auto.last.bend;
      o.spineX = auto.last.bend >= 0 ? auto.last.bend * 0.45 : auto.last.bend * 1.1;
      o.hipsX = auto.last.sway * 0.06 * S;
      o.hipsZ = THREE.MathUtils.clamp(o.hipsX / S * 1.6, -0.14, 0.14);
      o.spineZ = -auto.last.sway * 0.12;
    } else applyAuto(auto.last);
    if (auto.t >= end) { auto = null; autoCooldown = 6 + Math.random() * 7; }
    return;
  }
  autoCooldown -= dt;
  const calm = autoMoves && !poseMode && autoIdle > 5 && autoCooldown <= 0
    && character.sit < 0.02 && character.sitS < 0.02 && !character.mixer && !character.dancing
    && !(currentMocap && !MOCAP.find((m) => m.id === currentMocap)?.idle)
    && Math.abs(character.bodyOffset.hipsRotX) < 0.01 && document.querySelector('.panel:not(.hidden)') === null;
  if (!calm) return;
  const choices = AUTO_ROUTINES.filter((r) => r.name !== autoLastName);
  const r = choices[Math.floor(Math.random() * choices.length)];
  autoLastName = r.name;
  auto = { keys: r.keys, t: 0 };
}
window.addEventListener('pointerdown', () => { autoIdle = 0; stopAuto(); }, { capture: true, passive: true });
function renderAutoBtn() {
  $('btn-auto').textContent = autoMoves ? '🌸 Сама двигается: вкл' : '🌸 Сама двигается: выкл';
  $('btn-auto').classList.toggle('active', autoMoves);
}
$('btn-auto').addEventListener('click', () => {
  autoMoves = !autoMoves;
  try { localStorage.setItem('waifu-auto', autoMoves ? '1' : '0'); } catch { /* ignore */ }
  renderAutoBtn();
});
renderAutoBtn();

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);

  updateCamera(dt);
  updateSitSlider();
  updateHandles();
  updateBlob();
  updateLiveIdle();
  updateAuto(dt);
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
    // Взгляд «на меня»: глаза в камеру, голова к тебе.
    if (gazeMode === 'me') lookPoint.copy(camera.position).add(saccade);
    character.lookTarget.position.lerp(lookPoint, 1 - Math.exp(-dt * 18));
    // Головой за пальцем следит только когда мы перед ней.
    const facing = Math.max(0, Math.cos(camYaw));
    if (gazeMode === 'follow') lookNdc.set(pointer.x * facing, pointer.y * facing);
    else lookNdc.set(0, 0);
    character.eyesShut = gazeMode === 'closed' ? 1 : 0;
    character.gazeTarget = gazeMode === 'me' ? camera.position : null;
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
