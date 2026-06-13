import * as THREE from 'three';

/* =========================================================================
   Лесная гонка 3D — простой бесконечный раннер-гонка для Яндекс Игр.
   Машина едет по лесной трассе, игрок маневрирует влево/вправо,
   собирает заправку (батареи для электро / канистры для бензина)
   и объезжает деревья-препятствия. Бак пустеет — игра кончается.
   ========================================================================= */

// ---------- Настройки ----------
const ROAD_WIDTH = 14;          // ширина трассы
const ROAD_HALF = ROAD_WIDTH / 2 - 1.2;
const SEGMENT_LEN = 20;         // длина одного куска дороги
const VISIBLE_SEGMENTS = 14;    // сколько кусков держим в сцене
const SPAWN_AHEAD = 70;         // как далеко впереди спавним объекты
const DESPAWN_BEHIND = 16;      // на сколько за спиной удаляем объекты

const CAR_CONFIG = {
  electric: {
    name: 'Электро',
    color: 0x2bd4d4,
    accent: 0x0a3a3a,
    fuelName: 'Заряд',
    fuelIcon: '🔋',
    pickupName: 'батарея',
    pickupColor: 0x39c6ff,
    drain: 5.2,           // расход в секунду
    refill: 34,           // сколько даёт один пикап
    maxSpeed: 64,
    accel: 14,
  },
  gas: {
    name: 'Бензин',
    color: 0xff5b3c,
    accent: 0x5a1606,
    fuelName: 'Топливо',
    fuelIcon: '⛽',
    pickupName: 'канистра',
    pickupColor: 0xff9a2e,
    drain: 7.0,
    refill: 40,
    maxSpeed: 72,
    accel: 18,
  },
};

const MAX_FUEL = 100;

// Бонус-ускоритель: даёт временный буст скорости и немного заправки
const BOOST_DURATION = 3.5;     // сек
const BOOST_MULT = 1.55;        // множитель к максималке/разгону
const BOOST_REFILL = 12;

// Биомы — меняются по мере прохождения дистанции (каждые BIOME_LEN метров)
const BIOME_LEN = 900;
const BIOMES = [
  { name: 'Лес',    sky: 0x9fd3e0, fog: 0x9fd3e0, grass: 0x4f7a3a, leaf: 0x2f6b34, leaf2: 0x3f8b44, trunk: 0x6b4a2b, snow: false },
  { name: 'Закат',  sky: 0xf6b26b, fog: 0xe8a06a, grass: 0x6a6a3a, leaf: 0x4a5a2a, leaf2: 0x6a7a3a, trunk: 0x5a3a2b, snow: false },
  { name: 'Зима',   sky: 0xdfeefc, fog: 0xeaf3ff, grass: 0xeef4f8, leaf: 0x6f9bb0, leaf2: 0x9fc4d6, trunk: 0x5a4636, snow: true },
];

// ---------- Состояние ----------
const state = {
  running: false,
  carType: 'electric',
  cfg: CAR_CONFIG.electric,
  fuel: MAX_FUEL,
  speed: 0,
  distance: 0,
  score: 0,
  steer: 0,          // -1..1 текущее направление руля
  carX: 0,
  boostTime: 0,      // остаток времени ускорения
  biomeIndex: 0,
  muted: loadMuted(),
  bestScore: loadBest(),
};

// ---------- Three.js базовая сцена ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd3e0);
scene.fog = new THREE.Fog(0x9fd3e0, 60, 150);

const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 400);

