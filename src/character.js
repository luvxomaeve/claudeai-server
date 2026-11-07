import * as THREE from 'three';

const EXPRESSIONS = ['happy', 'angry', 'sad', 'relaxed', 'surprised'];

// Зоны касания: сфера вокруг кости. offset и radius — в метрах для модели
// с головой на высоте 1.4 м (масштабируются под рост), в мировых координатах (модель смотрит в +Z, на камеру).
const ZONE_DEFS = [
  { zone: 'headpat', bone: 'head', offset: [0, 0.17, -0.01], radius: 0.085 },
  { zone: 'face', bone: 'head', offset: [0, 0.06, 0.06], radius: 0.065 },
  { zone: 'hand', side: 'left', bone: 'leftHand', offset: [0, -0.04, 0], radius: 0.06 },
  { zone: 'hand', side: 'right', bone: 'rightHand', offset: [0, -0.04, 0], radius: 0.06 },
  { zone: 'arm', side: 'left', bone: 'leftLowerArm', offset: [0, 0, 0], radius: 0.045 },
  { zone: 'arm', side: 'right', bone: 'rightLowerArm', offset: [0, 0, 0], radius: 0.045 },
  { zone: 'arm', side: 'left', bone: 'leftUpperArm', offset: [0, -0.04, 0], radius: 0.045 },
  { zone: 'arm', side: 'right', bone: 'rightUpperArm', offset: [0, -0.04, 0], radius: 0.045 },
  { zone: 'body', bone: 'chest', offset: [0, 0.02, 0.03], radius: 0.085 },
  { zone: 'body', bone: 'hips', offset: [0, -0.06, 0.01], radius: 0.09 },
  { zone: 'belly', bone: 'spine', offset: [0, 0.02, 0.03], radius: 0.075 },
  { zone: 'legs', bone: 'leftUpperLeg', offset: [0, -0.12, 0.01], radius: 0.065 },
  { zone: 'legs', bone: 'rightUpperLeg', offset: [0, -0.12, 0.01], radius: 0.065 },
  { zone: 'legs', bone: 'leftLowerLeg', offset: [0, -0.06, 0], radius: 0.055 },
  { zone: 'legs', bone: 'rightLowerLeg', offset: [0, -0.06, 0], radius: 0.055 },
];

// Базовые позы. Значения — углы нормализованных костей (радианы).
// lUpperTwist/rUpperTwist — поворот плеча вокруг своей оси (куда сгибается локоть).
const BASE_POSE = {
  spineX: 0, spineY: 0, spineZ: 0,
  headX: 0, headY: 0, headZ: 0,
  lUpperZ: -1.15, rUpperZ: 1.15,
  lUpperX: 0.05, rUpperX: 0.05,
  lUpperTwist: 0, rUpperTwist: 0,
  lLowerY: -0.45, rLowerY: 0.45,
  lLowerZ: 0, rLowerZ: 0,
  hipsY: 0, hipsZ: 0, hipsX: 0, hipsRotY: 0,
  lLegX: 0, rLegX: 0, lLegZ: 0, rLegZ: 0, lKneeX: 0, rKneeX: 0,
  lShoulderZ: 0, rShoulderZ: 0, handBend: 0.25,
};

export { BASE_POSE };

