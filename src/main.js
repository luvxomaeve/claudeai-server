import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, VRMLookAtQuaternionProxy, createVRMAnimationClip } from '@pixiv/three-vrm-animation';
import { saveFile, deleteFile, listFiles } from './storage.js';
import { Stockings, STOCKING_STYLES } from './stockings.js';
import { parseMixamo, mixamoClip } from './mixamo.js';
import { MOCAP, loadMocap, mocapClip, mocapUpperClip } from './mocap.js';
import { PieceWardrobe, PIECE_CATS } from './outfits.js';
import { Character, POSES, LOOPS } from './character.js';
import { initPlatform, gameReady, rewarded as adsRewarded, interstitial, onAdPause, hasAds } from './ads.js';
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
const camPanH = new THREE.Vector3(); // сдвиг кадра вбок (двумя пальцами)
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
// ---------- Ручная камера (после жестов двумя пальцами / двойного тапа) ----------
// Точка взгляда T привязана к её тазу (едет вместе с ней, когда садится/ложится),
// камера — на сфере вокруг T: поворот (camYaw/camPitch) и расстояние. Ничего не «утягивает»
// кадр к голове — где поставил, там и стоит.
let manualCam = null; // { off: Vector3, dist }
const hipsTrack = new THREE.Vector3(0, 0.9, 0);
let hipsTrackInit = false;
function updateHipsTrack(dt) {
  if (!character?.bones.hips) return;
  const h = character.bones.hips.getWorldPosition(new THREE.Vector3());
  if (!hipsTrackInit) { hipsTrack.copy(h); hipsTrackInit = true; }
  hipsTrack.lerp(h, 1 - Math.exp(-dt * 4));
}
function enterManualCam() {
  if (manualCam) return;
  if (typeof freeCam !== 'undefined' && freeCam) exitFreeCam();
  if (typeof faceCam !== 'undefined' && faceCam) setFaceCam(false);
  const T = cameraLookAt.clone();
  const v = camera.position.clone().sub(T);
  const dist = v.length();
  camYaw = Math.atan2(v.x, v.z);
  camPitch = Math.asin(THREE.MathUtils.clamp(v.y / dist, -1, 1));
  manualCam = { off: T.sub(hipsTrack), dist };
  camTween = 1;
}
function exitManualCam() { manualCam = null; }
function manualTarget(out) {
  const T = hipsTrack.clone().add(manualCam.off);
  const cp = Math.cos(camPitch);
  out.look.copy(T);
  out.pos.set(T.x + Math.sin(camYaw) * manualCam.dist * cp, T.y + Math.sin(camPitch) * manualCam.dist, T.z + Math.cos(camYaw) * manualCam.dist * cp);
  out.pos.y = Math.max(camFloor(), out.pos.y);
  return out;
}

// Самая низкая точка камеры. В релизе (Яндекс Игры) — не ниже колен:
// без ракурсов снизу (требования модерации).
function camFloor() { return (window.WAIFU_RELEASE ? 0.5 : 0.05) * camBase.S; }
function orbitTarget(out) {
  if (manualCam) return manualTarget(out);
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
  cx += camPanH.x;
  cz += camPanH.z;
  out.look.set(cx, lookY, cz);
  const cp = Math.cos(pitch);
  out.pos.set(cx + Math.sin(camYaw) * dd * cp, Math.max(camFloor(), lookY + Math.sin(pitch) * dd), cz + Math.cos(camYaw) * dd * cp);
  return out;
}