// Свет
const hemi = new THREE.HemisphereLight(0xcfeffd, 0x3a5a40, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d6, 1.1);
sun.position.set(-30, 60, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 200;
sun.shadow.camera.left = -60;
sun.shadow.camera.right = 60;
sun.shadow.camera.top = 60;
sun.shadow.camera.bottom = -60;
scene.add(sun);
scene.add(sun.target);

// Земля (трава) — большой бесконечный на вид план
const grassGeo = new THREE.PlaneGeometry(400, 600);
const grassMat = new THREE.MeshLambertMaterial({ color: 0x4f7a3a });
const grass = new THREE.Mesh(grassGeo, grassMat);
grass.rotation.x = -Math.PI / 2;
grass.position.set(0, -0.05, -200);
grass.receiveShadow = true;
scene.add(grass);

// ---------- Общие геометрии/материалы (переиспользуем) ----------
const roadMat = new THREE.MeshLambertMaterial({ color: 0x3a3a42 });
const roadGeo = new THREE.PlaneGeometry(ROAD_WIDTH, SEGMENT_LEN);
const stripeMat = new THREE.MeshBasicMaterial({ color: 0xf4e285 });
const stripeGeo = new THREE.PlaneGeometry(0.5, SEGMENT_LEN * 0.45);

const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 3, 6);
const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2b });
const leafGeo = new THREE.ConeGeometry(2.2, 5, 7);
const leafMat = new THREE.MeshLambertMaterial({ color: 0x2f6b34 });
const leafMat2 = new THREE.MeshLambertMaterial({ color: 0x3f8b44 });

// ---------- Пулы объектов ----------
const roadSegments = [];
const trees = [];       // деревья по бокам (декор)
const obstacles = [];   // деревья/пни на дороге (препятствия)
const pickups = [];     // заправка
const boosts = [];      // бонусы-ускорители

function makeRoadSegment(z) {
  const group = new THREE.Group();
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.rotation.x = -Math.PI / 2;
  road.receiveShadow = true;
  group.add(road);

  // прерывистая разметка
  const stripe = new THREE.Mesh(stripeGeo, stripeMat);
  stripe.rotation.x = -Math.PI / 2;
  stripe.position.y = 0.02;
  group.add(stripe);

  group.position.z = z;
  scene.add(group);
  return group;
}

function makeTree() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = 1.5;
  trunk.castShadow = true;
  g.add(trunk);
  const leaves = new THREE.Mesh(leafGeo, Math.random() > 0.5 ? leafMat : leafMat2);
  leaves.position.y = 4.2;
  leaves.castShadow = true;
  g.add(leaves);
  const top = new THREE.Mesh(leafGeo, leafMat);
  top.position.y = 6;
  top.scale.setScalar(0.7);
  g.add(top);
  const s = 0.7 + Math.random() * 0.7;
  g.scale.setScalar(s);
  scene.add(g);
  return g;
}

// Пикап (заправка): канистра/батарея + свечение
const pickupBodyGeo = new THREE.BoxGeometry(1, 1.3, 0.7);
function makePickup() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: state.cfg.pickupColor,
    emissive: state.cfg.pickupColor,
    emissiveIntensity: 0.5,
    metalness: 0.3,
    roughness: 0.4,
  });
  const body = new THREE.Mesh(pickupBodyGeo, mat);
  body.castShadow = true;
  g.add(body);
  // светящееся кольцо у земли
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.2, 0.12, 8, 20),
    new THREE.MeshBasicMaterial({ color: state.cfg.pickupColor, transparent: true, opacity: 0.6 })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  g.add(ring);
  g.userData.body = body;
  scene.add(g);
  return g;
}

// Препятствие на дороге — пень/камень
const obstacleGeo = new THREE.CylinderGeometry(0.9, 1.1, 1.2, 8);
const obstacleMat = new THREE.MeshLambertMaterial({ color: 0x7a5230 });
function makeObstacle() {
  const m = new THREE.Mesh(obstacleGeo, obstacleMat);
  m.position.y = 0.6;
  m.castShadow = true;
  scene.add(m);
  return m;
}

// Бонус-ускоритель — золотой кристалл со свечением
const boostGeo = new THREE.OctahedronGeometry(0.9);
function makeBoost() {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffd23f, emissive: 0xffb000, emissiveIntensity: 0.7, metalness: 0.6, roughness: 0.2,
  });
  const m = new THREE.Mesh(boostGeo, mat);
  m.position.y = 1.3;
  m.castShadow = true;
  scene.add(m);
  return m;
}
function addBoost() { const b = makeBoost(); boosts.push(b); return b; }