export const POSES = {
  stand: { label: 'Стоит' },
  hips: {
    label: 'Руки в боки',
    lUpperZ: -0.75, rUpperZ: 0.75, lUpperX: 0.2, rUpperX: 0.2,
    lUpperTwist: 0.95, rUpperTwist: 0.95, lLowerY: -1.5, rLowerY: 1.5,
    hipsZ: 0.06, spineZ: -0.05, headZ: 0.08,
  },
  shy: {
    label: 'Скромница',
    lUpperZ: -0.85, rUpperZ: 0.85, lUpperX: 0.15, rUpperX: 0.15,
    lUpperTwist: 0.75, rUpperTwist: 0.75, lLowerY: -2.1, rLowerY: 2.1,
    spineX: 0.05, headX: 0.15, headZ: 0.12,
  },
  behind: {
    label: 'Руки за спиной',
    lUpperZ: -0.95, rUpperZ: 0.95, lUpperX: 0.1, rUpperX: 0.1,
    lUpperTwist: 1.3, rUpperTwist: 1.3, lLowerY: -1.6, rLowerY: 1.6,
    spineX: -0.04, headZ: -0.1,
  },
  think: {
    label: 'Задумалась',
    lUpperZ: -0.85, lUpperX: 0.15, lUpperTwist: 0.75, lLowerY: -2.1,
    rUpperZ: 1.0, rUpperX: -0.7, rUpperTwist: 0.5, rLowerY: 2.6,
    headZ: -0.12, headX: 0.05, spineZ: 0.04,
  },
  hello: {
    label: 'Привет',
    lUpperZ: 0.15, lLowerZ: 1.3, lLowerY: 0,
    headZ: 0.1, spineZ: -0.04,
    wave: 'left',
  },
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
// Огибающая движения: быстро вошли, подержали, плавно вышли.
function envelope(t, dur) {
  const p = t / dur;
  if (p <= 0 || p >= 1) return 0;
  if (p < 0.15) return easeInOut(p / 0.15);
  if (p > 0.7) return easeInOut((1 - p) / 0.3);
  return 1;
}

// Плавно ведёт руку к целевой позе. target задаётся для левой руки,
// для правой знаки зеркалятся (поворот плеча — тот же знак).
function blendArm(pose, side, target, e) {
  const L = side === 'left';
  const set = (key, value) => { pose[key] += (value - pose[key]) * e; };
  set(L ? 'lUpperZ' : 'rUpperZ', L ? target.upZ : -target.upZ);
  set(L ? 'lUpperX' : 'rUpperX', target.upX);
  set(L ? 'lUpperTwist' : 'rUpperTwist', target.tw);
  set(L ? 'lLowerY' : 'rLowerY', L ? target.loY : -target.loY);
  set(L ? 'lLowerZ' : 'rLowerZ', L ? target.loZ : -target.loZ);
}

export class Character {
  constructor(vrm) {
    this.vrm = vrm;
    this.time = 0;
    this.motions = [];
    this.exprCurrent = Object.fromEntries(EXPRESSIONS.map((e) => [e, 0]));
    this.exprTarget = { ...this.exprCurrent };
    this.exprHold = 0;
    this.blinkTimer = 2;
    this.blinkPhase = 0;
    this.talkTime = 0;
    this.patAmount = 0; // 0..1, пока гладят по голове
    this.headLook = new THREE.Vector2(); // -1..1, куда смотрит голова
    this.poseName = 'stand';
    this.posePrev = { ...BASE_POSE };
    this.poseT = 1;
    this.twistQ = new THREE.Quaternion();
    this.dancing = false;
    this.poked = new Set();
    this.flip = vrm.meta?.metaVersion === '0' ? -1 : 1;
    this.mixer = null; // для mocap-анимаций (.vrma)
    this.axisX = new THREE.Vector3(1, 0, 0);

    this.lookTarget = new THREE.Object3D();
    if (vrm.lookAt) vrm.lookAt.target = this.lookTarget;

    this.bones = {};
    const names = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
      'leftShoulder', 'rightShoulder',
      'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand',
      'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg'];
    for (const n of names) this.bones[n] = vrm.humanoid.getNormalizedBoneNode(n);
    // Пальцы: [кость, сторона, сила сгиба]. Прямые пальцы — главный признак «манекена».
    this.fingers = [];
    for (const side of ['left', 'right']) {
      for (const [finger, k] of [['Index', 0.7], ['Middle', 0.85], ['Ring', 1], ['Little', 1.15]]) {
        for (const [seg, segK] of [['Proximal', 0.32], ['Intermediate', 0.45], ['Distal', 0.3]]) {
          const node = vrm.humanoid.getNormalizedBoneNode(`${side}${finger}${seg}`);
          if (node) this.fingers.push({ node, side, curl: k * segK });
        }
      }
      for (const [seg, k] of [['ThumbMetacarpal', 0.25], ['ThumbProximal', 0.3], ['ThumbDistal', 0.25]]) {
        const node = vrm.humanoid.getNormalizedBoneNode(`${side}${seg}`);
        if (node) this.fingers.push({ node, side, thumb: true, curl: k });
      }
    }

    vrm.humanoid.update();
    vrm.scene.updateMatrixWorld(true);
    const headPos = new THREE.Vector3();
    (vrm.humanoid.getRawBoneNode('head') ?? vrm.scene).getWorldPosition(headPos);
    this.headHeight = headPos.y;
    // Масштаб зон относительно «стандартной» модели с головой на 1.4 м.
    this.scale = this.headHeight / 1.4;
    this.measureBody();
    this.armFix = { left: 0, right: 0 };
    this.stabilizeSprings();

    this.zones = ZONE_DEFS
      .map((d) => ({ ...d, node: vrm.humanoid.getRawBoneNode(d.bone), center: new THREE.Vector3() }))
      .filter((z) => z.node);
  }

  // ---------- Реакции ----------

  react({ expression, motion, side, strength = 1 }) {
    if (expression) this.setExpression(expression, strength);
    if (motion) this.playMotion(motion, side);
  }

  setExpression(name, weight = 1, hold = 2.2) {
    for (const e of EXPRESSIONS) this.exprTarget[e] = 0;
    this.exprTarget[name] = weight;
    this.exprHold = hold;
  }

  playMotion(name, side = Math.random() < 0.5 ? 'left' : 'right') {
    const durations = {
      tiltHead: 1.6, flinch: 1.0, raiseHand: 2.2, sway: 1.6, hop: 0.9, turnAway: 2.6,
      lookAround: 3.2, stretch: 2.8, shift: 3.0, touchHair: 3.0, bounce: 1.4,
      squirm: 1.3, shyLegs: 1.8, sigh: 2.6, clasp: 4.5, handOnHip: 4.5, nails: 3.4,
    };
    this.motions = this.motions.filter((m) => m.name !== name);
    this.motions.push({ name, side, t: 0, dur: durations[name] ?? 1.5 });
  }

  // Поза из редактора: применяется сразу, без плавного перехода.
  setCustomPose(params) {
    POSES.custom = { label: 'Своя', ...params };
    this.poseName = 'custom';
    this.poseT = 1;
  }

  // Текущие значения базовой позы (для редактора).
  getPoseParams() {
    return this.currentBasePose();
  }

  setPose(name) {
    if (!POSES[name] || name === this.poseName) return;
    this.posePrev = this.currentBasePose();
    this.poseName = name;
    this.poseT = 0;
  }

  currentBasePose() {
    const target = { ...BASE_POSE, ...POSES[this.poseName] };
    const k = easeInOut(Math.min(this.poseT / 0.7, 1));
    const out = {};
    for (const key in BASE_POSE) out[key] = this.posePrev[key] + (target[key] - this.posePrev[key]) * k;
    return out;
  }

  // ---------- Mocap (.vrma) ----------

  playClip(clip) {
    this.stopClip();
    this.mixer = new THREE.AnimationMixer(this.vrm.scene);
    this.mixer.clipAction(clip).play();
  }

  stopClip() {
    if (!this.mixer) return;
    this.mixer.stopAllAction();
    this.mixer = null;
  }

  talk(seconds) {
    this.talkTime = Math.max(this.talkTime, seconds);
  }

  // ---------- Зоны касания ----------

  updateZones() {
    const tmp = new THREE.Vector3();
    for (const z of this.zones) {
      z.node.getWorldPosition(z.center);
      tmp.fromArray(z.offset).multiplyScalar(this.scale);
      z.center.add(tmp);
      z.worldRadius = z.radius * this.scale;
    }
  }

  hitTest(ray) {
    let best = null;
    const sphere = new THREE.Sphere();
    const hit = new THREE.Vector3();
    for (const z of this.zones) {
      sphere.set(z.center, z.worldRadius);
      if (ray.intersectSphere(sphere, hit)) {
        // Ближайшая к лучу зона (по расстоянию от центра до луча),
        // чтобы перекрывающиеся сферы не спорили по порядку.
        const d = ray.distanceToPoint(z.center) / z.worldRadius;
        if (!best || d < best.score) best = { ...z, point: hit.clone(), score: d };
      }
    }
    return best;
  }

  // ---------- Кадр ----------

  update(dt) {
    this.time += dt;
    const t = this.time;
    const b = this.bones;

    // Сбрасываем все кости в исходную позу, дальше накладываем слои.
    this.vrm.humanoid.resetNormalizedPose();

    // Mocap-анимация управляет телом сама; мимика и физика — как обычно.
    if (this.mixer) {
      this.mixer.update(dt);
      this.finishFrame(dt);
      return;
    }

    this.poseT += dt;
    // В танце руки свободны, поэтому берём стойку «Стоит».
    const pose = this.dancing ? { ...BASE_POSE } : this.currentBasePose();
    const poseDef = POSES[this.poseName];

    if (poseDef.wave === 'left') pose.lLowerZ += Math.sin(t * 9) * 0.25;

    // Дыхание: грудь и плечи чуть поднимаются.
    const breath = Math.sin(t * 1.5);
    pose.spineX += breath * 0.02;
    pose.lShoulderZ += breath * 0.035;
    pose.rShoulderZ -= breath * 0.035;
    pose.lUpperZ += breath * 0.025;
    pose.rUpperZ -= breath * 0.025;

    // Перенос веса: стоит то на одной, то на другой ноге (контрапост).
    // tanh делает «плато» — она подолгу стоит на одной ноге, а не качается маятником.
    const w = Math.tanh(2.2 * Math.sin(t * 0.42)) / Math.tanh(2.2);
    const relaxL = Math.max(0, -w); // левая нога расслаблена
    const relaxR = Math.max(0, w); // правая нога расслаблена
    pose.hipsX += w * 0.035 * this.scale;
    pose.hipsZ += w * 0.075;
    pose.lLegZ -= w * 0.075; // ноги остаются вертикальными, бёдра наклоняются
    pose.rLegZ -= w * 0.075;
    pose.spineZ -= w * 0.12;
    pose.headZ += w * 0.06;
    pose.rKneeX += relaxR * 0.3;
    pose.rLegX -= relaxR * 0.13;
    pose.lKneeX += relaxL * 0.3;
    pose.lLegX -= relaxL * 0.13;
    // Рука со стороны опорной ноги чуть отходит от бедра.
    pose.lUpperZ += relaxR * 0.06;
    pose.rUpperZ -= relaxL * 0.06;

    // Медленный поворот корпуса и «блуждающий» взгляд.
    const twist = Math.sin(t * 0.29 + 1.3);
    pose.hipsRotY += twist * 0.08;
    pose.spineY -= twist * 0.05;
    pose.lUpperX += twist * 0.05;
    pose.rUpperX -= twist * 0.05;
    pose.headY += Math.sin(t * 0.31) * 0.14 + Math.sin(t * 0.83) * 0.04;
    pose.headX += Math.sin(t * 0.23) * 0.05;
    pose.headZ += Math.sin(t * 0.47 + 0.9) * 0.04;

    if (this.dancing) this.applyDance(pose, t);

    // Голова чуть поворачивается за пальцем/курсором.
    pose.headY += this.headLook.x * 0.35;
    pose.headX += -this.headLook.y * 0.2;

    // Пока гладят — голова клонится и прижимается к руке.
    pose.headZ += this.patAmount * 0.18 * Math.sin(t * 2.2);
    pose.headX += this.patAmount * 0.12;

    // Движения-реакции. Руки не «прибавляются» к текущей позе (из-за этого их
    // выворачивало), а плавно переходят в позу реакции и обратно.
    for (const m of this.motions) {
      m.t += dt;
      const e = envelope(m.t, m.dur);
      const s = m.side === 'left' ? 1 : -1;
      const arm = (side, target) => blendArm(pose, side, target, e);
      switch (m.name) {
        case 'tiltHead':
          pose.headZ += 0.25 * e * s;
          pose.spineZ += 0.05 * e * s;
          break;
        case 'flinch':
          // «Ой!» — отшатнулась, ладошки к лицу.
          pose.spineX -= 0.15 * e;
          pose.headX -= 0.12 * e;
          arm('left', { upZ: -1.1, upX: -0.47, tw: 0, loY: -2.4, loZ: 0 });
          arm('right', { upZ: -1.1, upX: -0.47, tw: 0, loY: -2.4, loZ: 0 });
          break;
        case 'raiseHand':
          arm(m.side, { upZ: 0.15, upX: 0, tw: 0, loY: -0.15, loZ: 1.3 + Math.sin(m.t * 10) * 0.25 });
          pose.headZ += 0.12 * e * s;
          pose.headY += 0.2 * e * s;
          break;
        case 'sway':
          pose.spineZ += Math.sin(m.t * 6) * 0.08 * e;
          pose.headZ -= Math.sin(m.t * 6) * 0.1 * e;
          break;
        case 'hop':
          pose.hipsY += Math.abs(Math.sin(m.t * 10)) * 0.04 * e * this.scale;
          pose.spineZ += Math.sin(m.t * 18) * 0.06 * e;
          pose.headZ += Math.sin(m.t * 18) * 0.08 * e;
          break;
        case 'squirm':
          // Ёжится от прикосновения: плечи вверх, мелкое смущённое покачивание.
          pose.lShoulderZ += 0.12 * e;
          pose.rShoulderZ -= 0.12 * e;
          pose.spineZ += Math.sin(m.t * 11) * 0.035 * e;
          pose.spineX += 0.05 * e;
          pose.headX += 0.1 * e;
          pose.headZ += 0.08 * e * s;
          break;
        case 'shyLegs':
          // Смущённо сводит колени, переминается.
          pose.lLegZ -= 0.07 * e;
          pose.rLegZ += 0.07 * e;
          pose.lKneeX += (0.12 + Math.max(0, Math.sin(m.t * 5)) * 0.12) * e;
          pose.rKneeX += (0.12 + Math.max(0, -Math.sin(m.t * 5)) * 0.12) * e;
          pose.lLegX -= 0.06 * e;
          pose.rLegX -= 0.06 * e;
          pose.hipsY -= 0.012 * e * this.scale;
          pose.headX += 0.12 * e;
          pose.spineX += 0.04 * e;
          break;
        case 'lookAround': {
          // Оглядывается: сначала в одну сторону, потом в другую.
          const p = m.t / m.dur;
          pose.headY += Math.sin(p * Math.PI * 2) * 0.45 * e * s;
          pose.headX -= 0.05 * e;
          break;
        }
        case 'stretch':
          // Потягивается: руки вверх, спина назад.
          arm('left', { upZ: 0.65, upX: 0, tw: 0, loY: 0, loZ: 0.4 });
          arm('right', { upZ: 0.65, upX: 0, tw: 0, loY: 0, loZ: 0.4 });
          pose.spineX -= 0.12 * e;
          pose.headX -= 0.2 * e;
          break;
        case 'shift':
          // Переносит вес на другую ногу.
          pose.hipsZ += 0.07 * e * s;
          pose.spineZ -= 0.09 * e * s;
          pose.headZ += 0.06 * e * s;
          break;
        case 'touchHair':
          // Поправляет волосы у виска.
          arm(m.side, { upZ: -0.1, upX: -0.55, tw: 0, loY: -0.2, loZ: 2.4 });
          pose.headZ += 0.14 * e * s;
          pose.headY -= 0.12 * e * s;
          break;
        case 'bounce':
          // Пружинит на носочках.
          pose.hipsY += Math.abs(Math.sin(m.t * Math.PI * 2 / 0.7)) * 0.02 * e * this.scale;
          pose.headX += Math.sin(m.t * 9) * 0.03 * e;
          break;
        case 'sigh': {
          // Глубокий вдох-выдох: плечи вверх, потом расслабленно вниз.
          const p = m.t / m.dur;
          const inhale = Math.sin(Math.min(p * 1.6, 1) * Math.PI);
          pose.lShoulderZ += 0.14 * inhale * e;
          pose.rShoulderZ -= 0.14 * inhale * e;
          pose.spineX -= 0.05 * inhale * e;
          pose.headX -= 0.08 * inhale * e;
          break;
        }
        case 'clasp':
          // Сцепила руки перед собой, покачивается.
          arm('left', { upZ: -0.85, upX: 0.15, tw: 0.75, loY: -2.1, loZ: 0 });
          arm('right', { upZ: -0.85, upX: 0.15, tw: 0.75, loY: -2.1, loZ: 0 });
          pose.spineY += Math.sin(m.t * 1.6) * 0.08 * e;
          pose.headZ += 0.08 * e * s;
          break;
        case 'handOnHip':
          // Одна рука на бедре, вес на этой ноге.
          arm(m.side, { upZ: -0.75, upX: 0.2, tw: 0.95, loY: -1.5, loZ: 0 });
          pose.hipsZ += 0.05 * e * s;
          pose.spineZ -= 0.06 * e * s;
          pose.headZ -= 0.06 * e * s;
          break;
        case 'nails':
          // Разглядывает ногти.
          arm(m.side, { upZ: -1.1, upX: -0.5, tw: 0, loY: -2.3, loZ: 0.2 });
          pose.headX += 0.18 * e;
          pose.headY += 0.15 * e * s;
          break;
        case 'turnAway':
          // Обиделась: отвернулась, руки скрещены.
          pose.spineY += 0.45 * e * s;
          pose.headY += 0.5 * e * s;
          pose.headX += 0.12 * e;
          arm('left', { upZ: -0.95, upX: -0.2, tw: 0, loY: -2.3, loZ: 0 });
          arm('right', { upZ: -0.95, upX: -0.2, tw: 0, loY: -2.3, loZ: 0 });
          break;
      }
    }
    this.motions = this.motions.filter((m) => m.t < m.dur);

    // Мелкие движения в покое, если сейчас ничего не происходит.
    this.idleTimer = (this.idleTimer ?? 4) - dt;
    if (this.idleTimer <= 0) {
      this.idleTimer = 3.5 + Math.random() * 5;
      if (this.motions.length === 0 && this.patAmount < 0.1) {
        const r = Math.random();
        const busyArms = this.poseName !== 'stand';
        if (this.dancing) { /* в танце и так весело */ }
        else if (busyArms) this.playMotion(pick(['shift', 'lookAround', 'tiltHead', 'sigh', 'bounce']));
        else this.playMotion(pick([
          'shift', 'lookAround', 'tiltHead', 'sigh', 'bounce',
          'touchHair', 'clasp', 'handOnHip', 'nails', 'stretch',
        ]));
      }
    }

    // Применяем позу к нормализованным костям.
    const spineBone = b.chest ?? b.spine;
    this.rot(b.spine, pose.spineX * 0.5, pose.spineY * 0.5, pose.spineZ * 0.5);
    this.rot(spineBone, pose.spineX * 0.5, pose.spineY * 0.5, pose.spineZ * 0.5);
    this.rot(b.neck, pose.headX * 0.4, pose.headY * 0.4, pose.headZ * 0.4);
    this.rot(b.head, pose.headX * 0.6, pose.headY * 0.6, pose.headZ * 0.6);
    this.applyUpperArm('left', pose, 0);
    this.applyUpperArm('right', pose, 0);
    this.rot(b.leftLowerArm, 0, pose.lLowerY, pose.lLowerZ);
    this.rot(b.rightLowerArm, 0, pose.rLowerY, pose.rLowerZ);
    this.rot(b.leftShoulder, 0, 0, pose.lShoulderZ);
    this.rot(b.rightShoulder, 0, 0, pose.rShoulderZ);
    // Кисти мягко опущены к ладони.
    this.rot(b.leftHand, 0, 0, -pose.handBend);
    this.rot(b.rightHand, 0, 0, pose.handBend);
    this.rot(b.leftUpperLeg, pose.lLegX, 0, pose.lLegZ);
    this.rot(b.rightUpperLeg, pose.rLegX, 0, pose.rLegZ);
    this.rot(b.leftLowerLeg, pose.lKneeX, 0, 0);
    this.rot(b.rightLowerLeg, pose.rKneeX, 0, 0);
    // Пальцы слегка согнуты и чуть «дышат».
    const curl = 1 + Math.sin(t * 0.7) * 0.08;
    for (const f of this.fingers) {
      const s = f.side === 'left' ? -1 : 1;
      if (f.thumb) this.rot(f.node, 0, -s * f.curl * curl, 0);
      else this.rot(f.node, 0, 0, s * f.curl * curl);
    }
    // Не даём кистям уйти внутрь тела: при необходимости отводим руки наружу.
    this.solveArms(pose, dt);
    if (b.hips) {
      b.hips.position.y += pose.hipsY;
      b.hips.position.x += pose.hipsX * this.flip;
      this.rot(b.hips, 0, pose.hipsRotY, pose.hipsZ);
    }

    this.finishFrame(dt);
  }

  // Поворот нормализованной кости. У VRM 0.x модель развёрнута на 180°,
  // поэтому оси X и Z у неё зеркальные — компенсируем знаком.
  rot(bone, x, y, z) {
    bone?.rotation.set(x * this.flip, y, z * this.flip);
  }

  finishFrame(dt) {
    this.restorePokes();
    if (this.dancing && !this.mixer) this.exprTarget.happy = Math.max(this.exprTarget.happy, 0.5);
    this.updateExpressions(dt);
    this.vrm.update(dt);
    this.vrm.scene.updateMatrixWorld(true);
    this.updateZones();
  }

  // Танец: пружинит коленями в такт (~120 BPM), переносит вес с ноги на ногу,
  // согнутые руки качаются вперёд-назад, голова кивает.
  applyDance(pose, t) {
    const b = t * Math.PI * 2; // 1 цикл в секунду = 2 «удара»
    const bounce = Math.abs(Math.sin(b));
    const w = Math.sin(b * 0.5); // шаг в сторону раз в такт
    const knee = 0.12 + 0.2 * bounce;
    pose.lKneeX += knee + Math.max(0, -w) * 0.25;
    pose.rKneeX += knee + Math.max(0, w) * 0.25;
    pose.lLegX -= (knee + Math.max(0, -w) * 0.25) * 0.5;
    pose.rLegX -= (knee + Math.max(0, w) * 0.25) * 0.5;
    pose.hipsY -= (0.012 + 0.022 * bounce) * this.scale;
    pose.hipsX += w * 0.04 * this.scale;
    pose.hipsZ += w * 0.09;
    pose.lLegZ -= w * 0.09;
    pose.rLegZ -= w * 0.09;
    pose.spineZ -= w * 0.13;
    pose.hipsRotY += Math.sin(b * 0.25) * 0.25;
    pose.spineY -= Math.sin(b * 0.25) * 0.12;
    pose.headX += Math.sin(b * 2) * 0.06;
    pose.headZ += w * 0.12;
    pose.lShoulderZ += bounce * 0.05;
    pose.rShoulderZ -= bounce * 0.05;
    const swing = Math.sin(b * 0.5);
    blendArm(pose, 'left', { upZ: -1.05, upX: -0.3 + 0.4 * swing, tw: 0.4, loY: -1.5 - 0.2 * bounce, loZ: 0 }, 1);
    blendArm(pose, 'right', { upZ: -1.05, upX: -0.3 - 0.4 * swing, tw: 0.4, loY: -1.5 - 0.2 * bounce, loZ: 0 }, 1);
  }

  // Меряем «объём» тела в исходной позе: для каждой высоты (шаг 2 см) — полуширину
  // и переднюю/заднюю границы туловища вместе с одеждой. По ним потом проверяем,
  // не попала ли кисть внутрь тела.
  measureBody() {
    const raw = (n) => this.vrm.humanoid.getRawBoneNode(n);
    const hips = raw('hips');
    const shoulder = raw('leftUpperArm');
    const knee = raw('leftLowerLeg');
    this.bodyBins = new Map();
    if (!hips || !shoulder) return;
    this.restHips = hips.getWorldPosition(new THREE.Vector3());
    const shoulderY = shoulder.getWorldPosition(new THREE.Vector3()).y;
    const shoulderX = Math.abs(shoulder.getWorldPosition(new THREE.Vector3()).x);
    const yMin = knee ? knee.getWorldPosition(new THREE.Vector3()).y : this.restHips.y - 0.4;
    const yMax = shoulderY - 0.04 * this.scale;
    const v = new THREE.Vector3();
    this.vrm.scene.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.some((m) => /hair|face|eye/i.test(m.name))) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        if (v.y < yMin || v.y > yMax || Math.abs(v.x) > shoulderX) continue; // руки в T-позе не считаем
        const key = Math.round(v.y / 0.02);
        const bin = this.bodyBins.get(key) ?? { hw: 0, zMin: Infinity, zMax: -Infinity };
        bin.hw = Math.max(bin.hw, Math.abs(v.x));
        bin.zMin = Math.min(bin.zMin, v.z);
        bin.zMax = Math.max(bin.zMax, v.z);
        this.bodyBins.set(key, bin);
      }
    });
  }

  // true, если точка (с запасом на толщину кисти) внутри туловища.
  insideBody(p, hipsShift) {
    const bin = this.bodyBins.get(Math.round((p.y - hipsShift.y) / 0.02));
    if (!bin) return false;
    const m = 0.045 * this.scale;
    const x = (p.x - hipsShift.x) / (bin.hw + m);
    const zc = (bin.zMin + bin.zMax) / 2;
    const hd = (bin.zMax - bin.zMin) / 2 + m;
    const z = (p.z - hipsShift.z - zc) / hd;
    return x * x + z * z < 1;
  }

  applyUpperArm(side, pose, extra) {
    const L = side === 'left';
    const bone = L ? this.bones.leftUpperArm : this.bones.rightUpperArm;
    if (!bone) return;
    const z = L ? pose.lUpperZ + extra : pose.rUpperZ - extra;
    this.rot(bone, L ? pose.lUpperX : pose.rUpperX, 0, z);
    bone.quaternion.multiply(this.twistQ.setFromAxisAngle(this.axisX, (L ? pose.lUpperTwist : pose.rUpperTwist) * this.flip));
  }

  solveArms(pose, dt) {
    if (!this.bodyBins?.size) return;
    const hipsNode = this.vrm.humanoid.getRawBoneNode('hips');
    const shift = hipsNode.getWorldPosition(new THREE.Vector3()).sub(this.restHips);
    const hand = new THREE.Vector3();
    const elbow = new THREE.Vector3();
    const mid = new THREE.Vector3();
    for (const side of ['left', 'right']) {
      const handNode = this.bones[`${side}Hand`];
      const lower = this.bones[`${side}LowerArm`];
      if (!handNode || !lower) continue;
      // Ищем минимальный отвод руки, при котором кисть и предплечье снаружи.
      let need = 0;
      for (let i = 0; i <= 10; i++) {
        this.applyUpperArm(side, pose, need);
        this.bones[`${side}UpperArm`].updateWorldMatrix(true, true);
        handNode.getWorldPosition(hand);
        lower.getWorldPosition(elbow);
        mid.lerpVectors(elbow, hand, 0.5);
        if (!this.insideBody(hand, shift) && !this.insideBody(mid, shift)) break;
        need += 0.07;
      }
      // Плавно, чтобы рука не дёргалась.
      const k = 1 - Math.exp(-dt * (need > this.armFix[side] ? 14 : 4));
      this.armFix[side] += (need - this.armFix[side]) * k;
      this.applyUpperArm(side, pose, this.armFix[side]);
    }
  }

  // Физика груди в моделях VRoid часто почти без демпфирования — из-за этого
  // её выгибает при движениях. Оставляем мягкое естественное движение без выворотов.
  stabilizeSprings() {
    const joints = this.vrm.springBoneManager?.joints;
    if (!joints) return;
    for (const j of joints) {
      if (!/bust|breast/i.test(j.bone.name)) continue;
      j.settings.dragForce = Math.max(j.settings.dragForce, 0.25);
      j.settings.stiffness = Math.max(j.settings.stiffness, 1.0);
      j.settings.gravityPower = 0;
      j.userData ??= {};
      j.userData.noPoke = true;
    }
  }

  // Касание толкает одежду и волосы с физикой (spring bones) рядом с точкой касания.
  // Толкаем только горизонтально — в сторону от камеры и вбок, не вверх.
  poke(point, dir, strength = 1) {
    const joints = this.vrm.springBoneManager?.joints;
    if (!joints) return;
    const push = new THREE.Vector3(dir.x, 0, dir.z);
    if (push.lengthSq() < 1e-6) return;
    push.normalize();
    const radius = 0.22 * this.scale;
    const pos = new THREE.Vector3();
    for (const j of joints) {
      if (j.userData?.noPoke) continue;
      j.bone.getWorldPosition(pos);
      const d = pos.distanceTo(point);
      if (d > radius) continue;
      j.userData ??= {};
      if (!j.userData.poke) {
        j.userData.poke = { power: j.settings.gravityPower, dir: j.settings.gravityDir.clone() };
      }
      const k = (1 - d / radius) * strength;
      j.settings.gravityDir.copy(push);
      j.settings.gravityPower = Math.max(j.settings.gravityPower, 1.6 * k);
      j.userData.pokeUntil = this.time + 0.22;
      this.poked.add(j);
    }
  }

  restorePokes() {
    for (const j of this.poked) {
      if (this.time < j.userData.pokeUntil) continue;
      j.settings.gravityPower = j.userData.poke.power;
      j.settings.gravityDir.copy(j.userData.poke.dir);
      j.userData.poke = null;
      this.poked.delete(j);
    }
  }

  updateExpressions(dt) {
    const em = this.vrm.expressionManager;
    if (!em) return;

    // Эмоция держится, потом плавно уходит в нейтраль.
    this.exprHold -= dt;
    if (this.exprHold <= 0) for (const e of EXPRESSIONS) this.exprTarget[e] = 0;
    if (this.patAmount > 0.2) this.exprTarget.happy = Math.max(this.exprTarget.happy, this.patAmount);

    const k = 1 - Math.exp(-dt * 8);
    for (const e of EXPRESSIONS) {
      this.exprCurrent[e] += (this.exprTarget[e] - this.exprCurrent[e]) * k;
      em.setValue(e, this.exprCurrent[e]);
    }

    // Моргание (кроме моментов, когда глаза и так закрыты от улыбки).
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0 && this.blinkPhase === 0) this.blinkPhase = 0.001;
    let blink = 0;
    if (this.blinkPhase > 0) {
      this.blinkPhase += dt / 0.16;
      blink = Math.sin(Math.min(this.blinkPhase, 1) * Math.PI);
      if (this.blinkPhase >= 1) {
        this.blinkPhase = 0;
        this.blinkTimer = 2 + Math.random() * 4;
      }
    }
    const eyesBusy = Math.max(this.exprCurrent.happy, this.exprCurrent.relaxed);
    em.setValue('blink', blink * (1 - eyesBusy));

    // Рот шевелится, пока она «говорит».
    this.talkTime -= dt;
    const mouth = this.talkTime > 0 ? (0.5 + 0.5 * Math.sin(this.time * 22)) * 0.6 : 0;
    em.setValue('aa', mouth);
  }

  headScreenAnchor(out) {
    const head = this.vrm.humanoid.getRawBoneNode('head');
    head.getWorldPosition(out);
    out.y += 0.3 * this.scale;
    return out;
  }
}