// Мгновенно применить yaw/zoom (при жестах и кнопках).
// Свободная камера (как дрон): шарик — лететь вперёд/назад и вбок;
// палец по фону — оглядеться; два пальца — щипок вперёд/назад, вверх/вниз — высота.
let freeCam = null; // { yaw, pitch } — куда смотрит камера
function freeDir(out = new THREE.Vector3()) {
  const cp = Math.cos(freeCam.pitch);
  return out.set(Math.sin(freeCam.yaw) * cp, Math.sin(freeCam.pitch), Math.cos(freeCam.yaw) * cp);
}
function enterFreeCam() {
  if (freeCam) return;
  exitManualCam();
  if (typeof faceCam !== 'undefined' && faceCam) setFaceCam(false);
  const d = cameraLookAt.clone().sub(camera.position).normalize();
  freeCam = { yaw: Math.atan2(d.x, d.z), pitch: Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) };
  camTween = 1;
  showToast('🛸 Свободная камера · ⌂ — вернуть');
}
function exitFreeCam() { freeCam = null; }
function applyFree() {
  camera.position.y = Math.max(camFloor(), camera.position.y);
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

let lastCamMove = 0; // когда последний раз крутили камеру — точки не ловят палец
function rotateBy(delta, dPitch = 0) {
  lastCamMove = performance.now();
  if (freeCam) {
    // Свободная камера: палец по фону — оглядеться.
    freeCam.yaw += delta * 0.6;
    freeCam.pitch = THREE.MathUtils.clamp(freeCam.pitch - dPitch * 0.8, -1.4, 1.4);
    applyFree();
    return;
  }
  if (faceCam) setFaceCam(false); // крутишь сам — слежение за лицом выключается
  camYaw = (camYaw + delta) % (Math.PI * 2);
  camPitch = THREE.MathUtils.clamp(camPitch + dPitch, manualCam ? -1.2 : -0.6, manualCam ? 1.45 : 1.35);
  applyOrbit();
}

function zoomBy(factor) {
  if (!freeCam && touches.size === 2) {
    enterManualCam();
    // Приближаем к точке между пальцами (а не к центру экрана).
    const [a, b] = [...touches.values()];
    const ndc = new THREE.Vector2(((a.x + b.x) / 2 / window.innerWidth) * 2 - 1, -((a.y + b.y) / 2 / window.innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const P = ray.ray.at(manualCam.dist, new THREE.Vector3());
    const T = hipsTrack.clone().add(manualCam.off);
    const nd = THREE.MathUtils.clamp(manualCam.dist * factor, 0.12 * camBase.S, 6 * camBase.S);
    const real = nd / manualCam.dist;
    manualCam.off.addScaledVector(P.sub(T), 1 - real);
    manualCam.dist = nd;
    applyOrbit();
    return;
  }
  if (manualCam) {
    manualCam.dist = THREE.MathUtils.clamp(manualCam.dist * factor, 0.12 * camBase.S, 6 * camBase.S);
    applyOrbit();
    return;
  }
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
  updateHipsTrack(dt);
  updateStick(dt);
  if (freeCam) return; // свободная камера — орбита не вмешивается
  if (manualCam) { if (camTween >= 1) applyOrbit(); }
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
    // Бинарная модель (.glb/.vrm) — сразу готова, без распаковки.
    if (!/\.json($|\?)/.test(url)) { storeModel(url, all.buffer.slice(0)); return all.buffer; }
    text = new TextDecoder().decode(all);
  } else {
    if (!/\.json($|\?)/.test(url)) { const buf = await res.arrayBuffer(); storeModel(url, buf.slice(0)); return buf; }
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
  if (/\.glb$/.test(source.url)) {
    // Облегчённая бинарная модель; если хостинг её не отдал — запасная упакованная (.json).
    try { return await loader.parseAsync(await loadPackedModel(source.url), ''); } catch (err) {
      console.warn('glb failed, fallback to json', err);
      return loader.parseAsync(await loadPackedModel(source.url.replace(/\.glb$/, '.json')), '');
    }
  }
  if (/\.json$/.test(source.url)) return loader.parseAsync(await loadPackedModel(source.url), ''); // с кэшем и прогрессом
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
    pieceWardrobe.attachBase(vrm);
    loadLookFor(currentOutfit);
    applyLook();
    applyWear();
    preloadWornSources();
    if (!$('wardrobe').classList.contains('hidden')) renderWardrobe();
    buildHitboxes();
    frameCamera();
    $('loading').classList.add('done');
    if (firstLoad) {
      gameReady();
      greetOnLoad();
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
// Самый высокий достигнутый уровень. Пока до последнего уровня не дошёл — уровень может
// и упасть (функции снова закроются). Дошёл до последнего — всё открыто навсегда.
let reachedLvl = 0;
const maxedOut = () => reachedLvl >= LEVELS.length - 1;
try { reachedLvl = Number(localStorage.getItem('waifu-reached')) || 0; } catch { /* ignore */ }
reachedLvl = Math.max(reachedLvl, levelOf(love)); // уже набранная симпатия тоже считается
try { localStorage.setItem('waifu-reached', String(reachedLvl)); } catch { /* ignore */ }
function setLove(v, silent = false) {
  const before = levelOf(love);
  const reachedBefore = Math.max(reachedLvl, before);
  love = THREE.MathUtils.clamp(v, 0, LOVE_MAX);
  try { localStorage.setItem(STORAGE_KEY, String(love)); } catch { /* ignore */ }
  const after = levelOf(love);
  if (after > reachedLvl) {
    reachedLvl = after;
    try { localStorage.setItem('waifu-reached', String(reachedLvl)); } catch { /* ignore */ }
  }
  renderAffection();
  renderLocks();
  if (!silent && after > before) {
    say(LEVEL_UP_LINES[after], 'happy');
    const opened = after > reachedBefore ? FEATURES.filter((f) => f.lvl === after && !adOpen(f.id)) : [];
    if (opened.length) setTimeout(() => showToast(`🔓 Открыто: ${opened.map((f) => f.name).join(', ')}`), 2200);
    $('affection').classList.remove('levelup');
    void $('affection').offsetWidth;
    $('affection').classList.add('levelup');
  }
}
// Шкала стала в 10 раз длиннее, а прирост — только вдвое: прокачка идёт примерно в 5 раз дольше.
// ---------- Прогресс: возможности открываются с ростом симпатии ----------
// Можно открыть раньше — за рекламу (в Яндекс Играх); без рекламы (артефакт) открывается сразу.
const FEATURES = [
  { id: 'floor', lvl: 1, name: 'Сесть на пол и лечь', ids: [] },
  { id: 'wardrobe', lvl: 1, name: 'Гардероб', ids: ['btn-wardrobe'] },
  { id: 'poses', lvl: 2, name: 'Вкладка «Позы»', ids: ['btn-tab-pose', 'poses-toggle'] },
  { id: 'photo', lvl: 2, name: 'Фото', ids: ['cam-photo'] },
  { id: 'lieStyles', lvl: 3, name: 'Лечь на живот и на спину', ids: ['lie-toggle', 'lie-toggle2'] },
  { id: 'handles', lvl: 3, name: 'Точки поз (всё тело)', ids: ['btn-handles'] },
  { id: 'dance', lvl: 4, name: 'Танцы и анимации', ids: ['btn-anims'] },
  { id: 'flow', lvl: 5, name: '«Повтор движения»', ids: ['cam-auto'] },
];
// Фича открывается навсегда: уровнем симпатии или сразу — за рекламу.
const UNLOCK_KEY = 'waifu-unlocked2';
const AD_UNLOCK_FOREVER = 8.64e15; // «навсегда» (максимальная дата)
let adUnlocked = {}; // id → до какого времени открыто
try { adUnlocked = JSON.parse(localStorage.getItem(UNLOCK_KEY) || '{}') || {}; } catch { /* ignore */ }
const adOpen = (id) => (adUnlocked[id] ?? 0) > Date.now();
function unlocked(id) {
  const f = FEATURES.find((x) => x.id === id);
  if (!f) return true;
  return levelOf(love) >= f.lvl || maxedOut() || adOpen(id);
}
// Время вышло — замочки возвращаются (проверка раз в 5 с).
let lockSig = '';
setInterval(() => {
  const sig = FEATURES.map((f) => (unlocked(f.id) ? 1 : 0)).join('');
  if (lockSig && sig !== lockSig) {
    const closed = FEATURES.filter((f, i) => lockSig[i] === '1' && sig[i] === '0');
    if (closed.length) showToast(`⏳ Время вышло: ${closed.map((f) => f.name).join(', ')}`);
  }
  lockSig = sig;
  renderLocks(); // кнопки всегда по текущему состоянию
}, 5000);
function renderLocks() {
  for (const f of FEATURES) {
    const on = unlocked(f.id);
    for (const id of f.ids) $(id)?.classList.toggle('locked', !on);
  }
}
let lockPop = null;
function showLock(f) {
  if (!lockPop) {
    lockPop = document.createElement('div');
    lockPop.id = 'lock-pop';
    lockPop.innerHTML = '<div class="lp-title"></div><div class="lp-text"></div><div class="lp-btns"><button class="lp-ad primary"></button><button class="lp-ok">Ок</button></div>';
    document.body.appendChild(lockPop);
    lockPop.querySelector('.lp-ok').addEventListener('click', () => { lockPop.hidden = true; });
  }
  lockPop.querySelector('.lp-title').textContent = `🔒 ${f.name}`;
  lockPop.querySelector('.lp-text').textContent = `Откроется на уровне ${f.lvl + 1} — «${LEVELS[f.lvl].label}». Общайся с ней, чтобы симпатия росла 💗`;
  const ad = lockPop.querySelector('.lp-ad');
  ad.textContent = '▶ Открыть сейчас (реклама)';
  ad.hidden = !hasAds(); // без рекламы (нет SDK) — только по уровню
  ad.onclick = () => {
    lockPop.hidden = true;
    adsRewarded(() => {
      adUnlocked[f.id] = AD_UNLOCK_FOREVER;
      try { localStorage.setItem(UNLOCK_KEY, JSON.stringify(adUnlocked)); } catch { /* ignore */ }
      lockSig = FEATURES.map((x) => (unlocked(x.id) ? 1 : 0)).join('');
      renderLocks();
      showToast(`🔓 Открыто: ${f.name}`);
    }, () => showToast('Реклама не досмотрена — ничего страшного'));
  };
  lockPop.hidden = false;
}
// Нажатие на закрытую кнопку — вместо действия показываем, когда откроется.
document.addEventListener('click', (e) => {
  const el = e.target.closest?.('.locked');
  if (!el) return;
  const f = FEATURES.find((x) => x.ids.includes(el.id));
  if (!f) return;
  e.stopPropagation();
  e.preventDefault();
  showLock(f);
}, true);

// Темп симпатии: касания тратят «запас» (до 30 очков, +4 в минуту). Пока запас есть —
// растёт как обычно, кончился — почти не растёт (натыкать всё сразу нельзя).
// Полностью открыть всё — несколько часов игры (растягивается на дни);
// не хочешь ждать — фичу можно открыть за рекламу.
const GAIN_CAP = 30, GAIN_PER_MIN = 4, GAIN_KEY = 'waifu-gain';
// «x2 симпатия на 10 минут» — за рекламу (кнопка в меню сердечка).
const BOOST_KEY = 'waifu-boost', BOOST_MS = 10 * 60000;
let boostUntil = 0;
try { boostUntil = Number(localStorage.getItem(BOOST_KEY)) || 0; } catch { /* ignore */ }
const boostOn = () => boostUntil > Date.now();
let tiredHintAt = 0;
let gainBudget = GAIN_CAP, gainAt = Date.now();
try {
  const g = JSON.parse(localStorage.getItem(GAIN_KEY) || 'null');
  if (g && Number.isFinite(g.b) && Number.isFinite(g.t)) { gainBudget = g.b; gainAt = g.t; }
} catch { /* ignore */ }
function refillGain() {
  const now = Date.now();
  gainBudget = Math.min(GAIN_CAP, gainBudget + ((now - gainAt) / 60000) * GAIN_PER_MIN);
  gainAt = now;
}
function changeAffection(delta) {
  // Шкала никогда не откатывается назад: на тычки и «не те» зоны — только реакция и фраза.
  if (!(delta > 0)) return;
  let d = delta * 2;
  if (d > 0) {
    refillGain();
    const full = Math.min(d, Math.max(0, gainBudget));
    gainBudget -= full;
    d = (full + (d - full) * 0.05) * (boostOn() ? 2 : 1);
    try { localStorage.setItem(GAIN_KEY, JSON.stringify({ b: gainBudget, t: gainAt })); } catch { /* ignore */ }
    // Запас кончился — подсказка про x2 (не чаще раза в 10 минут).
    if (gainBudget < 1 && !boostOn() && hasAds() && Date.now() - tiredHintAt > 600000 && love < LOVE_MAX) {
      tiredHintAt = Date.now();
      setTimeout(() => showToast('💗 Нажми на сердечко сверху — x2 симпатия за рекламу'), 1500);
    }
  }
  setLove(love + d);
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
  renderLocks();
}
// Тап по шкале — окошко прогресса: уровни и что на каком открывается, x2 за рекламу.
// «Макс» и «Сброс» — только для разработчика: 7 быстрых тапов по сердечку включают их.
const DEV_KEY = 'waifu-dev';
let devMode = false;
try { devMode = localStorage.getItem(DEV_KEY) === '1'; } catch { /* ignore */ }
let devTaps = [];
const loveMenu = $('love-menu');
loveMenu.innerHTML = '';
const lmHead = document.createElement('div');
lmHead.className = 'lm-head';
const lmList = document.createElement('div');
lmList.className = 'lm-levels';
const lmBtns = document.createElement('div');
lmBtns.className = 'lm-btns';
const lmDev = document.createElement('div');
lmDev.className = 'lm-dev';
loveMenu.append(lmHead, lmDev, lmBtns, lmList); // «Макс» — сразу под заголовком, без прокрутки
function renderLoveCard() {
  const l = levelOf(love);
  const next = LEVELS[l + 1];
  lmHead.innerHTML = `<b>💗 ${LEVELS[l].label}</b><span>${Math.round(love)} / ${LOVE_MAX}</span>`
    + (next ? `<small>До «${next.label}» — ещё ${Math.max(0, Math.ceil(next.min - love))} ♥</small>` : '<small>Максимум симпатии ♥</small>');
  lmList.innerHTML = '';
  LEVELS.forEach((lv, i) => {
    const row = document.createElement('div');
    const state = i < l ? 'done' : i === l ? 'cur' : 'lock';
    row.className = `lm-lvl ${state}`;
    const feats = FEATURES.filter((f) => f.lvl === i);
    const items = feats.map((f) => {
      const open = unlocked(f.id);
      const byAd = open && i > l && !maxedOut();
      return `<li class="${open ? 'open' : ''}">${open ? '✓' : '🔒'} ${f.name}${byAd ? ' <em>(за рекламу)</em>' : ''}</li>`;
    }).join('');
    const pct = state === 'cur' && next ? Math.round(((love - lv.min) / (next.min - lv.min)) * 100) : state === 'done' ? 100 : 0;
    row.innerHTML = `<div class="lm-top"><span class="lm-n">${state === 'lock' ? '🔒' : i + 1}</span><span class="lm-name">${lv.label}</span><span class="lm-min">${lv.min} ♥</span></div>`
      + (state === 'cur' && next ? `<div class="lm-bar"><i style="width:${pct}%"></i></div>` : '')
      + (items ? `<ul>${items}</ul>` : '');
    lmList.appendChild(row);
  });
  lmDev.hidden = !!window.WAIFU_RELEASE; // в версии для магазина «Макс» и «Сброс» скрыты
}
let devSuppressClick = false;
function enableDev() {
  if (window.WAIFU_RELEASE) return; // в версии для магазина режима разработчика нет
  devSuppressClick = true; // клик после касания не должен закрыть окошко
  if (devMode) { showToast('🛠 Режим разработчика уже включён'); return; }
  devMode = true;
  devTaps = [];
  try { localStorage.setItem(DEV_KEY, '1'); } catch { /* ignore */ }
  wakeUi();
  // Открываем окошко после текущего касания (иначе оно сразу закроется «тапом мимо»).
  setTimeout(() => { renderLoveCard(); loveMenu.hidden = false; }, 60);
  showToast('🛠 Режим разработчика: «Макс» и «Сброс» в окошке прогресса');
}
// Секрет: 7 быстрых касаний по сердечку (шкала сверху или 💗 в окошке) или удержание 3 с.
let devHold = 0;
// Ловим на всём окне по месту сердечка: даже если кнопки спрятались (через 4 с без касаний),
// касание туда всё равно считается.
window.addEventListener('pointerdown', (e) => {
  const t = e.target;
  const r = $('affection').getBoundingClientRect();
  const onBadge = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  if (!onBadge && !t.closest?.('.lm-head')) return;
  if (t.closest?.('#love-menu') && !t.closest('.lm-head')) return;
  const now = performance.now();
  devTaps = devTaps.filter((x) => now - x < 10000);
  devTaps.push(now);
  if (devTaps.length >= 7) enableDev();
  clearTimeout(devHold);
  devHold = setTimeout(enableDev, 3000);
}, true);
for (const ev of ['pointerup', 'pointercancel']) window.addEventListener(ev, () => clearTimeout(devHold), true);
$('affection').addEventListener('click', (e) => {
  e.stopPropagation();
  if (e.target.closest('#love-menu')) return;
  if (devSuppressClick) { devSuppressClick = false; loveMenu.hidden = false; renderLoveCard(); return; }
  loveMenu.hidden = !loveMenu.hidden;
  if (!loveMenu.hidden) { renderLoveCard(); renderBoost(); }
  document.body.classList.toggle('love-open', !loveMenu.hidden);
});
loveMenu.addEventListener('click', (e) => e.stopPropagation());
new MutationObserver(() => document.body.classList.toggle('love-open', !loveMenu.hidden)).observe(loveMenu, { attributes: true, attributeFilter: ['hidden'] });
const boostBtn = document.createElement('button');
boostBtn.id = 'love-boost';
lmBtns.appendChild(boostBtn);
function renderBoost() {
  boostBtn.hidden = !hasAds() || love >= LOVE_MAX;
  if (boostOn()) {
    boostBtn.textContent = `✨ x2 ещё ${Math.ceil((boostUntil - Date.now()) / 60000)} мин`;
    boostBtn.disabled = true;
  } else {
    boostBtn.textContent = '▶ x2 симпатия 10 мин (реклама)';
    boostBtn.disabled = false;
  }
}
boostBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  $('love-menu').hidden = true;
  if (boostOn()) return;
  adsRewarded(() => {
    boostUntil = Date.now() + BOOST_MS;
    try { localStorage.setItem(BOOST_KEY, String(boostUntil)); } catch { /* ignore */ }
    refillGain(); gainBudget = GAIN_CAP; // и запас касаний полный
    showToast('✨ x2 симпатия на 10 минут!');
    say(pick(['Ой, мне так хорошо с тобой~', 'Хи, я вся твоя ♥', 'Давай ещё пообщаемся~']), 'happy');
    renderBoost();
  }, () => showToast('Реклама не досмотрена — ничего страшного'));
});
$('affection').addEventListener('click', renderBoost, true);
setInterval(() => { if (!$('love-menu').hidden) renderBoost(); }, 10000);
{
  const rs = document.createElement('button'); rs.id = 'love-reset'; rs.textContent = 'Сброс';
  if (!window.WAIFU_RELEASE) {
    // «Макс» — только в веб-версии для проверки (в приложении его нет).
    const mx = document.createElement('button'); mx.id = 'love-max'; mx.textContent = '♥ Макс';
    mx.addEventListener('click', (e) => { e.stopPropagation(); setLove(LOVE_MAX); loveMenu.hidden = true; showToast('♥ Максимум'); });
    lmDev.append(mx);
  }
  lmDev.append(rs);
}
$('love-reset').addEventListener('click', (e) => { e.stopPropagation(); reachedLvl = 0; try { localStorage.setItem('waifu-reached', '0'); } catch { /* ignore */ } setLove(0, true); $('love-menu').hidden = true; showToast('Симпатия сброшена'); });
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#affection, #love-menu')) $('love-menu').hidden = true; });
renderAffection();
// В релизе (Яндекс Игры) кнопки «Макс» нет — симпатию надо заработать.
// «Макс» в релизе — только в режиме разработчика (см. окошко прогресса).
initPlatform();

// ---------- Реплики и озвучка ----------

let voiceOn = true;
let bubbleTimer = 0;
let lastSpokeAt = 0;

// Что сейчас на ногах: колготки (свои), чулки или гольфы — реплики подстраиваются.
function legwear() {
  try {
    const id = wear.legs || 'base';
    if (id === 'base') return window.WAIFU_BASE_LEGS ?? 'tights';
    return PIECE_SOURCES.find((x) => x.id === id)?.legsKind ?? 'stockings';
  } catch { return 'tights'; } // ещё не загрузилось
}
const LEGS_LINES = {
  stockings: ['Тебе нравятся мои чулочки? ♥', 'Чулочки — моя слабость~', 'Хи, красивые чулки, правда?', 'Смотришь на мои чулки? 😳', 'Резинка не сползла?..'],
  socks: ['Тебе нравятся мои гольфы? ♥', 'Хи, гольфики~', 'Мило же, да?'],
  tights: ['Нравятся мои колготки? ♥', 'Колготки — классика~', 'Мягкие, правда?', 'Хи, гладкие, да?~'],
};
function legsText(text) {
  const k = legwear();
  if (k === 'tights' || !/колготк/i.test(text)) return text;
  const w = k === 'socks' ? ['гольфы', 'гольфах', 'гольфами'] : ['чулочки', 'чулочках', 'чулочками'];
  return text.replace(/колготках/gi, w[1]).replace(/колготками/gi, w[2]).replace(/колготки/gi, w[0]);
}
function say(text, expression) {
  text = legsText(text);
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
  // Хвостики волос — своя зона (ей нравится, когда их гладят), если они ближе к пальцу.
  const hair = character.hitHair?.(raycaster.ray);
  if (hair) {
    const ht = hit ? hit.point.clone().sub(raycaster.ray.origin).dot(raycaster.ray.direction) : Infinity;
    if (!hit || hair.t < ht + 0.01 * character.scale) return hair;
  }
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
let pinchMidX = 0;
let pinchAng = 0;

function pinchDistance() {
  const [a, b] = [...touches.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Двойной тап: по ней — камера плавно подлетает к этому месту; по фону — обычный вид.
let lastTap = { t: 0, x: 0, y: 0 };
function focusAt(e) {
  const hit = character ? zoneAt(e, true) : null;
  if (!hit) { resetView(); showToast('⌂ Обычный вид'); return; }
  exitFreeCam();
  setFaceCam(false);
  enterManualCam();
  // Плавно: точка взгляда — туда, куда тапнул, и камера ближе.
  const from = { off: manualCam.off.clone(), dist: manualCam.dist };
  const to = { off: hit.point.clone().sub(hipsTrack), dist: Math.min(manualCam.dist, 0.7 * camBase.S) };
  let t0 = performance.now();
  const step = () => {
    if (!manualCam) return;
    const k = Math.min(1, (performance.now() - t0) / 450);
    const e2 = k * k * (3 - 2 * k);
    manualCam.off.lerpVectors(from.off, to.off, e2);
    manualCam.dist = from.dist + (to.dist - from.dist) * e2;
    applyOrbit();
    if (k < 1) requestAnimationFrame(step);
  };
  step();
}
canvas.addEventListener('pointerdown', (e) => {
  // Двойной тап больше не приближает (мешал гладить/тапать её).
  if (!character) return;
  // Открыт список поз — касание по сцене просто закрывает его.
  if (!$('pose-list').hidden && !poseMode) { setPoseListOpen(false); return; }
  canvas.setPointerCapture(e.pointerId);
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 1) flickStart = { x: e.clientX, y: e.clientY, t: performance.now(), onHer: !!zoneAt(e) || nearHerOnScreen(e) };
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

  // Режим позы: хватаем руку или голову. Точки спрятаны (⁘) или «чистый вид» —
  // касания как на главной: гладь и тапай её, поза и повтор остаются.
  if (poseMode && !petInPose()) {
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
  stroking = { hit, lastX: e.clientX, lastY: e.clientY, sx: e.clientX, sy: e.clientY, moved: 0, dist: 0, ticks: 0 };
});

// Тычок: срабатывает, когда палец отпустили, не поведя им.
function tapReaction(hit, e) {
  if (hit?.zone === 'legs' && LEGS_LINES[legwear()] && Math.random() < 0.5) {
    character.react({ expression: 'happy', motion: 'shyLegs' });
    changeAffection(0.4);
    floatHeart(e.clientX, e.clientY);
    say(pick(LEGS_LINES[legwear()]));
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
  else if (r.affection[t] <= 0) lockedStroke(stroking.hit.zone, r, e);
  const now = performance.now();
  if (now - lastStrokeLineAt > 2600 && now - lastSpokeAt > 1800) {
    lastStrokeLineAt = now;
    // Ноги — про чулки/гольфы/колготки, как при тапе (иногда — обычная фраза).
    const lw = stroking.hit.zone === 'legs' ? LEGS_LINES[legwear()] : null;
    say(pick(lw && Math.random() < 0.4 ? lw : r.lines[t]));
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
    // Два пальца: щипок — ближе/дальше к тому месту, где пальцы; вести — сдвинуть кадр.
    const [a, b] = [...touches.values()];
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const ang = 0;
    if (pinchMidY != null) {
      const dx = midX - pinchMidX;
      const dy = midY - pinchMidY;
      if (freeCam) {
        const dist = 1.5;
        const k = (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / window.innerHeight;
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
        camera.position.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
        applyFree();
      } else {
        enterManualCam();
        const k = (2 * manualCam.dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / window.innerHeight;
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
        manualCam.off.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
        applyOrbit();
      }
    }
    pinchMidX = midX;
    pinchMidY = midY;
    pinchAng = ang;
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
  if (stroking && poseMode && stroking.ticks === 0 && stroking.hit.zone !== 'hair') {
    // Режим позы без точек: повёл по ней вверх-вниз — сажаем/поднимаем (как правая полоса);
    // вбок или по кругу — поглаживание.
    const ax = Math.abs(e.clientX - stroking.sx), ay = Math.abs(e.clientY - stroking.sy);
    if (ay > 22 && ay > ax * 1.5) {
      stroking = null;
      poseDrag = { kind: 'sitdrag', y: e.clientY, t: performance.now() };
      showLabel('Ниже — сесть / лечь, выше — встать');
      return;
    }
  }
  if (stroking) {
    const d = Math.hypot(e.clientX - stroking.lastX, e.clientY - stroking.lastY);
    stroking.moved += d;
    stroking.dist += d;
    if (stroking.moved > 18) {
      while (stroking.dist > 80) {
        stroking.dist -= 80;
        // Не отрывая пальца перешёл на другую зону — гладим уже её.
        const now = zoneAt(e, true);
        if (now && now.zone === 'headpat') {
          petting = { lastX: e.clientX, lastY: e.clientY, dist: 0, ticks: 1 };
          canvas.classList.add('petting');
          stroking = null;
          break;
        }
        if (now && STROKES[now.zone]) stroking.hit = now;
        strokeTick(e);
      }
      if (!stroking) return;
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
    // Ушёл с макушки на другую зону, не отрывая пальца, — дальше гладим её.
    {
      const now = zoneAt(e, true);
      if (now && now.zone !== 'headpat' && STROKES[now.zone]) {
        stroking = { hit: now, lastX: e.clientX, lastY: e.clientY, sx: e.clientX, sy: e.clientY, moved: 99, dist: 0, ticks: 1 };
        petting = null;
        canvas.classList.remove('petting');
        strokeTick(e);
        return;
      }
    }
    petting.ticks++;
    changeAffection(0.4);
    floatHeart(e.clientX, e.clientY);
    if (petting.ticks % 6 === 1 && performance.now() - lastSpokeAt > 2500) {
      say(pick(REACTIONS.headpat.lines[tier()]));
    }
  }
});

// Два быстрых свайпа по ней подряд (на главной): вниз — на одно положение ниже
// (стоя → присела → на коленях → села → легла), вверх — на одно выше.
let flickStart = null;
// Палец в пределах её силуэта на экране (по костям, с запасом) — быстро, без пересчёта сетки.
function nearHerOnScreen(e) {
  if (!character) return false;
  const v = new THREE.Vector3();
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const n of ['head', 'hips', 'leftFoot', 'rightFoot', 'leftHand', 'rightHand', 'leftLowerLeg', 'rightLowerLeg']) {
    const bn = character.bones[n] ?? character.vrm.humanoid.getNormalizedBoneNode(n);
    if (!bn) continue;
    bn.getWorldPosition(v).project(camera);
    const sx = (v.x * 0.5 + 0.5) * window.innerWidth, sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
    x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
  }
  const m = 30;
  return e.clientX > x0 - m && e.clientX < x1 + m && e.clientY > y0 - m * 2 && e.clientY < y1 + m;
}
let lastFlick = null;
const SIT_STEPS = [0, 0.45, 0.8, 1.0, 1.3];
function checkFlick(e) {
  const f = flickStart;
  flickStart = null;
  if (!f || !character || poseMode || cameraMode || touches.size > 1) return;
  const dt = performance.now() - f.t;
  const dy = e.clientY - f.y;
  const dx = e.clientX - f.x;
  if (!f.onHer || dt > (window.__flickMaxDt ?? 450) || Math.abs(dy) < 45 || Math.abs(dx) > Math.abs(dy) * 0.8) return;
  const dir = Math.sign(dy);
  const now = performance.now();
  if (lastFlick && lastFlick.dir === dir && now - lastFlick.t < (window.__flickMaxGap ?? 900)) {
    lastFlick = null;
    const cur = character.sit;
    const max = sitMax();
    let next;
    if (dir > 0) next = SIT_STEPS.find((v) => v > cur + 0.05 && v <= max + 1e-6);
    else next = [...SIT_STEPS].reverse().find((v) => v < cur - 0.05);
    if (next == null) return;
    character.sitRate = 0.9;
    sitBy((next - cur) / 0.004);
    showToast({ 0: '⬆ Встала', 0.45: '⬇ Присела', 0.8: '⬇ На коленях', 1: '⬇ Села', 1.3: '⬇ Легла' }[next] ?? '');
    return;
  }
  lastFlick = { dir, t: now };
}

function endPointer(e) {
  if (e.type === 'pointerup') checkFlick(e);
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
  if (on) { exitFreeCam(); exitManualCam(); }
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
  exitManualCam();
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
$('cam-auto').addEventListener('click', () => setRepeat(!curRep().on));
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
const stick = { x: 0, y: 0, on: false }; // розовый шарик убран (высота — двумя пальцами)
// 🟣 Фиолетовый джойстик свободной камеры — в строке камеры: вверх — лететь вперёд
// (куда смотришь), вниз — назад, вбок — в сторону. Двумя пальцами — как раньше.
const stick2El = document.createElement('div');
stick2El.id = 'cam-stick2';
stick2El.className = 'stick zoom';
stick2El.title = 'Свободная камера: вверх — вперёд, вниз — назад, вбок — в сторону';
stick2El.innerHTML = '<b></b>';
$('cam-controls').prepend(stick2El);
const stick2 = makeStick(stick2El);
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
$('cam-view')?.addEventListener('click', () => {
  viewIdx = (viewIdx + 1) % VIEWS.length;
  setView(VIEWS[viewIdx]);
});

// 📸 Фото: прячем интерфейс, снимаем кадр (фон — тот же, что на экране) и показываем,
// чтобы сохранить долгим нажатием.
let photoPending = false;
$('cam-photo').addEventListener('click', (e) => {
  e.stopPropagation();
  document.body.classList.add('photo');
  // Фон страницы в кадр не попадает (холст прозрачный) — рисуем его в сцену на время снимка.
  const bg = getComputedStyle(document.body).backgroundColor;
  const prev = scene.background;
  const g = document.createElement('canvas');
  g.width = 2; g.height = 256;
  const ctx = g.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  const dark = document.body.classList.contains('dark');
  grad.addColorStop(0, dark ? '#1b1238' : '#f6dcf1');
  grad.addColorStop(1, dark ? '#3b2a6b' : '#d8c4ff');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(g);
  tex.colorSpace = THREE.SRGBColorSpace;
  scene.background = tex;
  setTimeout(() => {
    photoPending = true;
    setTimeout(() => { scene.background = prev; tex.dispose(); }, 200);
  }, 120);
  void bg;
});
$('photo-close').addEventListener('click', () => { $('photo-view').hidden = true; });

// 📍 Свои ракурсы: запомнить текущее положение камеры и возвращаться одним тапом (до 4).
const VIEWS_KEY = 'waifu-cam-views';
let savedViews = [];
try { savedViews = JSON.parse(localStorage.getItem(VIEWS_KEY) || '[]'); } catch { savedViews = []; }
function camState() {
  return freeCam
    ? { free: true, pos: camera.position.toArray(), yaw: freeCam.yaw, pitch: freeCam.pitch }
    : { yaw: camYaw, pitch: camPitch, zoom: camZoom, lift: camLift, pan: camPanH.toArray(), full: fullBody };
}
function applyCamState(v) {
  setFaceCam(false);
  if (v.free) {
    freeCam = { yaw: v.yaw, pitch: v.pitch };
    camera.position.fromArray(v.pos);
    applyFree();
    return;
  }
  exitFreeCam();
  camYaw = v.yaw; camPitch = v.pitch; camLift = v.lift ?? 0; camZoom = v.zoom;
  camPanH.fromArray(v.pan ?? [0, 0, 0]);
  if (v.full !== undefined && v.full !== fullBody) { fullBody = v.full; $('btn-zoom').classList.toggle('off', !fullBody); }
  animateCamera = true;
  frameCamera();
  animateCamera = false;
}
function renderViews() {
  const box = $('cam-views');
  box.innerHTML = '';
  savedViews.forEach((v, i) => {
    const b = document.createElement('button');
    b.className = 'cam-view-chip';
    b.textContent = String(i + 1);
    b.title = 'Тап — ракурс, удержание — удалить';
    let hold = 0;
    b.addEventListener('pointerdown', () => {
      hold = setTimeout(() => {
        hold = -1;
        savedViews.splice(i, 1);
        try { localStorage.setItem(VIEWS_KEY, JSON.stringify(savedViews)); } catch { /* ignore */ }
        renderViews();
        showToast('Ракурс удалён');
      }, 650);
    });
    b.addEventListener('pointerup', () => { if (hold !== -1) { clearTimeout(hold); applyCamState(v); showToast(`📍 Ракурс ${i + 1}`); } });
    b.addEventListener('pointerleave', () => { if (hold > 0) clearTimeout(hold); });
    box.appendChild(b);
  });
}
$('cam-pin').addEventListener('click', () => {
  savedViews.push(camState());
  if (savedViews.length > 3) savedViews.shift();
  try { localStorage.setItem(VIEWS_KEY, JSON.stringify(savedViews)); } catch { /* ignore */ }
  renderViews();
  showToast(`📍 Ракурс ${savedViews.length} запомнен · тап — вернуться, удержать — удалить`);
});
renderViews();

function resetView() {
  exitManualCam();
  exitFreeCam();
  setFaceCam(false);
  camLift = 0;
  camPanH.set(0, 0, 0);
  viewIdx = 0;
  camYaw = 0;
  camPitch = 0.05;
  camZoom = 1;
  animateCamera = true;
  frameCamera();
  animateCamera = false;
}
$('cam-reset').addEventListener('click', resetView);
// «Чистый вид»: весь интерфейс прячется — только она. Вернуть — кнопкой в углу.
{
  const cleanBtn = document.createElement('button');
  cleanBtn.id = 'cam-clean';
  cleanBtn.className = 'icon-btn';
  cleanBtn.title = 'Чистый вид';
  cleanBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/></svg>';
  $('cam-reset').before(cleanBtn);
  const back = document.createElement('button');
  back.id = 'clean-exit';
  back.title = 'Вернуть кнопки';
  back.textContent = '◉';
  document.body.appendChild(back);
  const setClean = (on) => {
    document.body.classList.toggle('clean', on);
    if (on) showToast('Чистый вид — ◉ в углу вернёт кнопки');
  };
  cleanBtn.addEventListener('click', (e) => { e.stopPropagation(); setClean(true); });
  back.addEventListener('pointerdown', (e) => e.stopPropagation());
  back.addEventListener('click', (e) => { e.stopPropagation(); setClean(false); });
}
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
const SLEEP_LINES = ['Ммм… ♥', '*сопит*', 'Хи… приятно… zzz', 'Мур… 😴', '…ещё…'];
const SLEEP_WAKE_LINES = ['Ммм?.. ну что такое… я же сплю 😣', 'Ой… ты меня разбудил…', 'А?.. ты чего тормошишь~', 'Пять минуточек ещё… 😴'];
function triggerReaction(zone, hit, e) {
  const r = REACTIONS[zone];
  if (!r) return;
  // Спит: нежное касание — спит дальше и улыбается во сне; тормошишь
  // (несколько быстрых касаний подряд) — просыпается.
  if (character.sitS > 1.05 && character.sleep > 0.5) {
    character.disturb = (character.disturb ?? 0) + (zone === 'spam' ? 2 : 1);
    if (character.disturb >= 3) {
      character.disturb = 0;
      character.wake(6);
      character.react({ expression: 'relaxed', motion: 'lieTurn', side: hit?.side, strength: 0.8 });
      say(pick(SLEEP_WAKE_LINES));
      return;
    }
    character.sleepJoy = 1;
    changeAffection(0.4);
    floatHeart(e.clientX, e.clientY);
    const now = performance.now();
    if (now - lastZoneLineAt > 2500) { lastZoneLineAt = now; say(pick(SLEEP_LINES)); }
    return;
  }
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

// Зона пока не даёт симпатию: ей «всё равно» — вместо сердечек всплывают 😐 + подсказка, когда понравится.
const ZONE_NAMES = { face: 'Лицо', arm: 'Плечи', belly: 'Живот', legs: 'Ноги', body: 'Грудь', hand: 'Рука', hair: 'Волосы' };
const TIER_NAMES = ['', '«Друг»', '«Близкий человек»'];
let lockHintAt = 0;
function lockedStroke(zone, r, e) {
  if (stroking && stroking.ticks % 2 === 0) floatLock(e.clientX, e.clientY);
  const ti = r.affection.findIndex((v) => v > 0);
  const now = performance.now();
  if (ti > 0 && now - lockHintAt > 20000) {
    lockHintAt = now;
    const what = { face: 'лицо понравится', arm: 'плечи понравятся', belly: 'живот понравится', legs: 'ноги понравятся', body: 'грудь понравится' }[zone] ?? 'это понравится';
    showToast(`😐 Ей пока всё равно — ${what} на уровне ${TIER_NAMES[ti]} 💗`);
  }
}
function floatLock(x, y) {
  const el = document.createElement('div');
  el.className = 'float-heart float-meh';
  el.textContent = Math.random() < 0.7 ? '😐' : '😶';
  el.style.left = `${x + (Math.random() - 0.5) * 24}px`;
  el.style.top = `${y - 10}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1100);
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
  dreamy: 'Ах… о чём это я?~',
  hug: 'Хочу обнимашки…',
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
$('poses-toggle').addEventListener('click', () => {
  $('pose-list').classList.remove('show-std');
  setPoseListOpen($('pose-list').hidden);
});
// Окошко поз: сверху твои избранные ★, ниже «Все позы ▾» — раскрывает стандартные.
const poseMore = document.createElement('button');
poseMore.id = 'pose-more';
poseMore.textContent = 'Все позы ▾';
poseMore.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = $('pose-list').classList.toggle('show-std');
  poseMore.textContent = open ? 'Свернуть ▴' : 'Все позы ▾';
});
$('pose-list').appendChild(poseMore);

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
    snapPose();
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
// ↶ Отмена в режиме позы: снимок до каждого действия (тянешь точку, полосу, выбираешь позу, сброс).
const undoStack = [];
function snapPose() {
  if (!character || !poseMode) return;
  const snap = { name: character.poseName, touch: character.exportTouchPose() };
  const last = undoStack[undoStack.length - 1];
  if (last && JSON.stringify(last) === JSON.stringify(snap)) return;
  undoStack.push(snap);
  if (undoStack.length > 40) undoStack.shift();
}
$('pose-undo').addEventListener('click', () => {
  const snap = undoStack.pop();
  if (!snap || !character) { showToast('Отменять нечего'); return; }
  const sit = character.sit;
  character.setPose(snap.name);
  character.importTouchPose(snap.touch);
  if (snap.touch?.sit == null) character.sit = sit;
  setActivePoseButton(snap.name);
  showToast('↶ Отменено');
});
$('pose-reset').addEventListener('click', () => {
  snapPose();
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
const HANDLE_LABELS = { kneeL: 'Левое колено', kneeR: 'Правое колено', handL: 'Левая рука', handR: 'Правая рука', head: 'Голова', chest: 'Наклон корпуса', belly: 'Поворот корпуса', hips: 'Бёдра: вниз — сесть, вбок — качнуть', footL: 'Левая нога', footR: 'Правая нога' };
// Точки поз: только когда открыты (уровень/реклама) и включены кнопкой ⁘.
// Без точек в режиме позы её гладят и трогают, как на главной, а ведя по ней
// пальцем вверх-вниз — сажают/поднимают. Полосы работают всегда.
let handlesShown = false;
try { handlesShown = localStorage.getItem('waifu-handles-on') === '1'; } catch { /* ignore */ }
let handlesHidden = true; // итог: точки сейчас не активны
function syncHandles() {
  handlesHidden = !(handlesShown && unlocked('handles'));
}
const petInPose = () => { syncHandles(); return handlesHidden || document.body.classList.contains('clean'); };
function renderHandlesBtn() {
  syncHandles();
  $('btn-handles').classList.toggle('active', !handlesHidden);
  $('btn-handles').title = handlesHidden ? 'Показать точки' : 'Спрятать точки';
}
$('btn-handles').addEventListener('click', () => {
  if (!unlocked('handles')) return; // закрыто — покажется замочек
  handlesShown = !handlesShown;
  try { localStorage.setItem('waifu-handles-on', handlesShown ? '1' : '0'); } catch { /* ignore */ }
  renderHandlesBtn();
  showToast(handlesShown ? 'Точки включены — ставь позу (движения точек тоже записываются в повтор)' : 'Точки выключены — гладь и трогай её 💗, веди по ней вверх-вниз — сесть/встать');
});
renderHandlesBtn();
$('btn-handles').hidden = true;
// Точки и повтор: 📌 «Поставить» — точки просто ставят позу и НЕ сбивают повтор
// (он идёт дальше, а рука/нога остаётся, где поставил); 🔁 «Запись» — движение точкой
// записывается в повтор и она его повторяет.
let pointMode = 'pin';
try { if (localStorage.getItem('waifu-point-mode') === 'rec') pointMode = 'rec'; } catch { /* ignore */ }
const pointModeBtn = document.createElement('button');
pointModeBtn.id = 'btn-pointmode';
pointModeBtn.hidden = true;
$('btn-handles').after(pointModeBtn);
function renderPointMode() {
  pointModeBtn.hidden = !poseMode || petInPose();
  pointModeBtn.textContent = pointMode === 'pin' ? '📌' : '🔁';
  pointModeBtn.title = pointMode === 'pin' ? 'Точки: ставить позу' : 'Точки: запись движения в повтор';
  pointModeBtn.classList.toggle('rec', pointMode === 'rec');
  pointModeBtn.classList.toggle('recording', pointMode === 'rec' && curRep().on && !!curRep().ptsRec);
}
pointModeBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
pointModeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  pointMode = pointMode === 'pin' ? 'rec' : 'pin';
  try { localStorage.setItem('waifu-point-mode', pointMode); } catch { /* ignore */ }
  // Обратно в 📌: точки из повтора останавливаются там, где сейчас (их можно ставить руками).
  if (pointMode === 'pin') for (const r of Object.values(reps)) { r.movedPts = {}; r.ptsTrack = null; r.ptsRec = null; }
  renderPointMode();
  showToast(pointMode === 'pin' ? '📌 Точки: ставить позу (повтор не сбивается)' : '🔁 Точки: запись движения — подвигай точку и отпусти');
});
// Точку взяли в режиме 📌: повтор больше не управляет этой рукой/ногой.
function pinLimb(kind, side) {
  const key = (kind === 'hand' ? 'h' : 'f') + (side === 'left' ? 'L' : 'R');
  for (const r of Object.values(reps)) {
    if (r.movedPts) r.movedPts[key] = false;
    if (r.ptsTrack) r.ptsTrack.moved[key] = false;
  }
}
const repPlaying = () => { const r = curRep(); return r.on && r.state === 'play'; };
$('btn-home').classList.add('active');
function updateHandles() {
  const show = poseMode && !!character && !petInPose();
  renderPointMode();
  if ($('btn-handles').classList.contains('active') === handlesHidden) renderHandlesBtn();
  $('handles').hidden = !show;
  // Пока крутишь камеру — точки бледнеют и не мешают.
  $('handles').classList.toggle('calm', poseDrag?.kind === 'bg' || performance.now() - lastCamMove < 450);
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
if (!unlocked('lieStyles') && lieMode !== 'side') lieMode = 'side'; // пока не открыто — только на бок
let allowLie = lieMode !== 'off';
const sitMax = () => (!unlocked('floor') ? 0.8 : allowLie ? 1.3 : 1.0);
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
  renderSitMarks();
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
  snapPose();
  e.preventDefault();
  e.stopPropagation();
  sitSlider.setPointerCapture(e.pointerId);
  sliderDrag = { y: e.clientY, t: performance.now() };
  sliderTakesOver();
  sitSlider.classList.add('active');
});
sitSlider.addEventListener('pointermove', (e) => {
  if (!sliderDrag || !character) return;
  character.effortT = 0.35; // губы приоткрываются, пока ведёшь
  const h = sitSlider.querySelector('.track').getBoundingClientRect().height || 200;
  const dv = ((e.clientY - sliderDrag.y) / h) * sitMax();
  const now = performance.now();
  // Скорость пальца → скорость движения: быстро ведёшь — быстрее, медленно — плавно.
  const rate = Math.abs(dv) / Math.max(0.008, (now - sliderDrag.t) / 1000);
  character.sitRate = Math.max(character.sitRate * 0.8, Math.min(rate, 3));
  sliderDrag.y = e.clientY;
  sliderDrag.t = now;
  character.slideHold = 3;
  character.dragBoostT = 0.5; // палец на полосе — тело отзывается в его темпе
  sliderTakesOver();
  // Повтор идёт — полоса не перезаписывает его, а сдвигает: глубже/выше, не останавливая.
  if (loopNoteMove() === 'shift') {
    const r = curRep();
    repRanges(r);
    if (poseMode) {
      // Сдвиг не выводит движение за края — иначе оно «упирается» и залипает.
      r.bendOff = THREE.MathUtils.clamp((r.bendOff ?? 0) + (dv / sitMax()) * BEND_RANGE, BEND_MIN - r.bendLo, BEND_MAX - r.bendHi);
      showLabel(dv > 0 ? 'Повтор: наклон глубже' : 'Повтор: наклон выше');
    } else {
      r.sitOff = THREE.MathUtils.clamp((r.sitOff ?? 0) + dv, -r.sitLo, Math.max(-r.sitLo, sitMax() - r.sitHi));
      showLabel(dv > 0 ? 'Повтор: ниже' : 'Повтор: выше');
    }
    return;
  }
  if (poseMode) {
    // В режиме позы левая полоса не сажает: ноги стоят, тело с бёдрами идёт вперёд
    // (наклон, таз назад) или назад (прогиб) — плавно, в темпе пальца.
    const o = character.bodyOffset;
    const bend = THREE.MathUtils.clamp(o.hipsRotX + (dv / sitMax()) * BEND_RANGE, BEND_MIN, BEND_MAX);
    o.hipsRotX = bend;
    // Назад гнётся в основном спина (S-линия), голова следует за ней.
    o.spineX = bendSpine(bend);
    showLabel(bend > 0.05 ? 'Наклон вперёд' : bend < -0.05 ? 'Прогиб назад' : 'Прямо');
    return;
  }
  sitBy(dv / 0.004);
});
for (const ev of ['pointerup', 'pointercancel']) {
  sitSlider.addEventListener(ev, () => { sliderDrag = null; sitSlider.classList.remove('active'); });
}
// Палец отпустили где угодно (в т.ч. за краем полосы) — полоса не «залипает».
for (const ev of ['pointerup', 'pointercancel']) {
  window.addEventListener(ev, () => {
    if (sliderDrag) { sliderDrag = null; sitSlider.classList.remove('active'); }
    if (typeof slider2Drag !== 'undefined' && slider2Drag) { slider2Drag = null; $('sit-slider2')?.classList.remove('active'); }
  });
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
  sliderTakesOver();
  sitSlider2.classList.add('active');
});
sitSlider2.addEventListener('pointermove', (e) => {
  if (!slider2Drag || !character) return;
  character.effortT = 0.35;
  const h = sitSlider2.querySelector('.track').getBoundingClientRect().height || 200;
  const dv = ((e.clientY - slider2Drag.y) / h) * sitMax();
  const now = performance.now();
  const rate = Math.abs(dv) / Math.max(0.008, (now - slider2Drag.t) / 1000);
  character.sitRate = Math.max(character.sitRate * 0.8, Math.min(rate, 3));
  slider2Drag.y = e.clientY;
  slider2Drag.t = now;
  character.slideHold = 3;
  character.dragBoostT = 0.5;
  sliderTakesOver();
  loopNoteMove('sit');
  sitBy(dv / 0.004);
});
for (const ev of ['pointerup', 'pointercancel']) {
  sitSlider2.addEventListener(ev, () => { slider2Drag = null; sitSlider2.classList.remove('active'); });
}

// Наклон в режиме позы: от прогиба назад (верх полосы) до глубокого наклона (низ).
const BEND_MIN = -0.8; // прогиб назад — побольше
const BEND_MAX = 1.9; // наклон вперёд поглубже
const BEND_RANGE = BEND_MAX - BEND_MIN;
// Сколько изгиба берёт спина: вперёд — мягкая дуга, назад — глубокий прогиб (S-линия).
function bendSpine(b) { return b >= 0 ? b * 0.55 : b * 1.25; }
// Точки-отметки: стоит, присед, на коленях, боком, лёжа — только те, что в пределах полосы
// (пока «сесть на пол» не открыто, полоса короче — нижние отметки прячем).
var sitMarksFor = null; // var: renderLieToggle() вызывается при запуске раньше этой строки
function renderSitMarks() {
  const max = sitMax();
  if (sitMarksFor === max) return;
  sitMarksFor = max;
  const marks = [0, 0.5, 0.8, 1.0, 1.3];
  for (const sl of [sitSlider, $('sit-slider2')]) {
    sl?.querySelectorAll('.track i').forEach((el, i) => {
      const m = marks[i];
      el.style.display = m == null || m > max + 1e-6 ? 'none' : '';
      if (m != null) el.style.top = `${(m / max) * 100}%`;
    });
  }
}
function updateSitSlider() {
  if (!character) return;
  renderSitMarks();
  // В режиме позы стоя — наклон; если она сидит/лежит — полоса поднимает/опускает её.
  const bendMode = poseMode;
  sitSlider2.style.setProperty('--k', THREE.MathUtils.clamp(character.sitS / sitMax(), 0, 1).toFixed(3));
  sitSlider.classList.toggle('pose-mode', poseMode);
  sitSlider.classList.toggle('bend', bendMode);
  const k = bendMode
    ? (character.bodyOffset.hipsRotX - BEND_MIN) / BEND_RANGE
    : (sliderDrag ? character.sit : character.sitS) / sitMax(); // пока ведёшь — кружок под пальцем
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
function nearestHandle(e, radius = 40) {
  let best = null;
  // Только что крутили камеру — точки не хватаем (чтобы не зацепить случайно); радиус поменьше.
  if (performance.now() - lastCamMove < 450) return null;
  let bestD = radius;
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
  snapPose();
  const camBusy = performance.now() - lastCamMove < 450;
  // Точку берём, только если палец прямо на ней (≈ размер кружка); иначе ведёшь по ней —
  // работает как правая полоса.
  const handleHit = camBusy ? null : nearestHandle(e, 24);
  const hit = camBusy ? null : (handleHit ?? zoneAt(e, true));
  // Водишь по ней (мимо точек) вверх-вниз — как правая полоса: сесть/лечь/встать.
  if (hit && !handleHit && !['hand', 'arm', 'knee'].includes(hit.zone)) {
    poseDrag = { kind: 'sitdrag', y: e.clientY, t: performance.now() };
    activeHandle = null;
    showLabel('Ниже — сесть / лечь, выше — встать');
    return;
  }
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
    poseDrag = { kind: 'knee', side, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, kneePos), shin: footPos.clone().sub(kneePos),
      kneeStart: kneePos.clone(), footStart: footPos.clone() };
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
  if (poseDrag.kind === 'sitdrag') {
    character.effortT = 0.35;
    const h = sitSlider2.querySelector('.track').getBoundingClientRect().height || window.innerHeight * 0.5;
    const dv = ((e.clientY - poseDrag.y) / h) * sitMax();
    const now = performance.now();
    const rate = Math.abs(dv) / Math.max(0.008, (now - poseDrag.t) / 1000);
    character.sitRate = Math.max(character.sitRate * 0.8, Math.min(rate, 3));
    poseDrag.y = e.clientY;
    poseDrag.t = now;
    character.slideHold = 3;
    character.dragBoostT = 0.5;
    loopNoteMove('sit');
    sitBy(dv / 0.004);
    return;
  }
  if (poseDrag.kind === 'hand' || poseDrag.kind === 'foot' || poseDrag.kind === 'knee') {
    if (pointMode === 'rec') ptsNoteMove(); // 🔁 движение точек — отдельный слой повтора
    else pinLimb(poseDrag.kind, poseDrag.side); // 📌 повтор идёт дальше, точка — где поставил
    toNdc(e);
    raycaster.setFromCamera(pointer, camera);
    if (raycaster.ray.intersectPlane(poseDrag.plane, dragPoint)) {
      if (poseDrag.kind === 'knee' && character.sitS > 0.3) {
        // На полу колено ведёт всю ногу: стопа сдвигается вместе с коленом.
        character.setFootTarget(poseDrag.side, poseDrag.footStart.clone().add(dragPoint.clone().sub(poseDrag.kneeStart)));
      } else if (poseDrag.kind === 'knee') {
        // Голень свисает почти вертикально под коленом (чуть назад).
        const len = poseDrag.shin.length();
        character.setFootTarget(poseDrag.side, dragPoint.clone().add(new THREE.Vector3(0, -len * 0.97, -0.05 * character.scale)));
      } else if (poseDrag.kind === 'hand') {
        const near = nearestAnchor(e, poseDrag.side);
        if (near && snapAnchor?.a !== near.a) showLabel(`${HANDLE_LABELS[activeHandle] ?? 'Рука'} ${near.a.label}`);
        snapAnchor = near;
        if (near?.a.preset) character.setArmPreset(poseDrag.side, near.a.preset);
        else {
          character.setHandTarget(poseDrag.side, near ? near.p : dragPoint);
          // Магнит на теле — рука держится за эту часть тела и едет вместе с ней.
          if (near) character.setHandAnchor(poseDrag.side, near.a);
        }
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
    if (!repPlaying()) { // наклон ведёт повтор — не спорим с ним
      o.hipsRotX = clamp(o.hipsRotX + dy * 0.0035, -0.2, 1.0);
      o.spineX = clamp(o.spineX + dy * 0.002, -0.5, 0.6);
    }
    o.spineZ = clamp(o.spineZ - dx * 0.004 * facing, -0.5, 0.5);
  } else if (poseDrag.kind === 'twist') {
    // Живот: вбок — поворот корпуса, вверх/вниз — наклон.
    const o = character.bodyOffset;
    o.spineY = clamp(o.spineY + dx * 0.005 * facing, -0.8, 0.8);
    if (!repPlaying()) o.spineX = clamp(o.spineX + dy * 0.004, -0.5, 1.1);
  } else {
    // Таз: тянешь вниз — опускается (присед → на колени → сидит → лежит), вверх — встаёт;
    // вбок — бёдра в сторону (стоя), с противовесом плеч и головы.
    const o = character.bodyOffset;
    const S = character.scale;
    // Только вбок (бёдра в сторону) — вертикаль не трогаем, чтобы она не приседала случайно.
    // На полу таз двигается свободнее: вбок шире, и вверх-вниз (приподнять/опустить бёдра).
    const floor = character.sitS > 0.3;
    if (character.hipsSetSit == null || Math.abs(character.hipsSetSit - character.sitS) > 0.05) {
      // Новое положение — прошлые сдвиги таза (от другого положения) не тащим.
      o.hipsX = 0; o.hipsZ = 0; o.hipsY = 0;
    }
    character.hipsSetSit = character.sitS;
    const lim = floor ? 0.16 : 0.08;
    o.hipsX = clamp(o.hipsX + dx * 0.0006 * facing * S, -lim * S, lim * S);
    o.hipsZ = clamp(o.hipsX / S * 1.6, -0.14, 0.14);
    // Вверх-вниз за точку бёдер — как правая полоса: сесть / лечь / встать.
    // В 📌 при играющем повторе присед ведёт повтор — точкой бёдер только вбок.
    {
      const dyPx = dy;
      const h = sitSlider2.querySelector('.track').getBoundingClientRect().height || window.innerHeight * 0.5;
      const dv = (dyPx / h) * sitMax();
      const now = performance.now();
      const rate = Math.abs(dv) / Math.max(0.008, (now - (poseDrag.t ?? now - 16)) / 1000);
      poseDrag.t = now;
      character.sitRate = Math.max(character.sitRate * 0.8, Math.min(rate, 3));
      character.slideHold = 3;
      character.dragBoostT = 0.5;
      if (pointMode === 'rec') loopNoteMove('sit');
      sitBy(dv / 0.004);
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
    if (document.querySelector('.panel:not(.hidden)') || (!$('pose-list').hidden && !poseMode) || poseDrag || $('pose-save-form').hidden === false || !$('love-menu').hidden) { wakeUi(); return; }
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
  // Общая перекраска одежды убрана — цвет теперь у каждой вещи свой (повторный тап в шкафу).
  const def = CLOTH_COLORS[0];
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

// ---------- Одежда по частям ----------
// Источники — та же девушка в других нарядах (.vrm из VRoid). В артефакте список задаёт страница
// (window.WAIFU_OUTFITS), модели лежат только там. cats — какие вещи есть; dress — верх это платье.
const PIECE_SOURCES = window.WAIFU_OUTFITS ?? [];
const pieceWardrobe = new PieceWardrobe(scene);
window.__pw = pieceWardrobe; // для отладки
const WEAR_KEY = 'waifu-wear';
let wear = {};
try { wear = JSON.parse(localStorage.getItem(WEAR_KEY) || '{}'); } catch { wear = {}; }
const pieceLoading = new Map();
function loadPieceSource(id) {
  if (pieceWardrobe.hasSource(id)) return Promise.resolve();
  if (pieceLoading.has(id)) return pieceLoading.get(id);
  const def = PIECE_SOURCES.find((x) => x.id === id);
  if (!def) return Promise.reject(new Error('нет такого наряда'));
  const pr = parseModel({ url: def.url }).then((gltf) => {
    const vrm = gltf.userData.vrm;
    if (!vrm) throw new Error('Это не VRM');
    pieceWardrobe.addSource(id, vrm);
  }).finally(() => pieceLoading.delete(id));
  pieceLoading.set(id, pr);
  return pr;
}
function applyWear() {
  if (!character) return;
  // Без загруженного источника — показываем своё, пока грузится.
  const w = {};
  for (const c of PIECE_CATS) {
    const v = wear[c.id] ?? 'base';
    w[c.id] = v === 'base' || v === 'none' || pieceWardrobe.hasSource(v) ? v : 'base';
  }
  // Чулки/колготки «чёрные» — ноги темнее, полупрозрачно.
  const lt = TINTS[wearTint[`legs:${w.legs}`] ?? 0];
  if (lt?.name === 'Глубокий чёрный') w.legsDark = 0.8;
  else if (lt?.hex != null) w.legsTint = lt.hex;
  pieceWardrobe.apply(w, (map) => {
    stockings?.setBase(map);
    stockings?.apply(look.stockings);
  });
  // Цвет каждой надетой вещи.
  for (const c of PIECE_CATS) {
    if (c.skin) continue;
    const t = TINTS[wearTint[`${c.id}:${w[c.id]}`] ?? 0];
    pieceWardrobe.tint(c.id, w[c.id], t.hex);
  }
}
function preloadWornSources() {
  const ids = new Set(Object.values(wear).filter((v) => v !== 'base' && v !== 'none'));
  for (const id of ids) loadPieceSource(id).then(applyWear).catch(() => {});
}
// Цвета вещей: тап по уже надетой вещи — следующий цвет.
const TINTS = [
  { name: 'Оригинал', hex: null },
  { name: 'Чёрный', hex: 0x2b2530 },
  { name: 'Бордо', hex: 0x7a2238 },
  { name: 'Алый', hex: 0xc8283c },
  { name: 'Роза', hex: 0xf2a7c3 },
  { name: 'Фиалка', hex: 0x6b45a0 },
  { name: 'Небо', hex: 0x8fc4ee },
  { name: 'Мята', hex: 0x9fdcc4 },
  { name: 'Глубокий чёрный', hex: 0x0b090d },
  { name: 'Лаванда', hex: 0xc9b3f5 },
  { name: 'Персик', hex: 0xffc2a8 },
  { name: 'Изумруд', hex: 0x2f9e7a },
  { name: 'Шоколад', hex: 0x6b4434 },
];
const TINT_KEY = 'waifu-wear-tint';
let wearTint = {};
try { wearTint = JSON.parse(localStorage.getItem(TINT_KEY) || '{}'); } catch { wearTint = {}; }
function cycleTint(cat, id) {
  const key = `${cat}:${id}`;
  wearTint[key] = ((wearTint[key] ?? 0) + 1) % TINTS.length;
  try { localStorage.setItem(TINT_KEY, JSON.stringify(wearTint)); } catch { /* ignore */ }
  applyWear();
  renderPieces();
  showToast(`🎨 ${TINTS[wearTint[key]].name}`);
}
const isDress = (id) => !!PIECE_SOURCES.find((x) => x.id === id)?.dress;
async function pickPiece(cat, id, quiet = false) {
  if (cat === 'tops') {
    // Платье — низ не нужен; обычный верх — вернуть низ, если его не было.
    if (isDress(id)) wear.bottoms = 'none';
    else if (wear.bottoms === 'none' || wear.bottoms === undefined && isDress(wear.tops)) wear.bottoms = 'base';
  }
  if (cat === 'bottoms' && id !== 'none' && isDress(wear.tops)) wear.tops = 'base';
  wear[cat] = id;
  try { localStorage.setItem(WEAR_KEY, JSON.stringify(wear)); } catch { /* ignore */ }
  renderPieces();
  if (id !== 'base' && id !== 'none' && !pieceWardrobe.hasSource(id)) {
    showToast('Загружаю вещь… (первый раз — пару секунд)');
    $('flash').classList.add('on');
    try { await loadPieceSource(id); } catch (e) { console.error(e); say('Не получилось загрузить вещь…', 'sad'); }
    $('flash').classList.remove('on');
  }
  applyWear();
  if (quiet) return;
  character?.react({ expression: 'happy', motion: 'sway' });
  if (cat === 'legs' && legwear() !== 'tights') say(pick(LEGS_LINES[legwear()]));
  else if (cat === 'legs') say(pick(['Колготки — классика~', 'Так уютнее ♥', 'Нравятся мои колготки?']));
  else if (Math.random() < 0.6) say(pick(['Мне идёт? ♥', 'Хи, примерим~', 'Так лучше?', 'Нравится?']));
}
// Гардероб-шкаф: вкладки по частям (верх, низ, обувь, аксессуары, ноги) и карточки вещей с названиями.
const PIECE_ICONS = { tops: '👚', bottoms: '🩳', shoes: '👠', acc: '🎀', legs: '🧦' };
const BASE_NAMES = window.WAIFU_BASE_NAMES ?? {};
let closetTab = 'tops';
function pieceName(srcId, cat) {
  if (srcId === 'none') return { shoes: 'Босиком', acc: 'Без аксессуара', bottoms: 'Без низа (платье)' }[cat] ?? 'Без';
  if (srcId === 'base') return BASE_NAMES[cat] ?? (cat === 'legs' ? 'Свои' : 'Своё');
  const src = PIECE_SOURCES.find((x) => x.id === srcId);
  return src?.names?.[cat] ?? src?.name ?? srcId;
}
// ---------- Иногда сама предлагает переодеться ----------
// Раз в 5–9 минут (когда ты её не трогаешь и шкаф закрыт) предлагает надеть
// какую-нибудь вещь. «Надень» — надевает, «Не сейчас» — отложит надолго.
const SUGGEST_LINES = [
  (n) => `Слушай… может, надену «${n}»? ♥`,
  (n) => `Хочу примерить «${n}». Можно?~`,
  (n) => `Мне кажется, «${n}» мне пойдёт… Надеть?`,
  (n) => `Скучно в одном и том же… «${n}»?`,
];
let suggestTimer = 300 + Math.random() * 240;
let suggestion = null;
window.__suggestNow = () => { suggestTimer = 0; };
// ---------- Сама переодевается (иногда): одну вещь или целый наряд ----------
let selfDressTimer = 600 + Math.random() * 480;
let selfDressing = false;
const SELF_DRESS_LINES = {
  legs: ['Решила сменить чулочки~ Как тебе?', 'Новые на ножках ♥ Заметил?', 'Захотелось других чулок~'],
  shoes: ['Переобулась~ Идёт?', 'Новые туфельки ♥ Нравятся?', 'Захотелось сменить обувь~'],
  tops: ['Сменила верх~ Как тебе?', 'Решила примерить другое ♥', 'Так мне больше нравится~ А тебе?'],
  bottoms: ['Сменила юбочку~ Нравится?', 'Решила переодеться ♥', 'Как тебе так?'],
  acc: ['Добавила украшение~', 'Маленькая деталь ♥ Заметил?'],
  outfit: ['Я решила сменить наряд~ Специально для тебя ♥', 'Переоделась для тебя~ Как тебе?', 'Новый образ! Нравится? ♥', 'Хи, сюрприз — новый прикид~'],
  base: ['Вернула свой любимый образ~', 'Снова в своём ♥ Скучал по нему?'],
};
async function updateSelfDress(dt) {
  if (!character || !PIECE_SOURCES.length || selfDressing || suggestion) return;
  if (!unlocked('wardrobe') || pointerActive || poseMode || character.sleep > 0.3 || !$('wardrobe').classList.contains('hidden')) return;
  selfDressTimer -= dt;
  if (selfDressTimer > 0) return;
  selfDressTimer = 600 + Math.random() * 480; // раз в 10–18 минут
  suggestTimer = Math.max(suggestTimer, 180); // не вместе с предложением
  selfDressing = true;
  try {
    const r = Math.random();
    let kind;
    if (r < 0.85) {
      // Одна вещь (чаще всего).
      const opts = [];
      for (const c of PIECE_CATS) {
        for (const src of PIECE_SOURCES) if (src.cats.includes(c.id) && (wear[c.id] ?? 'base') !== src.id) opts.push({ cat: c.id, id: src.id });
        if ((wear[c.id] ?? 'base') !== 'base' && c.id !== 'acc') opts.push({ cat: c.id, id: 'base' });
      }
      if (!opts.length) return;
      const o = opts[Math.floor(Math.random() * opts.length)];
      kind = o.cat;
      await pickPiece(o.cat, o.id, true);
    } else if (r < 0.95) {
      // Целый наряд (редко) из одного комплекта.
      const src = PIECE_SOURCES[Math.floor(Math.random() * PIECE_SOURCES.length)];
      kind = 'outfit';
      for (const c of PIECE_CATS) {
        if (src.cats.includes(c.id)) await pickPiece(c.id, src.id, true);
        else if (c.id === 'acc') await pickPiece('acc', 'none', true);
      }
    } else {
      // Обратно в свой базовый образ.
      kind = 'base';
      for (const c of PIECE_CATS) await pickPiece(c.id, 'base', true);
    }
    character.react({ expression: 'happy', motion: 'sway' });
    say(pick(SELF_DRESS_LINES[kind] ?? SELF_DRESS_LINES.outfit), 'happy');
  } finally {
    selfDressing = false;
  }
}
window.__selfDressNow = () => { selfDressTimer = 0; };
function updateSuggest(dt) {
  if (!character || !PIECE_SOURCES.length) return;
  if (suggestion) return;
  if (pointerActive || poseMode || character.sleep > 0.3 || !$('wardrobe').classList.contains('hidden')) return;
  suggestTimer -= dt;
  if (suggestTimer > 0) return;
  suggestTimer = 300 + Math.random() * 240;
  // Случайная вещь, которая сейчас не надета.
  const opts = [];
  for (const c of PIECE_CATS) {
    if (c.id === 'acc') continue;
    for (const src of PIECE_SOURCES) if (src.cats.includes(c.id) && (wear[c.id] ?? 'base') !== src.id) opts.push({ cat: c.id, id: src.id });
  }
  if (!opts.length) return;
  const o = opts[Math.floor(Math.random() * opts.length)];
  const name = pieceName(o.id, o.cat);
  suggestion = o;
  say(pick(SUGGEST_LINES)(name), 'happy');
  $('suggest').hidden = false;
  setTimeout(() => { if (suggestion === o) closeSuggest(); }, 15000);
}
function closeSuggest() {
  suggestion = null;
  $('suggest').hidden = true;
}
$('suggest-yes').addEventListener('click', (e) => {
  e.stopPropagation();
  const o = suggestion;
  closeSuggest();
  if (o) pickPiece(o.cat, o.id);
});
$('suggest-no').addEventListener('click', (e) => {
  e.stopPropagation();
  closeSuggest();
  suggestTimer = 600 + Math.random() * 300;
  say(pick(['Ладно, в другой раз~', 'Хорошо-хорошо…', 'Эх, ну ладно ♥']));
});

function renderPieces() {
  const box = $('piece-list');
  if (!box) return;
  box.innerHTML = '';
  if (!PIECE_SOURCES.length) { box.innerHTML = '<p class="panel-note">Пришли наряды (.vrm из VRoid) — вещи появятся здесь.</p>'; return; }
  const tabs = document.createElement('div');
  tabs.className = 'closet-tabs';
  for (const c of PIECE_CATS) {
    const t = document.createElement('button');
    t.className = 'closet-tab' + (c.id === closetTab ? ' active' : '');
    t.innerHTML = `<span>${PIECE_ICONS[c.id]}</span>${c.name}`;
    t.addEventListener('click', () => { closetTab = c.id; renderPieces(); });
    tabs.appendChild(t);
  }
  box.appendChild(tabs);
  const c = PIECE_CATS.find((x) => x.id === closetTab);
  const opts = ['base'];
  for (const src of PIECE_SOURCES) if (src.cats.includes(c.id)) opts.push(src.id);
  if (c.id === 'shoes' || c.id === 'acc') opts.push('none');
  if (c.id === 'bottoms' && isDress(wear.tops)) opts.push('none');
  const grid = document.createElement('div');
  grid.className = 'closet-grid';
  const cur = wear[c.id] ?? 'base';
  for (const id of opts) {
    const b = document.createElement('button');
    b.className = 'closet-item' + (id === cur ? ' active' : '');
    b.innerHTML = `<span class="ci-icon">${id === 'none' ? '✕' : PIECE_ICONS[c.id]}</span><span class="ci-name">${pieceName(id, c.id)}</span>`;
    const tint = TINTS[wearTint[`${c.id}:${id}`] ?? 0];
    if (id !== 'none') {
      const dot = document.createElement('span');
      dot.className = 'ci-tint';
      dot.style.background = tint.hex == null ? 'conic-gradient(#f2a7c3, #8fc4ee, #9fdcc4, #c8283c, #f2a7c3)' : `#${tint.hex.toString(16).padStart(6, '0')}`;
      b.appendChild(dot);
    }
    // Тап по надетой вещи — сменить её цвет.
    b.addEventListener('click', () => (id === cur && id !== 'none' ? cycleTint(c.id, id) : pickPiece(c.id, id)));
    grid.appendChild(b);
  }
  box.appendChild(grid);
  {
    const hint = document.createElement('p');
    hint.className = 'panel-note';
    hint.textContent = 'Тапни надетую вещь ещё раз — сменится цвет 🎨';
    box.appendChild(hint);
  }
}

function applyLook() {
  if (!character) return;
  look.stockings = 'off'; // старые нарисованные чулки убраны — чулки берутся из нарядов
  applyClothColor();
  tintMaterials(/HAIR/i, HAIR_COLORS.find((c) => c.id === look.hair)?.color ?? null, 0.6);
  stockings?.apply(look.stockings);
  const bg = look.bg ?? 'stars';
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
  const cur = look.bg ?? 'stars';
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
  renderPieces();
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

  renderBackgrounds();
}


$('goth-preset').addEventListener('click', async () => {
  // Готик-образ: чёрный свитер-кроп, тёмная юбка с сакурой, чёрные колготки, чёрные платформы.
  const src = PIECE_SOURCES.find((s) => s.id === 'o5' && s.cats.includes('bottoms'));
  const deep = TINTS.findIndex((t) => t.name === 'Глубокий чёрный');
  wearTint['bottoms:o5'] = deep;
  wearTint['tops:base'] = deep;
  wearTint['acc:base'] = deep;
  wearTint['legs:base'] = deep; // колготки — полупрозрачные чёрные
  try { localStorage.setItem(TINT_KEY, JSON.stringify(wearTint)); } catch { /* ignore */ }
  await pickPiece('tops', 'base', true);
  await pickPiece('bottoms', src ? 'o5' : 'base', true);
  await pickPiece('shoes', 'base', true);
  await pickPiece('legs', 'base', true);
  await pickPiece('acc', 'base', true);
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

// Шкаф: камера отъезжает — она видна целиком над панелью, сразу видно, что надето.
// Закрыл шкаф — камера возвращается как была.
let wardrobeCam = null;
function wardrobeView() {
  wardrobeCam = camState();
  exitManualCam();
  exitFreeCam();
  setFaceCam(false);
  camPanH.set(0, 0, 0);
  camYaw = 0;
  camPitch = 0.08;
  camZoom = 2.9;
  camLift = -1.2 * camBase.S;
  animateCamera = true;
  frameCamera();
  animateCamera = false;
}
function updateWardrobeCam() {
  if (wardrobeCam && $('wardrobe').classList.contains('hidden')) {
    const v = wardrobeCam;
    wardrobeCam = null;
    applyCamState(v);
  }
}
$('btn-wardrobe').addEventListener('click', () => {
  const opening = $('wardrobe').classList.contains('hidden');
  if (opening) interstitial();
  togglePanel('wardrobe', renderWardrobe);
  if (opening && !$('wardrobe').classList.contains('hidden')) wardrobeView();
});
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
let gazeSwitchAt = 0;
$('btn-gaze').addEventListener('click', () => {
  gazeSwitchAt = performance.now();
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
// ---------- Настроение по времени суток и «скучала» ----------
const VISIT_KEY = 'waifu-last-visit';
function greetOnLoad() {
  let last = 0;
  try { last = Number(localStorage.getItem(VISIT_KEY)) || 0; localStorage.setItem(VISIT_KEY, String(Date.now())); } catch { /* ignore */ }
  const away = last ? (Date.now() - last) / 3600000 : 0;
  const h = new Date().getHours();
  let line;
  if (away > 24) line = pick(['Я так скучала… где ты был? 🥺', 'Наконец-то! Я ждала тебя ♥', 'Долго тебя не было…']);
  else if (h >= 5 && h < 11) { line = pick(['Доброе утро~ *зевает*', 'Ммм… утро уже? Привет ♥', 'Утречко~']); character.playMotion('archStretch'); }
  else if (h >= 22 || h < 5) { line = pick(['Уже поздно… а ты всё со мной? ♥', 'Не спится? Мне тоже~', 'Ночь… так тихо~']); character.sleepy = 1; }
  else if (h >= 17) line = pick(['Добрый вечер~', 'Как прошёл день?', 'Вечер — моё любимое время ♥']);
  else line = pick(['Привет! ♥', 'Ты пришёл~', 'О, привет!']);
  setTimeout(() => say(line, 'happy'), 1200);
}

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
  if (!(t1 > t0)) { for (const v of AUTO_VALS) out[v] = b[v] ?? 0; return out; }
  // Сплайн через ключи (Catmull-Rom): движение течёт, не замирая в каждой точке;
  // в начале и в конце — мягкий старт и остановка.
  const u = THREE.MathUtils.clamp((t - t0) / (t1 - t0), 0, 1);
  const h00 = 2 * u ** 3 - 3 * u * u + 1, h10 = u ** 3 - 2 * u * u + u, h01 = -2 * u ** 3 + 3 * u * u, h11 = u ** 3 - u * u;
  const prev = keys[i - 1];
  const next = keys[i + 2];
  for (const v of AUTO_VALS) {
    const p0 = a[v] ?? 0, p1 = b[v] ?? 0;
    const m0 = prev ? ((p1 - (prev[1][v] ?? 0)) / (t1 - prev[0])) * (t1 - t0) : 0;
    const m1 = next ? (((next[1][v] ?? 0) - p0) / (next[0] - t0)) * (t1 - t0) : 0;
    out[v] = h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1;
    // Посадка — без «перелёта» (иначе на коленях она чуть начинала садиться на пол).
    if (v === 'sit') out[v] = THREE.MathUtils.clamp(out[v], Math.min(p0, p1), Math.max(p0, p1));
  }
  return out;
}
function applyAuto(v) {
  const o = character.bodyOffset;
  const S = character.scale;
  o.hipsRotX = v.bend;
  o.spineX = bendSpine(v.bend);
  o.hipsX = v.sway * 0.08 * S;
  o.hipsZ = THREE.MathUtils.clamp(o.hipsX / S * 1.6, -0.14, 0.14);
  o.spineZ = -v.sway * 0.16;
  character.sit = v.sit;
  character.sitRate = 0.5;
}
// Плавно вернуться из текущего положения (касание или переход во вкладку «Позы»).
function stopAuto(instant = false) {
  if (!auto || !character) return;
  if (auto.pose) {
    // Позу, которую она приняла сама, не сбиваем касанием — дослушает и вернётся сама.
    if (instant && character.poseName === auto.pose) character.setPose('stand');
    if (instant) auto = null;
    return;
  }
  if (instant) { applyAuto({ bend: 0, sway: 0, sit: 0 }); auto = null; return; }
  const cur = auto.last ?? { bend: 0, sway: 0, sit: 0 };
  auto = { keys: [[0, cur], [1.2, { sit: cur.sit }]], t: 0, returning: true };
}
// Палец на полосе — её собственное движение плавно останавливается и не мешает
// (иначе оно каждый кадр перезаписывает посадку и полоса «залипает»). Посадку не сбрасываем.
function sliderTakesOver() {
  autoIdle = 0;
  if (auto && !auto.pose && !auto.returning) stopAuto();
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
      o.spineX = bendSpine(auto.last.bend);
      o.hipsX = auto.last.sway * 0.06 * S;
      o.hipsZ = THREE.MathUtils.clamp(o.hipsX / S * 1.6, -0.14, 0.14);
      o.spineZ = -auto.last.sway * 0.12;
    } else applyAuto(auto.last);
    if (auto.t >= end) {
      if (auto.pose && character.poseName === auto.pose) character.setPose('stand');
      auto = null;
      autoCooldown = 6 + Math.random() * 7;
    }
    return;
  }
  autoCooldown -= dt;
  const calm = autoMoves && !poseMode && autoIdle > 5 && !sliderDrag && !slider2Drag && autoCooldown <= 0 && !reps.home.on
    && character.sit < 0.02 && character.sitS < 0.02 && !character.mixer && !character.dancing
    && !(currentMocap && !MOCAP.find((m) => m.id === currentMocap)?.idle)
    && Math.abs(character.bodyOffset.hipsRotX) < 0.01 && document.querySelector('.panel:not(.hidden)') === null;
  if (!calm) return;
  // Иногда вместо движения — красивая поза на несколько секунд.
  if (Math.random() < 0.4 && character.poseName === 'stand') {
    const poses = ['flirty', 'hips', 'shy', 'think', 'hair', 'cheek', 'dreamy', 'hug'].filter((n) => n !== autoLastName);
    const n = poses[Math.floor(Math.random() * poses.length)];
    autoLastName = n;
    character.setPose(n);
    auto = { keys: [[0, {}], [7 + Math.random() * 5, {}]], t: 0, pose: n };
    return;
  }
  const choices = AUTO_ROUTINES.filter((r) => r.name !== autoLastName);
  const r = choices[Math.floor(Math.random() * choices.length)];
  autoLastName = r.name;
  auto = { keys: r.keys, t: 0 };
}
// Камеру крутишь — авто не мешаем; трогаешь её саму — авто плавно останавливается.
window.addEventListener('pointerdown', (e) => {
  if (e.target !== canvas) return;
  if (!zoneAt(e)) return;
  autoIdle = 0;
  stopAuto();
  // Повтор касанием не выключаем: её можно трогать и гладить, пока она двигается.
}, { capture: true, passive: true });
// ---------- «Повтор»: она повторяет твоё движение ползунком по кругу ----------
// Нажал кнопку над ползунком → двигаешь (наклон, прогиб, присесть, лечь) → отпустил —
// она повторяет это движение туда-обратно, плавно. Подвигал по-новому — подхватит на ходу.
// На главной и во вкладке «Позы» повторы РАЗНЫЕ и не мешают друг другу:
// перешёл во вкладку — повтор главной на паузе, вернулся — продолжает.
// Избранное: ＋ сохраняет движение, номерок — включить, удержание номерка — удалить.
const newRep = (tab) => ({ tab, on: false, state: 'off', samples: [], t: 0, lastMove: 0, recStart: 0, faceT: 2, life: 0 });
const reps = { home: newRep('home'), pose: newRep('pose') };
const curRep = () => (poseMode ? reps.pose : reps.home);
const repKey = (r) => (r.tab === 'pose' ? 'waifu-repeat-move-pose' : 'waifu-repeat-move');
const favKey = (r) => (r.tab === 'pose' ? 'waifu-repeat-favs-pose' : 'waifu-repeat-favs');
const repBtns = () => [$('cam-auto'), $('rep-btn')].filter(Boolean);
function loadFavs(r) { try { return JSON.parse(localStorage.getItem(favKey(r)) || '[]'); } catch { return []; } }
function saveFavs(r, list) { try { localStorage.setItem(favKey(r), JSON.stringify(list)); } catch { /* ignore */ } }
// Снимок того, что повторяем: наклон, посадка и точки рук/ног (во вкладке «Позы»).
const vArr = (v) => (v ? [v.x, v.y, v.z] : null);
function nowPose() {
  const c = character;
  return {
    bend: c.bodyOffset.hipsRotX, spine: c.bodyOffset.spineX, sit: c.sit,
    hL: c.handAnchor?.left ? null : vArr(c.handTargets.left), hR: c.handAnchor?.right ? null : vArr(c.handTargets.right),
    fL: vArr(c.footOffset.left), fR: vArr(c.footOffset.right),
  };
}
// Точки: плавно между двумя снимками (если точка есть в обоих).
const lerpArr = (a, b, k) => (a && b ? [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k] : (b ?? a));
function applyPoints(p) {
  const c = character;
  const set = (obj, side, arr) => {
    if (!arr) return;
    if (obj[side]) obj[side].set(arr[0], arr[1], arr[2]);
    else obj[side] = new THREE.Vector3(arr[0], arr[1], arr[2]);
  };
  if (!c.handAnchor?.left) set(c.handTargets, 'left', p.hL);
  if (!c.handAnchor?.right) set(c.handTargets, 'right', p.hR);
  set(c.footOffset, 'left', p.fL);
  set(c.footOffset, 'right', p.fR);
  if (p.hL) c.armPreset.left = null;
  if (p.hR) c.armPreset.right = null;
}
// Включить конкретное движение (из памяти или избранного) — плавно перетекая в него.
function movedPoints(samples) {
  const out = {};
  for (const key of ['hL', 'hR', 'fL', 'fR']) {
    const vals = samples.map((x) => x[key]).filter(Boolean);
    if (vals.length < 2) continue;
    const f = vals[0];
    out[key] = vals.some((v) => Math.hypot(v[0] - f[0], v[1] - f[1], v[2] - f[2]) > 0.01);
  }
  return out;
}
// Края записанного движения: до куда его можно сдвигать полосой.
function repRanges(r) {
  if (r.rangeFor === r.samples) return;
  r.rangeFor = r.samples;
  const S = r.samples ?? [];
  const sit = S.map((x) => x.sit), bend = S.map((x) => x.bend);
  r.sitLo = sit.length ? Math.min(...sit) : 0;
  r.sitHi = sit.length ? Math.max(...sit) : 0;
  r.bendLo = bend.length ? Math.min(...bend) : 0;
  r.bendHi = bend.length ? Math.max(...bend) : 0;
}
const sitMovedIn = (S) => { const v = S.map((x) => x.sit); return Math.max(...v) - Math.min(...v) > 0.02; };
function playMove(r, mv) {
  r.movedPts = movedPoints(mv.samples);
  r.sitMoved = sitMovedIn(mv.samples);
  r.sitFree = false;
  r.bendOff = 0;
  r.sitOff = 0;
  r.samples = mv.samples;
  r.dur = mv.dur;
  r.t = 0;
  r.blendFrom = nowPose();
  r.blendK = 0;
  r.state = 'play';
  r.midFor = null;
}
function setRepeat(on) {
  if (!character) return;
  const r = curRep();
  r.on = on;
  r.state = on ? 'wait' : 'off';
  r.samples = [];
  r.ptsTrack = null;
  r.ptsRec = null;
  r.sitFree = false;
  r.bendOff = 0;
  r.sitOff = 0;
  if (on) stopAuto(true);
  renderRep();
  // Включил — всегда с чистого листа: ждёт твоё новое движение.
  // Сохранённые движения — только из избранного (номерки рядом с кнопкой).
  showToast(on ? 'Подвигай ползунком — я повторю 💗' : 'Стоп');
}
// Кнопка повтора — над левым ползунком; рядом — избранные движения.
const repFavsEl = document.createElement('div');
repFavsEl.id = 'rep-favs';
repFavsEl.hidden = true;
$('sit-slider').appendChild(repFavsEl);
for (const ev of ['pointerdown', 'touchstart']) repFavsEl.addEventListener(ev, (e) => e.stopPropagation());
function renderRep() {
  const r = curRep();
  for (const b of repBtns()) {
    b.classList.toggle('active', r.on);
    b.classList.toggle('rec', r.on && r.state === 'rec');
  }
  repFavsEl.hidden = !r.on;
  if (!r.on) return;
  const favs = loadFavs(r);
  repFavsEl.innerHTML = '';
  const add = document.createElement('button');
  add.className = 'rf-add';
  add.textContent = '＋';
  add.title = 'Сохранить это движение';
  add.disabled = r.state !== 'play' || favs.length >= 6;
  add.addEventListener('click', () => {
    if (r.state !== 'play' || !r.samples.length) return;
    const list = loadFavs(r);
    list.push({ dur: r.dur, samples: r.samples.filter((_, i) => i % 2 === 0 || i === r.samples.length - 1) });
    saveFavs(r, list.slice(-6));
    showToast(`★ Движение ${list.length} сохранено`);
    renderRep();
  });
  repFavsEl.appendChild(add);
  favs.forEach((mv, i) => {
    const c = document.createElement('button');
    c.className = 'rf-chip';
    c.textContent = String(i + 1);
    c.title = 'Тап — повторять · удержать — удалить';
    let hold = null;
    let held = false;
    c.addEventListener('pointerdown', () => {
      held = false;
      hold = setTimeout(() => {
        held = true;
        const list = loadFavs(r);
        list.splice(i, 1);
        saveFavs(r, list);
        showToast(`Движение ${i + 1} удалено`);
        renderRep();
      }, 600);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) c.addEventListener(ev, () => clearTimeout(hold));
    c.addEventListener('click', () => {
      if (held) return;
      playMove(r, mv);
      showToast(`Повторяю движение ${i + 1} ♥`);
      renderRep();
    });
    repFavsEl.appendChild(c);
  });
}
{
  const b = document.createElement('button');
  b.id = 'rep-btn';
  b.title = 'Повтор движения';
  b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a6 6 0 0 1 10.5-4M20 12a6 6 0 0 1-10.5 4"/><path d="M14 4.5l.8 3.6-3.6.6M10 19.5l-.8-3.6 3.6-.6"/></svg>';
  $('sit-slider').prepend(b);
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  b.addEventListener('click', (e) => { e.stopPropagation(); setRepeat(!curRep().on); });
  const f = FEATURES.find((x) => x.id === 'flow');
  if (f && !f.ids.includes('rep-btn')) f.ids.push('rep-btn');
  renderLocks();
}
// Ползунок двинули: в режиме повтора этой вкладки — начинаем (или продолжаем) запись.
// Слой точек (🔁): своя запись и свой повтор, наклон/посадку не останавливает.
function ptsNoteMove() {
  const r = curRep();
  if (!r.on) return;
  const now = performance.now();
  if (!r.ptsRec) {
    r.ptsRec = { samples: [], start: now };
    r.ptsTrack = null; // новое движение точек заменяет старое
    r.movedPts = {}; // точками теперь управляет слой точек
  }
  r.ptsLast = now;
}
function updatePtsLayer(dt) {
  if (!character) return;
  const r = curRep();
  if (!r.on) return;
  const now = performance.now();
  if (r.ptsRec) {
    const P = nowPose();
    r.ptsRec.samples.push({ t: (now - r.ptsRec.start) / 1000, hL: P.hL, hR: P.hR, fL: P.fL, fR: P.fR });
    const dragging = !!(poseDrag && /hand|foot|knee/.test(poseDrag.kind));
    if (!dragging && now - r.ptsLast > 250) {
      const endT = (r.ptsLast - r.ptsRec.start) / 1000;
      const S = r.ptsRec.samples.filter((x) => x.t <= endT + 0.05);
      r.ptsRec = null;
      if (endT >= 0.4 && S.length >= 4) {
        r.ptsTrack = { samples: S, dur: endT, t: endT, moved: movedPoints(S) };
        showToast('🔁 Повторяю движение точек — и наклон тоже ♥');
      }
    }
    return;
  }
  const T = r.ptsTrack;
  if (!T) return;
  T.t = (T.t + dt) % (T.dur * 2);
  const tri = T.t < T.dur ? T.t / T.dur : 2 - T.t / T.dur;
  const u = (0.5 - 0.5 * Math.cos(Math.PI * tri)) * T.dur;
  const S = T.samples;
  let i = 0;
  while (i < S.length - 2 && S[i + 1].t < u) i++;
  const a = S[i];
  const b = S[Math.min(i + 1, S.length - 1)];
  const k = b.t > a.t ? THREE.MathUtils.clamp((u - a.t) / (b.t - a.t), 0, 1) : 0;
  const m = T.moved;
  applyPoints({ hL: m.hL ? lerpArr(a.hL, b.hL, k) : null, hR: m.hR ? lerpArr(a.hR, b.hR, k) : null,
    fL: m.fL ? lerpArr(a.fL, b.fL, k) : null, fR: m.fR ? lerpArr(a.fR, b.fR, k) : null });
}
function loopNoteMove(kind = 'main') {
  const r = curRep();
  if (!r.on) return;
  // Положение (сесть/встать) меняешь, пока идёт повтор, — повтор не останавливается:
  // посадка просто становится ручной, а наклон и дальше качается.
  if (kind === 'sit' && r.state === 'play') { r.sitFree = true; return 'free'; }
  // Идёт повтор — останавливает его только кнопка повтора; движения его лишь сдвигают.
  if (r.state === 'play') return 'shift';
  const now = performance.now();
  if (r.state !== 'rec') {
    r.state = 'rec';
    r.samples = [];
    r.recStart = now;
    r.blendFrom = null;
    renderRep();
  }
  r.lastMove = now;
}
// Сменили вкладку: повтор другой вкладки на паузе, этой — плавно продолжает.
let repTabSeen = null;
function updateLoop(dt) {
  if (!character) return;
  const r = curRep();
  if (repTabSeen !== r.tab) {
    repTabSeen = r.tab;
    if (r.on && r.state === 'play') { r.blendFrom = nowPose(); r.blendK = 0; }
    if (r.on && r.state === 'rec') r.state = 'wait';
    r.ptsRec = null;
    renderRep();
  }
  if (!r.on) return;
  const now = performance.now();
  if (r.state === 'rec') {
    r.samples.push({ t: (now - r.recStart) / 1000, ...nowPose() });
    const dragging = !!(sliderDrag || slider2Drag || (poseDrag && /sitdrag|hand|foot|knee/.test(poseDrag.kind)));
    if (!dragging && now - r.lastMove > 250) {
      const endT = (r.lastMove - r.recStart) / 1000;
      r.samples = r.samples.filter((x) => x.t <= endT + 0.05);
      if (endT < 0.4 || r.samples.length < 4) { r.state = 'wait'; renderRep(); return; }
      r.dur = endT;
      // С того места, где отпустил (конец записи), и обратно — без скачка и паузы.
      r.t = r.dur;
      r.blendFrom = null;
      r.state = 'play';
      // Какие точки реально двигались в записи — только их и повторяем
      // (остальные точки остаются как поставил, их можно править на ходу).
      r.movedPts = movedPoints(r.samples);
      // Точки, которые ведёт слой точек, основной повтор не трогает.
      if (r.ptsTrack) for (const key of Object.keys(r.ptsTrack.moved)) if (r.ptsTrack.moved[key]) r.movedPts[key] = false;
      r.sitMoved = sitMovedIn(r.samples);
      r.sitFree = false;
      r.bendOff = 0;
      r.sitOff = 0;
      r.midFor = null;
      try { localStorage.setItem(repKey(r), JSON.stringify({ dur: r.dur, samples: r.samples.filter((_, i) => i % 2 === 0 || i === r.samples.length - 1) })); } catch { /* ignore */ }
      if (!r.toldOnce) { r.toldOnce = true; showToast('Повторяю~ ♥ ＋ — в избранное, подвигай — запомню новое'); }
      renderRep();
    }
    return;
  }
  if (r.state !== 'play') return;
  // Живее: темп и размах чуть «дышат» — каждый повтор немного другой.
  r.life += dt;
  const tempo = 1 + 0.08 * Math.sin(r.life * 0.23) + 0.04 * Math.sin(r.life * 0.61 + 1);
  const amp = 1 + 0.1 * Math.sin(r.life * 0.17 + 2) + 0.05 * Math.sin(r.life * 0.47);
  r.t = (r.t + dt * tempo) % (r.dur * 2);
  const tri = r.t < r.dur ? r.t / r.dur : 2 - r.t / r.dur;
  const u = (0.5 - 0.5 * Math.cos(Math.PI * tri)) * r.dur;
  const S = r.samples;
  let i = 0;
  while (i < S.length - 2 && S[i + 1].t < u) i++;
  const a = S[i];
  const b = S[Math.min(i + 1, S.length - 1)];
  const k = b.t > a.t ? THREE.MathUtils.clamp((u - a.t) / (b.t - a.t), 0, 1) : 0;
  const L = (x, y) => x + (y - x) * k;
  if (r.midFor !== r.samples) {
    r.midFor = r.samples;
    r.midBend = S.reduce((m, x) => m + x.bend, 0) / S.length;
  }
  let bend = THREE.MathUtils.clamp(r.midBend + (L(a.bend, b.bend) - r.midBend) * amp + (r.bendOff ?? 0), BEND_MIN, BEND_MAX);
  let spine = bendSpine(bend);
  let sit = THREE.MathUtils.clamp(L(a.sit, b.sit) + (r.sitOff ?? 0), 0, sitMax());
  let pts = { hL: lerpArr(a.hL, b.hL, k), hR: lerpArr(a.hR, b.hR, k), fL: lerpArr(a.fL, b.fL, k), fR: lerpArr(a.fR, b.fR, k) };
  if (r.blendFrom) {
    r.blendK = Math.min(1, r.blendK + dt / 1.2);
    const e = r.blendK * r.blendK * (3 - 2 * r.blendK);
    bend = r.blendFrom.bend + (bend - r.blendFrom.bend) * e;
    spine = r.blendFrom.spine + (spine - r.blendFrom.spine) * e;
    sit = r.blendFrom.sit + (sit - r.blendFrom.sit) * e;
    const bf = r.blendFrom;
    pts = { hL: lerpArr(bf.hL, pts.hL, e), hR: lerpArr(bf.hR, pts.hR, e), fL: lerpArr(bf.fL, pts.fL, e), fR: lerpArr(bf.fR, pts.fR, e) };
    if (r.blendK >= 1) r.blendFrom = null;
  }
  {
    const m = r.movedPts ?? {};
    applyPoints({ hL: m.hL ? pts.hL : null, hR: m.hR ? pts.hR : null, fL: m.fL ? pts.fL : null, fR: m.fR ? pts.fR : null });
  }
  const o = character.bodyOffset;
  o.hipsRotX = bend;
  o.spineX = spine;
  // Посадку ведёт повтор, только если она менялась в записи и ты не взял её в руки.
  const sitByRep = r.sitMoved !== false && !r.sitFree;
  if (sitByRep) character.sit = sit;
  // Темп посадки из записи: быстро записал — быстро и на всю глубину, медленно — плавно.
  if (sitByRep) {
    const span = Math.max(0.03, b.t - a.t);
    const du = (Math.PI / 2) * Math.abs(Math.sin(Math.PI * tri)) * tempo;
    const sp = Math.abs(b.sit - a.sit) / span * Math.max(0.4, du);
    character.sitRate = THREE.MathUtils.clamp(sp * 1.2, 0.9, 2.6);
  }
  character.slideHold = 3; // ножками не болтает
  character.hipsSetSit = character.sitS;
  // Лицо живёт: улыбается, подмигивает, смущается.
  r.faceT -= dt;
  if (r.faceT <= 0 && character.sleep < 0.3) {
    r.faceT = 3.5 + Math.random() * 3;
    const f = FLOW_FACES[Math.floor(Math.random() * FLOW_FACES.length)];
    if (f === 'smile') character.setExpression('happy', 0.55 + Math.random() * 0.25, 1.6);
    else if (f === 'wink') { character.setExpression('happy', 0.35, 1.0); character.wink(); }
    else if (f === 'shy') { character.setExpression('relaxed', 0.55, 2.0); character.playMotion('tiltHead'); }
    else if (f === 'surprised') character.setExpression('surprised', 0.35, 0.8);
  }
}
const FLOW_FACES = ['smile', 'smile', 'wink', 'shy', 'smile', 'wink', 'surprised'];
// ---------- Встроенная музыка (генерируется в браузере, без файлов) ----------
// Спокойный бит ~96 BPM: бочка, хлопок, хэт, мягкие аккорды Am–F–C–G и бас.
const music = { ctx: null, on: false, bpm: 96, start: 0, step: 0, timer: null, out: null };
function musicBeat() {
  if (!music.on || !music.ctx) return null;
  return Math.max(0, (music.ctx.currentTime - music.start) * music.bpm / 60);
}
function noiseBuf(ctx) {
  const b = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function playMusic(on) {
  if (on && !music.ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { showToast('Музыка не поддерживается в этом браузере'); return; }
    music.ctx = new Ctx();
    window.__waifuAudio = music.ctx;
    music.out = music.ctx.createGain();
    music.out.gain.value = 0.32;
    music.out.connect(music.ctx.destination);
    music.noise = noiseBuf(music.ctx);
  }
  if (!music.ctx) return;
  if (on) {
    music.ctx.resume();
    music.on = true;
    music.start = music.ctx.currentTime + 0.1;
    music.step = 0;
    clearInterval(music.timer);
    music.timer = setInterval(scheduleMusic, 25);
  } else {
    music.on = false;
    clearInterval(music.timer);
    music.timer = null;
  }
  $('btn-music-toggle')?.classList.toggle('active', music.on);
  if ($('btn-music-toggle')) $('btn-music-toggle').textContent = music.on ? '🎶 Музыка: вкл' : '🎶 Музыка';
}
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
function tone(t, freq, dur, type, gain, attack = 0.01) {
  const c = music.ctx;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(music.out);
  o.start(t);
  o.stop(t + dur + 0.05);
}
function hit(t, dur, gain, filter, freq) {
  const c = music.ctx;
  const src = c.createBufferSource();
  src.buffer = music.noise;
  const f = c.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(music.out);
  src.start(t);
  src.stop(t + dur + 0.05);
}
function scheduleMusic() {
  const c = music.ctx;
  const eighth = 30 / music.bpm;
  while (music.start + music.step * eighth < c.currentTime + 0.15) {
    const t = music.start + music.step * eighth;
    const st = music.step % 8;
    const bar = Math.floor(music.step / 8) % 4;
    if (st === 0 || st === 4) { // бочка
      const o = c.createOscillator();
      const g = c.createGain();
      o.frequency.setValueAtTime(120, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g).connect(music.out);
      o.start(t); o.stop(t + 0.35);
    }
    if (st === 2 || st === 6) hit(t, 0.18, 0.35, 'bandpass', 1800); // хлопок
    if (st % 2 === 1) hit(t, 0.05, 0.12, 'highpass', 7000); // хэт
    if (st === 0) for (const n of CHORDS[bar]) tone(t, hz(n), eighth * 8, 'triangle', 0.05, 0.25); // аккорд
    if (st === 0 || st === 3 || st === 4) tone(t, hz(CHORDS[bar][0] - 12), eighth * 1.6, 'sine', 0.22); // бас
    if (st === 5 && Math.random() < 0.5) tone(t, hz(CHORDS[bar][2] + 12), eighth, 'sine', 0.05); // искорка
    music.step++;
  }
}

// Музыка — в панели танцев (🎵): кнопка «Музыка».
{
  const mb = document.createElement('button');
  mb.id = 'btn-music-toggle';
  mb.className = 'panel-big';
  mb.textContent = '🎶 Музыка';
  $('btn-dance').after(mb);
  mb.addEventListener('click', () => playMusic(!music.on));
}
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

// Пауза на время рекламы: картинка и звук стоят.
let adPaused = false;
let playGain = 0;
onAdPause((on) => {
  adPaused = on;
  try { if (on) window.speechSynthesis?.cancel(); } catch { /* ignore */ }
  for (const a of document.querySelectorAll('audio')) { if (on) a.pause(); }
  try { if (on) window.__waifuAudio?.suspend?.(); else window.__waifuAudio?.resume?.(); } catch { /* ignore */ }
});
function tick() {
  requestAnimationFrame(tick);
  if (adPaused) { clock.getDelta(); return; }
  const dt = Math.min(clock.getDelta(), 0.05);

  updateCamera(dt);
  updateSitSlider();
  updateHandles();
  updateBlob();
  updateLiveIdle();
  updateAuto(dt);
  updateLoop(dt);
  updatePtsLayer(dt);
  updateWardrobeCam();
  // Пока ты с ней — симпатия понемногу растёт и сама (раз в минуту).
  if (!document.hidden) {
    playGain += dt;
    if (playGain > 60) { playGain = 0; setLove(love + (boostOn() ? 2 : 1)); }
  }
  updateSuggest(dt);
  updateSelfDress(dt);
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
    // Камера близко к лицу — она это чувствует (смущение, улыбка); смущаясь, отводит глаза.
    {
      const hp = character.bones.head.getWorldPosition(new THREE.Vector3());
      const dist = camera.position.distanceTo(hp) / camBase.S;
      character.camClose = THREE.MathUtils.clamp((1.5 - dist) / 0.6, 0, 1); // ближе ~1 м — «близко»
      character.loveK = love / LOVE_MAX;
      if ((character.shyNow ?? 0) > 0.2) lookPoint.add(new THREE.Vector3(0.6 * character.shyNow, -0.25 * character.shyNow, 0));
    }
    // Сразу после переключения взгляда глаза переводятся мягко (без скачка).
    const gazeEase = Math.min(1, (performance.now() - gazeSwitchAt) / 900);
    character.lookTarget.position.lerp(lookPoint, 1 - Math.exp(-dt * (4 + 14 * gazeEase * gazeEase)));
    // Головой за пальцем следит только когда мы перед ней.
    const facing = Math.max(0, Math.cos(camYaw));
    if (gazeMode === 'follow') lookNdc.set(pointer.x * facing, pointer.y * facing);
    else lookNdc.set(0, 0);
    character.eyesShut = gazeMode === 'closed' ? 1 : 0;
    character.gazeTarget = gazeMode === 'me' ? camera.position : null;
    character.gazeUp = (character.gazeUp ?? new THREE.Vector3()).set(0, 1, 0).applyQuaternion(camera.quaternion);
    character.headLook.lerp(lookNdc, 1 - Math.exp(-dt * 4));

    const patTarget = petting && petting.ticks > 0 ? 1 : 0;
    character.patAmount += (patTarget - character.patAmount) * (1 - Math.exp(-dt * 5));

    character.update(dt);
    pieceWardrobe.sync(dt);

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
      if (character.sleep > 0.3) say(pick(['zzz…', '*тихо сопит*', 'Ммм… 😴']));
      else say(pick(IDLE_LINES[tier()]), tier() === 2 ? 'relaxed' : 'sad');
    }
  }

  renderer.render(scene, camera);
  if (photoPending) {
    photoPending = false;
    try {
      $('photo-img').src = canvas.toDataURL('image/png');
      $('photo-view').hidden = false;
    } catch { showToast('Не получилось сделать фото'); }
    document.body.classList.remove('photo');
  }
}

resize();
tick();
restoreLibrary();