// ---------- Снег (для зимнего биома) ----------
let snow = null;
function buildSnow() {
  const count = 600;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() * 2 - 1) * 60;
    pos[i * 3 + 1] = Math.random() * 40;
    pos[i * 3 + 2] = -Math.random() * 120;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.5, transparent: true, opacity: 0.85 });
  snow = new THREE.Points(geo, mat);
  snow.visible = false;
  scene.add(snow);
}

// ---------- Машина игрока ----------
let car;
function buildCar(cfg) {
  if (car) scene.remove(car);
  car = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color: cfg.color, metalness: 0.5, roughness: 0.35 });
  const accentMat = new THREE.MeshStandardMaterial({ color: cfg.accent, metalness: 0.4, roughness: 0.5 });

  const base = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 4.4), bodyMat);
  base.position.y = 0.75;
  base.castShadow = true;
  car.add(base);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 2.2), accentMat);
  cabin.position.set(0, 1.35, -0.2);
  cabin.castShadow = true;
  car.add(cabin);

  // лобовое стекло
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.55, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x9fe7ff, metalness: 0.1, roughness: 0.1, transparent: true, opacity: 0.7 })
  );
  glass.position.set(0, 1.35, 0.95);
  car.add(glass);

  // колёса
  const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.4, 12);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x14151a });
  const wheelPos = [[-1.05, 1.5], [1.05, 1.5], [-1.05, -1.5], [1.05, -1.5]];
  for (const [x, z] of wheelPos) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.5, z);
    w.castShadow = true;
    car.add(w);
  }

  // фары
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff7cf });
  for (const x of [-0.7, 0.7]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.1), headMat);
    h.position.set(x, 0.8, 2.25);
    car.add(h);
  }

  scene.add(car);
}

// ---------- Инициализация мира ----------
function initWorld() {
  // дорога
  for (let i = 0; i < VISIBLE_SEGMENTS; i++) {
    roadSegments.push(makeRoadSegment(-i * SEGMENT_LEN));
  }
  // боковые деревья
  for (let i = 0; i < 60; i++) {
    const t = makeTree();
    placeSideTree(t, -Math.random() * SPAWN_AHEAD);
    trees.push(t);
  }
}

function placeSideTree(t, z) {
  const side = Math.random() > 0.5 ? 1 : -1;
  const off = ROAD_WIDTH / 2 + 2 + Math.random() * 22;
  t.position.set(side * off, 0, z);
}

// ---------- Спавн препятствий и пикапов ----------
let nextPickupZ = -40;
let nextObstacleZ = -55;
let nextBoostZ = -120;

function spawnAhead(frontZ) {
  // пикапы
  while (nextPickupZ > frontZ - SPAWN_AHEAD) {
    const p = pickups.find((o) => !o.visible) || addPickup();
    p.visible = true;
    p.position.set((Math.random() * 2 - 1) * ROAD_HALF, 1.1, nextPickupZ);
    p.userData.taken = false;
    nextPickupZ -= 22 + Math.random() * 26;
  }
  // препятствия
  while (nextObstacleZ > frontZ - SPAWN_AHEAD) {
    const o = obstacles.find((m) => !m.visible) || addObstacle();
    o.visible = true;
    o.position.set((Math.random() * 2 - 1) * ROAD_HALF, 0.6, nextObstacleZ);
    o.userData.hit = false;
    nextObstacleZ -= 30 + Math.random() * 40;
  }
  // бонусы-ускорители (реже)
  while (nextBoostZ > frontZ - SPAWN_AHEAD) {
    const b = boosts.find((m) => !m.visible) || addBoost();
    b.visible = true;
    b.position.set((Math.random() * 2 - 1) * ROAD_HALF, 1.3, nextBoostZ);
    b.userData.taken = false;
    nextBoostZ -= 140 + Math.random() * 120;
  }
}

function addPickup() { const p = makePickup(); pickups.push(p); return p; }
function addObstacle() { const o = makeObstacle(); obstacles.push(o); return o; }

