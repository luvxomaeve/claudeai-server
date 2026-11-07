import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { Character, POSES, BASE_POSE } from './character.js';
import { REACTIONS, IDLE_LINES, TIERS, tierFor, pick } from './dialogue.js';

// Тестовая модель (семпл из репозитория three-vrm). Замени на свою из VRoid Studio:
// положи файл рядом, например models/waifu.vrm, и укажи путь здесь,
// или просто перетащи .vrm в окно / нажми 📂.
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

function frameCamera() {
  // headHeight — высота кости головы (основание черепа).
  const H = character ? character.headHeight : 1.4;
  const S = H / 1.4;
  // Кадр: от макушки с запасом под облачко до середины бёдер.
  const top = H + 0.42 * S;
  const bottom = H * 0.38;
  const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const distV = (top - bottom) / 2 / Math.tan(halfFov);
  // На узком экране следим, чтобы влезли руки (~0.75 м в ширину).
  const distH = (0.75 * S) / 2 / (Math.tan(halfFov) * camera.aspect);
  const dist = Math.max(distV, distH);
  const cy = (top + bottom) / 2;
  cameraLookAt.set(0, cy, 0);
  camera.position.set(0, cy + 0.05 * S, dist);
  camera.lookAt(cameraLookAt);
  camera.updateProjectionMatrix();
}

// ---------- Загрузка модели ----------

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

let hitboxGroup = null;

async function loadModel(url) {
  $('loading').classList.remove('done');
  $('loading-text').textContent = 'Загрузка…';
  try {
    const gltf = await loader.loadAsync(url, (e) => {
      if (e.total) $('loading-text').textContent = `Загрузка… ${Math.round((e.loaded / e.total) * 100)}%`;
    });
    const vrm = gltf.userData.vrm;
    if (!vrm) throw new Error('Это не VRM-файл');

    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    (VRMUtils.combineSkeletons ?? VRMUtils.removeUnnecessaryJoints)?.(gltf.scene);
    VRMUtils.rotateVRM0(vrm); // VRM 0.x смотрит назад — разворачиваем к камере
    vrm.scene.traverse((o) => { o.frustumCulled = false; });

    if (character) {
      scene.remove(character.vrm.scene);
      VRMUtils.deepDispose(character.vrm.scene);
    }
    scene.add(vrm.scene);
    character = new Character(vrm);
    window.__waifu = character; // для отладки из консоли
    setActivePoseButton('stand');
    buildHitboxes();
    frameCamera();
    $('loading').classList.add('done');
    setTimeout(() => say(pick(IDLE_LINES[tier()])), 600);
  } catch (err) {
    console.error(err);
    $('loading-text').textContent = `Не удалось загрузить модель: ${err.message}`;
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

canvas.addEventListener('pointerdown', (e) => {
  if (!character) return;
  canvas.setPointerCapture(e.pointerId);
  pointerActive = true;
  $('hint').style.opacity = 0;
  const hit = zoneAt(e);
  if (!hit) return;

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
  pointerActive = false;
  canvas.classList.remove('petting');
  if (petting) {
    // Просто нажали на голову без движения — одиночное поглаживание.
    if (petting.ticks === 0) triggerReaction('headpat', null, e);
    petting = null;
  }
}
canvas.addEventListener('pointerup', endPointer);
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
  for (const btn of document.querySelectorAll('#poses button')) {
    btn.classList.toggle('active', btn.dataset.pose === name);
  }
}

function addPoseButton(name, def) {
  const btn = document.createElement('button');
  btn.textContent = def.label;
  btn.dataset.pose = name;
  btn.addEventListener('click', () => {
    if (!character) return;
    character.setPose(name);
    setActivePoseButton(name);
    say(POSE_LINES[name] ?? pick(['Так?', 'Ну как я тебе?', 'Вот так нормально?']));
  });
  $('poses').appendChild(btn);
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
  $('editor').classList.remove('hidden');
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

$('btn-editor').addEventListener('click', () => {
  if ($('editor').classList.contains('hidden')) openEditor();
  else $('editor').classList.add('hidden');
});
$('editor-close').addEventListener('click', () => $('editor').classList.add('hidden'));
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
    document.querySelector(`#poses button[data-pose="saved:${CSS.escape(name)}"]`)?.remove();
  }
  savedPoses = {};
  try { localStorage.removeItem(POSES_KEY); } catch { /* ignore */ }
});

// ---------- Своя модель ----------

function loadFile(file) {
  if (!file || !file.name.toLowerCase().endsWith('.vrm')) return;
  const url = URL.createObjectURL(file);
  loadModel(url).finally(() => URL.revokeObjectURL(url));
}
$('file-input').addEventListener('change', (e) => loadFile(e.target.files[0]));
window.addEventListener('dragover', (e) => { e.preventDefault(); $('drop-overlay').classList.remove('hidden'); });
window.addEventListener('dragleave', () => $('drop-overlay').classList.add('hidden'));
window.addEventListener('drop', (e) => {
  e.preventDefault();
  $('drop-overlay').classList.add('hidden');
  loadFile(e.dataTransfer.files[0]);
});

// ---------- Цикл ----------

const clock = new THREE.Clock();
const anchor = new THREE.Vector3();
const lookPoint = new THREE.Vector3();
let idleTime = 0;

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (character) {
    // Взгляд за пальцем/курсором: точка на плоскости перед моделью.
    raycaster.setFromCamera(pointer, camera);
    raycaster.ray.at(camera.position.z - 0.3, lookPoint);
    character.lookTarget.position.lerp(lookPoint, 1 - Math.exp(-dt * 10));
    character.headLook.lerp(pointer, 1 - Math.exp(-dt * 4));

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
    bubble.style.top = `${Math.max(y, bubble.offsetHeight + 64)}px`;

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
loadModel(DEFAULT_MODEL);
