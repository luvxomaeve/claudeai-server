import * as THREE from 'three';
import { tuneSkirt, shapeHips, HIP_FLEX, SQUAT_FLEX, CROTCH_LIFT } from './outfits.js';
const HEAD_LEAN_SIGN = -1; // знак наклона головы «к пальцу» (проверено тестом)

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
  lUpperZ: -1.2, rUpperZ: 1.2,
  lUpperX: -0.04, rUpperX: -0.04,
  lUpperTwist: 0, rUpperTwist: 0,
  lLowerY: -0.55, rLowerY: 0.55,
  lLowerZ: 0, rLowerZ: 0,
  hipsY: 0, hipsZ: 0, hipsX: 0, hipsRotY: 0, hipsRotX: 0, lFootIn: 0, rFootIn: 0,
  lLegX: 0, rLegX: 0, lLegZ: 0, rLegZ: 0, lKneeX: 0, rKneeX: 0,
  lShoulderZ: 0, rShoulderZ: 0, handBend: 0.25,
};

export { BASE_POSE };

// Позы задаются целиком, ноги и бёдра тоже — так поза выглядит цельной, а не «руки отдельно».
// Если руки где-то заденут тело, их аккуратно отведёт solveArms().
// Позы: тело (наклоны, вес на одной ноге, голова) задаётся углами, а кисти — точками на
// собственном теле (hands: [кость, смещение в осях тела]), к которым руки тянутся IK. Так руки
// лежат на ней по-настоящему, а не «висят под углом». Смещение x — к боку этой руки.
export const POSES = {
  stand: { label: 'Стоит' },
  flirty: {
    label: 'Кокетка',
    hands: { left: ['hips', [0.15, 0.07, 0.03]], right: ['head', [0.1, 0.11, -0.03]] },
    hipsZ: 0.1, hipsX: 0.035, spineZ: -0.12, spineY: 0.08, headZ: 0.18, headY: -0.12,
    rKneeX: 0.32, rLegX: -0.14, lLegZ: -0.08, rLegZ: -0.06, rFootIn: 0.03,
  },
  hips: {
    label: 'Руки в боки',
    hands: { left: ['hips', [0.15, 0.07, 0.03]], right: ['hips', [0.15, 0.07, 0.03]] },
    hipsZ: -0.05, spineZ: 0.04, spineX: -0.04, headZ: 0.08, headX: -0.05, lKneeX: 0.18, lLegX: -0.07,
  },
  shy: {
    label: 'Скромница',
    hands: { left: ['hips', [0.02, -0.08, 0.14]], right: ['hips', [0.02, -0.08, 0.14]] },
    spineX: 0.08, headX: 0.18, headZ: 0.14, headY: 0.1,
    lFootIn: 0.04, rFootIn: 0.04, lKneeX: 0.22, rKneeX: 0.1, lLegX: -0.08,
  },
  behind: {
    label: 'Руки за спиной',
    armDir: 1,
    lUpperZ: -0.95, rUpperZ: 0.95, lUpperX: 0.1, rUpperX: 0.1,
    lUpperTwist: 1.3, rUpperTwist: 1.3, lLowerY: -1.6, rLowerY: 1.6,
    spineX: -0.08, headZ: -0.12, headX: -0.05, rKneeX: 0.25, rLegX: -0.1, hipsZ: 0.04,
  },
  think: {
    label: 'Задумалась',
    hands: { left: ['otherLowerArm', [0.02, -0.02, 0.05]], right: ['head', [0.03, -0.09, 0.07]] },
    headZ: -0.12, headX: 0.08, headY: -0.08, spineZ: 0.05, hipsZ: -0.06, lKneeX: 0.2, lLegX: -0.08,
  },
  hair: {
    label: 'Поправляет волосы',
    hands: { right: ['head', [0.08, 0.13, -0.02]], left: ['hips', [0.15, 0.07, 0.03]] },
    headZ: -0.16, headY: 0.14, headX: -0.04, hipsZ: 0.07, spineZ: -0.07, spineX: -0.05, rKneeX: 0.25, rLegX: -0.1,
  },
  cheek: {
    label: 'Ладонь у щеки',
    hands: { left: ['head', [0.09, -0.06, 0.04]], right: ['UpperLeg', [0.04, -0.12, 0.095]] },
    headZ: 0.18, headX: 0.06, hipsZ: -0.05, spineZ: 0.05, lKneeX: 0.2, lLegX: -0.08,
  },
  dreamy: {
    label: 'Мечтательно',
    hands: { left: ['upperChest', [0.03, -0.02, 0.12]], right: ['upperChest', [0.03, 0.02, 0.12]] },
    headX: -0.12, headZ: 0.12, spineX: -0.06, hipsZ: 0.05, rKneeX: 0.22, rLegX: -0.08,
  },
  hug: {
    label: 'Обнимает себя',
    hands: { left: ['upperChest', [-0.07, 0.0, 0.19]], right: ['upperChest', [-0.06, -0.06, 0.2]] },
    spineX: 0.06, headX: 0.12, headZ: 0.1, lShoulderZ: 0.1, rShoulderZ: -0.1, lKneeX: 0.2, lFootIn: 0.03, rFootIn: 0.03,
  },
  hello: {
    label: 'Привет',
    lUpperZ: 0.15, lLowerZ: 1.3, lLowerY: 0,
    hands: { right: ['hips', [0.15, 0.07, 0.03]] },
    headZ: 0.12, spineZ: -0.05, hipsZ: 0.05, rKneeX: 0.18,
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
const ZERO3 = new THREE.Vector3();
const ARM_MOTIONS = new Set(['flinch', 'raiseHand', 'stretch', 'touchHair', 'turnAway', 'clasp', 'handOnHip', 'nails']);

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
// Огибающая движения: быстро вошли, подержали, плавно вышли.
// Нежные жесты руками в ожидании: кисть касается своего тела и плавно скользит.
// Точки — смещения от кости в осях тела в покое: x — к её левому боку, y — вверх, z — вперёд
// (для правой руки x зеркалится). body(s, e) — сопровождающее движение корпуса/головы.
const TOUCH_MOTIONS = {
  collar: { dur: 5.5, path: [['upperChest', [0.03, 0.0, 0.11]], ['upperChest', [0.07, 0.05, 0.09]]],
    body: (p, s, e) => { p.spineX -= 0.06 * e; p.headZ += 0.1 * s * e; p.headX += 0.04 * e; } },
  neck: { dur: 5, path: [['neck', [0.05, 0.03, 0.06]], ['neck', [0.06, 0.07, 0.03]]],
    body: (p, s, e) => { p.headZ -= 0.16 * s * e; p.spineX -= 0.08 * e; p.hipsZ += 0.04 * s * e; } },
  lips: { dur: 4, path: [['head', [0.01, 0.03, 0.1]]],
    body: (p, s, e) => { p.headX += 0.07 * e; p.headZ += 0.06 * s * e; } },
  hairBack: { dur: 5, path: [['head', [0.08, 0.14, 0.0]], ['head', [0.1, 0.05, -0.05]]],
    body: (p, s, e) => { p.headZ += 0.12 * s * e; p.headY -= 0.1 * s * e; p.spineX -= 0.05 * e; } },
  thigh: { dur: 5.5, path: [['UpperLeg', [0.03, -0.04, 0.11]], ['UpperLeg', [0.04, -0.2, 0.1]]],
    body: (p, s, e) => { p.hipsZ += 0.06 * s * e; p.spineZ -= 0.07 * s * e; p.headX += 0.06 * e; p.headZ -= 0.06 * s * e; } },
  waistSlide: { dur: 5, path: [['hips', [0.13, 0.13, 0.05]], ['hips', [0.16, 0.0, 0.03]]],
    body: (p, s, e) => { p.hipsZ += 0.07 * s * e; p.spineZ -= 0.08 * s * e; p.headZ += 0.05 * s * e; } },
  hug: { dur: 5, both: true, path: [['otherUpperArm', [0, -0.07, 0.06]]],
    body: (p, s, e) => { p.spineX += 0.06 * e; p.headX += 0.1 * e; p.lShoulderZ += 0.1 * e; p.rShoulderZ -= 0.1 * e; } },
  twirl: { dur: 5, wobble: 0.025, path: [['head', [0.1, 0.0, 0.03]], ['head', [0.11, -0.08, 0.04]]],
    body: (p, s, e) => { p.headZ += 0.14 * s * e; p.headX += 0.05 * e; p.hipsZ -= 0.04 * s * e; } },
  behindBack: { dur: 6, both: true, path: [['hips', [0.05, 0.02, -0.14]]],
    body: (p, s, e, t) => { p.spineX -= 0.08 * e; p.headX += 0.05 * e; p.spineY += Math.sin(t * 1.4) * 0.12 * e; p.hipsZ += Math.sin(t * 1.4) * 0.05 * e; } },
  knee: { dur: 5.5, path: [['UpperLeg', [0.03, -0.18, 0.11]], ['LowerLeg', [0.02, 0.02, 0.09]]],
    body: (p, s, e) => { p.hipsRotX += 0.55 * e; p.spineX += 0.15 * e; p.headX -= 0.2 * e; p.headZ += 0.08 * s * e; } },
  archStretch: { dur: 6, both: true, path: [['head', [0.08, 0.12, -0.05]]],
    body: (p, s, e) => { p.spineX -= 0.16 * e; p.headX -= 0.1 * e; p.hipsZ += 0.04 * Math.sin(e * 3) * e; } },
};

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
          if (node) this.fingers.push({ node, side, curl: k * segK, phase: k * 2.3 + (side === 'left' ? 0 : 1.1) });
        }
      }
      for (const [seg, k] of [['ThumbMetacarpal', 0.25], ['ThumbProximal', 0.3], ['ThumbDistal', 0.25]]) {
        const node = vrm.humanoid.getNormalizedBoneNode(`${side}${seg}`);
        if (node) this.fingers.push({ node, side, thumb: true, curl: k, phase: side === 'left' ? 0.5 : 1.6 });
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
    // Поворот головы в покое — чтобы потом знать, куда смотрит лицо (камера «к лицу»).
    this.headRestInv = this.bones.head.getWorldQuaternion(new THREE.Quaternion()).invert();
    this.hipsRestInv = this.bones.hips.getWorldQuaternion(new THREE.Quaternion()).invert();
    this.rootRestQ = this.bones.hips.getWorldQuaternion(new THREE.Quaternion());
    // Повороты в покое для костей, к которым тянутся руки в жестах.
    this.boneRestInv = new Map();
    for (const n of ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm']) {
      const node = this.bones[n] ?? vrm.humanoid.getNormalizedBoneNode(n);
      if (node) this.boneRestInv.set(node, node.getWorldQuaternion(new THREE.Quaternion()).invert());
    }
    this.initIK();
    this.handTargets = { left: null, right: null }; // позы «пальцем»: цель кисти в системе груди
    this.headOffset = { x: 0, y: 0 };
    this.bodyOffset = { spineX: 0, spineY: 0, spineZ: 0, hipsX: 0, hipsY: 0, hipsZ: 0, hipsRotX: 0, hipsFwd: 0 };
    this.footOffset = { left: null, right: null }; // ступни, сдвинутые пальцем
    this.armPreset = { left: null, right: null }; // рука «примагничена»: 'hips' — на талии, 'behind' — на пояснице
    // Физика управления: цели рук/ног догоняются с инерцией (пружина с лёгким перехлёстом).
    this.dragPhys = { hand: { left: null, right: null }, foot: { left: null, right: null } };
    this.reachLean = { x: 0, z: 0 }; // наклон корпуса вслед за рукой, которую тянут дальше досягаемости
    this.sit = 0; // 0 — стоит, 1 — сидит на полу (свайп вниз)
    this.sitS = 0; // сглаженное значение
    this.sitV = 0; // скорость посадки (разгон и торможение плавные)
    this.sitRate = 0; // насколько быстро ведут пальцем (ед./с) — ускоряет посадку
    this.lieStyle = 'side'; // 'side' — на бок на локоть, 'belly' — на живот, спать
    this.sleep = 0; // 0..1 — глаза закрываются, когда спит на животе
    this.offK = 1; // сколько от наклона/таза пальцем действует (в посадке — плавно уходит)
    // Верх тела из записи живого человека (живое ожидание): ноги при этом свои,
    // стоят на полу, поэтому она не ходит и не скользит.
    this.upper = null;
    this.sitDropNow = 0;
    this.sitBackNow = 0;
    this.sitSideNow = 0;
    this.shinLean = 0; // наклон голени вперёд (рад), для баланса корпуса в приседе
    this.kneelPlantar = 1.1; // насколько вытянут носок на коленях (рад)
    this.loop = null; // встроенная анимация: cute | flirty | shy | happy | dance2
    this.armFix = { left: { need: 0, dir: -1 }, right: { need: 0, dir: -1 } };
    this.stabilizeSprings();
    this.tuneHair();

    this.zones = ZONE_DEFS
      .map((d) => ({ ...d, node: vrm.humanoid.getRawBoneNode(d.bone), center: new THREE.Vector3() }))
      .filter((z) => z.node);
  }

  // ---------- Реакции ----------

  react({ expression, motion, side, strength = 1 }) {
    if (expression) this.setExpression(expression, strength);
    // «Спит» и «Замри»: на касание отвечает только лицом — тело не двигается.
    if (motion && !this.forceSleep && !this.frozen) this.playMotion(motion, side);
  }

  coy(sec = 3.5) { this.coyT = sec; this.coySide = Math.random() < 0.5 ? 1 : -1; }
  wink(side = Math.random() < 0.5 ? 'left' : 'right') {
    this.winkSide = side;
    this.winkT = 0.45;
  }

  setExpression(name, weight = 1, hold = 2.2) {
    for (const e of EXPRESSIONS) this.exprTarget[e] = 0;
    this.exprTarget[name] = weight;
    this.exprHold = hold;
  }

  playMotion(name, side = Math.random() < 0.5 ? 'left' : 'right') {
    // Сидит или лежит — движения ногами/подскоки заменяем на подходящие (без подпрыгивания над полом).
    if (this.sitS > 0.3) {
      const seated = { hop: 'squirm', bounce: 'tiltHead', shift: 'tiltHead', sway: 'tiltHead', shyLegs: 'squirm', stretch: 'sigh', lookAround: 'lookAround' };
      if (name in seated) name = seated[name];
    }
    // Её сейчас тормошат (ведут наклон/присед) — жесты руками не начинает: руки не мечутся.
    if (this.handsQuiet && (TOUCH_MOTIONS[name] || ARM_MOTIONS.has(name))) return;
    // На четвереньках вес на руках — ладони с пола ради жеста не отрывает.
    if ((this.onHands ?? 0) > 0.5 && (TOUCH_MOTIONS[name] || ARM_MOTIONS.has(name))) return;
    const durations = {
      tiltHead: 1.6, flinch: 1.0, raiseHand: 2.2, sway: 1.6, hop: 0.9, turnAway: 2.6,
      lookAround: 3.2, stretch: 2.8, shift: 3.0, touchHair: 3.0, bounce: 1.4, lieTurn: 2.6,
      squirm: 1.3, shyLegs: 1.8, sigh: 2.6, clasp: 4.5, handOnHip: 4.5, nails: 3.4,
    };
    this.motions = this.motions.filter((m) => m.name !== name);
    this.motions.push({ name, side, t: 0, dur: TOUCH_MOTIONS[name]?.dur ?? durations[name] ?? 1.5 });
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
    this.posePrevName = this.poseName;
    this.poseName = name;
    this.poseT = 0;
  }

  currentBasePose() {
    const target = { ...BASE_POSE, ...POSES[this.poseName] };
    const k = easeInOut(Math.min(this.poseT / 0.7, 1));
    const out = {};
    for (const key in BASE_POSE) out[key] = this.posePrev[key] + (target[key] - this.posePrev[key]) * k;
    // Руки идут в новую позу по дуге (чуть в стороны в середине пути), а не напрямик
    // сквозь тело — как двигается живой человек.
    if (k < 1) {
      const arc = Math.sin(Math.PI * k);
      const dl = Math.abs(target.lUpperZ - this.posePrev.lUpperZ) + Math.abs(target.lLowerY - this.posePrev.lLowerY);
      const dr = Math.abs(target.rUpperZ - this.posePrev.rUpperZ) + Math.abs(target.rLowerY - this.posePrev.rLowerY);
      out.lUpperZ += arc * Math.min(0.35, dl * 0.25);
      out.rUpperZ -= arc * Math.min(0.35, dr * 0.25);
      out.lLowerY -= arc * Math.min(0.3, dl * 0.15);
      out.rLowerY += arc * Math.min(0.3, dr * 0.15);
    }
    return out;
  }

  // ---------- Mocap (.vrma) ----------

  // Плавный переход между анимациями (кроссфейд), без рывков.
  playClip(clip, { loop = true, fade = 0.9 } = {}) {
    if (!this.mixer) this.mixer = new THREE.AnimationMixer(this.vrm.scene);
    const action = this.mixer.clipAction(clip);
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !loop;
    action.play();
    if (this.action && this.action !== action) this.action.crossFadeTo(action, fade, false);
    else action.fadeIn(fade);
    this.action = action;
  }

  // Сколько осталось до конца текущей анимации (сек).
  clipTimeLeft() {
    if (this.upper && !this.upper.stopping) return this.upper.cur.dur - this.upper.cur.t;
    if (!this.action) return Infinity;
    return this.action.getClip().duration - this.action.time;
  }

  stopClip() {
    if (!this.mixer) return;
    // Запоминаем позу из записи, чтобы плавно перетечь из неё в обычную анимацию.
    this.blendFrom = { t: 0, q: new Map(), hips: this.bones.hips?.position.clone() };
    this.vrm.scene.traverse((o) => { if (o.isBone || o.name?.startsWith('Normalized_')) this.blendFrom.q.set(o, o.quaternion.clone()); });
    this.mixer.stopAllAction();
    this.mixer = null;
    this.action = null;
  }

  // Плавный переход (~0.5 с) из позы записи в процедурную позу.
  applyBlendFrom(dt) {
    const bf = this.blendFrom;
    if (!bf) return;
    bf.t += dt;
    const k = Math.min(1, bf.t / 0.9);
    const e = k * k * (3 - 2 * k);
    for (const [node, q] of bf.q) node.quaternion.slerpQuaternions(q, node.quaternion.clone(), e);
    if (bf.hips && this.bones.hips) this.bones.hips.position.lerpVectors(bf.hips, this.bones.hips.position.clone(), e);
    if (k >= 1) this.blendFrom = null;
  }

  // ---------- Живое ожидание: верх тела из записи ----------

  // Запись играет только на позвоночнике, плечах, руках и голове; ноги, таз и
  // посадка — свои (стоят на полу). Смена записей — длинный кроссфейд 1.6 с.
  playUpperIdle(clip) {
    const samplers = [];
    for (const track of clip.tracks) {
      const [name, prop] = track.name.split('.');
      if (prop !== 'quaternion') continue;
      const node = this.vrm.scene.getObjectByName(name);
      if (!node) continue;
      const head = node === this.bones.head || node === this.bones.neck;
      const interp = track.createInterpolant();
      // Средняя поза записи: из неё берём только движение (отклонение от средней),
      // а осанку и положение рук оставляем её собственными — у актёра другие
      // пропорции, иначе руки торчат в стороны.
      const mean = new THREE.Quaternion(0, 0, 0, 0);
      const q = new THREE.Quaternion();
      for (let t = 0; t < clip.duration; t += 0.2) {
        q.fromArray(interp.evaluate(t));
        const sgn = mean.x * q.x + mean.y * q.y + mean.z * q.z + mean.w * q.w < 0 ? -1 : 1;
        mean.set(mean.x + q.x * sgn, mean.y + q.y * sgn, mean.z + q.z * sgn, mean.w + q.w * sgn);
      }
      mean.normalize();
      const hand = node === this.bones.leftHand || node === this.bones.rightHand;
      const b = this.bones;
      const upperArm = node === b.leftUpperArm || node === b.rightUpperArm;
      const shoulder = node === b.leftShoulder || node === b.rightShoulder;
      const lowerArm = node === b.leftLowerArm || node === b.rightLowerArm;
      // Предел отклонения от своей позы (рад): руки не разлетаются в стороны.
      const max = upperArm ? 0.2 : shoulder ? 0.08 : lowerArm ? 0.3 : hand ? 0.25 : head ? 0.2 : 0.1;
      // Амплитуда спокойнее, чем у актёра: живость без «трясучки».
      samplers.push({ node, interp, meanInv: mean.invert(), k: head ? 0.4 : hand ? 0.35 : 0.7, max });
    }
    const cur = { samplers, t: 0, dur: clip.duration };
    const prev = this.upper?.cur ?? null;
    this.upper = { cur, prev, f: prev ? 0 : 1, w: this.upper?.w ?? 0, stopping: false };
  }

  stopUpperIdle() {
    if (this.upper) this.upper.stopping = true;
  }

  applyUpperLayer(dt) {
    const L = this.upper;
    if (!L) return;
    // Реакции, гладят, танец, сидит — запись уступает место (плавно).
    const busy = this.motions.length > 0 || this.patAmount > 0.1 || this.dancing || this.loop || this.poseName !== 'stand';
    let want = L.stopping ? 0 : busy ? 0.15 : 1;
    // Сильно наклонена/прогнута — запись (с её поворотами корпуса) уходит, иначе перекручивает.
    want *= 1 - THREE.MathUtils.smoothstep(Math.abs(this.bodyOffset.hipsRotX), 0.15, 0.5);
    want *= 1 - THREE.MathUtils.smoothstep(this.sitS, 0.02, 0.3);
    L.w += (want - L.w) * (1 - Math.exp(-dt * 2.5));
    if (L.stopping && L.w < 0.01) { this.upper = null; return; }
    L.f = Math.min(1, L.f + dt / 1.6);
    const fe = L.f * L.f * (3 - 2 * L.f);
    for (const c of [L.cur, L.prev]) if (c) c.t = (c.t + dt) % c.dur;
    if (L.f >= 1) L.prev = null;
    const qa = this.tmpQa ??= new THREE.Quaternion();
    const qb = this.tmpQb ??= new THREE.Quaternion();
    const prevBy = L.prev ? new Map(L.prev.samplers.map((s) => [s.node, s])) : null;
    const one = new THREE.Quaternion();
    for (const s of L.cur.samplers) {
      qb.copy(s.meanInv).multiply(qa.fromArray(s.interp.evaluate(L.cur.t)));
      const ps = prevBy?.get(s.node);
      if (ps) qb.copy(ps.meanInv.clone().multiply(qa.fromArray(ps.interp.evaluate(L.prev.t))).slerp(qb.clone(), fe));
      // Движение из записи — поверх её собственной позы, с весом слоя и пределом угла.
      if (qb.w < 0) qb.set(-qb.x, -qb.y, -qb.z, -qb.w);
      const ang = 2 * Math.acos(Math.min(1, qb.w)) * L.w * s.k;
      const lim = ang > s.max ? s.max / ang : 1;
      qb.copy(one.clone().slerp(qb, L.w * s.k * lim));
      s.node.quaternion.multiply(qb);
    }
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

  // Точное попадание по самой модели (тело, одежда, волосы): ищем ближайшую зону
  // к точке касания. Закрывает щели между сферами зон — касание не «проваливается».
  // Быстро (без перебора треугольников): тело как набор «капсул» по костям —
  // ноги, бёдра с юбкой, корпус, руки, голова. Касание мгновенное, без подтормаживания.
  hitTestMesh(raycaster) {
    const ray = raycaster.ray;
    const S = this.scale;
    const b = this.bones;
    const P = (n) => b[n]?.getWorldPosition(new THREE.Vector3());
    const head = P('head');
    const segs = [
      ['hips', 'spine', 0.15], ['spine', 'chest', 0.14], ['chest', 'neck', 0.13], ['neck', 'head', 0.08],
      ['hips', 'leftUpperLeg', 0.17], ['hips', 'rightUpperLeg', 0.17],
      ['leftUpperLeg', 'leftLowerLeg', 0.09], ['rightUpperLeg', 'rightLowerLeg', 0.09],
      ['leftLowerLeg', 'leftFoot', 0.065], ['rightLowerLeg', 'rightFoot', 0.065],
      ['leftUpperArm', 'leftLowerArm', 0.055], ['rightUpperArm', 'rightLowerArm', 0.055],
      ['leftLowerArm', 'leftHand', 0.05], ['rightLowerArm', 'rightHand', 0.05],
    ];
    let bestT = Infinity;
    let point = null;
    const pr = new THREE.Vector3();
    const ps = new THREE.Vector3();
    const test = (a, c, r) => {
      if (!a || !c) return;
      const d2 = ray.distanceSqToSegment(a, c, pr, ps);
      if (d2 > (r * S) ** 2) return;
      const t = pr.clone().sub(ray.origin).dot(ray.direction);
      if (t < bestT) { bestT = t; point = ps.clone(); }
    };
    for (const [a, c, r] of segs) test(P(a), P(c), r);
    if (head) test(head, head.clone().add(new THREE.Vector3(0, 0.16 * S, 0)), 0.13); // голова с волосами
    if (!point) return null;
    let best = null;
    for (const z of this.zones) {
      const d = (z.center.distanceTo(point) - z.worldRadius) / S;
      if (!best || d < best.score) best = { ...z, point: point.clone(), score: d };
    }
    return best;
  }

  // Волосы (хвостики ниже головы): по костям пружин волос — двигаются вместе с ними.
  hitHair(ray) {
    if (!this.hairSegs) {
      this.hairSegs = [];
      const joints = this.vrm.springBoneManager?.joints ?? [];
      for (const j of joints) {
        if (j.bone && j.child && /hair/i.test(j.bone.name)) this.hairSegs.push([j.bone, j.child]);
      }
    }
    if (!this.hairSegs.length) return null;
    const S = this.scale;
    const head = this.bones.head?.getWorldPosition(new THREE.Vector3());
    if (!head) return null;
    const a = new THREE.Vector3(), c = new THREE.Vector3(), pr = new THREE.Vector3(), ps = new THREE.Vector3();
    let best = null;
    for (const [b0, b1] of this.hairSegs) {
      b0.getWorldPosition(a); b1.getWorldPosition(c);
      if (Math.max(a.y, c.y) > head.y - 0.02 * S) continue; // макушка — это «погладить по голове»
      const d2 = ray.distanceSqToSegment(a, c, pr, ps);
      if (d2 > (0.04 * S) ** 2) continue;
      const t = pr.clone().sub(ray.origin).dot(ray.direction);
      if (!best || t < best.t) best = { zone: 'hair', point: ps.clone(), t, score: 0 };
    }
    return best;
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
    this.lastDt = Math.min(dt, 0.05);
    if (this.heel) {
      this.heelK = (this.heelK ?? 0) + ((this.heelWant ?? 0) - (this.heelK ?? 0)) * (1 - Math.exp(-dt * 5));
      const up = 1 - THREE.MathUtils.smoothstep(this.sitS, 0.47, 0.6);
      this.heelRaise = this.heelK * this.heel.raise * up;
      for (const m of this.heel.meshes) m.visible = this.heelK > 0.5;
    }
    this.turnBegin(dt);
    this.dragBoostT = Math.max(0, (this.dragBoostT ?? 0) - dt);
    this.time += dt;
    const t = this.time;
    const b = this.bones;

    // Сбрасываем все кости в исходную позу, дальше накладываем слои.
    this.vrm.humanoid.resetNormalizedPose();

    // Mocap-анимация управляет телом сама; мимика и физика — как обычно.
    if (this.mixer) {
      this.mixer.update(dt);
      this.applyReactLayer(dt);
      this.floorPush(true);
      this.finishFrame(dt);
      return;
    }

    this.poseT += dt;
    // В танце руки свободны, поэтому берём стойку «Стоит».
    const pose = this.dancing ? { ...BASE_POSE } : this.currentBasePose();
    const poseDef = POSES[this.poseName];

    if (poseDef.wave === 'left') pose.lLowerZ += Math.sin(t * 9) * 0.25;

    // Дыхание: грудь и плечи чуть поднимаются.
    // Во сне дыхание медленное и глубже.
    const sl = this.sleep ?? 0;
    const breath = Math.sin(t * (1.5 - 0.6 * sl)) * (1 + 0.8 * sl);
    this.breathNow = breath;
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
    pose.hipsX += w * 0.055 * this.scale;
    pose.hipsZ += w * 0.17;
    pose.hipsY -= Math.abs(w) * 0.016 * this.scale;
    // Плавная «восьмёрка» бёдрами в покое: таз чуть поворачивается и покачивается,
    // плечи и голова уравновешивают — живая, женственная стойка.
    {
      const st = 1 - THREE.MathUtils.smoothstep(this.sitS, 0.1, 0.4);
      const f = Math.sin(t * 0.55);
      const g = Math.sin(t * 1.1 + 0.6);
      pose.hipsRotY += f * 0.13 * st;
      pose.hipsZ += g * 0.065 * st;
      pose.spineY -= f * 0.07 * st;
      pose.spineZ -= g * 0.045 * st;
    }
    // Живая плавная пластика: медленные несинхронные волны в корпусе, плечах и голове —
    // она будто дышит всем телом, ни на секунду не замирая (небольшая амплитуда).
    {
      const aw = (1 - 0.92 * (this.sleep ?? 0)) * (this.posing ? 0.6 : 1) * (this.frozen ? 0.12 : 1); // «Замри» — только дыхание
      const n = (a, b, c) => Math.sin(t * a + b) * 0.6 + Math.sin(t * a * 2.17 + c) * 0.4;
      pose.spineZ += n(0.29, 0.3, 1.7) * 0.035 * aw;
      pose.spineY += n(0.21, 2.1, 0.4) * 0.04 * aw;
      pose.spineX += n(0.33, 1.2, 2.6) * 0.02 * aw;
      pose.headZ += n(0.25, 0.9, 2.2) * 0.05 * aw;
      pose.headX += n(0.19, 2.7, 0.8) * 0.03 * aw;
      pose.lShoulderZ += n(0.31, 0.5, 1.1) * 0.03 * aw;
      pose.rShoulderZ -= n(0.27, 1.9, 0.2) * 0.03 * aw;
    }
    // Иногда игриво пружинит на месте: мягко подгибает колени в ритм,
    // бёдра покачиваются, голова в такт — живая, «прыгучая», но без подскоков.
    {
      const st = 1 - THREE.MathUtils.smoothstep(this.sitS, 0.1, 0.4);
      const calm = 1 - THREE.MathUtils.smoothstep(Math.abs(this.bodyOffset.hipsRotX), 0.15, 0.5);
      const env = THREE.MathUtils.smoothstep(Math.sin(t * 0.11 + 0.5), 0.3, 0.85) * st * calm * (1 - (this.sleep ?? 0));
      if (env > 0.001) {
        const bb = 0.5 + 0.5 * Math.sin(t * 4.0);
        const sw = Math.sin(t * 2.0);
        pose.hipsY -= bb * 0.014 * this.scale * env;
        pose.lKneeX += bb * 0.13 * env;
        pose.rKneeX += bb * 0.13 * env;
        pose.hipsZ += sw * 0.06 * env;
        pose.spineZ -= sw * 0.03 * env;
        pose.headZ += sw * 0.04 * env;
      }
    }
    pose.lLegZ -= w * 0.075; // ноги остаются вертикальными, бёдра наклоняются
    pose.rLegZ -= w * 0.075;
    pose.spineZ -= w * 0.12;
    pose.headZ += w * 0.06;
    // Свободная нога расслаблена: колено мягко согнуто и чуть внутрь — женственная стойка.
    pose.rKneeX += relaxR * 0.42;
    pose.rLegX -= relaxR * 0.18;
    pose.lKneeX += relaxL * 0.42;
    pose.lLegX -= relaxL * 0.18;
    pose.headZ -= w * 0.03;
    // Рука со стороны опорной ноги чуть отходит от бедра.
    pose.lUpperZ += relaxR * 0.06;
    pose.rUpperZ -= relaxL * 0.06;

    // Живые руки: лёгкий маятник вперёд-назад (у каждой руки свой ритм),
    // локти то сгибаются, то расслабляются, чуть отходят от тела и возвращаются.
    pose.lUpperX += Math.sin(t * 0.83 + 0.4) * 0.045 + Math.sin(t * 0.31) * 0.02;
    pose.rUpperX += Math.sin(t * 0.77 + 2.3) * 0.045 + Math.sin(t * 0.29 + 1) * 0.02;
    pose.lUpperZ += Math.sin(t * 0.47 + 1.1) * 0.03;
    pose.rUpperZ -= Math.sin(t * 0.51 + 0.2) * 0.03;
    pose.lLowerY -= 0.06 + Math.sin(t * 0.53 + 0.7) * 0.07;
    pose.rLowerY += 0.06 + Math.sin(t * 0.59 + 2.9) * 0.07;
    pose.lLowerZ += Math.sin(t * 0.67) * 0.03;
    pose.rLowerZ -= Math.sin(t * 0.61 + 1.7) * 0.03;

    // Медленный поворот корпуса и «блуждающий» взгляд.
    const twist = Math.sin(t * 0.29 + 1.3);
    pose.hipsRotY += twist * 0.08;
    pose.spineY -= twist * 0.05;
    pose.lUpperX += twist * 0.05;
    pose.rUpperX -= twist * 0.05;
    const awakeK = 1 - (this.sleep ?? 0); // спит — голова не блуждает
    pose.headY += (Math.sin(t * 0.31) * 0.14 + Math.sin(t * 0.83) * 0.04) * awakeK;
    pose.headX += Math.sin(t * 0.23) * 0.05 * awakeK;
    pose.headZ += Math.sin(t * 0.47 + 0.9) * 0.04 * awakeK;

    if (this.dancing) this.applyDance(pose, t);
    else if (this.loop) this.applyLoop(pose, t);

    // Сесть на пол (свайп вниз): бёдра опускаются к полу, ступни уходят вперёд,
    // колени поднимаются — она садится, обняв колени. Плавно, с пружиной.
    // Одно общее плавное значение посадки с ограниченной скоростью: таз, колени
    // и ступни всегда согласованы, даже если свайпнуть очень резко.
    // Разгон и торможение плавные (ограничено ускорение), ложится медленнее,
    // чем садится, — без «падения», как бы резко ни свайпнули.
    {
      const c = THREE.MathUtils.clamp;
      // Скорость следует за пальцем: медленно ведёшь — плавно, быстро — быстрее (но без рывка).
      // Нет данных о пальце (кнопка ⌂ и т.п.) — спокойная скорость; иначе — как ведёшь.
      const base = this.sitS > 0.95 || this.sit > 1.0 ? 0.32 : 0.5;
      // Палец на полосе — тело идёт за ним плотно (не медленнее спокойной скорости),
      // иначе при медленном ведении оно отстаёт и полоса будто «залипает».
      const held = (this.dragBoostT ?? 0) > 0;
      const vmax = c(Math.max(held ? base * 1.6 : base, this.sitRate * 1.3), 0.22, 2.4);
      const acc = (held ? 3 : 1.2) + this.sitRate * 3;
      const want = c((this.sit - this.sitS) * ((held ? 6 : 2.6) + this.sitRate), -vmax, vmax);
      this.sitV += c(want - this.sitV, -acc * dt, acc * dt);
      if (Math.abs(this.sit - this.sitS) < 0.02) this.sitRate *= Math.exp(-dt * 3);
      const before = this.sit - this.sitS;
      this.sitS += this.sitV * dt;
      if (Math.sign(this.sit - this.sitS) !== Math.sign(before) && before !== 0) { this.sitS = this.sit; this.sitV = 0; }
      this.sitS = c(this.sitS, 0, 1.3);
    }
    // Наклон и сдвиг таза пальцем — для стоя; в посадке плавно уходят,
    // иначе таз перекручивает и ногу выбрасывает.
    this.offK = 1 - THREE.MathUtils.smoothstep(this.sitS, 0.03, 0.3);
    // Смена «на бок / на живот» — только когда она уже поднялась до колен (без скачка).
    if (this.pendingLieStyle && this.sitS <= 0.81) {
      this.lieStyle = this.pendingLieStyle;
      this.pendingLieStyle = null;
      if (this.pendingSit != null) { this.sit = this.pendingSit; this.pendingSit = null; }
    }
    this.wakeT = Math.max(0, (this.wakeT ?? 0) - dt);
    // Пока ведёшь полосу (и пару секунд после) — ножками не болтает.
    this.slideHold = Math.max(0, (this.slideHold ?? 0) - dt);
    this.kickOn = (this.kickOn ?? 1) + ((this.slideHold > 0 ? 0 : 1) - (this.kickOn ?? 1)) * (1 - Math.exp(-dt * 2.5));
    // Сон: улеглась (на живот, на спину или на бок) — немного полежит (~10 с) и уснёт.
    // Тормошат — просыпается; гладят и нежно трогают — спит дальше, довольная.
    {
      const ph = this.sitPhases();
      // Лежит — в готовой позе или в любой своей (на боку, на спине): таз и голова у самого пола.
      const hipsY = this.bones.hips.getWorldPosition(new THREE.Vector3()).y;
      const headY = this.bones.head.getWorldPosition(new THREE.Vector3()).y;
      const lying = Math.max(ph.b4, ph.c4, ph.p4) > 0.85 || (hipsY < 0.36 && headY < 0.42);
      this.disturb = Math.max(0, (this.disturb ?? 0) - dt * 0.6);
      if (lying && this.wakeT <= 0) this.lieT = (this.lieT ?? 0) + dt;
      else if (!lying) this.lieT = 0;
      if (this.wakeT > 0) this.lieT = Math.min(this.lieT ?? 0, 3); // разбудили — снова задремлет не сразу
      // Смотришь ей в лицо в режиме «смотрит на тебя» — не засыпает, смотрит в ответ.
      let watched = false;
      if (this.gazeTarget && this.headRestInv) {
        const hp = this.bones.head.getWorldPosition(new THREE.Vector3());
        const toCam = this.gazeTarget.clone().sub(hp).normalize();
        // Камера с лицевой стороны тела (не со спины/затылка).
        const chestQ = (this.chestNode() ?? this.bones.hips).getWorldQuaternion(new THREE.Quaternion());
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(chestQ.multiply(this.hipsRestInv));
        watched = toCam.dot(fwd) > 0.2;
      }
      // Смотришь в лицо — засыпает позже, но всё равно засыпает.
      // forceSleep — состояние «Спит»: спит, пока сам не разбудишь; касания её не будят.
      const want = (this.forceSleep && lying) || (lying && this.wakeT <= 0 && this.lieT > (watched || this.autoSleep ? 22 : 10)) ? 1 : 0;
      // Засыпает медленно (веки тяжелеют), просыпается быстрее.
      this.sleep += (want - this.sleep) * (1 - Math.exp(-dt * (want ? 0.7 : 1.5))); // просыпается без рывка
      this.sleepJoy = Math.max(0, (this.sleepJoy ?? 0) - dt * 0.25);
    }
    this.sitDropNow = 0;
    this.sitBackNow = 0;
    this.sitSideNow = 0;
    if (this.sitS > 0.001) {
      const s = this.sitS;
      const { p1, p2, p3 } = this.sitPhases(s);
      this.sitDropNow = this.sitDropFor(s);
      this.sitSideNow = 0.12 * p3 * this.scale; // сидя боком таз смещён к руке-опоре
      this.sitBackNow = (0.12 * p1 * (1 - p2)) * this.scale;
      // Таз опускаем напрямую (без отдельной пружины), чтобы он не отставал от ног.
      // Присед на каблуках: таз уходит назад и наклоняется вперёд, поясница прогибается,
      // корпус подаётся вперёд, грудь раскрыта. На коленях — прямая спина с лёгким прогибом.
      const squat = p1 * (1 - p2);
      // Динамика движения вниз-вверх: опускаясь, корпус подаётся вперёд и бёдра уходят
      // в сторону (каждый раз в другую); поднимаясь — грудь раскрывается, лёгкая пружинка.
      {
        const v = THREE.MathUtils.clamp(this.sitV ?? 0, -2, 2);
        this.sitVS = (this.sitVS ?? 0) + (v - (this.sitVS ?? 0)) * Math.min(1, (this.lastDt ?? 0.016) * 4); // плавно нарастает и уходит
        const vs = this.sitVS;
        if (Math.sign(vs) !== Math.sign(this.sitDirPrev ?? 0) && Math.abs(vs) > 0.15) {
          this.sitDirPrev = Math.sign(vs);
          if (vs > 0) this.sitSideSign = -(this.sitSideSign ?? 1);
        }
        const near = 1 + 0.35 * p2; // ниже (колени, пол) — движение даже шире
        // Сила движения: быстро — сильнее, но и медленное приседание заметно (не «столбиком»).
        const mag = Math.min(1, Math.abs(vs) * 1.6);
        const down = vs > 0 ? mag : 0, up = vs < 0 ? mag : 0;
        const side = (this.sitSideSign ?? 1) * mag;
        pose.spineX += (down * 0.3 - up * 0.24) * near;
        pose.hipsRotX += (down * 0.12 - up * 0.08) * near;
        pose.headX -= (down * 0.1 - up * 0.06) * near;
        pose.hipsZ += side * 0.2 * near;
        pose.hipsX += side * 0.03 * this.scale * near;
        pose.hipsRotY += side * 0.14 * near;
        pose.spineZ -= side * 0.12 * near;
        pose.spineY -= side * 0.08 * near;
        pose.headZ += side * 0.08 * near;
        pose.lShoulderZ += side * 0.05; pose.rShoulderZ += side * 0.05;
      }
      // Баланс как у человека: центр тяжести над стопами, поэтому в приседе
      // корпус наклоняется вперёд примерно параллельно голени (угол голени
      // берём с прошлого кадра). Наклон делят таз (больше) и поясница (с прогибом).
      const lean = THREE.MathUtils.clamp(this.shinLean, 0, 1.0);
      pose.hipsRotX += (0.68 * lean + 0.06) * squat + 0.18 * p2;
      pose.spineX += (0.3 * lean - 0.14) * squat - 0.1 * p2; // прогиб поясницы; часть наклона — спиной
      pose.headX -= 0.25 * squat + 0.05 * p2;
      pose.hipsZ *= Math.max(0, 1 - s);
      pose.hipsX *= Math.max(0, 1 - s);
      if (p3 > 0) {
        // Сидит боком: ноги сложены в одну сторону, корпус развёрнут к тебе,
        // опора на одну руку, спина — мягкой S-линией, голова набок.
        // Таз сильнее развёрнут к ногам — бёдрам не нужно скручиваться сверх нормы.
        pose.hipsRotY += 0.6 * p3;
        pose.spineY -= 0.42 * p3;
        pose.hipsZ += 0.12 * p3;
        pose.spineZ += 0.16 * p3;
        pose.headZ -= 0.22 * p3;
        pose.hipsRotX -= 0.1 * p3;
        pose.spineX -= 0.06 * p3;
        pose.headX += 0.06 * p3;
      }
      // Сидит — не замирает: мягко покачивается, наклоняет голову.
      // Бёдра живые и в приседе (на пятках), и на коленях, и сидя/лёжа.
      // Свои «часы» бёдер: на полу и лёжа покачивание живее (быстрее), во сне — тише, но не замирает.
      this.hipClock = (this.hipClock ?? t) + (this.lastDt ?? 0.016) * (1 + 0.7 * p2) * (1 - 0.5 * (this.sleep ?? 0));
      const tt = this.hipClock;
      // во сне — почти неподвижна; лёжа на боку ёрзает вдвое спокойнее (иначе её «перегибает»)
      // На животе сама ёрзает заметно спокойнее (иначе её «возит» по полу); пока её ведут или выставили точки — ещё тише.
      const hipLife = p1 * (1 - 0.88 * (this.sleep ?? 0)) * (1 + 0.25 * p2) * (1 - 0.5 * this.sitPhases(s).p4) * (1 - 0.7 * this.sitPhases(s).b4) * (this.slideHold > 0 ? 0.5 : 1)
        * (1 - 0.55 * p2 * (1 - this.sitPhases(s).p3)); // на коленях сама «плавает» вдвое меньше
      if (hipLife > 0) {
        const ph2 = this.sitPhases(s);
        const lieAll = Math.max(ph2.p4, ph2.b4, ph2.c4);
        const hw = Math.tanh(1.8 * Math.sin(tt * 0.6)) / Math.tanh(1.8);
        const squatK = p1 * (1 - p2);
        // На полу (колени, сидя, лёжа) — шире и пластичнее: бёдра плавно переносят вес
        // из стороны в сторону с поворотом — мягкая «восьмёрка», а не мелкое дрожание.
        const floorK = p2;
        const fig = Math.sin(tt * 0.6 * 2 + 0.7); // второй такт восьмёрки
        pose.hipsZ += hw * (0.15 + 0.16 * floorK + 0.12 * Math.max(ph2.p4, ph2.c4)) * hipLife;
        pose.hipsX += hw * (0.035 * squatK + 0.045 * floorK * (1 - lieAll)) * this.scale;
        pose.hipsRotY += (Math.sin(tt * 0.6 + 1.3) * (0.11 * floorK + 0.12 * lieAll) + Math.sin(tt * 0.42 + 1.1) * 0.1) * hipLife;
        // Сидя и лёжа ёрзает: плечи и голова тоже плавно перекатываются.
        pose.spineZ += Math.sin(tt * 0.6 + 2.0) * (0.06 * floorK + 0.1 * lieAll) * hipLife;
        pose.headY += Math.sin(tt * 0.5 + 0.4) * (0.08 * floorK + 0.2 * lieAll) * hipLife;
        pose.headZ += Math.sin(tt * 0.43 + 1.7) * (0.06 * floorK + 0.08 * lieAll) * hipLife;
        pose.hipsY += fig * 0.012 * floorK * (1 - lieAll) * this.scale * hipLife;
        // Корпус уравновешивает — плечи плывут в противофазе, шея держит голову ровно.
        pose.spineY -= Math.sin(tt * 0.6 + 1.3) * 0.05 * floorK * hipLife;
        pose.headZ += hw * 0.05 * floorK * hipLife;
        // Таз мягко покачивается вперёд-назад — «волна» бёдрами.
        pose.hipsRotX += Math.sin(tt * 0.5 + 0.4) * 0.06 * (1 - lieAll * 0.5) * hipLife;
        pose.spineX -= Math.sin(t * 0.5 + 0.4) * 0.04 * (1 - lieAll * 0.5) * hipLife;
        pose.spineZ -= hw * 0.06 * (1 - lieAll) * hipLife;
      }
      // Упирается руками в пол (на четвереньках) — плавно покачивается вперёд-назад,
      // спина мягко прогибается и округляется, бёдра ходят из стороны в сторону.
      {
        const sup = Math.min(this.supW?.left ?? 0, this.supW?.right ?? 0) * (1 - (this.sleep ?? 0));
        if (sup > 0.01) {
          const rock = Math.sin(t * 0.7);
          pose.hipsRotX += rock * 0.05 * sup;
          pose.spineX -= Math.sin(t * 0.7 + 0.9) * 0.1 * sup;
          pose.hipsZ += Math.sin(t * 0.45) * 0.06 * sup;
          pose.headX += Math.sin(t * 0.7 + 0.9) * 0.06 * sup;
        }
      }
      // На полу — свои живые движения: сидя боком то опирается сильнее, то выпрямляется;
      // на животе покачивает головой в такт ножкам; на спине потягивается корпусом.
      {
        const ph3 = this.sitPhases(s);
        const lean = Math.sin(t * 0.33 + 0.5);
        pose.spineZ += lean * 0.07 * ph3.p3 * (1 - ph3.p4);
        pose.hipsZ += lean * 0.04 * ph3.p3 * (1 - ph3.p4);
        pose.headZ -= lean * 0.06 * ph3.p3 * (1 - ph3.p4);
        const awake = 1 - (this.sleep ?? 0);
        // На четвереньках (по дороге на живот) голова поднята и смотрит вперёд, спина чуть прогнута — живая поза,
        // а не «уткнулась в пол».
        { const four = ph3.b3 * (1 - ph3.b4) * awake; pose.headX -= 0.62 * four; pose.spineX -= 0.3 * four; }
        pose.headZ += Math.sin(t * 0.52) * 0.07 * ph3.b4 * awake;
        pose.spineY += Math.sin(t * 0.52) * 0.025 * ph3.b4 * awake;
        pose.spineX -= Math.max(0, Math.sin(t * 0.17)) * 0.08 * ph3.c4;
        pose.hipsRotY += Math.sin(t * 0.22) * 0.06 * ph3.c4;
      }
      const seatedLife = p2 * (1 - 0.5 * this.sitPhases(s).p4) * (1 - 0.85 * (this.sleep ?? 0));
      if (seatedLife > 0) {
        pose.spineZ += Math.sin(t * 0.47) * 0.05 * seatedLife;
        pose.spineX += Math.sin(t * 0.31 + 1.2) * 0.03 * seatedLife;
        pose.headZ += Math.sin(t * 0.37 + 0.6) * 0.09 * seatedLife;
        pose.headY += Math.sin(t * 0.23 + 2.1) * 0.12 * seatedLife;
      }
      const { p4 } = this.sitPhases(s);
      if (p4 > 0) {
        // Ложится на правый бок, приподнявшись на локте: таз заваливается набок,
        // грудь приподнята, голова ровно и смотрит на тебя, ноги вместе и согнуты.
        // Засыпает — опускается с локтя: корпус ложится на бок, голова — на пол/руку.
        const up = 1 - (this.sleep ?? 0);
        pose.hipsZ += 1.3 * p4;
        pose.hipsRotY -= 0.25 * p4;
        pose.spineZ -= (0.5 * up - 0.06 * (1 - up)) * p4;
        pose.spineY += 0.2 * p4 * up;
        pose.headZ -= (0.55 * up - 0.3 * (1 - up)) * p4;
        pose.hipsY -= 0.11 * (1 - up) * p4 * this.scale; // легла с локтя — таз опускается на пол, а не висит
        pose.headX += 0.05 * p4;
      }
      const { c3, c4 } = this.sitPhases(s);
      if (c3 > 0) {
        // Садится на пол (чуть откинувшись, опираясь на руки), потом плавно ложится на спину.
        pose.hipsRotX -= 0.22 * c3 * (1 - c4) + 1.5 * c4;
        pose.spineX -= 0.05 * c3 * (1 - c4) - 0.1 * c4;
        pose.headX += 0.45 * c4 * (1 - (this.sleep ?? 0)); // голова чуть приподнята — видно тебя; во сне — опущена
      }
      const { b3, b4 } = this.sitPhases(s);
      if (b3 > 0) {
        // С колен — плавный наклон вперёд к полу: таз остаётся на пятках,
        // спина округляется, плечи и голова опускаются, руки тянутся вперёд.
        const fold = b3 * (1 - b4);
        pose.hipsRotX += 0.95 * fold + 1.39 * b4; // на животе тело горизонтально
        pose.spineX += 0.45 * fold;
        // Опускается грудью на руки настолько, чтобы ладони стояли на полу (а не висели над ним).
        { const dts = this.lastDt ?? 0.016; this.sinkS = fold > 0.2 ? THREE.MathUtils.clamp((this.sinkS ?? 0) + THREE.MathUtils.clamp(this.handGapS ?? 0, -0.04, 0.1) * 8 * dts, 0, 0.6) : (this.sinkS ?? 0) * Math.exp(-dts * 4); /* уходит плавно, без скачка корпуса */ pose.spineX += this.sinkS * 0.6 * b3; pose.hipsRotX += this.sinkS * 0.4 * b3; }
        pose.headX += 0.25 * fold - 0.3 * b4; // лёжа голова чуть приподнята на руках
        pose.headY += 1.05 * b4; // щекой на руки, лицом к тебе
        pose.headZ += 0.15 * b4;
      }
    }

    // Голова, корпус и таз, заданные пальцем в режиме позы.
    pose.headY += this.headOffset.y;
    pose.headX += this.headOffset.x;
    // Наклон с левой полосы работает в полную силу и в приседе, и на коленях
    // (таз наклоняется так же красиво, как стоя); уходит только когда она садится
    // на пол / ложится — там наклон делает спина.
    this.bendW = 1 - THREE.MathUtils.smoothstep(this.sitS, 0.8, 1.0);
    // Лёжа наклон вперёд почти некуда делать (особенно на животе — в пол):
    // ослабляем, чтобы спину не складывало пополам и голова не уходила под тело.
    const phL = this.sitPhases();
    const fwdLie = 1 - Math.max(0.92 * phL.b4, 0.55 * phL.c4, 0.45 * phL.p4);
    // Наклон вперёд останавливается, когда голова/грудь касаются пола:
    // её не подбрасывает вверх (колени остаются на полу), а наклон мягко упирается.
    {
      const gap = this.upperGap ?? 1;
      const want = gap < 0.005 * this.scale ? -1 : gap > 0.04 * this.scale ? 1 : 0;
      this.bendScale = THREE.MathUtils.clamp((this.bendScale ?? 1) + want * dt * (want < 0 ? 1.2 : 0.35), 0.25, 1);
    }
    const fwdCap = this.sitS > 0.3 && this.sitS < 1.0 ? this.bendScale : 1;
    for (const key in this.bodyOffset) {
      if (key === 'hipsFwd') continue; // сдвиг таза вперёд-назад на полу — отдельно, см. plantFeet
      let w = key === 'hipsRotX' ? this.bendW : key.startsWith('hips') ? this.hipsOffK() : 1;
      if (key === 'spineX' && this.bodyOffset.spineX > 0) w *= fwdLie;
      if ((key === 'spineX' || key === 'hipsRotX') && this.bodyOffset[key] > 0) w *= fwdCap;
      pose[key] += this.bodyOffset[key] * w;
    }
    // Мягкий предел наклона таза (в приседе/на коленях наклон складывается с посадкой):
    // излишек уходит в спину — полоса отзывается, но она не переворачивается.
    {
      // В приседе и на коленях бедро не складываем к животу слишком сильно
      // (кожа сзади модели на сильном сгибе сминается в плоскость): таз наклоняется
      // меньше, остальное берёт спина — наклон такой же глубокий, но дугой.
      const sitK = this.sitPhases().p1;
      const lim = 1.25 - 0.5 * sitK;
      const gate = this.bendW * (1 - this.sitPhases().b3); // не трогаем «лечь на живот»
      if (pose.hipsRotX > lim && gate > 0) {
        const ex = pose.hipsRotX - lim;
        const soft = 0.35 * Math.tanh(ex / 0.35);
        const cut = (ex - soft * 0.4) * gate;
        pose.hipsRotX -= cut;
        pose.spineX += cut * (0.55 + 0.25 * sitK);
      }
    }
    {
      const lie = 1 - this.bendW;
      if (lie > 0) {
        // Засыпает — опускается с рук и ложится (прогиб/наклон плавно уходят).
        const bend = this.bodyOffset.hipsRotX * (1 - 0.92 * (this.sleep ?? 0));
        const ph = this.sitPhases();
        // Сидя на полу / лёжа наклон делает спина — с хорошей амплитудой;
        // немного помогает и таз (кроме «на боку», где он лежит).
        const k = bend >= 0 ? 1.35 * fwdLie : 1.2 * (1 + 0.25 * ph.b4); // на животе прогиб — выше на руках
        pose.spineX += bend * k * lie;
        // Общий предел изгиба спины лёжа/сидя на полу.
        pose.spineX = THREE.MathUtils.clamp(pose.spineX, -1.15 - 0.45 * ph.b4, 1.5);
        // На полу полоса двигает и таз: наклон — таз подаётся вперёд, прогиб — назад,
        // и бёдра перекатываются вбок — она ёрзает по полу всем телом.
        const lieAll2 = Math.max(ph.p4, ph.b4, ph.c4);
        // Лёжа на животе/спине таз почти не наклоняем (иначе ноги задирает и они кривые) —
        // он перекатывается вбок и поворачивается; на боку и сидя — наклоняется.
        const flat = Math.max(ph.b4, ph.c4);
        pose.hipsRotX += bend * (0.3 * (1 - lieAll2) + 0.3 * ph.p4) * (1 - 0.85 * flat) * lie;
        // Перекат вбок — только сидя на полу и на боку; на животе/спине — без скручивания.
        const roll = bend * lie * (1 - flat);
        pose.hipsZ += roll * 0.4;
        pose.hipsRotY -= roll * 0.3;
        pose.spineZ -= roll * 0.2;
        pose.headZ -= roll * 0.3;
        pose.headY += roll * 0.15;
        pose.headX -= bend * 0.2 * lie * (bend >= 0 ? fwdLie : 1);
        // Мостик лёжа на спине: таз поднимается (рукой за таз или прогибом в простом виде), а плечи и голова
        // остаются на полу — тело не «взлетает» целиком. Прогиб лёжа на спине = таз вверх, а не ломаная спина.
        {
          const arch = Math.max(0, -bend) * ph.c4 * lie;
          pose.hipsY += arch * 0.2 * this.scale;
          pose.spineX += arch * 1.2 * 0.6; // часть прогиба спины возвращаем: его работу делает подъём таза
          const up = Math.max(0, this.bodyOffset.hipsY) / this.scale + arch * 0.2;
          const ang = Math.asin(Math.min(0.9, up / 0.5)) * ph.c4 * lie;
          pose.hipsRotX -= ang;
          this.bridgeK = THREE.MathUtils.smoothstep(up * ph.c4 * lie, 0.02, 0.08); // мостик — ладони упираются в пол
          pose.headX += ang * 0.35; // голова лежит на полу, а не запрокидывается
        }
        // То же на животе: таз поднимается, а грудь, руки и ноги остаются на полу (раньше всё тело целиком
        // поднималось и висело над полом).
        {
          const upB = Math.max(0, this.bodyOffset.hipsY) / this.scale;
          pose.hipsRotX += Math.asin(Math.min(0.9, upB / 0.5)) * ph.b4 * lie;
        }
      }
    }
    // Руки висят по гравитации: корпус наклонили вперёд/прогнули назад — плечи
    // поворачиваются обратно, кисти смотрят вниз, а не торчат вперёд или в стороны.
    {
      const pitch = (this.bodyOffset.hipsRotX * this.bendW + this.bodyOffset.spineX) * Math.max(this.offK, 0.6 * this.bendW);
      const hang = THREE.MathUtils.clamp(pitch, -0.9, 1.6) * 0.75;
      pose.lUpperX -= hang;
      pose.rUpperX -= hang;
      // Руки чуть отводятся от тела в наклоне/прогибе и сидя — не проходят сквозь бёдра и бока.
      const away = 0.03 * Math.min(1, Math.abs(pitch)) + 0.03 * THREE.MathUtils.smoothstep(this.sitS, 0.2, 0.6); // ближе к телу
      pose.lUpperZ += away;
      pose.rUpperZ -= away;
      this.armHang = hang;
    }
    // Контрапост: бёдра ушли вбок — плечи и голова уравновешивают S-линией,
    // таз чуть опускается, и свободное колено мягко сгибается само (IK).
    {
      const hz = this.bodyOffset.hipsZ * this.offK;
      pose.spineZ -= hz * 0.9;
      pose.headZ += hz * 0.45;
      pose.lShoulderZ += hz * 0.25;
      pose.rShoulderZ += hz * 0.25;
      pose.hipsY -= Math.abs(hz) * 0.12 * this.scale;
    }
    this.updateDragPhysics(dt);
    // Баланс: подняла ногу — вес на опорную ногу, таз и корпус уравновешивают.
    const liftOf = (side) => {
      const f = this.dragPhys.foot[side]?.x;
      return f ? THREE.MathUtils.clamp(f.y / (0.12 * this.scale), 0, 1) * this.offK : 0;
    };
    const liftL = liftOf('left');
    const liftR = liftOf('right');
    pose.hipsX += (liftR - liftL) * 0.06 * this.scale;
    pose.hipsZ += (liftL - liftR) * 0.07;
    pose.spineZ += (liftL - liftR) * 0.06;
    // Тянется за рукой.
    pose.spineX += this.reachLean.z;
    pose.spineZ += this.reachLean.x;
    // Наклон вперёд — голова чуть приподнимается, чтобы смотреть на тебя.
    pose.headX -= this.bodyOffset.spineX * 0.4;

    // Голова чуть поворачивается за пальцем/курсором.
    const bendHL = 1 - 0.6 * THREE.MathUtils.smoothstep(Math.abs(this.bodyOffset.hipsRotX), 0.2, 0.7);
    pose.headY += this.headLook.x * 0.35 * bendHL * (1 - (this.sleep ?? 0));
    // Кокетливый взгляд (см. флирт в main.js): подбородок чуть вниз, голова набок — смотрит из-под ресниц.
    {
      this.coyT = Math.max(0, (this.coyT ?? 0) - dt);
      this.coyK = (this.coyK ?? 0) + ((this.coyT > 0 ? 1 : 0) - (this.coyK ?? 0)) * (1 - Math.exp(-dt * 3));
      const ck = this.coyK * (1 - (this.sleep ?? 0));
      pose.headX += 0.13 * ck;
      pose.headZ += 0.09 * ck * (this.coySide ?? 1);
      pose.spineZ -= 0.03 * ck * (this.coySide ?? 1);
    }
    // Смущение, когда камера близко к лицу: сначала смотрит в глаза и улыбается,
    // потом (чем выше симпатия, тем мягче и чаще) отводит взгляд и голову, краснеет — и снова смотрит.
    {
      const close = this.camClose ?? 0; // 0..1 — насколько камера близко к лицу
      this.closeT = close > 0.5 ? (this.closeT ?? 0) + dt : Math.max(0, (this.closeT ?? 0) - dt * 2);
      const level = this.loveK ?? 0; // 0..1 — уровень симпатии
      const period = 7 - 2.5 * level;
      const ph = this.closeT > 2.5 ? ((this.closeT - 2.5) % period) / period : -1;
      const shy = ph >= 0 && ph < 0.28 ? Math.sin((ph / 0.28) * Math.PI) : 0;
      this.shyNow = shy;
      const side = Math.sin(Math.floor((this.closeT - 2.5) / period) * 12.9898) > 0 ? 1 : -1;
      pose.headY += 0.45 * shy * side;
      pose.headX += 0.18 * shy;
      pose.headZ += 0.08 * shy * side;
      pose.lShoulderZ += 0.06 * shy;
      pose.rShoulderZ -= 0.06 * shy;
      // Лёгкая (без закрытых глаз) улыбка и смущение — применяются в updateExpressions.
      this.closeSmile = this.closeT > 1.2 ? (0.07 + 0.06 * level) * (1 - shy) : 0;
    }
    // «Смотрит на тебя»: голова, шея и корпус поворачиваются к камере — как человек,
    // который оборачивается через плечо (до ~170°: шея ~95°, корпус ~80°).
    {
      const k = 1 - Math.exp(-dt * 3);
      const on = this.gazeTarget ? 1 : 0;
      this.gazeW = (this.gazeW ?? 0) + (on - (this.gazeW ?? 0)) * k;
      const yaw = (this.gazeYaw ?? 0);
      const pitch = (this.gazePitch ?? 0);
      this.gazeYawS = (this.gazeYawS ?? 0) + (yaw - (this.gazeYawS ?? 0)) * k;
      this.gazePitchS = (this.gazePitchS ?? 0) + (pitch - (this.gazePitchS ?? 0)) * k;
      const w = this.gazeW;
      // Сзади оборачивается умеренно (до ~125°), без выворачивания.
      // Камера сзади — оборачивается только чуть-чуть (голова ~70°, корпус ~25°),
      // дальше не тянется: никаких выкрученных спин.
      const total = THREE.MathUtils.clamp(this.gazeYawS, -1.65, 1.65) * w;
      // В наклоне и на полу корпус не скручиваем — поворачивается только голова.
      const bendK = Math.max(THREE.MathUtils.smoothstep(Math.abs(this.bodyOffset.hipsRotX), 0.2, 0.7), THREE.MathUtils.smoothstep(this.sitS, 0.3, 0.8));
      const head = THREE.MathUtils.clamp(total, -1.2 + 0.3 * bendK, 1.2 - 0.3 * bendK);
      const body = THREE.MathUtils.clamp(total - head, -0.45, 0.45) * (1 - bendK);
      pose.headY += head;
      pose.spineY += body;
      // Наклонена — поднимает голову к тебе сильнее (угол считается относительно корпуса).
      const lieK = THREE.MathUtils.smoothstep(this.sitS, 1.0, 1.3);
      // Смотрит в глаза: голова поднимается/опускается к камере сильнее (особенно вблизи),
      // а грудь чуть помогает, если камера очень низко или высоко.
      const pitchT = THREE.MathUtils.clamp(-this.gazePitchS, -0.9 - 0.45 * Math.max(bendK, lieK), 0.9);
      pose.headX += pitchT * w;
      pose.spineX += THREE.MathUtils.clamp(pitchT * 0.25, -0.15, 0.12) * w * (1 - bendK) * (1 - lieK);
    }
    pose.headX += -this.headLook.y * 0.2 * (1 - (this.sleep ?? 0));

    // Пока гладят — голова клонится и прижимается к руке.
    // Тянется к руке: голова (и чуть корпус) клонятся в сторону пальца — и когда гладят
    // по голове, и когда гладят там, где ей нравится.
    const pl = this.pleasure ?? 0;
    this.touchSideS = (this.touchSideS ?? 0) + ((this.touchSide ?? 0) - (this.touchSideS ?? 0)) * (1 - Math.exp(-(this.lastDt ?? 0.016) * 4));
    const lean = pl * this.touchSideS * (1 - (this.sleep ?? 0));
    pose.headZ += this.patAmount * 0.18 * Math.sin(t * 2.2) * (1 - 0.55 * Math.abs(this.touchSideS));
    pose.headX += this.patAmount * 0.12;
    pose.headZ += HEAD_LEAN_SIGN * 0.17 * lean;
    pose.spineZ += HEAD_LEAN_SIGN * 0.045 * lean * (1 - THREE.MathUtils.smoothstep(this.sitS, 0.9, 1.2));
    // Пока гладят — смущённо сводит ладошки перед собой, плечики чуть вверх.
    {
      const pa = this.patAmount * (this.armPreset.left || this.armPreset.right || this.handTargets.left || this.handTargets.right ? 0 : 1)
        * (1 - THREE.MathUtils.smoothstep(this.sitS, 0.3, 0.6));
      if (pa > 0.01) {
        const sway = Math.sin(t * 1.8) * 0.06;
        blendArm(pose, 'left', { upZ: -0.9 + sway, upX: 0.12, tw: 0.75, loY: -2.0, loZ: 0 }, pa * 0.8);
        blendArm(pose, 'right', { upZ: -0.9 - sway, upX: 0.12, tw: 0.75, loY: -2.0, loZ: 0 }, pa * 0.8);
        pose.lShoulderZ += 0.08 * pa;
        pose.rShoulderZ -= 0.08 * pa;
      }
    }

    // Движения-реакции. Руки не «прибавляются» к текущей позе (из-за этого их
    // выворачивало), а плавно переходят в позу реакции и обратно.
    for (const m of this.motions) {
      m.t += dt;
      // Начала тормошить посреди жеста — он плавно гаснет (и не возвращается).
      if (TOUCH_MOTIONS[m.name] || ARM_MOTIONS.has(m.name)) {
        if (this.handsQuiet || (this.onHands ?? 0) > 0.5) m.quit = true;
        if (m.quit) { m.fade = (m.fade ?? 1) * Math.exp(-dt * 5); if (m.fade < 0.02) m.t = m.dur + 1; }
      }
      const e = envelope(m.t, m.dur) * (m.fade ?? 1);
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
        default:
          if (TOUCH_MOTIONS[m.name]) TOUCH_MOTIONS[m.name].body(pose, s, e, m.t);
          break;
        case 'lieTurn':
          // Лёжа: поднимает голову и поворачивается к тебе, мягко улыбается.
          pose.headY += 0.5 * e * (this.lieStyle === 'belly' ? 1 : 0.4);
          pose.headX -= 0.25 * e;
          pose.spineX -= 0.08 * e;
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
        // Без одинаковых движений подряд — разнообразнее и живее.
        const pickFresh = (list) => {
          const opts = list.filter((n) => n !== this.lastIdleMotion);
          this.lastIdleMotion = pick(opts.length ? opts : list);
          return this.lastIdleMotion;
        };
        const lying = this.sitS > 1.05;
        if (this.frozen || this.dancing || this.loop || (this.upper && !this.upper.stopping && this.sitS < 0.2) || (this.sleep ?? 0) > 0.3) { /* замерла, занята или спит */ }
        else if (lying) {
          // Лёжа: изредка поворачивает голову, вздыхает, потягивается корпусом.
          if (r < 0.6) this.playMotion(pickFresh(['lookAround', 'sigh', 'tiltHead', 'lieTurn']));
        } else if (this.posing) {
          // Во вкладке «Позы» руки — твои: только голова живёт.
          this.playMotion(pickFresh(['lookAround', 'tiltHead', 'sigh']));
        } else if (this.sitS > 0.2) {
          // Сидя / на коленях: голова, вздох, иногда поправляет волосы.
          this.playMotion(pickFresh(['lookAround', 'tiltHead', 'sigh', 'tiltHead', 'touchHair']));
        } else if (busyArms) this.playMotion(pickFresh(['shift', 'lookAround', 'tiltHead', 'sigh']));
        else this.playMotion(pickFresh([
          'shift', 'lookAround', 'tiltHead', 'sigh',
          'touchHair', 'clasp', 'handOnHip', 'nails', 'stretch',
        ]));
      }
    }

    // Нежные жесты руками по своему телу — раз в 7–13 с, когда она просто стоит.
    this.touchTimer = (this.touchTimer ?? 6) - dt;
    if (this.touchTimer <= 0) {
      this.touchTimer = 7 + Math.random() * 6;
      const free = !this.posing && this.poseName === 'stand' && this.sitS < 0.15 && !this.dancing && !this.loop
        && !this.mixer && this.patAmount < 0.1 && !this.motions.some((m) => TOUCH_MOTIONS[m.name] || ARM_MOTIONS.has(m.name))
        && !this.handTargets.left && !this.handTargets.right && !this.armPreset.left && !this.armPreset.right
        && Math.abs(this.bodyOffset.hipsRotX) < 0.1;
      if (free) {
        const names = Object.keys(TOUCH_MOTIONS).filter((n) => n !== this.lastTouch);
        this.lastTouch = pick(names);
        this.playMotion(this.lastTouch);
      }
    }

    // Пружины: каждый сустав догоняет цель с инерцией (бёдра тяжёлые,
    // голова и руки чуть запаздывают) — движения становятся плавными и живыми.
    // Примагниченная рука берёт выверенную позу руки (на талию / на поясницу) — красиво и без IK-перекрутов.
    for (const side of ['left', 'right']) {
      const preset = POSES[this.armPreset[side]];
      if (!preset) continue;
      const pre = side === 'left' ? 'l' : 'r';
      for (const k of ['UpperZ', 'UpperX', 'UpperTwist', 'LowerY', 'LowerZ']) {
        if (preset[pre + k] !== undefined) pose[pre + k] = preset[pre + k];
        else pose[pre + k] = BASE_POSE[pre + k];
      }
    }
    Object.assign(pose, this.springPose(pose, dt));

    // Применяем позу к нормализованным костям.
    // Изгиб корпуса распределён по позвоночнику плавной дугой (поясница, грудь,
    // верх груди) — пластичнее, без «перелома» в одной точке.
    if (b.chest && b.upperChest) {
      // Пластичная «волна» по позвоночнику: поясница ведёт, грудь и верх груди
      // догоняют с мягким запаздыванием — тело гнётся дугой, как живое.
      const wv = this.spineWave ??= { c: { x: pose.spineX, y: pose.spineY, z: pose.spineZ }, u: { x: pose.spineX, y: pose.spineY, z: pose.spineZ } };
      const kc = 1 - Math.exp(-(this.lastDt ?? 0.016) * 9);
      const ku = 1 - Math.exp(-(this.lastDt ?? 0.016) * 6.5);
      wv.c.x += (pose.spineX - wv.c.x) * kc; wv.c.y += (pose.spineY - wv.c.y) * kc; wv.c.z += (pose.spineZ - wv.c.z) * kc;
      wv.u.x += (wv.c.x - wv.u.x) * ku; wv.u.y += (wv.c.y - wv.u.y) * ku; wv.u.z += (wv.c.z - wv.u.z) * ku;
      this.rot(b.spine, pose.spineX * 0.36, pose.spineY * 0.3, pose.spineZ * 0.36);
      this.rot(b.chest, wv.c.x * 0.34, wv.c.y * 0.35, wv.c.z * 0.34);
      this.rot(b.upperChest, wv.u.x * 0.3, wv.u.y * 0.35, wv.u.z * 0.3);
    } else {
      const spineBone = b.chest ?? b.spine;
      this.rot(b.spine, pose.spineX * 0.5, pose.spineY * 0.5, pose.spineZ * 0.5);
      this.rot(spineBone, pose.spineX * 0.5, pose.spineY * 0.5, pose.spineZ * 0.5);
    }
    this.rot(b.neck, pose.headX * 0.4, pose.headY * 0.4, pose.headZ * 0.4);
    this.rot(b.head, pose.headX * 0.6, pose.headY * 0.6, pose.headZ * 0.6);
    this.applyUpperArm('left', pose, 0);
    this.applyUpperArm('right', pose, 0);
    this.rot(b.leftLowerArm, 0, pose.lLowerY, pose.lLowerZ);
    this.rot(b.rightLowerArm, 0, pose.rLowerY, pose.rLowerZ);
    this.rot(b.leftShoulder, 0, 0, pose.lShoulderZ);
    this.rot(b.rightShoulder, 0, 0, pose.rShoulderZ);
    // Кисти мягко опущены к ладони.
    // Кисти мягко поворачиваются, каждая в своём ритме.
    this.rot(b.leftHand, Math.sin(t * 0.9) * 0.08, Math.sin(t * 0.6 + 1) * 0.1, -(pose.handBend + Math.sin(t * 0.71) * 0.08));
    this.rot(b.rightHand, Math.sin(t * 0.85 + 2) * 0.08, -Math.sin(t * 0.63 + 0.4) * 0.1, pose.handBend + Math.sin(t * 0.79 + 1.3) * 0.08);
    this.rot(b.leftUpperLeg, pose.lLegX, 0, pose.lLegZ);
    this.rot(b.rightUpperLeg, pose.rLegX, 0, pose.rLegZ);
    this.rot(b.leftLowerLeg, pose.lKneeX, 0, 0);
    this.rot(b.rightLowerLeg, pose.rKneeX, 0, 0);
    // Пальцы слегка согнуты и чуть «дышат».
    // Пальцы шевелятся каждый в своём темпе, а не все разом.
    for (const f of this.fingers) {
      const s = f.side === 'left' ? -1 : 1;
      const curl = 1 + Math.sin(t * 0.7 + f.phase) * 0.12 + Math.sin(t * 1.9 + f.phase * 2) * 0.04;
      if (f.thumb) this.rot(f.node, 0, -s * f.curl * curl, 0);
      else this.rot(f.node, 0, 0, s * f.curl * curl);
    }
    if (b.hips) {
      const wk = this.updateWalk(dt, pose);
      b.hips.position.y += pose.hipsY - this.sitDropNow + (this.heelRaise ?? 0);
      b.hips.position.x += (pose.hipsX + wk.x) * this.flip;
      b.hips.position.z += wk.z * this.flip;
      // В приседе таз уходит чуть назад, на коленях — возвращается над пятками.
      b.hips.position.z -= this.sitBackNow * this.flip;
      b.hips.position.x -= this.sitSideNow * this.flip;
      // Наклон в тазобедренных (поза пальцем): таз уходит назад для баланса.
      b.hips.position.z -= Math.max(0, this.bodyOffset.hipsRotX) * this.offK * 0.13 * this.scale * this.flip;
      this.rot(b.hips, pose.hipsRotX, pose.hipsRotY, pose.hipsZ);
    }
    // Верх тела из записи живого человека (если включено живое ожидание).
    this.applyUpperLayer(dt);
    // Ступни стоят на полу: колени сгибаются сами под движение бёдер.
    this.kneeFwdDone = false;
    this.plantFeet(pose);
    // Не даём кистям уйти внутрь тела: при необходимости отводим руки наружу.
    this.solveArms(pose, dt);
    // Руки, выставленные пальцем, тянутся к своим точкам.
    this.applyHandTargets();
    this.applyHandRest(dt);
    this.applyPoseHands(dt);
    this.applySelfTouch();
    // Низко к полу — упирается ладонями в пол (а не проводит руки сквозь него).
    this.applyFloorSupport(dt);
    // Анатомические пределы: после всех поз, IK и реакций каждый сустав
    // возвращается в диапазон, возможный у живого человека.
    this.applyJointLimits();
    this.footFloorFix();
    this.handFloorFix();
    this.applyBlendFrom(dt);
    // Пол для всего тела: колени, таз, руки, голова не проходят сквозь пол.
    if (this.floorPush()) {
      this.plantFeet(pose);
      this.applyHandTargets();
      this.applySelfTouch();
      this.applyFloorSupport(0);
      this.applyJointLimits();
      this.footFloorFix();
      this.handFloorFix();
    }
    // Точная доводка взгляда: лицо смотрит прямо в камеру с любого ракурса.
    this.applyHeadAim(dt);
    // Где колени оказались в готовой позе (после всех пределов суставов) — отсюда берём их место на полу.
    if (this.bones.leftLowerLeg && this.bones.rightLowerLeg) {
      const kl = this.kneeLast ??= {};
      const nl = this.bones.leftLowerLeg.getWorldPosition(new THREE.Vector3());
      this.kneeStill = kl.left && kl.left.distanceTo(nl) < 0.2 * this.scale * Math.max(dt, 0.004) ? (this.kneeStill ?? 0) + dt : 0; // секунд подряд колено почти не двигалось
      kl.left = nl;
      kl.right = this.bones.rightLowerLeg.getWorldPosition(new THREE.Vector3());
    }
    // Корректирующий объём бёдер: чем сильнее согнута нога в тазу, тем выпуклее сзади.
    {
      const b = this.bones;
      const hq = b.hips.getWorldQuaternion(new THREE.Quaternion()).multiply(this.hipsRestInv);
      const down = new THREE.Vector3(0, -1, 0).applyQuaternion(hq);
      const flex = (side) => {
        const up = b[`${side}UpperLeg`];
        const lo = b[`${side}LowerLeg`];
        if (!up || !lo) return 0;
        const d = lo.getWorldPosition(new THREE.Vector3()).sub(up.getWorldPosition(new THREE.Vector3())).normalize();
        return THREE.MathUtils.smoothstep(Math.acos(THREE.MathUtils.clamp(d.dot(down), -1, 1)), 0.3, 1.75);
      };
      // Только возврат объёма, потерянного сеткой при сгибе (см. installHipKeep): стоя — ноль.
      const amt = 0.038 * (this.scale ?? 1);
      HIP_FLEX.value.set(flex('left') * amt, flex('right') * amt);
      SQUAT_FLEX.value = (flex('left') + flex('right')) / 2; // правка сетки между ног в приседе (см. outfits.js)
      { const upK = THREE.MathUtils.smoothstep(new THREE.Vector3(0, 1, 0).applyQuaternion(hq).y, 0.15, 0.8); CROTCH_LIFT.value = SQUAT_FLEX.value; void upK; } // по замеру ровности: втягивание равно сгибу ног в любой позе (ослабление давало бугор)
    }

    this.calmArms(dt);
    this.finishFrame(dt);
  }

  // Сама поворачивается боком/спиной. Вся поза считается как обычно (лицом вперёд), а в конце кадра модель
  // целиком доворачивается вокруг таза — ничего в позах и амплитудах не меняется. Взгляд «на тебя» пересчитан,
  // так что спиной она оглядывается через плечо. Ступни при повороте переступают.
  turnTo(a, fast = false) { this.turnGoal = a; if (fast) this.turnFast = true; }
  turnBegin(dt) {
    const sc = this.vrm.scene;
    if (this.turnBase == null) { this.turnBase = sc.rotation.y; this.turnPos = sc.position.clone(); this.turn = 0; this.turnV = 0; this.turnGoal ??= 0; }
    if (this.turnApplied) { sc.rotation.y = this.turnBase; sc.position.copy(this.turnPos); sc.updateMatrixWorld(true); this.turnApplied = false; }
    if ((this.turnGoal ?? 0) === 0 && Math.abs(this.turn) < 1e-4 && Math.abs(this.turnV) < 1e-4) { this.turn = 0; this.turnV = 0; this.turnFast = false; this.turnStep = 0; return; }
    // Плавно, с разгоном и торможением (пружина без перелёта); от касания возвращается быстрее.
    const w = this.turnFast ? 9 : 2.6;
    this.turnV += ((this.turnGoal - this.turn) * w * w - 2 * w * this.turnV) * dt;
    this.turn += this.turnV * dt;
    this.turnStep = Math.min(1, Math.abs(this.turnV) / 0.5);
    this.turnPhase = (this.turnPhase ?? 0) + Math.abs(this.turnV) * dt * 5;
    // Камера и «верх» для взгляда — в её (неповёрнутой) системе.
    if (this.gazeTarget || this.gazeUp) {
      const hp = this.bones.hips.getWorldPosition(new THREE.Vector3());
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -this.turn);
      if (this.gazeTarget) this.gazeTarget = this.gazeTarget.clone().sub(hp).applyQuaternion(q).add(hp);
      if (this.gazeUp) this.gazeUp = this.gazeUp.clone().applyQuaternion(q);
    }
  }
  turnEnd() {
    if (!this.turn) return;
    const sc = this.vrm.scene;
    const hp = this.bones.hips.getWorldPosition(new THREE.Vector3());
    const q = hp.clone().sub(this.turnPos);
    const c = Math.cos(this.turn), s = Math.sin(this.turn);
    sc.rotation.y = this.turnBase + this.turn;
    sc.position.set(this.turnPos.x + q.x - (c * q.x + s * q.z), this.turnPos.y, this.turnPos.z + q.z - (-s * q.x + c * q.z));
    sc.updateMatrixWorld(true);
    this.turnApplied = true;
  }

  // Сама ходит: пара шагов в сторону/вперёд и обратно. Ступни переставляет по очереди (ведущая — со стороны
  // движения, ноги не перекрещиваются), таз переносит вес плавно. Только стоя; садится/ложится — у себя «дома».
  walkTo(x, z) {
    this.walk ??= { pos: new THREE.Vector3(), goal: new THREE.Vector3(), foot: { left: new THREE.Vector3(), right: new THREE.Vector3() }, step: null, k: 1, out: new THREE.Vector3() };
    this.walk.goal.set(x, 0, z);
  }
  walkAway() { return this.walk ? this.walk.pos.length() : 0; }
  updateWalk(dt, pose) {
    const w = this.walk;
    if (!w) return ZERO3;
    const S = this.scale;
    // Присела/легла/спит — возвращается на место.
    if (this.sitS > 0.06 || (this.sleep ?? 0) > 0.3) w.goal.set(0, 0, 0);
    w.k = 1 - THREE.MathUtils.smoothstep(this.sitS, 0.2, 0.5);
    if (!w.step) {
      const d = w.goal.clone().sub(w.pos);
      if (d.length() > 0.03 * S && dt > 0) {
        d.clampLength(0, 0.15 * S);
        const leftOut = Math.sign((this.restFoot?.left?.pos.x ?? 1) - (this.restHips?.x ?? 0)) || 1;
        let lead;
        if (Math.abs(d.x) > Math.abs(d.z) * 0.6) lead = d.x * leftOut > 0 ? 'left' : 'right';
        else lead = w.last === 'left' ? 'right' : 'left';
        w.last = lead;
        w.step = { d, u: 0, lead, trail: lead === 'left' ? 'right' : 'left', from: w.pos.clone(), dur: this.sitS > 0.06 ? 0.7 : 1.05 };
      }
    }
    const st = w.step;
    if (st) {
      st.u = Math.min(1, st.u + dt / st.dur);
      const sm = (x) => x * x * (3 - 2 * x);
      const a = sm(THREE.MathUtils.clamp(st.u / 0.5, 0, 1)); // ведущая ступня
      const b2 = sm(THREE.MathUtils.clamp((st.u - 0.5) / 0.5, 0, 1)); // вторая догоняет
      const lf = w.foot[st.lead], tf = w.foot[st.trail];
      lf.copy(st.from).addScaledVector(st.d, a); lf.y = Math.sin(Math.PI * a) * 0.05 * S;
      tf.copy(st.from).addScaledVector(st.d, b2); tf.y = Math.sin(Math.PI * b2) * 0.05 * S;
      w.pos.copy(st.from).addScaledVector(st.d, sm(st.u));
      // Вес — на опорную ногу, корпус чуть разворачивается по ходу.
      const sideSign = st.lead === 'left' ? 1 : -1;
      const sway = (Math.sin(Math.PI * a) - Math.sin(Math.PI * b2)) * w.k;
      pose.hipsZ += -0.05 * sideSign * sway;
      pose.spineZ += 0.03 * sideSign * sway;
      pose.hipsRotY += 0.1 * Math.sign(st.d.x || 0) * Math.sin(Math.PI * st.u) * w.k;
      pose.hipsY -= 0.012 * S * Math.sin(Math.PI * st.u) * w.k;
      if (st.u >= 1) { lf.y = 0; tf.y = 0; w.step = null; }
    }
    return w.out.copy(w.pos).multiplyScalar(w.k);
  }

  // Пока её тормошат, руки идут за телом с лёгкой инерцией (сглаживаем повороты плеча/локтя/кисти):
  // при резких «туда-сюда» они не дёргаются по кадрам. В покое и при обычных движениях — без изменений.
  calmArms(dt) {
    const want = this.handsQuiet ? 1 : 0;
    this.quietK = (this.quietK ?? 0) + (want - (this.quietK ?? 0)) * (1 - Math.exp(-dt * (want ? 9 : 1.6)));
    const k = this.quietK;
    this.armPrev ??= new Map();
    const limit = !this.mixer && !this.dancing && !this.loop, maxStep = 15 * dt; // ≈ 860°/с
    for (const n of ['leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand']) {
      const b = this.bones[n];
      if (!b) continue;
      let q = this.armPrev.get(n);
      if (!q) this.armPrev.set(n, (q = b.quaternion.clone()));
      if (k > 0.02 && dt > 0) {
        q.slerp(b.quaternion, 1 - Math.exp(-dt * (70 - 52 * k)));
        b.quaternion.copy(q);
      } else if (limit && dt > 0 && q.angleTo(b.quaternion) > maxStep) {
        // Рука не «телепортируется»: за кадр сустав поворачивается не больше, чем при очень быстром живом движении.
        q.rotateTowards(b.quaternion, maxStep);
        b.quaternion.copy(q);
      } else q.copy(b.quaternion);
    }
    // То же для ног: бедро, колено и стопа не перескакивают за один кадр (отстрелы при выставлении точек,
    // смене позы лёжа и т.п.). В танцах и записанных анимациях не вмешиваемся.
    for (const n of ['leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot']) {
      const b = this.bones[n];
      if (!b) continue;
      let q = this.armPrev.get(n);
      if (!q) this.armPrev.set(n, (q = b.quaternion.clone()));
      if (limit && dt > 0 && q.angleTo(b.quaternion) > maxStep) { q.rotateTowards(b.quaternion, maxStep); b.quaternion.copy(q); }
      else q.copy(b.quaternion);
    }
  }

  // Поворот нормализованной кости. У VRM 0.x модель развёрнута на 180°,
  // поэтому оси X и Z у неё зеркальные — компенсируем знаком.
  rot(bone, x, y, z) {
    bone?.rotation.set(x * this.flip, y, z * this.flip);
  }

  finishFrame(dt) {
    this.turnEnd();
    this.restorePokes();
    this.hairInertia(dt);
    if (this.dancing && !this.mixer) this.exprTarget.happy = Math.max(this.exprTarget.happy, 0.5);
    this.updateExpressions(dt);
    this.vrm.update(dt);
    // Дыхание видно телом: на вдохе грудная клетка чуть расширяется (вперёд заметнее, чем вширь), на выдохе
    // опадает. Шею и плечи возвращаем к своему размеру — руки и голова не «пульсируют». Облегающая одежда
    // нарисована по телу и вещи-сетки привязаны к тем же костям, поэтому ткань поднимается вместе с грудью.
    {
      const h = this.vrm.humanoid;
      const chest = h.getRawBoneNode('upperChest') ?? h.getRawBoneNode('chest');
      if (chest) {
        this.breathS = (this.breathS ?? 0) + (((this.breathNow ?? 0) * 0.5 + 0.5) - (this.breathS ?? 0)) * (1 - Math.exp(-dt * 6));
        const k = this.dancing || this.mixer ? 0.4 : 1;
        const sx = 1 + 0.009 * this.breathS * k, sy = 1 + 0.005 * this.breathS * k, sz = 1 + 0.024 * this.breathS * k;
        chest.scale.set(sx, sy, sz);
        for (const n of ['neck', 'leftShoulder', 'rightShoulder']) {
          const c = h.getRawBoneNode(n);
          if (c && c.parent === chest) c.scale.set(1 / sx, 1 / sy, 1 / sz);
        }
      }
    }
    this.vrm.scene.updateMatrixWorld(true);
    this.updateZones();
    this.measureGaze();
  }

  // Кисти касаются своего тела (жесты TOUCH_MOTIONS): IK поверх текущей позы с весом огибающей.
  // Руки в покое не висят «растопыркой», а лежат на теле: на бёдрах, на талии, сцеплены
  // перед собой, одна на бедре — другая на талии, за спиной. Место меняется само раз в 9–16 с,
  // кисти плавно переезжают и чуть скользят. Жесты, позы и магниты имеют приоритет.
  pickRestSpot() {
    // Стоя прямо — иногда за голову (одну или обе руки), потом опускает на талию/бёдра.
    const upright = this.sitS < 0.1 && Math.abs(this.bodyOffset.hipsRotX) < 0.3;
    const spots = ['thighs', 'hips', 'clasp', 'hipThigh', 'thighHip', 'thighs', 'hips',
      ...(upright && !this.posing ? ['headL', 'headR', 'headBoth', 'headThigh'] : [])];
    let n;
    do { n = spots[Math.floor(Math.random() * spots.length)]; } while (n === this.restSpot && spots.length > 1);
    return n;
  }

  restTargets(spot, t) {
    const S = this.scale;
    const b = this.bones;
    const at = (bone, off, sx) => {
      if (!bone) return null;
      const ri = this.boneRestInv.get(bone);
      const q = bone.getWorldQuaternion(new THREE.Quaternion());
      if (ri) q.multiply(ri);
      return bone.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(off[0] * sx, off[1], off[2]).multiplyScalar(S).applyQuaternion(q));
    };
    const slide = Math.sin(t * 0.5) * 0.025; // кисти чуть скользят
    const one = (kind, side) => {
      const sx = side === 'left' ? 1 : -1;
      const leg = b[`${side}UpperLeg`];
      switch (kind) {
        case 'thigh': return at(leg, [0.04, -0.13 + slide, 0.095], sx);
        case 'hip': return at(b.hips, [0.15, 0.07, 0.03], sx);
        case 'front': return at(b.hips, [0.025, -0.07, 0.14], sx);
        case 'back': return at(b.hips, [0.05, 0.0, -0.13], sx);
        case 'head': return at(b.head, [0.075, 0.05, -0.06], sx); // ладонь за голову
        default: return null;
      }
    };
    const map = {
      thighs: ['thigh', 'thigh'], hips: ['hip', 'hip'], clasp: ['front', 'front'],
      hipThigh: ['hip', 'thigh'], thighHip: ['thigh', 'hip'], behind: ['back', 'back'],
      headL: ['head', 'hip'], headR: ['hip', 'head'], headBoth: ['head', 'head'], headThigh: ['thigh', 'head'],
    }[spot] ?? ['thigh', 'thigh'];
    this.restKinds = map;
    return { left: one(map[0], 'left'), right: one(map[1], 'right') };
  }

  applyHandRest(dt) {
    // Свободные руки лежат на теле и в режиме поз; в приседе их берут колени,
    // в глубоком наклоне — опора о пол (плавно уступают).
    const free = this.poseName === 'stand' && !this.dancing && !this.loop && !this.mixer;
    // Без «перескоков»: руки на бёдрах держатся во всём наклоне и неглубоком приседе,
    // а колени забирают их плавно и внахлёст (руки не повисают между).
    // В сильном наклоне ладони остаются на коленях (надолго); в пол — только на самом краю.
    const want = free ? (1 - THREE.MathUtils.smoothstep(this.sitS, 0.35, 0.55)) * (1 - THREE.MathUtils.smoothstep(Math.abs(this.bodyOffset.hipsRotX), 1.75, 2.1)) : 0;
    this.restW = (this.restW ?? 0) + (want - (this.restW ?? 0)) * (1 - Math.exp(-dt * 1.4));
    if (this.restW < 0.01) return;
    // Пока ведёшь полосу/идёт повтор — руки не перекладывает (без рывков).
    if (!((this.slideHold ?? 0) > 0)) this.restTimer = (this.restTimer ?? 0) - dt;
    if (!this.restSpot || this.restTimer <= 0) {
      this.prevSpot = this.restSpot ?? 'thighs';
      this.restSpot = this.pickRestSpot();
      this.restTimer = this.restSpot.startsWith("head") ? 5 + Math.random() * 3 : 9 + Math.random() * 7;
      this.restMix = 0;
    }
    this.restMix = Math.min(1, (this.restMix ?? 1) + dt / 1.6);
    const k = this.restMix * this.restMix * (3 - 2 * this.restMix);
    const a = this.restTargets(this.prevSpot, this.time);
    const c = this.restTargets(this.restSpot, this.time);
    for (const side of ['left', 'right']) {
      if (this.handTargets[side] || this.armPreset[side]) continue;
      // Жест руками/реакция — покой плавно уступает (без рывка в начале жеста).
      const yieldK = this.gestureYield(side);
      if (yieldK > 0.99) continue;
      const p0 = a[side];
      const p1 = c[side];
      if (!p0 || !p1) continue;
      const target = p0.clone().lerp(p1, k);
      // Переезд — по дуге, чуть от тела, а не сквозь него.
      if (k < 1) {
        const sx = side === 'left' ? 1 : -1;
        const hq = this.bones.hips.getWorldQuaternion(new THREE.Quaternion()).multiply(this.hipsRestInv);
        target.add(new THREE.Vector3(0.06 * sx, 0.03, 0.06).multiplyScalar(this.scale * Math.sin(Math.PI * k)).applyQuaternion(hq));
      }
      const upper = this.bones[`${side}UpperArm`];
      const lower = this.bones[`${side}LowerArm`];
      const hand = this.bones[`${side}Hand`];
      if (!upper || !lower || !hand) continue;
      const q1 = upper.quaternion.clone();
      const q2 = lower.quaternion.clone();
      const sx = side === 'left' ? 1 : -1;
      // Наклоняется / приседает — ладони съезжают по бёдрам к коленям (как у человека):
      // руки всегда у тела, без «крыльев» и без перескоков в присед.
      const slide = Math.max(THREE.MathUtils.smoothstep(Math.abs(this.bodyOffset.hipsRotX), 0.15, 0.85), THREE.MathUtils.smoothstep(this.sitS, 0.05, 0.3));
      if (slide > 0.001) {
        const knee = this.bones[`${side}LowerLeg`]?.getWorldPosition(new THREE.Vector3());
        const hp = this.bones.hips.getWorldPosition(new THREE.Vector3());
        if (knee) {
          const kt = knee.clone().lerp(hp, 0.12).add(new THREE.Vector3(0, 0.06 * this.scale, 0));
          const fw = new THREE.Vector3(0, 0, 1).applyQuaternion(this.bones.hips.getWorldQuaternion(new THREE.Quaternion()).multiply(this.hipsRestInv));
          fw.y = 0; if (fw.lengthSq() > 1e-6) kt.addScaledVector(fw.normalize(), 0.06 * this.scale);
          target.lerp(kt, slide);
        }
      }
      // Прогиб назад — ладони плавно на талию.
      const arch = THREE.MathUtils.smoothstep(-this.bodyOffset.hipsRotX, 0.1, 0.45);
      if (arch > 0.001) {
        const waist = this.restTargets('hips', this.time)[side];
        if (waist) target.lerp(waist, arch);
      }
      const kinds = this.restTargets(this.restSpot, this.time) && this.restKinds;
      const onHead = kinds && kinds[side === 'left' ? 0 : 1] === 'head' ? k * (1 - slide) * (1 - arch) : 0;
      const behind = (side === 'left' ? [a, c] : [a, c]) && (this.restSpot === 'behind') && slide < 0.5;
      // Локти — назад и вдоль тела, а не в стороны (рука лежит естественно, не «растопыркой»).
      const pole = lower.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(sx * 0.18, -0.25, behind ? 0.1 : -0.6));
      // Рука за головой — локоть в сторону и вверх (красивый изгиб, не сквозь голову).
      if (onHead > 0) pole.lerp(lower.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(sx * 0.6, 0.35, -0.05)), onHead);
      this.twoBoneIK(upper, lower, hand, target, pole);
      const w = this.restW * (1 - (this.patAmount ?? 0) * 0.7) * (1 - yieldK);
      upper.quaternion.copy(q1.clone().slerp(upper.quaternion, w));
      lower.quaternion.copy(q2.clone().slerp(lower.quaternion, w));
      upper.updateWorldMatrix(false, true);
    }
  }

  // Опора на руки: когда плечо опускается ниже длины руки (наклон в приседе, на коленях,
  // глубокий наклон стоя), ладонь ложится на пол под плечом и держит её; тело
  // двигается — локоть мягко сгибается, а ладонь стоит на месте и лишь
  // плавно «переступает», если ушла далеко. Рука никогда не уходит сквозь пол.
  applyFloorSupport(dt) {
    const S = this.scale;
    const ph = this.sitPhases();
    this.supW ??= { left: 0, right: 0 };
    this.plant ??= { left: null, right: null };
    const hq = this.bones.hips.getWorldQuaternion(new THREE.Quaternion()).multiply(this.hipsRestInv);
    // Куда она смотрит по горизонтали (вперёд по телу).
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(hq);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, 1);
    fwd.normalize();
    const side3 = new THREE.Vector3(1, 0, 0).applyQuaternion(hq);
    side3.y = 0;
    if (side3.lengthSq() < 1e-4) side3.set(1, 0, 0);
    side3.normalize();
    const palmY = 0.035 * S;
    for (const side of ['left', 'right']) {
      const upper = this.bones[`${side}UpperArm`];
      const lower = this.bones[`${side}LowerArm`];
      const hand = this.bones[`${side}Hand`];
      if (!upper || !lower || !hand) continue;
      const shoulder = upper.getWorldPosition(new THREE.Vector3());
      const handPos = hand.getWorldPosition(new THREE.Vector3());
      const len = this.armLength(side) + 0.07 * S; // с кистью
      // Свои позы рук на полу уже есть: лёжа, сидя на полу, опора сбоку.
      // Свои позы рук — только когда уже лежит (на боку, на животе, на спине). По дороге туда — на четвереньках
      // и полулёжа на спине — ладони ставит на пол опора: она стоит на руках, а не держит их в воздухе.
      const own = Math.max(ph.p4, ph.b4, THREE.MathUtils.smoothstep(ph.c4, 0.75, 1) * (1 - (this.bridgeK ?? 0)), ph.c3 * (1 - THREE.MathUtils.smoothstep(ph.c4, 0.05, 0.3)), side === 'right' ? ph.p3 : 0);
      // На четвереньках (наклон вперёд с колен, ещё не легла) вес на руках: жесты опору не перебивают.
      const four = ph.b3 * (1 - ph.b4);
      if (side === 'left') this.onHands = four;
      const busy = this.handTargets[side] || this.armPreset[side] ? 1 : this.gestureYield(side) * (1 - four);
      const low = THREE.MathUtils.smoothstep(len * 1.12 - (shoulder.y - palmY), 0, len * 0.3);
      // Руки лежат на коленях (наклон стоя) — опора о пол не перехватывает.
      const want = Math.max(low, four) * (1 - own) * (1 - busy) * (1 - 0.9 * (this.restW ?? 0));
      // Плечи выше, чем достаёт рука, — запоминаем, сколько не хватает: корпус в следующем кадре опустится на руки.
      if (dt > 0) { const gap = ((shoulder.y - palmY) - len * 0.8) / S; this.handGap = side === 'left' ? gap : Math.max(this.handGap ?? gap, gap); if (side === 'right') this.handGapS = four > 0.5 ? this.handGap : 0; }
      // На четвереньки руки ставит и снимает неторопливо (плавный ход ладони к полу), остальное — как было.
      if (dt > 0) this.supW[side] += (want - this.supW[side]) * (1 - Math.exp(-dt * (four > 0.05 || (this.onHandsWas ?? 0) > 0.05 ? 2.2 : 3.5)));
      if (side === 'right') this.onHandsWas = four;
      const wRaw = this.supW[side];
      const w = wRaw * wRaw * (3 - 2 * wRaw); // плавный разгон и остановка
      const below = handPos.y < palmY * 0.9;
      if (w < 0.01 && !below && !((this.belowW?.[side] ?? 0) > 0.01)) { this.plant[side] = null; continue; }
      const sx = side === 'left' ? 1 : -1;
      // Где ладонь стоит удобнее всего: под плечом, чуть впереди и в сторону.
      const ideal = shoulder.clone()
        .addScaledVector(fwd, 0.1 * S)
        .addScaledVector(side3, sx * 0.04 * S);
      ideal.y = palmY;
      // Не дальше, чем дотянется рука, — но ладонь остаётся НА полу: сокращаем вынос по полу, а не поднимаем кисть
      // (раньше при высоких плечах точка уходила за вылет руки, и ладонь зависала в воздухе над полом).
      {
        const hgt = shoulder.y - palmY, maxH = Math.sqrt(Math.max(0, (len * 0.83) ** 2 - hgt * hgt)); // len — с кистью; до запястья короче
        const off = new THREE.Vector3(ideal.x - shoulder.x, 0, ideal.z - shoulder.z), ol = off.length();
        if (ol > maxH) { ideal.x = shoulder.x + off.x / Math.max(ol, 1e-6) * maxH; ideal.z = shoulder.z + off.z / Math.max(ol, 1e-6) * maxH; }
      }
      if (!this.plant[side]) this.plant[side] = handPos.y < palmY * 2 ? handPos.clone().setY(palmY) : ideal.clone();
      const pl = this.plant[side];
      // Ладонь стоит; ушла далеко — плавно переставляет.
      // Ладонь стоит на месте, пока рука до неё достаёт; ушла далеко или не дотягивается — переставляет.
      if (dt > 0 && (pl.distanceTo(ideal) > 0.14 * S || pl.distanceTo(shoulder) > len * 0.85)) pl.lerp(ideal, 1 - Math.exp(-dt * (pl.distanceTo(shoulder) > len * 0.85 ? 7 : 3)));
      const target = handPos.clone().lerp(pl, w);
      if (target.y < palmY) target.y = palmY;
      const q1 = upper.quaternion.clone();
      const q2 = lower.quaternion.clone();
      // Локоть — назад и чуть в сторону, как у человека, который упирается в пол.
      const pole = lower.getWorldPosition(new THREE.Vector3())
        .addScaledVector(side3, sx * 0.3).addScaledVector(fwd, -0.35).add(new THREE.Vector3(0, 0.25, 0));
      this.twoBoneIK(upper, lower, hand, target, pole);
      // Кисть ушла под пол — опора включается быстро, но не одним кадром (раньше рука щёлкала на место).
      const bw = this.belowW ??= { left: 0, right: 0 };
      if (dt > 0) bw[side] = THREE.MathUtils.clamp(bw[side] + (below ? 9 : -5) * dt, 0, 1);
      const k = Math.max(w, bw[side] * bw[side] * (3 - 2 * bw[side]));
      upper.quaternion.copy(q1.clone().slerp(upper.quaternion, k));
      lower.quaternion.copy(q2.clone().slerp(lower.quaternion, k));
      upper.updateWorldMatrix(false, true);
      // Ладонь — плашмя на полу, пальцы вперёд.
      if (w > 0.05) {
        const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -sx * Math.PI / 2);
        const want = hq.clone();
        // Только поворот по горизонтали от таза.
        const yaw = Math.atan2(fwd.x, fwd.z);
        want.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(this.rootRestQ ?? new THREE.Quaternion()).multiply(turn);
        const parentQ = lower.getWorldQuaternion(new THREE.Quaternion());
        const local = parentQ.invert().multiply(want);
        hand.quaternion.slerp(local, Math.min(1, w) * 0.85);
        hand.updateWorldMatrix(false, true);
      }
    }
  }

  // Доводка головы на камеру после всех движений. Углы позы дают примерный поворот,
  // а здесь шея и голова доворачиваются по реальному направлению на камеру —
  // поэтому она смотрит в глаза и сверху, и снизу, и в наклоне, и вверх ногами.
  // Камера за спиной — доводка плавно уходит (без выворачивания шеи).
  applyHeadAim(dt) {
    const b = this.bones;
    const head = b.head;
    const neck = b.neck;
    if (!head || !this.headRestInv) return;
    const P = (n) => n.getWorldPosition(new THREE.Vector3());
    // Цель взгляда; после выключения «смотрит на тебя» доводим к последней точке,
    // пока доводка плавно гаснет (без ошибок и рывков).
    if (this.gazeTarget) (this.aimPoint ??= new THREE.Vector3()).copy(this.gazeTarget);
    const target = this.aimPoint;
    if (!target) return;
    let want = this.gazeTarget ? 1 : 0;
    want *= 1 - (this.sleep ?? 0);
    want *= 1 - (this.shyNow ?? 0);
    want *= 1 - 0.8 * (this.patAmount ?? 0);
    let behindK = 1;
    if (want > 0 && b.leftUpperArm && b.rightUpperArm && b.hips) {
      // Где «перед» груди: от линии плеч и оси позвоночника.
      const left = P(b.leftUpperArm).sub(P(b.rightUpperArm)).normalize();
      const up = P(neck ?? head).sub(P(b.hips)).normalize();
      const fwd = new THREE.Vector3().crossVectors(left, up).normalize();
      const dir = target.clone().sub(P(head)).normalize();
      const ang = Math.acos(THREE.MathUtils.clamp(dir.dot(fwd), -1, 1));
      // Лёжа она может запрокинуть голову и смотреть на тебя «вверх ногами» — предел шире.
      const ph = this.sitPhases();
      const lieK = Math.max(ph.c4, ph.p4, ph.b4);
      behindK = 1 - THREE.MathUtils.smoothstep(ang, 1.45 + 0.6 * lieK, 1.95 + 0.6 * lieK);
    }
    // Камера за её спиной по горизонтали (куда развёрнуто тело) — тоже не тянемся,
    // даже в наклоне, когда грудь смотрит в пол.
    {
      const hq = b.hips.getWorldQuaternion(new THREE.Quaternion()).multiply(this.hipsRestInv);
      const bf = new THREE.Vector3(0, 0, 1).applyQuaternion(hq); bf.y = 0;
      const toCam = target.clone().sub(P(head));
      toCam.y = 0;
      if (bf.lengthSq() > 1e-4 && toCam.lengthSq() > 1e-4) {
        const ph2 = this.sitPhases();
        const lieK2 = Math.max(ph2.c4, ph2.p4, ph2.b4);
        const d = bf.normalize().dot(toCam.normalize());
        behindK = Math.min(behindK, Math.max(lieK2, THREE.MathUtils.smoothstep(d, -0.35, 0.05)));
      }
    }
    want *= behindK;
    this.aimW = (this.aimW ?? 0) + (want - (this.aimW ?? 0)) * (1 - Math.exp(-(dt || 0.016) * 2.2)); // мягко включается/выключается
    const w = this.aimW;
    if (w < 0.01) return;
    const rotateToward = (bone, share, maxA) => {
      const face = this.faceDir(new THREE.Vector3());
      const dir = target.clone().sub(P(head)).normalize();
      const full = new THREE.Quaternion().setFromUnitVectors(face, dir);
      // Ограничиваем угол доводки.
      const angle = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(full.w), 0, 1));
      const k = angle > 1e-4 ? Math.min(1, maxA / angle) : 1;
      const part = new THREE.Quaternion().slerp(full, k * share * w);
      const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
      const boneW = bone.getWorldQuaternion(new THREE.Quaternion());
      const nw = part.multiply(boneW);
      bone.quaternion.copy(parentQ.invert().multiply(nw));
      bone.updateWorldMatrix(false, true);
    };
    if (neck) rotateToward(neck, 0.5, 0.6);
    rotateToward(head, 1.0, 0.9);
    rotateToward(head, 1.0, 0.25); // второй проход — точнее в центр
    // Жёсткий предел: лицо не уходит больше ~85° от направления груди (без выворота шеи).
    {
      const chest = this.chestNode() ?? b.hips;
      const cq = chest.getWorldQuaternion(new THREE.Quaternion()).multiply(this.hipsRestInv);
      const cf = new THREE.Vector3(0, 0, 1).applyQuaternion(cq);
      const face = this.faceDir(new THREE.Vector3());
      const ang = Math.acos(THREE.MathUtils.clamp(face.dot(cf), -1, 1));
      const maxA = 1.5;
      if (ang > maxA) {
        const back = new THREE.Quaternion().setFromUnitVectors(face, cf);
        const part = new THREE.Quaternion().slerp(back, (ang - maxA) / ang);
        const parentQ = head.parent.getWorldQuaternion(new THREE.Quaternion());
        head.quaternion.copy(parentQ.invert().multiply(part.multiply(head.getWorldQuaternion(new THREE.Quaternion()))));
        head.updateWorldMatrix(false, true);
      }
    }
    // Голова ровно по экрану: «верх» лица совпадает с верхом кадра (без завала набок).
    if (this.gazeUp) {
      const qh = head.getWorldQuaternion(new THREE.Quaternion()).multiply(this.headRestInv);
      const face = new THREE.Vector3(0, 0, 1).applyQuaternion(qh);
      const upNow = new THREE.Vector3(0, 1, 0).applyQuaternion(qh);
      const upWant = this.gazeUp.clone().addScaledVector(face, -this.gazeUp.dot(face));
      if (upWant.lengthSq() > 1e-4) {
        upWant.normalize();
        upNow.addScaledVector(face, -upNow.dot(face)).normalize();
        let roll = Math.atan2(new THREE.Vector3().crossVectors(upNow, upWant).dot(face), upNow.dot(upWant));
        roll = THREE.MathUtils.clamp(roll, -0.8, 0.8) * w;
        const rq = new THREE.Quaternion().setFromAxisAngle(face, roll);
        const parentQ = head.parent.getWorldQuaternion(new THREE.Quaternion());
        const nw = rq.multiply(head.getWorldQuaternion(new THREE.Quaternion()));
        head.quaternion.copy(parentQ.invert().multiply(nw));
        head.updateWorldMatrix(false, true);
      }
    }
  }

  // Сдвиг таза пальцем действует в том положении, где его поставили
  // (стоя — стоя, на полу — на полу), а при смене положения плавно уходит.
  hipsOffK() {
    // Таз, сдвинутый стоя, остаётся сдвинутым и в приседе (как и выставленные ступни); на коленях и ниже уходит.
    if (this.hipsSetSit == null || this.hipsSetSit < 0.3) return 1 - THREE.MathUtils.smoothstep(this.sitS, 0.47, 0.6);
    // Поставленный на полу — держится шире: сидя ↔ лёжа рядом он не сбрасывается от небольшого движения.
    return 1 - THREE.MathUtils.smoothstep(Math.abs(this.sitS - this.hipsSetSit), 0.14, 0.42);
  }

  footOffK(side) {
    const at = this.footSetSit?.[side];
    // Ступни, выставленные стоя, остаются на своих местах и в приседе: она садится от них (ноги широко — присед
    // широкий). На коленях и ниже ноги складываются как обычно.
    if (at == null || at < 0.3) return 1 - THREE.MathUtils.smoothstep(this.sitS, 0.47, 0.6);
    return 1 - THREE.MathUtils.smoothstep(Math.abs(this.sitS - at), 0.14, 0.42); // на полу — держится шире
  }

  // Насколько рука сейчас занята жестом/реакцией (0…1, плавно по огибающей жеста).
  gestureYield(side) {
    let k = 0;
    for (const m of this.motions) {
      const touch = TOUCH_MOTIONS[m.name];
      if (!touch && !ARM_MOTIONS.has(m.name)) continue;
      if (touch && !touch.both && m.side && m.side !== side) continue;
      k = Math.max(k, (m.dur ? envelope(m.t, m.dur) : 1) * (m.fade ?? 1));
    }
    return k;
  }

  // Точка на теле: смещение в осях кости (в покое), x — к боку руки side.
  bodyPoint(name, off, side) {
    const other = side === 'left' ? 'right' : 'left';
    const boneName = name === 'UpperLeg' ? `${side}UpperLeg` : name === 'otherUpperArm' ? `${other}UpperArm`
      : name === 'otherLowerArm' ? `${other}LowerArm` : name;
    const bone = this.bones[boneName] ?? this.vrm.humanoid.getNormalizedBoneNode(boneName);
    if (!bone) return null;
    if (!this.boneRestInv.has(bone)) this.boneRestInv.set(bone, null);
    const ri = this.boneRestInv.get(bone);
    const q = bone.getWorldQuaternion(new THREE.Quaternion());
    if (ri) q.multiply(ri); else q.copy(this.bones.hips.getWorldQuaternion(new THREE.Quaternion())).multiply(this.hipsRestInv);
    const xo = name.startsWith('other') ? off[0] : off[0] * (side === 'left' ? 1 : -1);
    // В облегающей юбке кисти лежат поверх ткани: точки на бёдрах и тазе чуть дальше от тела.
    const pad = (this.handPad ?? 0) > 0 && (name === 'UpperLeg' || name === 'hips') ? 1 + this.handPad : 1;
    return bone.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(xo * pad, off[1], off[2] * pad).multiplyScalar(this.scale).applyQuaternion(q));
  }

  // Кисти позы — к своим точкам на теле, плавно (в такт переходу позы).
  applyPoseHands(dt) {
    const def = POSES[this.poseName];
    const prev = this.posePrevName ? POSES[this.posePrevName] : null;
    const k = easeInOut(Math.min(this.poseT / 1.0, 1));
    const seatK = 1 - THREE.MathUtils.smoothstep(this.sitS, 0.3, 0.6);
    for (const side of ['left', 'right']) {
      if (this.handTargets[side] || this.armPreset[side]) continue;
      const yieldK = this.gestureYield(side);
      if (yieldK > 0.99) continue;
      const spec = def?.hands?.[side];
      const pspec = prev?.hands?.[side];
      let w = 0;
      let target = null;
      if (spec) {
        target = this.bodyPoint(spec[0], spec[1], side);
        w = k;
        if (pspec && k < 1) {
          const p0 = this.bodyPoint(pspec[0], pspec[1], side);
          if (p0 && target) { target = p0.lerp(target, k); w = 1; }
        }
      } else if (pspec && k < 1) {
        target = this.bodyPoint(pspec[0], pspec[1], side);
        w = 1 - k;
      }
      w *= seatK * (1 - yieldK);
      if (!target || w < 0.01) continue;
      // Лёгкое «дыхание» кисти — живая, не приклеенная.
      target.y += Math.sin(this.time * 1.3 + (side === 'left' ? 0 : 1.7)) * 0.006 * this.scale;
      const upper = this.bones[`${side}UpperArm`];
      const lower = this.bones[`${side}LowerArm`];
      const hand = this.bones[`${side}Hand`];
      if (!upper || !lower || !hand) continue;
      const q1 = upper.quaternion.clone();
      const q2 = lower.quaternion.clone();
      const sx = side === 'left' ? 1 : -1;
      const pole = lower.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(sx * 0.22, -0.3, -0.55));
      this.twoBoneIK(upper, lower, hand, target, pole);
      upper.quaternion.copy(q1.clone().slerp(upper.quaternion, w));
      lower.quaternion.copy(q2.clone().slerp(lower.quaternion, w));
      upper.updateWorldMatrix(false, true);
    }
  }

  applySelfTouch() {
    const active = this.motions.filter((m) => TOUCH_MOTIONS[m.name]);
    if (!active.length) return;
    this.boneRestInv ??= new Map();
    const restInv = (bone) => {
      if (!this.boneRestInv.has(bone)) return null;
      return this.boneRestInv.get(bone);
    };
    const S = this.scale;
    const bq = new THREE.Quaternion();
    for (const m of active) {
      const def = TOUCH_MOTIONS[m.name];
      const e = envelope(m.t, m.dur) * (m.fade ?? 1);
      if (e <= 0) continue;
      const sides = def.both ? ['left', 'right'] : [m.side];
      for (const side of sides) {
        if (this.handTargets[side] || this.armPreset[side]) continue;
        const sx = side === 'left' ? 1 : -1;
        const other = side === 'left' ? 'right' : 'left';
        // Позиция вдоль пути (скользит от первой точки ко второй).
        const prog = THREE.MathUtils.clamp((m.t / m.dur - 0.15) / 0.55, 0, 1);
        const pts = def.path.map(([name, off]) => {
          const boneName = name === 'UpperLeg' ? `${side}UpperLeg` : name === 'LowerLeg' ? `${side}LowerLeg` : name === 'otherUpperArm' ? `${other}UpperArm` : name;
          const bone = this.bones[boneName] ?? this.vrm.humanoid.getNormalizedBoneNode(boneName);
          if (!bone) return null;
          if (!this.boneRestInv.has(bone)) {
            // Поворот кости в покое неизвестен до первого раза — берём от таза (тело почти прямое).
            this.boneRestInv.set(bone, this.headRestInv && bone === this.bones.head ? this.headRestInv : null);
          }
          const ri = restInv(bone);
          if (ri) bq.copy(bone.getWorldQuaternion(new THREE.Quaternion())).multiply(ri);
          else bq.copy(this.bones.hips.getWorldQuaternion(new THREE.Quaternion())).multiply(this.hipsRestInv);
          const xo = name === 'otherUpperArm' ? off[0] : off[0] * sx;
          return bone.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(xo, off[1], off[2]).multiplyScalar(S).applyQuaternion(bq));
        }).filter(Boolean);
        if (!pts.length) continue;
        const target = pts.length > 1 ? pts[0].clone().lerp(pts[1], THREE.MathUtils.smoothstep(prog, 0, 1)) : pts[0];
        // Теребит прядь: кисть делает маленькие круги.
        if (def.wobble) target.add(new THREE.Vector3(0, Math.sin(m.t * 6) * def.wobble * S, Math.cos(m.t * 6) * def.wobble * S));
        const upper = this.bones[`${side}UpperArm`];
        const lower = this.bones[`${side}LowerArm`];
        const hand = this.bones[`${side}Hand`];
        if (!upper || !lower || !hand) continue;
        const q1 = upper.quaternion.clone();
        const q2 = lower.quaternion.clone();
        const pole = lower.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(sx * 0.35, -0.45, -0.25));
        this.twoBoneIK(upper, lower, hand, target, pole);
        upper.quaternion.copy(q1.clone().slerp(upper.quaternion, e));
        lower.quaternion.copy(q2.clone().slerp(lower.quaternion, e));
        upper.updateWorldMatrix(false, true);
      }
    }
  }

  // Куда смотрит лицо (единичный вектор в мире).
  faceDir(out = new THREE.Vector3()) {
    const q = this.bones.head.getWorldQuaternion(new THREE.Quaternion()).multiply(this.headRestInv);
    return out.set(0, 0, 1).applyQuaternion(q);
  }

  // Куда повернуться, чтобы смотреть в камеру: угол в осях таза (с прошлого кадра).
  measureGaze() {
    const t = this.gazeTarget;
    const b = this.bones;
    if (!t || !b.hips || !b.neck || !b.leftUpperLeg || !b.rightUpperLeg) return;
    const P = (n) => n.getWorldPosition(new THREE.Vector3());
    const left = P(b.leftUpperLeg).sub(P(b.rightUpperLeg)).normalize();
    // Углы относительно корпуса (в наклоне «вверх» — вдоль спины): так голова знает,
    // насколько её поднять, чтобы смотреть на тебя с любого ракурса.
    const up = P(b.neck).sub(P(b.hips)).normalize();
    const fwd = new THREE.Vector3().crossVectors(left, up).normalize();
    const dir = t.clone().sub(P(b.head ?? b.neck)).normalize();
    let yaw = Math.atan2(dir.dot(left), dir.dot(fwd));
    // Камера почти «над головой» по оси тела (например, в наклоне спереди): поворот
    // вбок не определён — не крутим голову, только поднимаем.
    const along = dir.dot(up);
    yaw *= THREE.MathUtils.smoothstep(Math.sqrt(Math.max(0, 1 - along * along)), 0.25, 0.6);
    // Камера ровно сзади — не перескакиваем с плеча на плечо.
    if (Math.abs(yaw) > 2.7 && this.gazeYaw && Math.sign(yaw) !== Math.sign(this.gazeYaw)) yaw = Math.sign(this.gazeYaw) * 2.7;
    this.gazeYaw = yaw;
    this.gazePitch = Math.asin(THREE.MathUtils.clamp(dir.dot(up), -1, 1));
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
      const toes = b[`${side}Toes`] ?? this.vrm.humanoid.getNormalizedBoneNode(`${side}Toes`);
      this.restFoot[side].toes = toes ?? null;
      if (toes) { toes.updateWorldMatrix(true, false); this.restFoot[side].toeQuat = toes.getWorldQuaternion(new THREE.Quaternion()); this.restFoot[side].toePos = toes.getWorldPosition(new THREE.Vector3()); this.restFoot[side].toeLocal = toes.quaternion.clone(); }
    }
    this.ikTmp = {
      a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(),
      t: new THREE.Vector3(), d: new THREE.Vector3(), p: new THREE.Vector3(),
      e: new THREE.Vector3(), q: new THREE.Quaternion(), q2: new THREE.Quaternion(),
    };
    // Исходная поза конечностей: от неё каждый кадр строим ориентацию заново,
    // поэтому кости не накапливают скручивание вокруг своей оси.
    this.limbRest = new Map();
    const limb = (u, l, e, pole0) => {
      const upper = b[u];
      const lower = b[l];
      const end = b[e];
      if (!upper || !lower || !end) return;
      const a0 = upper.getWorldPosition(new THREE.Vector3());
      const b0 = lower.getWorldPosition(new THREE.Vector3());
      const c0 = end.getWorldPosition(new THREE.Vector3());
      const dirU0 = b0.clone().sub(a0).normalize();
      const dirL0 = c0.clone().sub(b0).normalize();
      const hinge0 = new THREE.Vector3().crossVectors(c0.clone().sub(a0).normalize(), pole0).normalize();
      this.limbRest.set(upper.uuid, {
        l1: a0.distanceTo(b0),
        l2: b0.distanceTo(c0),
        restQU: upper.getWorldQuaternion(new THREE.Quaternion()),
        restQL: lower.getWorldQuaternion(new THREE.Quaternion()),
        frameU0: this.limbFrame(dirU0, hinge0),
        frameL0: this.limbFrame(dirL0, hinge0),
      });
    };
    limb('leftUpperLeg', 'leftLowerLeg', 'leftFoot', new THREE.Vector3(0, 0, 1));
    limb('rightUpperLeg', 'rightLowerLeg', 'rightFoot', new THREE.Vector3(0, 0, 1));
    limb('leftUpperArm', 'leftLowerArm', 'leftHand', new THREE.Vector3(0, -0.5, -0.3));
    limb('rightUpperArm', 'rightLowerArm', 'rightHand', new THREE.Vector3(0, -0.5, -0.3));
  }

  // Ортонормированная «рамка» кости: ось вдоль кости и ось шарнира (сгиба).
  // Ось шарнира общая для обеих костей конечности и всегда однозначна —
  // поэтому колено/локоть не переворачиваются и не скручиваются.
  limbFrame(dir, hinge) {
    const d = dir.clone().normalize();
    const side = hinge.clone().addScaledVector(d, -hinge.dot(d)).normalize();
    const fwd = new THREE.Vector3().crossVectors(side, d).normalize();
    const m = new THREE.Matrix4().makeBasis(side, d, fwd);
    return new THREE.Quaternion().setFromRotationMatrix(m);
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
  // Ориентация каждой кости строится заново от исходной позы по плоскости сгиба —
  // колено и локоть гнутся только как шарнир, без скручивания. Возвращает поворот
  // голени/предплечья относительно исходной позы (нужен для стопы).
  twoBoneIK(upper, lower, end, target, pole) {
    const rest = this.limbRest?.get(upper.uuid);
    const { a, t, p, e, d } = this.ikTmp;
    upper.updateWorldMatrix(true, true);
    upper.getWorldPosition(a);
    const l1 = rest ? rest.l1 : a.distanceTo(lower.getWorldPosition(new THREE.Vector3()));
    const l2 = rest ? rest.l2 : lower.getWorldPosition(new THREE.Vector3()).distanceTo(end.getWorldPosition(new THREE.Vector3()));
    t.copy(target).sub(a);
    // Не даём цели оказаться ближе минимального вылета — иначе конечность выкручивает.
    const dist = THREE.MathUtils.clamp(t.length(), Math.abs(l1 - l2) + 0.02 * (l1 + l2), (l1 + l2) * 0.999);
    t.normalize();
    const cosA = THREE.MathUtils.clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    p.copy(pole).sub(a);
    p.addScaledVector(t, -p.dot(t));
    if (p.lengthSq() < 1e-8) p.set(0, 0, 1);
    p.normalize();
    e.copy(a).addScaledVector(t, cosA * l1).addScaledVector(p, sinA * l1); // локоть/колено
    d.copy(a).addScaledVector(t, dist); // кисть/ступня
    const dirU = e.clone().sub(a).normalize();
    const dirL = d.clone().sub(e).normalize();
    if (!rest) return null;
    // Ось шарнира — нормаль к плоскости «плечо/бедро — цель — полюс».
    const hinge = new THREE.Vector3().crossVectors(t, p).normalize();
    const QU = this.limbFrame(dirU, hinge).multiply(rest.frameU0.clone().invert());
    const QL = this.limbFrame(dirL, hinge).multiply(rest.frameL0.clone().invert());
    this.setWorldQuat(upper, QU.clone().multiply(rest.restQU));
    this.setWorldQuat(lower, QL.clone().multiply(rest.restQL));
    return QL;
  }

  plantFeet(pose) {
    const b = this.bones;
    if (!b.hips || !this.restFoot.left) return;
    b.hips.updateWorldMatrix(true, true);
    const hipsPos = b.hips.getWorldPosition(new THREE.Vector3());
    const { p1, p2: p2avg, p3 } = this.sitPhases();
    const S = this.scale;
    const ease = (x) => x * x * (3 - 2 * x);
    let leanSum = 0;
    let leanN = 0;
    // Колени на полу — опора, а не «лыжи». Пока она стоит на коленях или на четвереньках и её двигают (таз вбок,
    // вверх, наклон) или она сама покачивается, колени остаются там, где стоят: таз ходит вокруг них на длину бедра.
    // Утянули таз далеко — колени переступают следом. Меняется сама посадка (садится/встаёт) — колени свободны.
    const kp = this.kneePin ??= { left: null, right: null, sit: -1, w: 0 };
    {
      const ph0 = this.sitPhases();
      const kw = p2avg * (1 - p3) * (1 - ph0.b4) * (1 - ph0.c3);
      this.kneelK = kw;
      const dtp = this.lastDt ?? 0.016;
      const has = kp.left && kp.right;
      // Куда развёрнут таз по горизонтали: повернули корпус — старые точки колен уже не подходят.
      const yawNow = (() => { const f = new THREE.Vector3(0, 0, 1).applyQuaternion(b.hips.getWorldQuaternion(new THREE.Quaternion()).multiply(this.hipsRestInv)); return Math.atan2(f.x, f.z); })();
      const yawOk = !has || Math.abs(Math.atan2(Math.sin(yawNow - (kp.yaw ?? yawNow)), Math.cos(yawNow - (kp.yaw ?? yawNow)))) < 0.2;
      const on = kw > 0.9 && Math.abs(this.sitS - this.sit) < 0.02 && (!has || Math.abs(kp.sit - this.sitS) < 0.03) && yawOk && !((kp.bad ?? 0) > 0.6) && !this.mixer && !this.dancing;
      // Берём место колен из готовой позы прошлого кадра (сейчас кости ещё не расставлены) и только когда она уже села ровно.
      if (on && !has && kp.w <= 0.001 && this.kneeLast?.left && this.kneeLast?.right && Math.abs(this.sitV ?? 0) < 0.03 && (this.kneeStill ?? 0) > 0.12) {
        kp.left = this.kneeLast.left.clone();
        kp.right = this.kneeLast.right.clone();
        kp.sit = this.sitS;
        kp.yaw = yawNow; kp.bad = 0;
      }
      if (!this.kneePinTick || this.kneePinTick !== this.time) { // второй проход кадра вес не трогает
        this.kneePinTick = this.time;
        kp.w = THREE.MathUtils.clamp(kp.w + (on && kp.left ? dtp / 0.3 : -dtp / 0.25), 0, 1);
      }
      if (!on && kp.w <= 0) { kp.left = kp.right = null; kp.sit = -1; kp.bad = 0; }
      if (kp.w > 0 && kp.left && kp.right) {
        const w = kp.w * kp.w * (3 - 2 * kp.w);
        const corr = new THREE.Vector3();
        let down = 0, vert = 0, vertN = 0;
        // Таз вперёд-назад по полу (ведут пальцем): с пяток вперёд на руки и обратно.
        {
          const f = (this.bodyOffset.hipsFwd ?? 0) * w * this.hipsOffK();
          if (f && !this.kneeFwdDone) {
            const fw = new THREE.Vector3(0, 0, 1).applyQuaternion(b.hips.parent.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize().multiplyScalar(this.flip);
            const wp0 = b.hips.getWorldPosition(new THREE.Vector3()).addScaledVector(fw, f);
            b.hips.position.copy(b.hips.parent.worldToLocal(wp0));
            b.hips.updateWorldMatrix(true, true);
          }
          this.kneeFwdDone = true;
        }
        for (const side of ['left', 'right']) {
          const up = b[`${side}UpperLeg`], P = kp[side];
          const l1 = this.limbRest.get(up.uuid)?.l1;
          if (!l1) continue;
          const hj = up.getWorldPosition(new THREE.Vector3());
          const dy = hj.y - P.y;
          const h = new THREE.Vector3(P.x - hj.x, 0, P.z - hj.z);
          const d = h.length();
          // Бедро стоит круто (таз над коленями или перекатился вперёд за них) — длину бедра держим высотой таза:
          // он идёт по дуге вокруг колена. Бедро пологое (сидит на пятках) — держим сдвигом таза по полу.
          const v = 1 - THREE.MathUtils.smoothstep(d, l1 * 0.55, l1 * 0.9); // плавно между двумя способами — без рывка
          if (v > 0) vert += ((P.y + Math.sqrt(Math.max(0, l1 * l1 - d * d))) - hj.y) * v * 0.5;
          if (v >= 1) continue;
          if (dy > l1 * 0.995) down = Math.max(down, (dy - l1 * 0.995) * (1 - v));
          const r = Math.sqrt(Math.max(0, l1 * l1 - Math.min(dy, l1 * 0.995) ** 2));
          if (d < 1e-5) continue;
          h.multiplyScalar(1 / d);
          let c = d - r;
          // Слишком далеко — колено переступает вслед за тазом (плавно), остальное добирает таз.
          const lim = 0.14 * S;
          if (Math.abs(c) > lim) { const ex = (Math.abs(c) - lim) * Math.sign(c); P.addScaledVector(h, -ex * Math.min(1, dtp * 9)); c -= ex * Math.min(1, dtp * 9); }
          corr.addScaledVector(h, c * 0.5 * (1 - v));
        }
        // Телу слишком долго приходится сильно тянуться к точкам колен — значит, они устарели: отпускаем и берём заново.
        if (this.kneeBadTick !== this.time) { this.kneeBadTick = this.time; kp.bad = Math.max(0, (kp.bad ?? 0) + (corr.length() + down > 0.1 * S ? dtp : -dtp * 2)); }
        const wp = b.hips.getWorldPosition(new THREE.Vector3());
        wp.x += corr.x * w; wp.z += corr.z * w; wp.y -= down * w;
        wp.y += vert * w;
        b.hips.position.copy(b.hips.parent.worldToLocal(wp));
        b.hips.updateWorldMatrix(true, true);
      }
    }
    for (const side of ['left', 'right']) {
      const L = side === 'left';
      // На колени — по очереди, как человек: сначала левое колено, потом правое.
      const p2 = p3 > 0 ? p2avg : ease(THREE.MathUtils.clamp((this.sitS - (L ? 0.5 : 0.58)) / 0.22, 0, 1));
      const upper = b[`${side}UpperLeg`];
      const lower = b[`${side}LowerLeg`];
      const foot = b[`${side}Foot`];
      const rest = this.restFoot[side];
      if (!upper || !lower || !foot || !rest) continue;
      const outSign = Math.sign(rest.pos.x - this.restHips.x) || (L ? 1 : -1);

      // Расслабленная нога (согнута сильнее другой) приподнимает пятку.
      const bend = (L ? pose.lKneeX - pose.rKneeX : pose.rKneeX - pose.lKneeX);
      const lift = THREE.MathUtils.clamp(bend, 0, 0.6) * (1 - p1);
      const target = rest.pos.clone();
      // Туфли на каблуке: пятка поднята на высоту шпильки, носок на полу (см. setupHeels). На коленях и ниже — нет.
      const hk = (this.heelK ?? 0) * (1 - p2);
      target.y += hk * (this.heel?.raise ?? 0);
      target.y += lift * 0.06 * S;
      target.z += lift * 0.08 * S;
      target.x -= outSign * (L ? pose.lFootIn : pose.rFootIn);

      // Присед в каблуках: привстаёт на носки, ступни чуть вперёд, колени над носками.
      target.z += p1 * 0.1 * S;
      target.y += p1 * 0.025 * S;
      target.x += outSign * p1 * (1 - p2) * 0.02 * S; // в приседе ступни чуть шире
      // На коленях: голени лежат на полу, ступни под ягодицами, носками назад.
      if (p2 > 0) {
        // Колени и ступни на ширине бёдер (как обычно стоят на коленях): сгиб в бедре
        // идёт под углом, а не строго к животу — меньше «сминания» сзади.
        const kneel = new THREE.Vector3(
          rest.pos.x + outSign * 0.07 * S * (1 - p3),
          rest.pos.y - 0.05 * S,
          this.restHips.z - 0.06 * S,
        );
        target.lerp(kneel, p2);
      }
      // Сидит боком: обе голени сложены в сторону её левого бедра.
      if (p3 > 0) {
        const fold = new THREE.Vector3(
          this.restHips.x + (L ? 0.34 : 0.2) * S,
          rest.pos.y - 0.05 * S,
          this.restHips.z + (L ? -0.14 : 0.04) * S,
        );
        target.lerp(fold, p3);
      }
      // Лёжа на боку: ноги вместе вдоль пола, колени чуть согнуты вперёд.
      const { p4 } = this.sitPhases();
      if (p4 > 0) {
        // Как лежат в жизни: ноги не палкой — верхняя чуть впереди, колени мягко согнуты.
        const lie = new THREE.Vector3(
          this.restHips.x + (L ? 0.5 : 0.47) * S,
          rest.pos.y - 0.04 * S,
          this.restHips.z + (L ? 0.16 : -0.02) * S,
        );
        // Лёжа верхняя нога неспешно покачивается — живая, а не застывшая.
        if (L) {
          lie.z += Math.sin(this.time * 0.6) * 0.05 * S;
          lie.y += Math.max(0, Math.sin(this.time * 0.6 + 0.8)) * 0.025 * S;
        }
        target.lerp(lie, p4);
      }
      // Сидит на полу / на спине: ноги вперёд, одно колено мягко поднято.
      const { c3, c4 } = this.sitPhases();
      if (c3 > 0) {
        const legLen = this.restHips.y - rest.pos.y;
        // Колени неспешно меняются: то одно поднято, то другое — живая поза, не статуя.
        const sw = Math.sin(this.time * 0.22) * 0.5 + 0.5; // 0…1, очень медленно
        const kL = 0.68 + 0.22 * sw, kR = 0.92 - 0.22 * sw;
        const fwd = new THREE.Vector3(rest.pos.x * 1.15, rest.pos.y, this.restHips.z + legLen * (L ? 0.7 : 0.85));
        if (c4 > 0) fwd.lerp(new THREE.Vector3(rest.pos.x * 1.1, rest.pos.y, this.restHips.z + legLen * (L ? kL : kR)), c4);
        // Сидя на полу ступни чуть «гуляют» — переставляет ноги.
        fwd.x += Math.sin(this.time * 0.31 + (L ? 0 : 2)) * 0.025 * S * (1 - c4);
        target.lerp(fwd, c3);
      }
      // На животе: ноги вытянуты назад, носки к полу.
      const { b4 } = this.sitPhases();
      if (b4 > 0) {
        const legLen = this.restHips.y - rest.pos.y;
        // Ноги почти прямые (иначе колено уходит под пол и тело «всплывает»).
        // Лёжа на животе болтает ножками: голени по очереди плавно поднимаются
        // (колени остаются на полу), иногда замирает и отдыхает.
        const rest2 = THREE.MathUtils.smoothstep(Math.sin(this.time * 0.11 + 1), -0.3, 0.3);
        const kick = Math.max(0, Math.sin(this.time * 1.05 + (L ? 0 : Math.PI))) * rest2 * (1 - (this.sleep ?? 0)) * (this.kickOn ?? 1) // во сне и пока ведёшь полосу — тихо
          // Ножками болтает, только когда действительно лежит на животе и таз на полу: на полпути с четверенек
          // и при поднятом тазе это выглядело как сломанная нога (одна голень в воздухе, вторая нога прямая).
          * (this.kickGate ?? 0);
        // Разрешение болтать ножками набирается и уходит плавно (иначе голень падала одним кадром).
        if (L) { const gt = THREE.MathUtils.smoothstep(b4, 0.85, 1) * (1 - THREE.MathUtils.smoothstep(Math.max(0, this.bodyOffset.hipsY) / S, 0.015, 0.05)); this.kickGate = (this.kickGate ?? 0) + (gt - (this.kickGate ?? 0)) * Math.min(1, (this.lastDt ?? 0.016) * 2.5); }
        (this.kickNow ??= {})[side] = kick * b4;
        const prone = new THREE.Vector3(
          rest.pos.x * 1.1 + (L ? 0.02 : -0.02) * S,
          0.11 * S,
          this.restHips.z - legLen * 1.02,
        );
        if (kick > 0.001) {
          // Голень поворачивается вокруг колена, лежащего на полу: стопа идёт по дуге.
          const lr = this.limbRest.get(upper.uuid);
          const hipJ = upper.getWorldPosition(new THREE.Vector3());
          const l1 = lr?.l1 ?? legLen * 0.5;
          const l2 = lr?.l2 ?? legLen * 0.5;
          const kneeP = new THREE.Vector3(prone.x, 0.06 * S, hipJ.z - Math.sqrt(Math.max(1e-4, l1 * l1 - (hipJ.y - 0.06 * S) ** 2)));
          const a = kick * 1.5;
          const arc = kneeP.clone().add(new THREE.Vector3(0, Math.sin(a) * l2 * 0.97, -Math.cos(a) * l2 * 0.97));
          prone.lerp(arc, Math.min(1, kick * 4));
        }
        target.lerp(prone, b4);
      }

      // Стойка (выбирается значком в простом виде): ступни шире или одна нога чуть вперёд. Только стоя; тело то же.
      {
        const st = this.stanceNow ??= { w: 0, f: 0 };
        if (L) { const a = 1 - Math.exp(-(this.lastDt ?? 0.016) * 3); st.w += ((this.stanceW ?? 0) - st.w) * a; st.f += ((this.stanceF ?? 0) - st.f) * a; }
        // Действует стоя и в приседе (приседает на расставленных ногах); на коленях и ниже — как обычно.
        const sk = 1 - THREE.MathUtils.smoothstep(this.sitS, 0.47, 0.6);
        this.stanceK = st.w * sk;
        target.x += outSign * st.w * S * sk;
        target.z += (L ? 1 : -1) * st.f * S * sk;
      }
      // Сама прошлась (см. updateWalk): ступня там, куда шагнула.
      if (this.walk) target.addScaledVector(this.walk.foot[side], this.walk.k);
      if (this.turnStep > 0.01) target.y += Math.max(0, Math.sin((this.turnPhase ?? 0) + (L ? 0 : Math.PI))) * 0.035 * S * this.turnStep * (1 - p1);
      // Ступня, сдвинутая пальцем.
      const footRaw = this.dragPhys.foot[side]?.x ?? null; // с инерцией
      (this.footBase ??= {})[side] = target.clone(); // где стопа стоит без сдвига
      const footOff = footRaw ? footRaw.clone().multiplyScalar(this.footOffK(side)) : null;
      if (footOff) {
        target.add(footOff);
        // Ноги, выставленные на полу, не лежат «деревянно»: ступня чуть покачивается и переступает, колено дышит.
        // То же для ноги, поднятой в воздух стоя: она не висит неподвижно.
        if ((this.sitS > 0.3 || footOff.y > 0.04 * S) && this.footOffK(side) > 0.5 && !(this.slideHold > 0)) {
          const lv = (1 - (this.sleep ?? 0)) * (this.frozen ? 0 : 1), tm = this.time, ph = L ? 0 : 2.1;
          target.y += (Math.max(0, Math.sin(tm * 0.7 + ph)) * 0.03 + Math.sin(tm * 1.7 + ph) * 0.006) * S * lv;
          target.z += (Math.sin(tm * 0.45 + ph * 1.3) * 0.03 + Math.sin(tm * 1.1 + ph) * 0.008) * S * lv;
          target.x += Math.sin(tm * 0.33 + ph * 0.7) * 0.018 * S * lv;
        }
      }
      if (this.sitS > 0.3) target.y = Math.max(target.y, (0.03 + 0.03 * p3) * S); // не сквозь пол (сидя боком ступня лежит на боку — она толще)
      target.y = Math.max(target.y, rest.pos.y - 0.05 * S * p2);

      // Колено всегда смотрит в сторону своей ступни (вперёд), поэтому колени
      // не перекрещиваются и не заламываются. Отвели ногу — колено туда же;
      // подняли — колено вперёд-вверх; на коленях — вперёд-вниз.
      const knee = lower.getWorldPosition(new THREE.Vector3());
      // Ступни шире (стойка) — колени разворачиваются наружу вместе с ними, а не сводятся «иксом».
      const lateral = (footOff ? footOff.x * 1.5 : 0) + outSign * (this.stanceK ?? 0) * S * 2.4;
      const kneeUp = footOff ? footOff.y * 1.2 : 0;
      const pole = new THREE.Vector3(
        rest.pos.x + outSign * (0.03 + 0.06 * p1 * (1 - p3)) * S + lateral + 0.4 * p3, // колени чуть врозь; сидя боком — влево-вперёд
        // На коленях колено вниз (к полу); сидя боком таз уже у пола — колено вперёд, не под пол.
        knee.y - 0.5 * p2 * (1 - p3) + 0.2 * p3 + kneeUp * 0.5,
        knee.z + 0.6 + kneeUp,
      );
      // Болтает ножкой — колено не уходит под пол (иначе тело «всплывает»).
      if (b4 > 0) pole.lerp(new THREE.Vector3(knee.x, knee.y - 0.15 + 0.5 * (this.kickNow?.[side] ?? 0), knee.z - 0.6), b4); // на животе колени к полу, ноги прямые
      if (c3 > 0) pole.lerp(new THREE.Vector3(knee.x, knee.y + 0.6, knee.z + 0.3), c3); // сидя/на спине колени вверх
      // Ногу взяли в руки (ступня/колено) — её колено отпускаем плавно, без щелчка.
      { const sw = kp.sw ??= { left: 1, right: 1 }; if (this.kneeSwTick?.[side] !== this.time) { (this.kneeSwTick ??= {})[side] = this.time; sw[side] = THREE.MathUtils.clamp(sw[side] + (footOff ? -1 : 1) * (this.lastDt ?? 0.016) / 0.22, 0, 1); } }
      if (kp.w > 0 && kp[side] && kp.sw[side] > 0) {
        // Колено стоит на своём месте, голень лежит от него назад к ступне.
        const w0 = kp.w * kp.sw[side], w = w0 * w0 * (3 - 2 * w0), P = kp[side];
        const lr = this.limbRest.get(upper.uuid);
        const hj = upper.getWorldPosition(new THREE.Vector3());
        if (lr?.l1 && lr?.l2) {
          const dy = Math.min(hj.y - P.y, lr.l1 * 0.995);
          const r = Math.sqrt(Math.max(0, lr.l1 * lr.l1 - dy * dy));
          const h = new THREE.Vector3(P.x - hj.x, 0, P.z - hj.z);
          if (h.lengthSq() > 1e-10) {
            h.normalize();
            const K = new THREE.Vector3(hj.x + h.x * r, P.y, hj.z + h.z * r);
            const f = new THREE.Vector3(target.x - K.x, 0, target.z - K.z);
            if (f.lengthSq() > 1e-10) {
              f.normalize();
              const rr = Math.sqrt(Math.max(1e-6, lr.l2 * lr.l2 - (K.y - target.y) ** 2)) * 0.99;
              target.lerp(new THREE.Vector3(K.x + f.x * rr, target.y, K.z + f.z * rr), w);
            }
            pole.lerp(K, w);
          }
        }
      }
      (this.footWantY ??= {})[side] = target.y;
      (this.footHeld ??= {})[side] = !!footOff;
      const QL = this.twoBoneIK(upper, lower, foot, target, pole);
      // Угол голени вперёд — для баланса корпуса в следующем кадре.
      {
        const kp = lower.getWorldPosition(new THREE.Vector3());

        const ap = foot.getWorldPosition(new THREE.Vector3());
        leanSum += Math.atan2(kp.z - ap.z, Math.max(1e-3, kp.y - ap.y));
        leanN++;
      }

      // Ориентация стопы.
      // Стоя — ровно на полу; приподнятая пятка, присед на носках и поднятая
      // нога наклоняют носок вниз. На коленях стопа продолжает линию голени
      // (носок назад, подъём на полу) — так голеностоп не выворачивается.
      const point = footOff ? Math.min(footOff.y / (0.3 * S), 1) * 0.7 : 0;
      const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), lift * 0.7 + point + Math.max(p1 * 0.55 * (1 - p2), hk * (this.heel?.angle ?? 0)));
      let q = pitch.multiply(rest.quat.clone());
      if (p2 > 0 && QL) {
        // На коленях стопа жёстко продолжает голень и вытянута носком назад.
        const plantar = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.kneelPlantar);
        const kneelQ = QL.clone().multiply(plantar).multiply(rest.quat.clone());
        q = q.slerp(kneelQ, p2);
      }
      this.setWorldQuat(foot, q);
      // На каблуке пальцы остаются на полу (плоско), а не продолжают наклон стопы.
      const toes = rest.toes;
      if (toes && rest.toeQuat && hk > 0.01) { toes.updateWorldMatrix(true, false); const cur = toes.getWorldQuaternion(new THREE.Quaternion()); this.setWorldQuat(toes, cur.slerp(rest.toeQuat, hk)); }
      else if (toes && rest.toeLocal) toes.quaternion.copy(rest.toeLocal);
    }
    if (leanN) this.shinLean += (leanSum / leanN - this.shinLean) * 0.3;
  }

  // Кисть ушла под пол — рука сама сгибается и кладёт ладонь на пол (тело при этом не приподнимается).
  handFloorFix() {
    if (this.mixer) return;
    const S = this.scale, minY = 0.022 * S, v = new THREE.Vector3();
    for (const side of ['left', 'right']) {
      const upper = this.bones[`${side}UpperArm`], lower = this.bones[`${side}LowerArm`], hand = this.bones[`${side}Hand`];
      if (!upper || !lower || !hand) continue;
      // Лёжа на спине кисти лежат плашмя (на животе и на полу), пальцы продолжают предплечье — а не торчат вверх.
      {
        const c4 = this.sitPhases().c4 * (this.handTargets[side] ? 0 : 1);
        if (c4 > 0.05) {
          const d = hand.getWorldPosition(new THREE.Vector3()).sub(lower.getWorldPosition(v)); d.y = 0;
          if (d.lengthSq() > 1e-8) {
            const sx = side === 'left' ? 1 : -1;
            const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(d.x, d.z))
              .multiply(this.rootRestQ ?? new THREE.Quaternion()).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -sx * Math.PI / 2));
            this.setWorldQuat(hand, hand.getWorldQuaternion(new THREE.Quaternion()).slerp(flat, 0.85 * c4));
          }
        }
      }
      hand.getWorldPosition(v);
      if (v.y >= minY) continue;
      const target = v.clone().setY(minY);
      const pole = lower.getWorldPosition(new THREE.Vector3()); pole.y += 0.25 * S;
      const hq = hand.getWorldQuaternion(new THREE.Quaternion());
      this.twoBoneIK(upper, lower, hand, target, pole);
      this.setWorldQuat(hand, hq); // сама кисть остаётся повёрнутой как была
    }
  }

  // Пределы суставов применяются после расчёта ног и могут повернуть бедро — тогда ступня уезжает под пол
  // (или повисает над ним). Здесь колено доворачивается ровно настолько, чтобы ступня вернулась на свою высоту.
  footFloorFix() {
    if (!(this.sitS > 0.3) || this.mixer) return;
    const X = new THREE.Vector3(1, 0, 0), v = new THREE.Vector3(), S = this.scale;
    // На коленях и четвереньках голень лежит на полу: ступню возвращаем на её высоту в обе стороны — и если
    // провалилась, и если задралась в воздух (пределы сустава срывали колено, и ступня повисала у бедра).
    const kneel = (this.kneelK ?? 0) > 0.5;
    for (const side of ['left', 'right']) {
      const knee = this.bones[`${side}LowerLeg`], foot = this.bones[`${side}Foot`], want = this.footWantY?.[side];
      if (!knee || !foot || want == null) continue;
      const yOf = (b) => { knee.quaternion.setFromAxisAngle(X, b); knee.updateWorldMatrix(false, true); return foot.getWorldPosition(v).y; };
      const q = knee.quaternion, sg = q.w < 0 ? -1 : 1;
      const b0 = 2 * Math.atan2(q.x * sg, q.w * sg);
      const y0 = foot.getWorldPosition(v).y;
      const both = kneel && !this.footHeld?.[side];
      const fixS = this.kneeFixS ??= { left: 0, right: 0 };
      const ease = (target) => { // поправка колена набирается и уходит плавно — без щелчка ногой
        if (this.kneeFixTick?.[side] !== this.time) { (this.kneeFixTick ??= {})[side] = this.time; fixS[side] += (target - fixS[side]) * Math.min(1, (this.lastDt ?? 0.016) * 14); }
        if (Math.abs(fixS[side]) > 1e-4) yOf(b0 + fixS[side]);
      };
      if (both ? Math.abs(y0 - want) < 0.015 * S : y0 > want - 0.012 * S) { ease(0); continue; }
      const sgn = Math.sign(b0) || 1, lo = Math.min(0, sgn * 2.53), hi = Math.max(0, sgn * 2.53);
      // Перебираем сгиб колена вокруг текущего и берём тот, где ступня ближе всего к своей высоте
      // (при равных — ближайший к текущему, чтобы нога не прыгала).
      let best = b0, bestE = both ? Math.abs(y0 - want) : Math.max(0, want - y0);
      for (let k = 1; k <= 14; k++) {
        for (const d of [k * 0.07, -k * 0.07]) {
          const b = THREE.MathUtils.clamp(b0 + d, lo, hi);
          const y = yOf(b);
          const e = (both ? Math.abs(y - want) : Math.max(0, want - y)) + k * 0.0015 * S;
          if (e < bestE - 1e-5) { bestE = e; best = b; }
        }
        if (bestE < 0.006 * S + k * 0.0015 * S) break;
      }
      if (both) ease(best - b0); else { fixS[side] = best - b0; yOf(best); }
    }
  }

  // ---------- Пол ----------
  // Находим самую «утонувшую» часть тела и приподнимаем таз на эту глубину.
  // withFeet — учитывать и ступни (в записях движений, где IK ступней нет).
  floorPush(withFeet = false) {
    const b = this.bones;
    if (!b.hips) return false;
    b.hips.updateWorldMatrix(true, true);
    const S = this.scale;
    const parts = [
      ['leftLowerLeg', 0.05], ['rightLowerLeg', 0.05], ['hips', 0.1],
      ['head', 0.1], ['chest', 0.1],
      ['leftLowerArm', 0.03], ['rightLowerArm', 0.03],
    ];
    // Кисти больше не поднимают всё тело: раньше одна ушедшая под пол ладонь приподнимала её целиком, и она
    // «висела» над полом. Теперь ладонь возвращается на пол сама, рукой (см. handFloorFix).
    if (withFeet) parts.push(['leftFoot', 0.05], ['rightFoot', 0.05]);
    const v = new THREE.Vector3();
    let pen = 0;
    let gapUpper = Infinity; // зазор до пола у головы и груди (для предела наклона)
    for (const [name, r] of parts) {
      const node = b[name] ?? this.vrm.humanoid.getNormalizedBoneNode(name);
      if (!node) continue;
      node.getWorldPosition(v);
      pen = Math.max(pen, r * S - v.y);
      if (name === 'head' || name === 'chest') gapUpper = Math.min(gapUpper, v.y - r * S);
    }
    if (!withFeet) this.upperGap = gapUpper;
    if (pen <= 0.001) return false;
    b.hips.position.y += pen;
    b.hips.updateWorldMatrix(false, true);
    return true;
  }

  // ---------- Толчок от касания ----------
  // Касание чуть толкает тело: корпус откачивается от пальца и пружинисто
  // возвращается, голова и бёдра догоняют с запаздыванием (через пружины позы).
  // Слой реакции поверх записей движений: небольшие повороты корпуса и головы
  // на пружине, которые добавляются к анимации (толчок от касания).
  applyReactLayer(dt) {
    const r = this.reactLayer;
    if (!r) return;
    const w = 7;
    for (const key of ['spineX', 'spineZ', 'headX', 'headZ']) {
      r.v[key] += (-w * w * r.x[key] - 2 * w * r.v[key]) * dt;
      r.x[key] += r.v[key] * dt;
    }
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const apply = (bone, x, z) => {
      if (!bone) return;
      e.set(x * this.flip, 0, z * this.flip);
      bone.quaternion.multiply(q.setFromEuler(e));
    };
    apply(this.bones.chest ?? this.bones.spine, r.x.spineX, r.x.spineZ);
    apply(this.bones.head, r.x.headX, r.x.headZ);
  }

  nudge(dir, strength = 1) {
    if (this.mixer) {
      // Во время записи — толкаем слой реакции.
      const k = 2.2 * strength;
      this.reactLayer ??= { x: { spineX: 0, spineZ: 0, headX: 0, headZ: 0 }, v: { spineX: 0, spineZ: 0, headX: 0, headZ: 0 } };
      const v = this.reactLayer.v;
      v.spineX += dir.z * k;
      v.spineZ -= dir.x * k;
      v.headX += dir.z * k * 0.6;
      v.headZ -= dir.x * k * 0.8;
      return;
    }
    if (!this.spv) return;
    const k = 2.2 * strength;
    const add = (key, val) => { if (key in this.spv) this.spv[key] += val; };
    // dir — направление касания в мире (от камеры в тело). В осях VRM 1.0:
    // толчок спереди (dir.z < 0) — наклон назад; сбоку — наклон в сторону толчка.
    add('spineX', dir.z * k);
    add('spineZ', -dir.x * k);
    add('headX', dir.z * k * 0.6);
    add('headZ', -dir.x * k * 0.8);
    add('hipsZ', dir.x * k * 0.3);
  }

  // ---------- Анатомические ограничения суставов ----------
  // Локальные повороты нормализованных костей заданы относительно исходной T-позы.
  // Раскладываем поворот на «скручивание» вокруг оси кости и «отклонение» оси,
  // и ограничиваем каждое как у человека. Для VRM 0.x оси X/Z зеркальные (flip).

  static swingTwist(q, axis) {
    const qq = q.clone();
    if (qq.w < 0) { qq.x = -qq.x; qq.y = -qq.y; qq.z = -qq.z; qq.w = -qq.w; }
    const proj = axis.clone().multiplyScalar(qq.x * axis.x + qq.y * axis.y + qq.z * axis.z);
    const twist = new THREE.Quaternion(proj.x, proj.y, proj.z, qq.w);
    if (twist.lengthSq() < 1e-10) twist.identity(); else twist.normalize();
    const swing = qq.clone().multiply(twist.clone().invert());
    const twistAngle = 2 * Math.atan2(qq.x * axis.x + qq.y * axis.y + qq.z * axis.z, qq.w);
    return { swing, twistAngle };
  }

  applyJointLimits() {
    const deg = Math.PI / 180;
    const f = this.flip;
    const X = new THREE.Vector3(1, 0, 0);
    const Y = new THREE.Vector3(0, 1, 0);
    // Позвоночник, шея, голова: наклон вперёд/назад, поворот и наклон вбок в пределах нормы.
    const clampEuler = (bone, xMin, xMax, yLim, zLim) => {
      if (!bone) return;
      const e = new THREE.Euler().setFromQuaternion(bone.quaternion, 'XYZ');
      e.x = THREE.MathUtils.clamp(e.x * f, xMin * deg, xMax * deg) * f;
      e.y = THREE.MathUtils.clamp(e.y, -yLim * deg, yLim * deg);
      e.z = THREE.MathUtils.clamp(e.z * f, -zLim * deg, zLim * deg) * f;
      bone.quaternion.setFromEuler(e);
    };
    const b = this.bones;
    clampEuler(b.spine, -30, 50, 35, 30);
    clampEuler(b.chest, -25, 40, 30, 25);
    clampEuler(b.upperChest, -20, 30, 25, 20);
    clampEuler(b.neck, -35, 40, 50, 30);
    clampEuler(b.head, -35, 40, 50, 35);
    for (const side of ['left', 'right']) {
      const L = side === 'left';
      const out = L ? 1 : -1; // в сторону от тела (в осях VRM 1.0)

      // Колено: только шарнир вперёд, 0…145°, без скручивания и бокового изгиба.
      const knee = this.bones[`${side}LowerLeg`];
      if (knee) {
        const q = knee.quaternion;
        const w = q.w < 0 ? -1 : 1;
        let bend = 2 * Math.atan2(q.x * w, q.w * w) * f;
        bend = THREE.MathUtils.clamp(bend, 0, 145 * deg);
        knee.quaternion.setFromAxisAngle(X, bend * f);
      }

      // Бедро: скручивание ±40°, вперёд до 120°, назад до 25°, наружу до 45°, внутрь до 20°.
      const hip = this.bones[`${side}UpperLeg`];
      if (hip) {
        const { swing, twistAngle } = Character.swingTwist(hip.quaternion, Y);
        const tw = THREE.MathUtils.clamp(twistAngle, -40 * deg, 40 * deg);
        const dir = new THREE.Vector3(0, -1, 0).applyQuaternion(swing);
        // В «человеческих» осях: fwd — вперёд, lat — наружу, down — вниз.
        const fwd = dir.z * f;
        const lat = dir.x * f * out;
        const down = -dir.y;
        let pitch = Math.atan2(fwd, down);
        let roll = Math.asin(THREE.MathUtils.clamp(lat, -1, 1));
        pitch = THREE.MathUtils.clamp(pitch, -25 * deg, 114 * deg);
        // Сильный сгиб + нога далеко в сторону одновременно — так сустав у человека не работает, а сетка модели
        // в этом месте сминается складками. Чем сильнее согнута нога, тем меньше её можно отвести вбок.
        const rollMax = 45 - 14 * THREE.MathUtils.smoothstep(pitch, 98 * deg, 114 * deg);
        roll = THREE.MathUtils.clamp(roll, -20 * deg, rollMax * deg);
        const r = Math.cos(roll);
        const nd = new THREE.Vector3(Math.sin(roll) / (f * out), -r * Math.cos(pitch), (r * Math.sin(pitch)) / f);
        const newSwing = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), nd.normalize());
        hip.quaternion.copy(newSwing.multiply(new THREE.Quaternion().setFromAxisAngle(Y, tw)));
      }

      // Стопа: носок вниз до 60°, вверх до 25°, вбок/скручивание до ±15°.
      const foot = this.bones[`${side}Foot`];
      if (foot) {
        const e = new THREE.Euler().setFromQuaternion(foot.quaternion, 'XYZ');
        e.x = THREE.MathUtils.clamp(e.x * f, -25 * deg, 60 * deg) * f;
        e.y = THREE.MathUtils.clamp(e.y, -15 * deg, 15 * deg);
        e.z = THREE.MathUtils.clamp(e.z, -15 * deg, 15 * deg);
        foot.quaternion.setFromEuler(e);
      }

      // Локоть: сгиб до 145°, скручивание предплечья ±80°.
      const elbow = this.bones[`${side}LowerArm`];
      if (elbow) {
        const { swing, twistAngle } = Character.swingTwist(elbow.quaternion, X);
        const tw = THREE.MathUtils.clamp(twistAngle, -80 * deg, 80 * deg);
        const sw = swing.clone();
        const ang = 2 * Math.acos(Math.min(1, Math.abs(sw.w)));
        if (ang > 145 * deg) sw.slerp(new THREE.Quaternion(), 1 - (145 * deg) / ang);
        elbow.quaternion.copy(sw.multiply(new THREE.Quaternion().setFromAxisAngle(X, tw)));
      }

      // Плечо: скручивание ±100°, рука не заводится далеко за спину.
      const upperArm = this.bones[`${side}UpperArm`];
      if (upperArm) {
        const axis = new THREE.Vector3(out, 0, 0);
        const { swing, twistAngle } = Character.swingTwist(upperArm.quaternion, axis);
        const tw = THREE.MathUtils.clamp(twistAngle, -100 * deg, 100 * deg);
        const dir = axis.clone().applyQuaternion(swing);
        // В осях VRM 1.0: back = насколько рука за плоскостью тела.
        const back = -dir.z * f;
        const maxBack = dir.y < -0.5 ? 0.75 : 0.55; // опущенную руку можно завести за спину чуть дальше
        let newSwing = swing;
        if (back > maxBack) {
          const nd = dir.clone();
          nd.z = -maxBack / f;
          const rest = Math.sqrt(Math.max(0, 1 - maxBack * maxBack));
          const xy = Math.hypot(dir.x, dir.y) || 1;
          nd.x = (dir.x / xy) * rest;
          nd.y = (dir.y / xy) * rest;
          newSwing = new THREE.Quaternion().setFromUnitVectors(axis, nd.normalize());
        }
        upperArm.quaternion.copy(newSwing.multiply(new THREE.Quaternion().setFromAxisAngle(axis, tw)));
      }

      // Кисть: сгиб до 60°, скручивание ±30°.
      const hand = this.bones[`${side}Hand`];
      if (hand) {
        const { swing, twistAngle } = Character.swingTwist(hand.quaternion, X);
        const tw = THREE.MathUtils.clamp(twistAngle, -30 * deg, 30 * deg);
        const sw = swing.clone();
        const ang = 2 * Math.acos(Math.min(1, Math.abs(sw.w)));
        if (ang > 60 * deg) sw.slerp(new THREE.Quaternion(), 1 - (60 * deg) / ang);
        hand.quaternion.copy(sw.multiply(new THREE.Quaternion().setFromAxisAngle(X, tw)));
      }
    }
  }

  // ---------- Поза пальцем ----------

  chestNode() {
    return this.bones.upperChest ?? this.bones.chest ?? this.bones.spine;
  }

  armLength(side) {
    const r = this.limbRest.get(this.bones[`${side}UpperArm`]?.uuid);
    return r ? r.l1 + r.l2 : 0.5 * this.scale;
  }

  setArmPreset(side, preset) {
    this.armPreset[side] = preset;
    this.handTargets[side] = null;
    if (this.handAnchor) this.handAnchor[side] = null;
  }

  // Точка крепления руки на теле: кость + смещение в осях тела (как магниты в позах).
  anchorPoint(a) {
    const node = this.vrm.humanoid.getNormalizedBoneNode(a.bone);
    if (!node) return null;
    const p = node.getWorldPosition(new THREE.Vector3());
    const q = this.bones.hips.getWorldQuaternion(new THREE.Quaternion());
    return p.add(new THREE.Vector3(a.off[0] * this.flip, a.off[1], a.off[2] * this.flip).multiplyScalar(this.scale).applyQuaternion(q));
  }

  setHandAnchor(side, a) {
    (this.handAnchor ??= { left: null, right: null })[side] = a ? { bone: a.bone, off: [...a.off] } : null;
  }

  setHandTarget(side, worldPoint) {
    this.armPreset[side] = null;
    if (this.handAnchor) this.handAnchor[side] = null;
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
    const S = this.scale;
    // На полу смещение — от того, где стопа лежит сейчас (а не стоя), и пределы шире.
    if (this.sitS > 0.3 && this.footBase?.[side]) {
      (this.footSetSit ??= {})[side] = this.sitS;
      const off = worldPoint.clone().sub(this.footBase[side]);
      off.x = THREE.MathUtils.clamp(off.x, -0.45 * S, 0.45 * S);
      off.y = THREE.MathUtils.clamp(off.y, -0.1 * S, 0.6 * S);
      off.z = THREE.MathUtils.clamp(off.z, -0.5 * S, 0.5 * S);
      this.footOffset[side] = off;
      return;
    }
    (this.footSetSit ??= {})[side] = this.sitS;
    const off = worldPoint.clone().sub(rest.pos);
    // Естественные пределы: вбок наружу до 25 см, внутрь — не дальше второй ноги,
    // вверх до 45 см, вперёд до 40 см, назад до 25 см.
    const out = Math.sign(rest.pos.x - this.restHips.x) || 1;
    const lateral = THREE.MathUtils.clamp(off.x * out, -Math.abs(rest.pos.x - this.restHips.x) + 0.02 * S, 0.25 * S);
    off.x = lateral * out;
    off.y = THREE.MathUtils.clamp(off.y, 0, 0.45 * S);
    off.z = THREE.MathUtils.clamp(off.z, -0.25 * S, 0.4 * S);
    this.footOffset[side] = off;
  }

  handWorld(side) {
    return this.bones[`${side}Hand`]?.getWorldPosition(new THREE.Vector3());
  }

  clearTouchPose() {
    this.handTargets = { left: null, right: null };
    this.headOffset = { x: 0, y: 0 };
    this.bodyOffset = { spineX: 0, spineY: 0, spineZ: 0, hipsX: 0, hipsY: 0, hipsZ: 0, hipsRotX: 0, hipsFwd: 0 };
    this.footOffset = { left: null, right: null };
    this.armPreset = { left: null, right: null };
    this.footSetSit = {};
    this.hipsSetSit = null;
    this.handAnchor = { left: null, right: null };
    // Позу сбросили или вернули как было — колени больше не держатся за старые точки на полу.
    if (this.kneePin) { this.kneePin.left = this.kneePin.right = null; this.kneePin.w = 0; this.kneePin.sit = -1; this.kneePin.bad = 0; }
  }

  exportTouchPose() {
    return {
      left: this.handTargets.left?.toArray() ?? null,
      right: this.handTargets.right?.toArray() ?? null,
      head: { ...this.headOffset },
      presets: { ...this.armPreset },
      sit: this.sit, // сохранённая поза помнит, сидит она или лежит (и как)
      lie: this.lieStyle,
      body: { ...this.bodyOffset },
      feet: {
        left: this.footOffset.left?.toArray() ?? null,
        right: this.footOffset.right?.toArray() ?? null,
      },
      footSit: { ...(this.footSetSit ?? {}) },
      anchors: { left: this.handAnchor?.left ?? null, right: this.handAnchor?.right ?? null },
      hipsSit: this.hipsSetSit ?? null,
    };
  }

  importTouchPose(data) {
    this.clearTouchPose();
    if (!data) return;
    if (data.left) this.handTargets.left = new THREE.Vector3().fromArray(data.left);
    if (data.right) this.handTargets.right = new THREE.Vector3().fromArray(data.right);
    if (data.head) this.headOffset = { ...data.head };
    if (data.presets) this.armPreset = { left: data.presets.left ?? null, right: data.presets.right ?? null };
    if (typeof data.sit === 'number') {
      if (data.lie && data.sit > 0.8 && data.lie !== this.lieStyle && this.sitS > 0.81) {
        // Сначала поднимется до колен, сменит способ и опустится в сохранённое положение.
        this.setLieStyle(data.lie);
        this.pendingSit = data.sit;
      } else {
        if (data.lie && data.sit > 0.8) this.lieStyle = data.lie;
        this.sit = data.sit;
      }
    }
    if (data.body) Object.assign(this.bodyOffset, data.body);
    for (const side of ['left', 'right']) {
      if (data.feet?.[side]) this.footOffset[side] = new THREE.Vector3().fromArray(data.feet[side]);
    }
    this.footSetSit = { ...(data.footSit ?? {}) };
    this.handAnchor = { left: data.anchors?.left ?? null, right: data.anchors?.right ?? null };
    this.hipsSetSit = data.hipsSit ?? null;
  }

  applyHandTargets() {
    const chest = this.chestNode();
    if (!chest) return;
    chest.updateWorldMatrix(true, false);
    let leanX = 0;
    let leanZ = 0;
    for (const side of ['left', 'right']) {
      // Рука прикреплена к телу (бедро, колено, щека) — цель считаем от этой части тела
      // прямо сейчас: рука едет вместе с ней и не отлипает при наклоне/посадке/повторе.
      const anc = this.handAnchor?.[side];
      const ap = anc && this.handTargets[side] ? this.anchorPoint(anc) : null;
      const local = ap ? chest.worldToLocal(ap) : this.handTargets[side] ? this.dragPhys.hand[side]?.x : null;
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
      // Куда смотрит локоть. Рука внизу — вниз-назад и чуть наружу (как было). Кисть выше плеча — локоть уходит
      // наружу, а не остаётся «внизу» (иначе рука выворачивается). Лёжа «низ» считаем от её тела, а не от пола.
      // Направление меняется плавно, без перескоков.
      const cq = chest.getWorldQuaternion(new THREE.Quaternion());
      const upC = new THREE.Vector3(0, 1, 0).applyQuaternion(cq);
      const high = THREE.MathUtils.smoothstep(target.clone().sub(shoulder).dot(upC) / (0.5 * this.scale), -0.1, 0.7);
      const lieK = THREE.MathUtils.smoothstep(this.sitS, 0.85, 1.15);
      const dirW = new THREE.Vector3(outward * (0.3 + 0.5 * high), -0.5 + 0.45 * high, -0.3 - 0.1 * high);
      if (lieK > 0) {
        const outC = Math.sign(chest.worldToLocal(shoulder.clone()).x) || 1;
        dirW.lerp(new THREE.Vector3(outC * (0.3 + 0.5 * high), -0.5 + 0.45 * high, -0.3).applyQuaternion(cq), lieK);
      }
      const pd = ((this.elbowDir ??= {})[side] ??= dirW.clone());
      pd.lerp(dirW, 1 - Math.exp(-(this.lastDt ?? 0.016) * 8));
      const pole = lower.getWorldPosition(new THREE.Vector3()).add(pd);
      // Тянут дальше, чем достаёт рука, — корпус наклоняется следом.
      const rest = this.limbRest.get(upper.uuid);
      if (rest) {
        const reach = (rest.l1 + rest.l2) * 0.95;
        const d = target.clone().sub(shoulder);
        const over = Math.max(0, d.length() - reach);
        if (over > 0) {
          d.normalize();
          leanZ += d.z * over * 2.5;
          leanX -= d.x * over * 2.5;
        }
      }
      this.twoBoneIK(upper, lower, hand, target, pole);
    }
    const k = 0.15;
    this.reachLean.x += (THREE.MathUtils.clamp(leanX, -0.4, 0.4) - this.reachLean.x) * k;
    this.reachLean.z += (THREE.MathUtils.clamp(leanZ, -0.3, 0.5) - this.reachLean.z) * k;
  }

  // Цели, выставленные пальцем, догоняются пружиной (ω≈11, лёгкий перехлёст):
  // рука и нога ощущаются с массой и инерцией, а не прилипают к пальцу.
  updateDragPhysics(dt) {
    const w = 9;
    const zeta = 0.95; // почти без перехлёста: тяжесть есть, а «швыряния» нет
    const step = (state, raw) => {
      if (!raw) return null;
      if (!state) return { x: raw.clone(), v: new THREE.Vector3() };
      const steps = Math.max(1, Math.ceil(dt / 0.016));
      const h = dt / steps;
      const a = new THREE.Vector3();
      for (let i = 0; i < steps; i++) {
        a.copy(raw).sub(state.x).multiplyScalar(w * w).addScaledVector(state.v, -2 * zeta * w);
        state.v.addScaledVector(a, h);
        state.x.addScaledVector(state.v, h);
      }
      return state;
    };
    for (const side of ['left', 'right']) {
      this.dragPhys.hand[side] = step(this.dragPhys.hand[side], this.handTargets[side]);
      // Ступня стартует из исходного положения (нулевого смещения), поэтому поднимается с инерцией.
      const rawFoot = this.footOffset[side];
      if (rawFoot && !this.dragPhys.foot[side]) this.dragPhys.foot[side] = { x: new THREE.Vector3(), v: new THREE.Vector3() };
      this.dragPhys.foot[side] = step(this.dragPhys.foot[side], rawFoot);
    }
    if (!this.handTargets.left && !this.handTargets.right) {
      this.reachLean.x *= 0.9;
      this.reachLean.z *= 0.9;
    }
  }

  // Посадка в две фазы: 0…0.6 — глубокий присед (ступни вперёд),
  // 0.6…1 — опускается на колени и садится на пятки (сейдза), руки на коленях.
  // Разбудить ненадолго (касание спящей): глаза открываются, потом снова засыпает.
  wake(seconds = 3) {
    this.wakeT = Math.max(this.wakeT ?? 0, seconds);
  }

  setLieStyle(style) {
    if (style === this.lieStyle) { this.pendingLieStyle = null; return; }
    if (this.sitS > 0.81) { this.pendingLieStyle = style; this.sit = Math.min(this.sit, 0.8); }
    else this.lieStyle = style;
  }

  sitPhases(s = this.sitS) {
    // 0…0.5 — присед, 0.5…0.8 — на колени, 0.8…1 — садится боком на пол.
    const ease = (x) => x * x * (3 - 2 * x);
    const c = THREE.MathUtils.clamp;
    const q3 = ease(c((s - 0.8) / 0.2, 0, 1));
    const q4 = ease(c((s - 1.0) / 0.3, 0, 1));
    // lieStyle 'belly': вместо «сидит боком → на бок» — наклон вперёд к полу (b3)
    // и ложится на живот спать (b4).
    const belly = this.lieStyle === 'belly';
    const back = this.lieStyle === 'back';
    const side = !belly && !back;
    return {
      p1: ease(c(s / 0.5, 0, 1)),
      p2: ease(c((s - 0.5) / 0.3, 0, 1)),
      p3: side ? q3 : 0,
      p4: side ? q4 : 0, // 1.0…1.3 — ложится на бок, на локоть
      b3: belly ? q3 : 0,
      b4: belly ? q4 : 0,
      // На спину: с колен садится на пол, ноги вперёд (c3), потом ложится на спину (c4).
      c3: back ? q3 : 0,
      c4: back ? q4 : 0,
    };
  }

  sitDropFor(s) {
    const restY = this.restHips.y;
    // Не до предела: при полном сгибе сетка модели сминается («плющит» ноги).
    const squatY = restY * 0.58;
    const floorY = 0.36 * this.scale; // на коленях, таз над пятками
    const sideY = 0.15 * this.scale; // сидит боком прямо на полу
    const { p1, p2, p3, p4 } = this.sitPhases(s);
    let y = THREE.MathUtils.lerp(restY, squatY, p1);
    if (p2 > 0) y = THREE.MathUtils.lerp(squatY, floorY, p2);
    if (p3 > 0) y = THREE.MathUtils.lerp(floorY, sideY, p3);
    if (p4 > 0) y = THREE.MathUtils.lerp(sideY, 0.13 * this.scale, p4); // лёжа на боку
    const { b3, b4 } = this.sitPhases(s);
    if (b3 > 0) y = THREE.MathUtils.lerp(floorY, floorY * 0.9, b3); // наклон к полу, таз на пятках
    if (b4 > 0) y = THREE.MathUtils.lerp(floorY * 0.9, 0.11 * this.scale, b4); // на животе
    const { c3, c4 } = this.sitPhases(s);
    if (c3 > 0) y = THREE.MathUtils.lerp(floorY, 0.14 * this.scale, c3); // сидит на полу, ноги вперёд
    if (c4 > 0) y = THREE.MathUtils.lerp(0.14 * this.scale, 0.11 * this.scale, c4); // на спине
    return Math.max(0, restY - y);
  }

  // Сидя на полу кладёт руки на колени (плавно, по мере того как садится).
  handsOnKnees(side) {
    // Руки ложатся на колени уже в приседе — не висят «на полпути».
    let w = THREE.MathUtils.smoothstep(this.sitS, 0.22, 0.45);
    // Руки в выбранной позе (или примагничены) — так и остаются, когда она садится;
    // берём руку только для опоры о пол, когда она сидит боком или лежит.
    if (this.armPreset[side] || this.poseName !== 'stand') {
      // Руки позы остаются и лёжа на боку (только правая — опора на локоть);
      // на живот руки уходят под голову.
      const ph = this.sitPhases();
      w *= side === 'right' ? Math.max(ph.p3, ph.b3, ph.c3) : Math.max(ph.b3, ph.c3);
    }
    if (w <= 0) return;
    const upper = this.bones[`${side}UpperArm`];
    const lower = this.bones[`${side}LowerArm`];
    const hand = this.bones[`${side}Hand`];
    const knee = this.bones[`${side}LowerLeg`];
    if (!upper || !lower || !hand || !knee) return;
    const q1 = upper.quaternion.clone();
    const q2 = lower.quaternion.clone();
    // Ладони на коленях; когда она на коленях — чуть ближе к себе, на бёдрах.
    const { p2, p3, p4 } = this.sitPhases();
    const kneePos = knee.getWorldPosition(new THREE.Vector3());
    const hipsPos = this.bones.hips.getWorldPosition(new THREE.Vector3());
    // В приседе предплечья лежат на бёдрах, кисти мягко свисают с колен;
    // на коленях — ладони на бёдрах, ближе к себе.
    const squatK = (1 - p2);
    const target = kneePos.clone()
      .lerp(hipsPos, 0.3 * p2)
      .add(new THREE.Vector3(0, (0.05 + 0.02 * squatK) * this.scale, (0.03 + 0.05 * squatK) * this.scale));
    // Ладонь — на внутренней стороне колена (ближе к центру), локти не разлетаются.
    {
      const inward = hipsPos.clone().sub(kneePos); inward.y = 0;
      if (inward.lengthSq() > 1e-6) target.addScaledVector(inward.normalize(), 0.05 * this.scale * (1 - p2));
    }
    let pole = lower.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.4, -0.4));
    // Сидя боком: правая рука опирается о пол сбоку, левая лежит на бедре.
    if (p3 > 0 && side === 'right') {
      const floor = new THREE.Vector3(hipsPos.x - 0.24 * this.scale, 0.03 * this.scale, hipsPos.z + 0.02 * this.scale);
      target.lerp(floor, p3);
      pole = pole.lerp(lower.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(-0.3, 0, -0.5)), p3);
    } else if (p3 > 0) {
      const thigh = kneePos.clone().lerp(hipsPos, 0.45).add(new THREE.Vector3(0, 0.06 * this.scale, 0));
      target.lerp(thigh, p3);
    }
    // Лёжа на боку: правое предплечье на полу перед грудью (опора на локоть),
    // левая рука лежит на полу перед животом.
    if (p4 > 0) {
      const chest = this.chestNode().getWorldPosition(new THREE.Vector3());
      // Верхняя (левая) рука — не на полу, а лежит на своём бедре: так лежат на боку в жизни.
      const upperLeg = this.bones.leftUpperLeg?.getWorldPosition(new THREE.Vector3()) ?? hipsPos;
      const lie = side === 'right'
        ? new THREE.Vector3(chest.x + 0.02 * this.scale, 0.04 * this.scale, chest.z + 0.22 * this.scale)
        : upperLeg.clone().lerp(kneePos, 0.4).add(new THREE.Vector3(0, 0.08 * this.scale, 0.03 * this.scale));
      target.lerp(lie, p4);
      const lieElbow = side === 'right' ? new THREE.Vector3(0, -0.6, -0.3) : new THREE.Vector3(0, 0.5, -0.4);
      pole = pole.lerp(lower.getWorldPosition(new THREE.Vector3()).add(lieElbow), p4);
    }
    // Сидит на полу — ладони сзади на полу (опора); на спине — одна рука на животе, другая вдоль тела.
    const { c3, c4 } = this.sitPhases();
    if (c3 > 0) {
      const S = this.scale;
      const out = side === 'left' ? 1 : -1;
      const behind = new THREE.Vector3(hipsPos.x + out * 0.17 * S, 0.03 * S, hipsPos.z - 0.2 * S);
      target.lerp(behind, c3 * (1 - c4));
      // Лёжа на спине: одна ладонь мягко на животе, другая рядом с телом, локоть согнут.
      const lying = side === 'left'
        ? new THREE.Vector3(hipsPos.x + 0.02 * S, hipsPos.y + 0.08 * S, hipsPos.z - 0.1 * S)
        : new THREE.Vector3(hipsPos.x - 0.21 * S, 0.04 * S, hipsPos.z - 0.17 * S);
      target.lerp(lying, c4);
      // Локти в стороны и к полу (не вверх).
      pole = pole.lerp(lower.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(out * 0.6, -0.3 * c4, -0.2)), c3);
    }
    // На животе: сначала ладони тянутся вперёд по полу, потом руки сложены под головой.
    const { b3, b4 } = this.sitPhases();
    if (b3 > 0) {
      const S = this.scale;
      const out = side === 'left' ? 1 : -1;
      // Ладони на полу впереди, локти чуть согнуты (не палками).
      const fwd = new THREE.Vector3(hipsPos.x + out * 0.15 * S, 0.04 * S, hipsPos.z + 0.44 * S);
      target.lerp(fwd, b3 * (1 - b4));
      const headP = this.bones.head.getWorldPosition(new THREE.Vector3());
      const pillow = new THREE.Vector3(headP.x + out * 0.13 * S, 0.05 * S, headP.z - 0.02 * S);
      target.lerp(pillow, b4);
      pole = pole.lerp(lower.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(out * 0.6, -0.2, -0.2)), b3);
    }
    // Руки не застывают: еле заметно «дышат» и чуть смещаются.
    {
      const ph = side === 'left' ? 0 : 2.1;
      const t = this.time;
      const opp = this.sitPhases();
      const onFloor = Math.max(opp.p4 * (side === 'right' ? 1 : 0), opp.c3 * (1 - opp.c4), opp.b3 * (1 - opp.b4), opp.p3 * (side === 'right' ? 1 : 0));
      const k = (1 - 0.8 * onFloor) * this.scale;
      target.y += Math.sin(t * 1.1 + ph) * 0.008 * k;
      target.x += Math.sin(t * 0.37 + ph) * 0.012 * k;
      target.z += Math.sin(t * 0.29 + ph * 1.7) * 0.012 * k;
    }
    // Глубоко наклонилась — колени уже выше плеч: ладони на коленях выглядят
    // выкрученными, руки просто свисают к полу (там их подхватит опора о пол).
    {
      const sh = upper.getWorldPosition(new THREE.Vector3());
      const ph = this.sitPhases();
      const free = 1 - Math.max(ph.p3 * (side === 'right' ? 1 : 0), ph.p4, ph.b3, ph.c3);
      w *= 1 - free * THREE.MathUtils.smoothstep(target.y - sh.y, -0.2 * this.scale, -0.04 * this.scale);
      if (w <= 0.001) return;
    }
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
      else if (key.startsWith('spine')) w = 5.2;
      else if (key.startsWith('head')) w = 5;
      else if (/Shoulder/.test(key)) w = 8;
      else if (/Leg|Knee/.test(key)) w = 7;
      else if (/Upper|Lower/.test(key)) w = fast ? 12 : 7.5;
      if (this.dancing) w *= 2.2;
      // Ведёшь полосу (или играет запись) быстро — тело отзывается быстрее;
      // медленно — остаётся мягким и плавным. Скорость следует за пальцем.
      if ((this.dragBoostT ?? 0) > 0 && /^(hips|spine|head)|Leg|Knee/.test(key)) w *= 1 + Math.min(this.sitRate ?? 0, 3) * 0.25; // чуть живее за пальцем, но гибко
      let x = this.sp[key] ?? target[key];
      let v = this.spv[key] ?? 0;
      // Бёдра — упругие: чуть «пружинят» после движения (сочнее, пластичнее);
      // корпус — мягче; остальное — без перелёта.
      const zeta = key.startsWith('hips') ? 0.55 : key.startsWith('spine') ? 0.72 : key.startsWith('head') ? 0.82 : /Shoulder|Upper|Lower/.test(key) ? 0.85 : 1;
      // Критически демпфированная пружина, с подшагами для устойчивости.
      const steps = Math.max(1, Math.ceil((w * dt) / 0.25));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        const a = w * w * (target[key] - x) - 2 * zeta * w * v;
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
      // Кисть выше плеча (у щеки, у волос) — это задумано, руку не выталкиваем наружу.
      const shoulderY = this.bones[`${side}UpperArm`].getWorldPosition(new THREE.Vector3()).y;
      if (hand.y > shoulderY - 0.06 * this.scale) continue;
      const bin = this.bodyBins.get(Math.round((hand.y - shift.y) / 0.02));
      const front = bin ? hand.z - shift.z > (bin.zMin + bin.zMax) / 2 : true;
      // В позе «за спиной» руки всегда отводим назад, иначе — по положению кисти.
      const armBusy = this.dancing || this.motions.some((m) => ARM_MOTIONS.has(m.name));
      const hint = armBusy ? undefined : this.armPreset[side] === 'behind' ? 1 : this.armPreset[side] ? undefined : (this.armHang ?? 0) < -0.15 ? 1 : POSES[this.poseName]?.armDir;
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

  // Волосы: у VRoid они по умолчанию «деревянные» (жёсткие и сильно задемпфированы).
  // Делаем мягче к кончикам и чуть тяжелее — висят естественно и качаются с запаздыванием.
  tuneHair() {
    const joints = this.vrm.springBoneManager?.joints;
    if (!joints) return;
    const hair = [...joints].filter((j) => j.bone && /hair/i.test(j.bone.name));
    const bones = new Set(hair.map((j) => j.bone));
    const depthOf = (b) => { let d = 0; for (let p = b.parent; p; p = p.parent) if (bones.has(p)) d++; return d; };
    let maxD = 0;
    for (const j of hair) { j.userData ??= {}; j.userData.hairDepth = depthOf(j.bone); maxD = Math.max(maxD, j.userData.hairDepth); }
    for (const j of hair) {
      const k = maxD ? j.userData.hairDepth / maxD : 0; // 0 — у корня, 1 — кончик
      j.settings.stiffness = Math.max(0.22, j.settings.stiffness * (0.85 - 0.4 * k));
      j.settings.dragForce = THREE.MathUtils.clamp(j.settings.dragForce * (0.8 - 0.25 * k), 0.2, 0.4);
      j.userData.hairBase = Math.max(j.settings.gravityPower, 0.1) + 0.06 * k;
      j.settings.gravityPower = j.userData.hairBase;
    }
    this.hairJoints = hair;
    this.hairSim = null;
  }

  // Инерция волос: голова двигается или поворачивается — пряди запаздывают и качаются,
  // потом догоняют; плюс еле заметный «воздух». Тяжесть всегда в основном вниз.
  hairInertia(dt) {
    const hair = this.hairJoints;
    const head = this.bones.head;
    if (!hair?.length || !head || !(dt > 0)) return;
    // Точка за затылком: ловит и перемещение головы, и её повороты.
    const p = this._hairP ??= new THREE.Vector3();
    p.set(0, -0.12 * this.scale, -0.12 * this.scale).applyQuaternion(head.getWorldQuaternion(this._hairQ ??= new THREE.Quaternion()));
    p.add(head.getWorldPosition(this._hairH ??= new THREE.Vector3()));
    if (!this.hairSim) this.hairSim = { p: p.clone(), v: new THREE.Vector3(), t: Math.random() * 10 };
    const hs = this.hairSim;
    const vel = (this._hairV ??= new THREE.Vector3()).copy(p).sub(hs.p).divideScalar(dt);
    hs.p.copy(p);
    if (vel.length() > 3) vel.setLength(3); // телепорт/смена позы — без рывка
    hs.v.lerp(vel, 1 - Math.exp(-dt * 9));
    hs.t += dt;
    const S = this.scale;
    const hx = -hs.v.x / S * 0.55 + Math.sin(hs.t * 0.8) * 0.018 + Math.sin(hs.t * 2.1 + 1) * 0.008;
    const hz = -hs.v.z / S * 0.55 + Math.cos(hs.t * 0.6) * 0.012;
    const hy = THREE.MathUtils.clamp(-hs.v.y / S * 0.35, -0.12, 0.08); // резко вниз — волосы «взлетают» чуть-чуть
    const g = this._hairG ??= new THREE.Vector3();
    for (const j of hair) {
      if (j.userData?.poke) continue; // её сейчас трогают — не перебиваем толчок от пальца
      const base = j.userData.hairBase ?? 0.1;
      const k = 0.5 + 0.5 * (j.userData.hairDepth ? 1 : 0);
      g.set(hx * k, -base + hy * k, hz * k);
      const lim = base * 2.2 + 0.1;
      if (g.length() > lim) g.setLength(lim);
      j.settings.gravityPower = g.length();
      j.settings.gravityDir.copy(g).normalize();
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
  // Толчок плавный: добавляется к «тяжести» сустава и мягко затухает — вещь пружинит, а не дёргается.
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
        j.userData.poke = { power: j.settings.gravityPower, dir: j.settings.gravityDir.clone(), vec: new THREE.Vector3() };
      }
      const k = (1 - d / radius) * strength;
      j.userData.poke.vec.addScaledVector(push, 0.55 * k);
      if (j.userData.poke.vec.length() > 0.85) j.userData.poke.vec.setLength(0.85);
      this.poked.add(j);
    }
  }

  restorePokes() {
    if (!this.poked.size) return;
    const decay = Math.exp(-(this.lastDt ?? 0.016) * 4.5);
    const g = this._pokeG ??= new THREE.Vector3();
    for (const j of this.poked) {
      const pk = j.userData.poke;
      pk.vec.multiplyScalar(decay);
      if (pk.vec.length() < 0.012) {
        j.settings.gravityPower = pk.power;
        j.settings.gravityDir.copy(pk.dir);
        j.userData.poke = null;
        this.poked.delete(j);
        continue;
      }
      g.copy(pk.dir).multiplyScalar(pk.power).add(pk.vec);
      j.settings.gravityPower = g.length();
      if (j.settings.gravityPower > 1e-5) j.settings.gravityDir.copy(g).normalize();
    }
  }

  updateExpressions(dt) {
    const em = this.vrm.expressionManager;
    if (!em) return;

    // Эмоция держится, потом плавно уходит в нейтраль.
    this.exprHold -= dt;
    if (this.exprHold <= 0) for (const e of EXPRESSIONS) this.exprTarget[e] = 0;
    if (this.patAmount > 0.2) this.exprTarget.happy = Math.max(this.exprTarget.happy, this.patAmount * (1 - 0.6 * (this.sleep ?? 0)));
    if (this.patAmount > 0.2 && (this.sleep ?? 0) > 0.5) this.sleepJoy = 1;
    // Жмурится от удовольствия: гладят дольше секунды — глаза мягко закрываются в улыбке.
    {
      const bliss = THREE.MathUtils.smoothstep(this.pleasure ?? 0, 0.5, 0.95) * (1 - (this.sleep ?? 0));
      if (bliss > 0.01 && this.exprTarget.angry < 0.1 && this.exprTarget.surprised < 0.1) {
        this.exprTarget.relaxed = Math.max(this.exprTarget.relaxed, bliss * 0.9);
        this.exprTarget.happy = Math.min(this.exprTarget.happy, 0.6 - 0.3 * bliss);
      }
    }
    // Лицо живее: смотрит на тебя — лёгкая улыбка; спит — спокойное расслабленное лицо.
    if (this.exprHold <= 0) {
      this.exprTarget.relaxed = Math.max(this.exprTarget.relaxed, (this.sleep ?? 0) * 0.45, (this.shyNow ?? 0) * 0.22);
      // Гладят спящую — улыбается во сне.
      this.exprTarget.happy = Math.max(this.exprTarget.happy, (this.sleep ?? 0) * Math.max(this.sleepJoy ?? 0, this.patAmount) * 0.35);
      this.exprTarget.happy = Math.max(this.exprTarget.happy, this.closeSmile ?? 0);
    }

    const k = 1 - Math.exp(-dt * 8);
    for (const e of EXPRESSIONS) {
      this.exprCurrent[e] += (this.exprTarget[e] - this.exprCurrent[e]) * k;
      // Эмоции мягче: «радость» у VRoid широко открывает рот — ограничиваем.
      // С ростом симпатии улыбка становится чуть шире и теплее.
      const lk = this.loveK ?? 0;
      const cap = e === 'happy' ? 0.42 + 0.2 * lk : e === 'surprised' ? 0.6 : e === 'angry' ? 0.75 : 1;
      em.setValue(e, this.exprCurrent[e] * cap);
    }

    // Моргание (кроме моментов, когда глаза и так закрыты от улыбки).
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0 && this.blinkPhase === 0) this.blinkPhase = 0.001;
    let blink = 0;
    if (this.blinkPhase > 0) {
      this.blinkPhase += dt / (this.sleepy ? 0.28 : 0.16);
      blink = Math.sin(Math.min(this.blinkPhase, 1) * Math.PI);
      if (this.blinkPhase >= 1) {
        this.blinkPhase = 0;
        // Иногда моргает дважды подряд — как живой человек.
        // Ночью сонная — моргает чаще и медленнее.
        this.blinkTimer = Math.random() < 0.18 ? 0.12 : (2 + Math.random() * 4) * (this.sleepy ? 0.6 : 1);
      }
    }
    const eyesBusy = Math.max(this.exprCurrent.happy, this.exprCurrent.relaxed);
    this.eyesShutS = (this.eyesShutS ?? 0) + ((this.eyesShut ?? 0) - (this.eyesShutS ?? 0)) * (1 - Math.exp(-dt * 5));
    em.setValue('blink', Math.max(blink * (1 - eyesBusy), this.sleep, this.eyesShutS)); // спит / закрыла глаза
    // Подмигивание: один глаз плавно закрывается и открывается (~0.45 с).
    if (this.winkT > 0) {
      this.winkT = Math.max(0, this.winkT - dt);
      const k = Math.sin((1 - this.winkT / 0.45) * Math.PI);
      const name = this.winkSide === 'left' ? 'blinkLeft' : 'blinkRight';
      try { em.setValue(name, k); } catch { /* у модели нет отдельного глаза */ }
      if (this.winkT === 0) { try { em.setValue(name, 0); } catch { /* ignore */ } }
    }

    // Рот шевелится, пока она «говорит».
    this.talkTime -= dt;
    // Говорит — губы двигаются мягко и негромко (не «во весь рот»).
    const talkTarget = this.talkTime > 0 ? (0.5 + 0.5 * Math.sin(this.time * 13)) * (0.5 + 0.5 * Math.sin(this.time * 5.3)) * 0.32 : 0;
    this.mouthS = (this.mouthS ?? 0) + (talkTarget - (this.mouthS ?? 0)) * (1 - Math.exp(-dt * 18));
    const mouth = this.mouthS;
    // Пока ведёшь полосу — губы медленно приоткрываются (мягкое «о»), отпустил — плавно смыкаются.
    this.effortT = Math.max(0, (this.effortT ?? 0) - dt);
    const want = this.effortT > 0 ? 1 : 0;
    const rate = want > (this.effort ?? 0) ? 1.6 : 0.9; // открывается ~0.6 с, закрывается ~1.1 с
    this.effort = THREE.MathUtils.clamp((this.effort ?? 0) + Math.sign(want - (this.effort ?? 0)) * rate * dt, 0, 1);
    const ef = this.effort * this.effort * (3 - 2 * this.effort);
    const breathe = 0.04 * Math.sin(this.time * 1.7) * ef;
    em.setValue('aa', Math.max(mouth, ef * 0.32 + breathe));
    em.setValue('oh', ef * 0.22);
  }

  headScreenAnchor(out) {
    const head = this.vrm.humanoid.getRawBoneNode('head');
    head.getWorldPosition(out);
    out.y += 0.3 * this.scale;
    return out;
  }
}