// Применяем оформление биома (цвета неба, тумана, травы, деревьев)
function applyBiome(idx) {
  const b = BIOMES[idx % BIOMES.length];
  scene.background.setHex(b.sky);
  scene.fog.color.setHex(b.fog);
  grassMat.color.setHex(b.grass);
  leafMat.color.setHex(b.leaf);
  leafMat2.color.setHex(b.leaf2);
  trunkMat.color.setHex(b.trunk);
  if (snow) snow.visible = b.snow;
  state.biomeIndex = idx % BIOMES.length;
}

function refreshPickupColors() {
  for (const p of pickups) {
    if (p.userData.body) {
      p.userData.body.material.color.setHex(state.cfg.pickupColor);
      p.userData.body.material.emissive.setHex(state.cfg.pickupColor);
    }
    p.children[1].material.color.setHex(state.cfg.pickupColor);
  }
}

// ---------- Игровой цикл ----------
const clock = new THREE.Clock();

function update(dt) {
  if (!state.running) return;

  const cfg = state.cfg;

  // ускорение (буст)
  const boosting = state.boostTime > 0;
  if (boosting) {
    state.boostTime -= dt;
    if (state.boostTime <= 0) el.boostBanner.classList.add('hidden');
  }
  const maxSpeed = cfg.maxSpeed * (boosting ? BOOST_MULT : 1);
  const accel = cfg.accel * (boosting ? BOOST_MULT : 1);

  // разгон
  state.speed = Math.min(maxSpeed, state.speed + accel * dt);
  const move = state.speed * dt;
  state.distance += move;

  // смена биома по дистанции
  const targetBiome = Math.floor(state.distance / BIOME_LEN) % BIOMES.length;
  if (targetBiome !== state.biomeIndex) applyBiome(targetBiome);

  // звук двигателя
  audio.engine(state.speed, cfg.maxSpeed);

  // расход топлива растёт со скоростью
  state.fuel -= (cfg.drain * (0.6 + state.speed / cfg.maxSpeed)) * dt;
  if (state.fuel <= 0) {
    state.fuel = 0;
    return gameOver();
  }

  // руль
  const steerSpeed = 18;
  state.carX += state.steer * steerSpeed * dt;
  state.carX = Math.max(-ROAD_HALF, Math.min(ROAD_HALF, state.carX));
  car.position.x = state.carX;
  car.position.z = 0;
  car.position.y = 0;
  // наклон кузова при повороте
  car.rotation.z = THREE.MathUtils.lerp(car.rotation.z, -state.steer * 0.12, 0.15);
  car.rotation.y = THREE.MathUtils.lerp(car.rotation.y, -state.steer * 0.18, 0.15);

  // двигаем мир к игроку (машина стоит в z=0)
  for (const seg of roadSegments) {
    seg.position.z += move;
    if (seg.position.z > SEGMENT_LEN) {
      // переносим сегмент вперёд
      const minZ = Math.min(...roadSegments.map((s) => s.position.z));
      seg.position.z = minZ - SEGMENT_LEN;
    }
  }

  for (const t of trees) {
    t.position.z += move;
    if (t.position.z > DESPAWN_BEHIND) {
      placeSideTree(t, -SPAWN_AHEAD + Math.random() * -10);
    }
  }

  // пикапы
  for (const p of pickups) {
    if (!p.visible) continue;
    p.position.z += move;
    p.rotation.y += dt * 2;
    if (p.userData.body) p.userData.body.position.y = Math.sin(clock.elapsedTime * 3) * 0.15;
    if (!p.userData.taken && Math.abs(p.position.z) < 2.2 && Math.abs(p.position.x - state.carX) < 1.7) {
      p.userData.taken = true;
      p.visible = false;
      state.fuel = Math.min(MAX_FUEL, state.fuel + cfg.refill);
      state.score += 50;
      flash(cfg.pickupColor);
      audio.pickup();
    }
    if (p.position.z > DESPAWN_BEHIND) p.visible = false;
  }

  // препятствия
  for (const o of obstacles) {
    if (!o.visible) continue;
    o.position.z += move;
    if (!o.userData.hit && Math.abs(o.position.z) < 2 && Math.abs(o.position.x - state.carX) < 1.7) {
      o.userData.hit = true;
      state.speed *= 0.35;
      state.fuel -= 12;
      flash(0xff2b2b);
      audio.crash();
      if (state.fuel <= 0) { state.fuel = 0; return gameOver(); }
    }
    if (o.position.z > DESPAWN_BEHIND) o.visible = false;
  }

  // бонусы-ускорители
  for (const b of boosts) {
    if (!b.visible) continue;
    b.position.z += move;
    b.rotation.y += dt * 3;
    b.rotation.x += dt * 1.5;
    if (!b.userData.taken && Math.abs(b.position.z) < 2.2 && Math.abs(b.position.x - state.carX) < 1.8) {
      b.userData.taken = true;
      b.visible = false;
      state.boostTime = BOOST_DURATION;
      state.fuel = Math.min(MAX_FUEL, state.fuel + BOOST_REFILL);
      state.score += 100;
      el.boostBanner.classList.remove('hidden');
      flash(0xffd23f);
      audio.boost();
    }
    if (b.position.z > DESPAWN_BEHIND) b.visible = false;
  }

  // снег в зимнем биоме
  if (snow && snow.visible) {
    const arr = snow.geometry.attributes.position.array;
    for (let i = 1; i < arr.length; i += 3) {
      arr[i] -= dt * 8;
      if (arr[i] < 0) arr[i] = 40;
    }
    snow.geometry.attributes.position.needsUpdate = true;
    snow.position.x = state.carX;
  }

  // спавн впереди: ориентируемся на «виртуальный» прогресс
  nextPickupZ += move;
  nextObstacleZ += move;
  nextBoostZ += move;
  spawnAhead(0);

  // очки за дистанцию
  state.score += move * 0.6;

  // камера следует за машиной
  const camTargetX = state.carX * 0.5;
  camera.position.x = THREE.MathUtils.lerp(camera.position.x, camTargetX, 0.08);
  camera.position.y = 6.5;
  camera.position.z = 11;
  camera.lookAt(state.carX * 0.3, 1.5, -8);

  // солнце за машиной
  sun.target.position.set(state.carX, 0, -10);

  updateHUD();
}

