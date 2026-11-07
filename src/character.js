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

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
// Огибающая движения: быстро вошли, подержали, плавно вышли.
function envelope(t, dur) {
  const p = t / dur;
  if (p <= 0 || p >= 1) return 0;
  if (p < 0.15) return easeInOut(p / 0.15);
  if (p > 0.7) return easeInOut((1 - p) / 0.3);
  return 1;
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

    this.lookTarget = new THREE.Object3D();
    if (vrm.lookAt) vrm.lookAt.target = this.lookTarget;

    this.bones = {};
    const names = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
      'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand'];
    for (const n of names) this.bones[n] = vrm.humanoid.getNormalizedBoneNode(n);

    vrm.humanoid.update();
    vrm.scene.updateMatrixWorld(true);
    const headPos = new THREE.Vector3();
    (vrm.humanoid.getRawBoneNode('head') ?? vrm.scene).getWorldPosition(headPos);
    this.headHeight = headPos.y;
    // Масштаб зон относительно «стандартной» модели с головой на 1.4 м.
    this.scale = this.headHeight / 1.4;

    this.zones = ZONE_DEFS
      .map((d) => ({ ...d, node: vrm.humanoid.getRawBoneNode(d.bone), center: new THREE.Vector3() }))
      .filter((z) => z.node);
    this.hipsBaseY = this.bones.hips?.position.y ?? 0;
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
    const durations = { tiltHead: 1.6, flinch: 1.0, raiseHand: 2.2, sway: 1.6, hop: 0.9, turnAway: 2.6 };
    this.motions = this.motions.filter((m) => m.name !== name);
    this.motions.push({ name, side, t: 0, dur: durations[name] ?? 1.5 });
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

    // Сбрасываем позу в базовую: руки опущены.
    for (const n in b) b[n]?.rotation.set(0, 0, 0);
    if (b.hips) b.hips.position.y = this.hipsBaseY;

    const pose = {
      spineX: 0, spineY: 0, spineZ: 0,
      headX: 0, headY: 0, headZ: 0,
      lUpperZ: -1.22, rUpperZ: 1.22,
      lUpperX: 0.08, rUpperX: 0.08,
      lLowerY: -0.25, rLowerY: 0.25,
      lLowerZ: 0, rLowerZ: 0,
      hipsY: 0, hipsZ: 0,
    };

    // Дыхание и лёгкое покачивание.
    const breath = Math.sin(t * 1.6);
    pose.spineX += breath * 0.015;
    pose.lUpperZ += breath * 0.02;
    pose.rUpperZ -= breath * 0.02;
    pose.hipsZ += Math.sin(t * 0.6) * 0.02;
    pose.spineZ -= Math.sin(t * 0.6) * 0.025;
    pose.headZ += Math.sin(t * 0.6 + 0.8) * 0.03;

    // Голова чуть поворачивается за пальцем/курсором.
    pose.headY += this.headLook.x * 0.35;
    pose.headX += -this.headLook.y * 0.2;

    // Пока гладят — голова клонится и прижимается к руке.
    pose.headZ += this.patAmount * 0.18 * Math.sin(t * 2.2);
    pose.headX += this.patAmount * 0.12;

    // Движения-реакции.
    for (const m of this.motions) {
      m.t += dt;
      const e = envelope(m.t, m.dur);
      const s = m.side === 'left' ? 1 : -1;
      switch (m.name) {
        case 'tiltHead':
          pose.headZ += 0.25 * e * s;
          pose.spineZ += 0.05 * e * s;
          break;
        case 'flinch':
          pose.spineX -= 0.18 * e;
          pose.headX -= 0.15 * e;
          // Руки вперёд и к груди — «прикрывается».
          pose.lUpperX -= 0.55 * e;
          pose.rUpperX -= 0.55 * e;
          pose.lUpperZ += 0.15 * e;
          pose.rUpperZ -= 0.15 * e;
          pose.lLowerY -= 2.0 * e;
          pose.rLowerY += 2.0 * e;
          break;
        case 'raiseHand':
          if (m.side === 'left') {
            pose.lUpperZ += (0.15 + 1.22) * e;
            pose.lLowerZ += (1.3 + Math.sin(m.t * 10) * 0.25) * e;
            pose.lLowerY += 0.25 * e;
          } else {
            pose.rUpperZ -= (0.15 + 1.22) * e;
            pose.rLowerZ -= (1.3 + Math.sin(m.t * 10) * 0.25) * e;
            pose.rLowerY -= 0.25 * e;
          }
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
        case 'turnAway':
          pose.spineY += 0.45 * e * s;
          pose.headY += 0.5 * e * s;
          pose.headX += 0.12 * e;
          pose.lUpperZ += 0.3 * e; // руки скрещены (примерно)
          pose.rUpperZ -= 0.3 * e;
          pose.lLowerY -= 1.9 * e;
          pose.rLowerY += 1.9 * e;
          break;
      }
    }
    this.motions = this.motions.filter((m) => m.t < m.dur);

    // Применяем позу к нормализованным костям.
    const spineBone = b.chest ?? b.spine;
    b.spine?.rotation.set(pose.spineX * 0.5, pose.spineY * 0.5, pose.spineZ * 0.5);
    spineBone?.rotation.set(pose.spineX * 0.5, pose.spineY * 0.5, pose.spineZ * 0.5);
    b.neck?.rotation.set(pose.headX * 0.4, pose.headY * 0.4, pose.headZ * 0.4);
    b.head?.rotation.set(pose.headX * 0.6, pose.headY * 0.6, pose.headZ * 0.6);
    b.leftUpperArm?.rotation.set(pose.lUpperX, 0, pose.lUpperZ);
    b.rightUpperArm?.rotation.set(pose.rUpperX, 0, pose.rUpperZ);
    b.leftLowerArm?.rotation.set(0, pose.lLowerY, pose.lLowerZ);
    b.rightLowerArm?.rotation.set(0, pose.rLowerY, pose.rLowerZ);
    if (b.hips) {
      b.hips.position.y = this.hipsBaseY + pose.hipsY;
      b.hips.rotation.z = pose.hipsZ;
    }

    this.updateExpressions(dt);
    this.vrm.update(dt);
    this.vrm.scene.updateMatrixWorld(true);
    this.updateZones();
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
