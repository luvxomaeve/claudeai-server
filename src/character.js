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
  lUpperX: -0.06, rUpperX: -0.06,
  lUpperTwist: 0, rUpperTwist: 0,
  lLowerY: -0.45, rLowerY: 0.45,
  lLowerZ: 0, rLowerZ: 0,
  hipsY: 0, hipsZ: 0, hipsX: 0, hipsRotY: 0, lFootIn: 0, rFootIn: 0,
  lLegX: 0, rLegX: 0, lLegZ: 0, rLegZ: 0, lKneeX: 0, rKneeX: 0,
  lShoulderZ: 0, rShoulderZ: 0, handBend: 0.25,
};

export { BASE_POSE };

// Позы задаются целиком, ноги и бёдра тоже — так поза выглядит цельной, а не «руки отдельно».
// Если руки где-то заденут тело, их аккуратно отведёт solveArms().
export const POSES = {
  stand: { label: 'Стоит' },
  flirty: {
    label: 'Кокетка',
    // Левая рука на бедре, бедро в сторону, правая нога расслаблена, голова набок.
    lUpperZ: -0.75, lUpperX: 0.2, lUpperTwist: 0.95, lLowerY: -1.5,
    rUpperZ: 1.12, rUpperX: -0.05, rLowerY: 0.5,
    hipsZ: 0.08, hipsX: 0.03, spineZ: -0.1, headZ: 0.16, headY: -0.08,
    rKneeX: 0.28, rLegX: -0.12, lLegZ: -0.08, rLegZ: -0.08,
  },
  hips: {
    label: 'Руки в боки',
    lUpperZ: -0.75, rUpperZ: 0.75, lUpperX: 0.2, rUpperX: 0.2,
    lUpperTwist: 0.95, rUpperTwist: 0.95, lLowerY: -1.5, rLowerY: 1.5,
    hipsZ: -0.04, spineZ: 0.03, headZ: 0.06, headX: -0.04, lKneeX: 0.15, lLegX: -0.06,
  },
  crossed: {
    label: 'Скрестила руки',
    lUpperZ: -1.0, lUpperX: -0.45, lUpperTwist: 0, lLowerY: -2.2,
    rUpperZ: 1.0, rUpperX: -0.5, rUpperTwist: 0, rLowerY: 2.45,
    spineX: -0.03, headX: -0.06, headZ: -0.08, hipsZ: 0.05, lKneeX: 0.2, lLegX: -0.08,
  },
  shy: {
    label: 'Скромница',
    lUpperZ: -0.85, rUpperZ: 0.85, lUpperX: 0.15, rUpperX: 0.15,
    lUpperTwist: 0.75, rUpperTwist: 0.75, lLowerY: -2.1, rLowerY: 2.1,
    spineX: 0.06, headX: 0.16, headZ: 0.12,
    lLegZ: -0.05, rLegZ: 0.05, lKneeX: 0.18, lLegX: -0.08,
  },
  behind: {
    label: 'Руки за спиной',
    armDir: 1,
    lUpperZ: -0.95, rUpperZ: 0.95, lUpperX: 0.1, rUpperX: 0.1,
    lUpperTwist: 1.3, rUpperTwist: 1.3, lLowerY: -1.6, rLowerY: 1.6,
    spineX: -0.05, headZ: -0.1, headX: -0.03, rKneeX: 0.2, rLegX: -0.08,
  },
  think: {
    label: 'Задумалась',
    lUpperZ: -0.85, lUpperX: 0.15, lUpperTwist: 0.75, lLowerY: -2.1,
    rUpperZ: 1.0, rUpperX: -0.7, rUpperTwist: 0.5, rLowerY: 2.6,
    headZ: -0.12, headX: 0.05, spineZ: 0.04, hipsZ: -0.05, lKneeX: 0.18, lLegX: -0.07,
  },
  hello: {
    label: 'Привет',
    lUpperZ: 0.15, lLowerZ: 1.3, lLowerY: 0,
    headZ: 0.1, spineZ: -0.04, hipsZ: 0.04, rKneeX: 0.15,
    wave: 'left',
  },
};