// ---------- HUD ----------
const el = {
  hud: document.getElementById('hud'),
  fuelFill: document.getElementById('fuel-fill'),
  fuelIcon: document.getElementById('fuel-icon'),
  fuelName: document.getElementById('fuel-name'),
  score: document.getElementById('score'),
  speed: document.getElementById('speed'),
  menu: document.getElementById('menu'),
  gameover: document.getElementById('gameover'),
  finalScore: document.getElementById('final-score'),
  bestScore: document.getElementById('best-score'),
  boostBanner: document.getElementById('boost-banner'),
  mute: document.getElementById('btn-mute'),
};

function updateHUD() {
  el.fuelFill.style.width = (state.fuel / MAX_FUEL * 100) + '%';
  el.score.textContent = Math.floor(state.score);
  el.speed.textContent = Math.round(state.speed * 3.6) + ' км/ч';
}

let flashEl = null;
function flash(colorHex) {
  if (!flashEl) {
    flashEl = document.createElement('div');
    flashEl.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:8;opacity:0;transition:opacity .25s;';
    document.getElementById('game-root').appendChild(flashEl);
  }
  const c = '#' + colorHex.toString(16).padStart(6, '0');
  flashEl.style.background = `radial-gradient(circle, ${c}55, transparent 70%)`;
  flashEl.style.opacity = '0.9';
  setTimeout(() => { if (flashEl) flashEl.style.opacity = '0'; }, 120);
}

// ---------- Звук (WebAudio, синтез без файлов) ----------
const audio = {
  ctx: null,
  engineOsc: null,
  engineGain: null,
  ready: false,
  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = state.muted ? 0 : 0.6;
    this.master.connect(this.ctx.destination);
    // непрерывный гул двигателя
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineGain.connect(this.master);
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 60;
    this.engineOsc.connect(this.engineGain);
    this.engineOsc.start();
    this.ready = true;
  },
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  engine(speed, maxSpeed) {
    if (!this.ready || state.muted) return;
    const t = Math.max(0, Math.min(1, speed / maxSpeed));
    this.engineOsc.frequency.setTargetAtTime(55 + t * 130, this.ctx.currentTime, 0.1);
    this.engineGain.gain.setTargetAtTime(state.running ? 0.18 : 0, this.ctx.currentTime, 0.2);
  },
  blip(freq, dur, type = 'square', vol = 0.4) {
    if (!this.ready || state.muted) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = vol;
    g.gain.setTargetAtTime(0, this.ctx.currentTime + 0.01, dur);
    o.connect(g); g.connect(this.master);
    o.start();
    o.stop(this.ctx.currentTime + dur + 0.1);
  },
  pickup() { this.blip(660, 0.12, 'square'); this.blip(990, 0.12, 'square', 0.25); },
  boost() { this.blip(440, 0.2, 'sawtooth'); this.blip(880, 0.25, 'sawtooth', 0.3); },
  crash() {
    if (!this.ready || state.muted) return;
    // короткий шумовой удар
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.2, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = 0.5;
    src.connect(g); g.connect(this.master);
    src.start();
  },
  setMuted(m) {
    state.muted = m;
    saveMuted(m);
    if (this.master) this.master.gain.value = m ? 0 : 0.6;
    el.mute.textContent = m ? '🔇' : '🔊';
  },
};

// ---------- Управление состоянием игры ----------
function startGame(carType) {
  state.carType = carType;
  state.cfg = CAR_CONFIG[carType];
  state.fuel = MAX_FUEL;
  state.speed = 0;
  state.distance = 0;
  state.score = 0;
  state.steer = 0;
  state.carX = 0;
  state.boostTime = 0;
  state.biomeIndex = -1;
  nextPickupZ = -40;
  nextObstacleZ = -60;
  nextBoostZ = -120;

  // звук: создаём контекст по жесту пользователя
  audio.init();
  audio.resume();

  buildCar(state.cfg);
  refreshPickupColors();
  applyBiome(0);
  // спрятать все динамические объекты и пересоздать раскладку
  pickups.forEach((p) => (p.visible = false));
  obstacles.forEach((o) => (o.visible = false));
  boosts.forEach((b) => (b.visible = false));
  spawnAhead(0);

  el.fuelIcon.textContent = state.cfg.fuelIcon;
  el.fuelName.textContent = state.cfg.fuelName;

  el.menu.classList.add('hidden');
  el.gameover.classList.add('hidden');
  el.boostBanner.classList.add('hidden');
  el.hud.classList.remove('hidden');

  state.running = true;

  if (yandex.gameplayStart) yandex.gameplayStart();
}

function gameOver() {
  state.running = false;
  state.score = Math.floor(state.score);
  if (state.score > state.bestScore) {
    state.bestScore = state.score;
    saveBest(state.bestScore);
  }
  el.finalScore.textContent = state.score;
  el.bestScore.textContent = state.bestScore;
  el.boostBanner.classList.add('hidden');
  el.hud.classList.add('hidden');
  el.gameover.classList.remove('hidden');
  if (audio.engineGain) audio.engineGain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.1);
  if (yandex.gameplayStop) yandex.gameplayStop();
  yandex.submitScore(state.score);
  yandex.showAd();
}

function showMenu() {
  state.running = false;
  el.gameover.classList.add('hidden');
  el.hud.classList.add('hidden');
  el.menu.classList.remove('hidden');
}

// ---------- Рекорд (localStorage) ----------
function loadBest() {
  try { return parseInt(localStorage.getItem('forest_best') || '0', 10) || 0; }
  catch { return 0; }
}
function saveBest(v) {
  try { localStorage.setItem('forest_best', String(v)); } catch {}
}
function loadMuted() {
  try { return localStorage.getItem('forest_muted') === '1'; } catch { return false; }
}
function saveMuted(m) {
  try { localStorage.setItem('forest_muted', m ? '1' : '0'); } catch {}
}

// ---------- Ввод ----------
const keys = { left: false, right: false };
function recomputeSteer() {
  state.steer = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A' || e.key === 'ф' || e.key === 'Ф') { keys.left = true; recomputeSteer(); }
  if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D' || e.key === 'в' || e.key === 'В') { keys.right = true; recomputeSteer(); }
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A' || e.key === 'ф' || e.key === 'Ф') { keys.left = false; recomputeSteer(); }
  if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D' || e.key === 'в' || e.key === 'В') { keys.right = false; recomputeSteer(); }
});