// Встроенные анимации (кнопки в панели анимаций).
export const LOOPS = [
  { id: 'cute', label: '🌸 Милое ожидание' },
  { id: 'flirty', label: '💋 Кокетливо' },
  { id: 'shy', label: '🙈 Застенчиво' },
  { id: 'happy', label: '✨ Радуется' },
  { id: 'dance2', label: '🎵 Милый танец' },
];

// Движения, которые сами управляют руками.
const ARM_MOTIONS = new Set(['flinch', 'raiseHand', 'stretch', 'touchHair', 'turnAway', 'clasp', 'handOnHip', 'nails']);

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
// eLower — отдельный вес для предплечья: локоть сгибается раньше плеча,
// чтобы рука не вытягивалась палкой в середине движения.
function blendArm(pose, side, target, e, eLower = e) {
  const L = side === 'left';
  const set = (key, value, w) => { pose[key] += (value - pose[key]) * w; };
  set(L ? 'lUpperZ' : 'rUpperZ', L ? target.upZ : -target.upZ, e);
  set(L ? 'lUpperX' : 'rUpperX', target.upX, e);
  set(L ? 'lUpperTwist' : 'rUpperTwist', target.tw, e);
  set(L ? 'lLowerY' : 'rLowerY', L ? target.loY : -target.loY, eLower);
  set(L ? 'lLowerZ' : 'rLowerZ', L ? target.loZ : -target.loZ, eLower);
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
      'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot'];
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
    this.initIK();
    this.handTargets = { left: null, right: null }; // позы «пальцем»: цель кисти в системе груди
    this.headOffset = { x: 0, y: 0 };
    this.bodyOffset = { spineX: 0, spineY: 0, spineZ: 0, hipsX: 0, hipsY: 0, hipsZ: 0 };
    this.footOffset = { left: null, right: null }; // ступни, сдвинутые пальцем
    this.sit = 0; // 0 — стоит, 1 — сидит на полу (свайп вниз)
    this.sitS = 0; // сглаженное значение
    this.sitDropNow = 0;
    this.loop = null; // встроенная анимация: cute | flirty | shy | happy | dance2
    this.armFix = { left: { need: 0, dir: -1 }, right: { need: 0, dir: -1 } };
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
    this.importTouchPose(POSES[name].touch);
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
    pose.hipsY -= Math.abs(w) * 0.01 * this.scale;
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
    else if (this.loop) this.applyLoop(pose, t);

    // Сесть на пол (свайп вниз): бёдра опускаются к полу, ступни уходят вперёд,
    // колени поднимаются — она садится, обняв колени. Плавно, с пружиной.
    this.sitS += (this.sit - this.sitS) * (1 - Math.exp(-dt * 5));
    if (this.sitS > 0.001) {
      const s = this.sitS;
      const { p1, p2 } = this.sitPhases(s);
      this.sitDropNow = this.sitDropFor(s);
      pose.hipsY -= this.sitDropNow;
      // В приседе корпус наклонён вперёд, сев на пол — выпрямляется.
      pose.spineX += 0.32 * p1 - 0.26 * p2;
      pose.headX -= 0.28 * p1 - 0.2 * p2;
      pose.hipsZ *= 1 - s;
      pose.hipsX *= 1 - s;
    }

    // Голова, корпус и таз, заданные пальцем в режиме позы.
    pose.headY += this.headOffset.y;
    pose.headX += this.headOffset.x;
    for (const key in this.bodyOffset) pose[key] += this.bodyOffset[key];
    // Наклон вперёд — голова чуть приподнимается, чтобы смотреть на тебя.
    pose.headX -= this.bodyOffset.spineX * 0.4;

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
          pose.lFootIn += 0.035 * e * this.scale;
          pose.rFootIn += 0.035 * e * this.scale;
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
        if (this.dancing || this.loop || this.sitS > 0.2) { /* она и так занята */ }
        else if (busyArms) this.playMotion(pick(['shift', 'lookAround', 'tiltHead', 'sigh', 'bounce']));
        else this.playMotion(pick([
          'shift', 'lookAround', 'tiltHead', 'sigh', 'bounce',
          'touchHair', 'clasp', 'handOnHip', 'nails', 'stretch',
        ]));
      }
    }

    // Пружины: каждый сустав догоняет цель с инерцией (бёдра тяжёлые,
    // голова и руки чуть запаздывают) — движения становятся плавными и живыми.
    Object.assign(pose, this.springPose(pose, dt));

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
    if (b.hips) {
      b.hips.position.y += pose.hipsY;
      b.hips.position.x += pose.hipsX * this.flip;
      this.rot(b.hips, 0, pose.hipsRotY, pose.hipsZ);
    }
    // Ступни стоят на полу: колени сгибаются сами под движение бёдер.
    this.plantFeet(pose);
    // Не даём кистям уйти внутрь тела: при необходимости отводим руки наружу.
    this.solveArms(pose, dt);
    // Руки, выставленные пальцем, тянутся к своим точкам.
    this.applyHandTargets();

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

  // ---------- IK (обратная кинематика) ----------

  initIK() {
    const b = this.bones;
    this.restFoot = {};
    for (const side of ['left', 'right']) {
      const foot = b[`${side}Foot`];
      if (!foot) continue;
      foot.updateWorldMatrix(true, false);
      this.restFoot[side] = {
        pos: foot.getWorldPosition(new THREE.Vector3()),
        quat: foot.getWorldQuaternion(new THREE.Quaternion()),
      };
    }
    this.ikTmp = {
      a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(),
      t: new THREE.Vector3(), d: new THREE.Vector3(), p: new THREE.Vector3(),
      e: new THREE.Vector3(), q: new THREE.Quaternion(), q2: new THREE.Quaternion(),
    };
  }

  // Поворачивает кость так, чтобы направление from (в мире) стало to.
  rotateBoneTo(bone, from, to) {
    const { q, q2 } = this.ikTmp;
    if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
    q.setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
    bone.getWorldQuaternion(q2);
    q2.premultiply(q);
    this.setWorldQuat(bone, q2);
  }

  setWorldQuat(bone, worldQuat) {
    const parent = new THREE.Quaternion();
    bone.parent.getWorldQuaternion(parent);
    bone.quaternion.copy(parent.invert().multiply(worldQuat));
    bone.updateWorldMatrix(false, true);
  }

  // Двухзвенный IK: upper → lower → end дотягивается до target, сгиб в сторону pole.
  twoBoneIK(upper, lower, end, target, pole) {
    const { a, b, c, t, d, p, e } = this.ikTmp;
    upper.updateWorldMatrix(true, true);
    upper.getWorldPosition(a);
    lower.getWorldPosition(b);
    end.getWorldPosition(c);
    const l1 = a.distanceTo(b);
    const l2 = b.distanceTo(c);
    t.copy(target).sub(a);
    // Не даём цели оказаться ближе минимального вылета — иначе ногу/руку выкручивает.
    const dist = THREE.MathUtils.clamp(t.length(), Math.abs(l1 - l2) + 0.02 * (l1 + l2), (l1 + l2) * 0.999);
    t.normalize();
    const cosA = THREE.MathUtils.clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    p.copy(pole).sub(a);
    p.addScaledVector(t, -p.dot(t));
    if (p.lengthSq() < 1e-8) p.set(0, 0, 1);
    p.normalize();
    e.copy(a).addScaledVector(t, cosA * l1).addScaledVector(p, sinA * l1); // новый локоть/колено
    this.rotateBoneTo(upper, b.clone().sub(a), e.clone().sub(a));
    lower.getWorldPosition(b);
    end.getWorldPosition(c);
    d.copy(a).addScaledVector(t, dist);
    this.rotateBoneTo(lower, c.clone().sub(b), d.clone().sub(b));
  }

  plantFeet(pose) {
    const b = this.bones;
    if (!b.hips || !this.restFoot.left) return;
    b.hips.updateWorldMatrix(true, true);
    const hipsPos = b.hips.getWorldPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, 1);
    for (const side of ['left', 'right']) {
      const L = side === 'left';
      const upper = b[`${side}UpperLeg`];
      const lower = b[`${side}LowerLeg`];
      const foot = b[`${side}Foot`];
      const rest = this.restFoot[side];
      if (!upper || !lower || !foot || !rest) continue;
      // Нога, которой «хотят» согнуть колено, приподнимает пятку и чуть выходит вперёд.
      // Пятку поднимает только та нога, что согнута сильнее другой (расслабленная).
      const bend = (L ? pose.lKneeX - pose.rKneeX : pose.rKneeX - pose.lKneeX);
      const lift = THREE.MathUtils.clamp(bend, 0, 0.6);
      const target = rest.pos.clone();
      target.y += lift * 0.06 * this.scale;
      target.z += lift * 0.08 * this.scale;
      const inward = L ? pose.lFootIn : pose.rFootIn;
      const outSign = -Math.sign(hipsPos.x - rest.pos.x) || (L ? 1 : -1);
      target.x -= outSign * inward;
      // Сидя на полу ступни уходят вперёд и чуть в стороны.
      const { p1, p2 } = this.sitPhases();
      target.z += p1 * 0.3 * this.scale;
      if (p2 > 0) {
        // На коленях: голени лежат на полу, ступни под ягодицами носками назад.
        const kneel = new THREE.Vector3(
          hipsPos.x + outSign * 0.07 * this.scale,
          rest.pos.y,
          this.restHips.z - 0.12 * this.scale,
        );
        target.lerp(kneel, p2);
      }
      // Ступня, сдвинутая пальцем.
      if (this.footOffset[side]) target.add(this.footOffset[side]);
      target.y = Math.max(target.y, rest.pos.y);
      const knee = lower.getWorldPosition(new THREE.Vector3());
      // Колено смотрит вперёд; сидя на полу — вперёд и вниз (колени на полу).
      const { p2: down } = this.sitPhases();
      // В приседе колени вместе и смотрят вперёд, а не разъезжаются в стороны.
      const inwardPole = (hipsPos.x - knee.x) * 1.5;
      const pole = knee.addScaledVector(fwd, 0.6).add(new THREE.Vector3(inwardPole, -0.5 * down, 0));
      this.twoBoneIK(upper, lower, foot, target, pole);
      // Стопа ровно на полу (при поднятой пятке носок смотрит вниз).
      // Сидя на полу носки смотрят назад, подъём стопы лежит на полу.
      const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), lift * 0.7 + down * Math.PI * 0.85);
      this.setWorldQuat(foot, tilt.multiply(rest.quat.clone()));
    }
  }

  // ---------- Поза пальцем ----------

  chestNode() {
    return this.bones.upperChest ?? this.bones.chest ?? this.bones.spine;
  }

  setHandTarget(side, worldPoint) {
    const chest = this.chestNode();
    chest.updateWorldMatrix(true, false);
    this.handTargets[side] = chest.worldToLocal(worldPoint.clone());
  }

  footWorld(side) {
    return this.bones[`${side}Foot`]?.getWorldPosition(new THREE.Vector3());
  }

  // Сдвиг ступни пальцем: храним смещение от исходного положения на полу.
  setFootTarget(side, worldPoint) {
    const rest = this.restFoot[side];
    if (!rest) return;
    const off = worldPoint.clone().sub(rest.pos);
    off.y = Math.max(0, off.y);
    const max = 0.5 * this.scale;
    if (off.length() > max) off.setLength(max);
    this.footOffset[side] = off;
  }

  handWorld(side) {
    return this.bones[`${side}Hand`]?.getWorldPosition(new THREE.Vector3());
  }

  clearTouchPose() {
    this.handTargets = { left: null, right: null };
    this.headOffset = { x: 0, y: 0 };
    this.bodyOffset = { spineX: 0, spineY: 0, spineZ: 0, hipsX: 0, hipsY: 0, hipsZ: 0 };
    this.footOffset = { left: null, right: null };
  }

  exportTouchPose() {
    return {
      left: this.handTargets.left?.toArray() ?? null,
      right: this.handTargets.right?.toArray() ?? null,
      head: { ...this.headOffset },
      body: { ...this.bodyOffset },
      feet: {
        left: this.footOffset.left?.toArray() ?? null,
        right: this.footOffset.right?.toArray() ?? null,
      },
    };
  }

  importTouchPose(data) {
    this.clearTouchPose();
    if (!data) return;
    if (data.left) this.handTargets.left = new THREE.Vector3().fromArray(data.left);
    if (data.right) this.handTargets.right = new THREE.Vector3().fromArray(data.right);
    if (data.head) this.headOffset = { ...data.head };
    if (data.body) Object.assign(this.bodyOffset, data.body);
    for (const side of ['left', 'right']) {
      if (data.feet?.[side]) this.footOffset[side] = new THREE.Vector3().fromArray(data.feet[side]);
    }
  }

  applyHandTargets() {
    const chest = this.chestNode();
    if (!chest) return;
    chest.updateWorldMatrix(true, false);
    for (const side of ['left', 'right']) {
      const local = this.handTargets[side];
      if (!local) {
        this.handsOnKnees(side);
        continue;
      }
      const upper = this.bones[`${side}UpperArm`];
      const lower = this.bones[`${side}LowerArm`];
      const hand = this.bones[`${side}Hand`];
      if (!upper || !lower || !hand) continue;
      const target = chest.localToWorld(local.clone());
      // Локоть смотрит вниз-назад и немного наружу, как у человека.
      const shoulder = upper.getWorldPosition(new THREE.Vector3());
      const outward = Math.sign(shoulder.x - chest.getWorldPosition(new THREE.Vector3()).x) || 1;
      const pole = lower.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(outward * 0.3, -0.5, -0.3));
      this.twoBoneIK(upper, lower, hand, target, pole);
    }
  }

  // Посадка в две фазы: 0…0.6 — глубокий присед (ступни вперёд),
  // 0.6…1 — опускается на колени и садится на пятки (сейдза), руки на коленях.
  sitPhases(s = this.sitS) {
    const ease = (x) => x * x * (3 - 2 * x);
    return { p1: ease(Math.min(s / 0.6, 1)), p2: ease(THREE.MathUtils.clamp((s - 0.6) / 0.4, 0, 1)) };
  }

  sitDropFor(s) {
    const restY = this.restHips.y;
    const squatY = restY * 0.5;
    const floorY = 0.25 * this.scale; // сидит на пятках
    const { p1, p2 } = this.sitPhases(s);
    const y = p2 > 0 ? THREE.MathUtils.lerp(squatY, floorY, p2) : THREE.MathUtils.lerp(restY, squatY, p1);
    return Math.max(0, restY - y);
  }

  // Сидя на полу кладёт руки на колени (плавно, по мере того как садится).
  handsOnKnees(side) {
    const w = THREE.MathUtils.smoothstep(this.sitS, 0.35, 0.85);
    if (w <= 0) return;
    const upper = this.bones[`${side}UpperArm`];
    const lower = this.bones[`${side}LowerArm`];
    const hand = this.bones[`${side}Hand`];
    const knee = this.bones[`${side}LowerLeg`];
    if (!upper || !lower || !hand || !knee) return;
    const q1 = upper.quaternion.clone();
    const q2 = lower.quaternion.clone();
    // Ладони на коленях; когда она на коленях — чуть ближе к себе, на бёдрах.
    const { p2 } = this.sitPhases();
    const kneePos = knee.getWorldPosition(new THREE.Vector3());
    const hipsPos = this.bones.hips.getWorldPosition(new THREE.Vector3());
    const target = kneePos.clone()
      .lerp(hipsPos, 0.3 * p2)
      .add(new THREE.Vector3(0, 0.05 * this.scale, 0.03 * this.scale * (1 - p2)));
    const pole = lower.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.4, -0.4));
    this.twoBoneIK(upper, lower, hand, target, pole);
    upper.quaternion.slerpQuaternions(q1, upper.quaternion.clone(), w);
    lower.quaternion.slerpQuaternions(q2, lower.quaternion.clone(), w);
    upper.updateWorldMatrix(false, true);
  }

  // ---------- Встроенные анимации ----------
  applyLoop(pose, t) {
    const sway = Math.sin(t * 1.3);
    switch (this.loop) {
      case 'cute':
        // Милое ожидание: руки в замке, покачивается из стороны в сторону, голова набок.
        blendArm(pose, 'left', { upZ: -0.85, upX: 0.15, tw: 0.75, loY: -2.1, loZ: 0 }, 1);
        blendArm(pose, 'right', { upZ: -0.85, upX: 0.15, tw: 0.75, loY: -2.1, loZ: 0 }, 1);
        pose.hipsZ += sway * 0.06;
        pose.spineZ -= sway * 0.08;
        pose.headZ += sway * 0.14 + 0.06;
        pose.spineY += Math.sin(t * 0.65) * 0.1;
        pose.lKneeX += Math.max(0, -sway) * 0.2;
        pose.rKneeX += Math.max(0, sway) * 0.2;
        break;
      case 'flirty': {
        // Кокетливо: рука на бедре, бедро ходит в сторону, второй рукой иногда трогает волосы.
        blendArm(pose, 'left', { upZ: -0.75, upX: 0.2, tw: 0.95, loY: -1.5, loZ: 0 }, 1);
        const hair = THREE.MathUtils.smoothstep(Math.sin(t * 0.5), 0.2, 0.7);
        blendArm(pose, 'right', { upZ: -0.1, upX: -0.55, tw: 0, loY: -0.2, loZ: 2.4 }, hair * hair, Math.min(1, hair * 2.5));
        const hip = Math.sin(t * 0.9);
        pose.hipsZ += 0.06 + hip * 0.05;
        pose.hipsX += (0.025 + hip * 0.015) * this.scale;
        pose.spineZ -= 0.08 + hip * 0.06;
        pose.headZ += 0.14 - hair * 0.1;
        pose.headY -= 0.1;
        pose.rKneeX += 0.3;
        pose.rLegX -= 0.1;
        break;
      }
      case 'shy': {
        // Застенчиво: руки в замке внизу, переминается, взгляд в сторону и обратно.
        blendArm(pose, 'left', { upZ: -1.0, upX: 0.05, tw: 0.75, loY: -1.6, loZ: 0 }, 1);
        blendArm(pose, 'right', { upZ: -1.0, upX: 0.05, tw: 0.75, loY: -1.6, loZ: 0 }, 1);
        const step = Math.sin(t * 2.2);
        pose.lKneeX += Math.max(0, step) * 0.25;
        pose.rKneeX += Math.max(0, -step) * 0.25;
        pose.lFootIn += 0.03 * this.scale;
        pose.rFootIn += 0.03 * this.scale;
        pose.headX += 0.18;
        pose.headY += Math.sin(t * 0.7) * 0.35;
        pose.spineX += 0.05;
        pose.lShoulderZ += 0.06;
        pose.rShoulderZ -= 0.06;
        break;
      }
      case 'happy': {
        // Радуется: пружинит, кулачки у груди, головой покачивает.
        const b = Math.abs(Math.sin(t * Math.PI * 1.6));
        blendArm(pose, 'left', { upZ: -1.1, upX: -0.45, tw: 0, loY: -2.4 + b * 0.3, loZ: 0 }, 1);
        blendArm(pose, 'right', { upZ: -1.1, upX: -0.45, tw: 0, loY: -2.4 + b * 0.3, loZ: 0 }, 1);
        pose.lKneeX += 0.1 + b * 0.18;
        pose.rKneeX += 0.1 + b * 0.18;
        pose.hipsY -= (0.01 + b * 0.02) * this.scale;
        pose.headZ += Math.sin(t * Math.PI * 0.8) * 0.15;
        pose.spineZ += Math.sin(t * Math.PI * 0.8) * 0.05;
        this.exprTarget.happy = Math.max(this.exprTarget.happy, 0.8);
        break;
      }
      case 'dance2': {
        // Милый танец: шаги в стороны, руки по очереди машут над головой.
        const beat = t * Math.PI * 2 * 0.9;
        const w = Math.sin(beat * 0.5);
        const bounce = Math.abs(Math.sin(beat));
        pose.hipsX += w * 0.05 * this.scale;
        pose.hipsZ += w * 0.1;
        pose.spineZ -= w * 0.14;
        pose.hipsY -= (0.01 + bounce * 0.025) * this.scale;
        pose.lKneeX += 0.1 + bounce * 0.15 + Math.max(0, -w) * 0.25;
        pose.rKneeX += 0.1 + bounce * 0.15 + Math.max(0, w) * 0.25;
        const up = Math.max(0, w);
        const down = Math.max(0, -w);
        blendArm(pose, 'left', { upZ: 0.3, upX: -0.2, tw: 0, loY: -0.2, loZ: 0.8 + Math.sin(beat * 2) * 0.3 }, up * up, Math.min(1, up * 2.5));
        blendArm(pose, 'right', { upZ: 0.3, upX: -0.2, tw: 0, loY: -0.2, loZ: 0.8 + Math.sin(beat * 2) * 0.3 }, down * down, Math.min(1, down * 2.5));
        pose.headZ += w * 0.15;
        pose.headX += Math.sin(beat * 2) * 0.05;
        this.exprTarget.happy = Math.max(this.exprTarget.happy, 0.6);
        break;
      }
    }
  }

  springPose(target, dt) {
    if (!this.sp) {
      this.sp = { ...target };
      this.spv = Object.fromEntries(Object.keys(target).map((k) => [k, 0]));
    }
    const fast = this.motions.some((m) => m.name === 'flinch' || m.name === 'hop');
    const out = {};
    for (const key in target) {
      let w = 8;
      if (key.startsWith('hips')) w = 4.5;
      else if (key.startsWith('spine')) w = 6;
      else if (key.startsWith('head')) w = 6.5;
      else if (/Shoulder/.test(key)) w = 10;
      else if (/Leg|Knee/.test(key)) w = 7;
      else if (/Upper|Lower/.test(key)) w = fast ? 16 : 9;
      if (this.dancing) w *= 2.2;
      let x = this.sp[key] ?? target[key];
      let v = this.spv[key] ?? 0;
      // Критически демпфированная пружина, с подшагами для устойчивости.
      const steps = Math.max(1, Math.ceil((w * dt) / 0.25));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        const a = w * w * (target[key] - x) - 2 * w * v;
        v += a * h;
        x += v * h;
      }
      this.sp[key] = x;
      this.spv[key] = v;
      out[key] = x;
    }
    return out;
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
    // Насколько опустить таз, чтобы сесть на пол (до ~15 см над полом).
    this.sitDrop = Math.max(0, this.restHips.y - 0.15 * this.scale);
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

  applyUpperArm(side, pose, extra, extraX = 0) {
    const L = side === 'left';
    const bone = L ? this.bones.leftUpperArm : this.bones.rightUpperArm;
    if (!bone) return;
    const z = L ? pose.lUpperZ + extra : pose.rUpperZ - extra;
    this.rot(bone, (L ? pose.lUpperX : pose.rUpperX) + extraX, 0, z);
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
      // Ищем минимальную поправку: рука уходит немного наружу и вперёд
      // (если кисть перед телом) или назад (если за спиной) — как у человека.
      this.applyUpperArm(side, pose, 0);
      this.bones[`${side}UpperArm`].updateWorldMatrix(true, true);
      handNode.getWorldPosition(hand);
      const bin = this.bodyBins.get(Math.round((hand.y - shift.y) / 0.02));
      const front = bin ? hand.z - shift.z > (bin.zMin + bin.zMax) / 2 : true;
      // В позе «за спиной» руки всегда отводим назад, иначе — по положению кисти.
      const armBusy = this.dancing || this.motions.some((m) => ARM_MOTIONS.has(m.name));
      const hint = armBusy ? undefined : POSES[this.poseName]?.armDir;
      const dir = hint ?? (front ? -1 : 1); // минус по X — рука вперёд
      let need = 0;
      for (let i = 0; i <= 10; i++) {
        this.applyUpperArm(side, pose, need * 0.6, need * dir);
        this.bones[`${side}UpperArm`].updateWorldMatrix(true, true);
        handNode.getWorldPosition(hand);
        lower.getWorldPosition(elbow);
        mid.lerpVectors(elbow, hand, 0.5);
        if (!this.insideBody(hand, shift) && !this.insideBody(mid, shift)) break;
        need += 0.06;
      }
      // Плавно, чтобы рука не дёргалась.
      const fix = this.armFix[side];
      const k = 1 - Math.exp(-dt * (need > fix.need ? 14 : 4));
      fix.need += (need - fix.need) * k;
      fix.dir += (dir - fix.dir) * (1 - Math.exp(-dt * 6));
      this.applyUpperArm(side, pose, fix.need * 0.6, fix.need * fix.dir);
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