// Сенсорные кнопки
function bindHold(id, on, off) {
  const b = document.getElementById(id);
  const start = (e) => { e.preventDefault(); on(); };
  const end = (e) => { e.preventDefault(); off(); };
  b.addEventListener('touchstart', start, { passive: false });
  b.addEventListener('touchend', end);
  b.addEventListener('touchcancel', end);
  b.addEventListener('mousedown', start);
  b.addEventListener('mouseup', end);
  b.addEventListener('mouseleave', end);
}
bindHold('btn-left', () => { keys.left = true; recomputeSteer(); }, () => { keys.left = false; recomputeSteer(); });
bindHold('btn-right', () => { keys.right = true; recomputeSteer(); }, () => { keys.right = false; recomputeSteer(); });

// Свайп/тап по половинам экрана как альтернатива
let touchActive = false;
canvas.addEventListener('touchstart', (e) => {
  document.body.classList.add('touch');
  touchActive = true;
  handleTouchSide(e.touches[0].clientX);
}, { passive: true });
canvas.addEventListener('touchmove', (e) => {
  if (touchActive) handleTouchSide(e.touches[0].clientX);
}, { passive: true });
canvas.addEventListener('touchend', () => {
  touchActive = false; keys.left = keys.right = false; recomputeSteer();
});
function handleTouchSide(x) {
  if (x < window.innerWidth / 2) { keys.left = true; keys.right = false; }
  else { keys.right = true; keys.left = false; }
  recomputeSteer();
}

// Показать сенсорные кнопки при первом касании
window.addEventListener('touchstart', () => document.body.classList.add('touch'), { once: true });

// Кнопки меню
document.querySelectorAll('.car-card').forEach((card) => {
  card.addEventListener('click', () => startGame(card.dataset.car));
});
document.getElementById('btn-restart').addEventListener('click', () => startGame(state.carType));
document.getElementById('btn-menu').addEventListener('click', showMenu);

// Кнопка звука
el.mute.textContent = state.muted ? '🔇' : '🔊';
el.mute.addEventListener('click', () => audio.setMuted(!state.muted));

// ---------- Яндекс SDK (опционально) ----------
// Имя лидерборда из консоли разработчика Яндекс Игр (создайте его там же).
const LEADERBOARD_NAME = 'forest_score';

const yandex = {
  sdk: null,
  lb: null,
  gameplayStart: null,
  gameplayStop: null,
  showAd() {},
  submitScore() {},
};

function initYandex() {
  if (typeof YaGames === 'undefined') return;
  YaGames.init().then((sdk) => {
    yandex.sdk = sdk;
    if (sdk.features && sdk.features.GameplayAPI) {
      yandex.gameplayStart = () => sdk.features.GameplayAPI.start();
      yandex.gameplayStop = () => sdk.features.GameplayAPI.stop();
    }
    yandex.showAd = () => {
      try { sdk.adv.showFullscreenAdv({ callbacks: {} }); } catch (e) {}
    };
    // таблица лидеров (если включена в проекте)
    if (sdk.getLeaderboards) {
      sdk.getLeaderboards().then((lb) => {
        yandex.lb = lb;
        yandex.submitScore = (score) => {
          try { lb.setLeaderboardScore(LEADERBOARD_NAME, Math.floor(score)); } catch (e) {}
        };
      }).catch(() => {});
    }
    // сообщаем платформе, что игра загрузилась
    if (sdk.features && sdk.features.LoadingAPI) {
      sdk.features.LoadingAPI.ready();
    }
  }).catch(() => {});
}
initYandex();

// ---------- Resize ----------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ---------- Запуск ----------
camera.position.set(0, 6.5, 11);
camera.lookAt(0, 1.5, -8);
initWorld();
buildSnow();
applyBiome(0);
buildCar(state.cfg);
el.bestScore.textContent = state.bestScore;
resize();

function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();
