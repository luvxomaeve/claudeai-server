import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// Перенос анимаций Mixamo (.fbx) на скелет VRM.
// Подход тот же, что в примерах three-vrm: переводим повороты костей Mixamo
// из их исходной позы в нормализованную позу VRM.

const MIXAMO_TO_VRM = {
  Hips: 'hips', Spine: 'spine', Spine1: 'chest', Spine2: 'upperChest', Neck: 'neck', Head: 'head',
  LeftShoulder: 'leftShoulder', LeftArm: 'leftUpperArm', LeftForeArm: 'leftLowerArm', LeftHand: 'leftHand',
  LeftHandThumb1: 'leftThumbMetacarpal', LeftHandThumb2: 'leftThumbProximal', LeftHandThumb3: 'leftThumbDistal',
  LeftHandIndex1: 'leftIndexProximal', LeftHandIndex2: 'leftIndexIntermediate', LeftHandIndex3: 'leftIndexDistal',
  LeftHandMiddle1: 'leftMiddleProximal', LeftHandMiddle2: 'leftMiddleIntermediate', LeftHandMiddle3: 'leftMiddleDistal',
  LeftHandRing1: 'leftRingProximal', LeftHandRing2: 'leftRingIntermediate', LeftHandRing3: 'leftRingDistal',
  LeftHandPinky1: 'leftLittleProximal', LeftHandPinky2: 'leftLittleIntermediate', LeftHandPinky3: 'leftLittleDistal',
  RightShoulder: 'rightShoulder', RightArm: 'rightUpperArm', RightForeArm: 'rightLowerArm', RightHand: 'rightHand',
  RightHandThumb1: 'rightThumbMetacarpal', RightHandThumb2: 'rightThumbProximal', RightHandThumb3: 'rightThumbDistal',
  RightHandIndex1: 'rightIndexProximal', RightHandIndex2: 'rightIndexIntermediate', RightHandIndex3: 'rightIndexDistal',
  RightHandMiddle1: 'rightMiddleProximal', RightHandMiddle2: 'rightMiddleIntermediate', RightHandMiddle3: 'rightMiddleDistal',
  RightHandRing1: 'rightRingProximal', RightHandRing2: 'rightRingIntermediate', RightHandRing3: 'rightRingDistal',
  RightHandPinky1: 'rightLittleProximal', RightHandPinky2: 'rightLittleIntermediate', RightHandPinky3: 'rightLittleDistal',
  LeftUpLeg: 'leftUpperLeg', LeftLeg: 'leftLowerLeg', LeftFoot: 'leftFoot', LeftToeBase: 'leftToes',
  RightUpLeg: 'rightUpperLeg', RightLeg: 'rightLowerLeg', RightFoot: 'rightFoot', RightToeBase: 'rightToes',
};

const fbxLoader = new FBXLoader();

export function parseMixamo(buffer) {
  return fbxLoader.parse(buffer, '');
}

// Имя кости Mixamo без префикса («mixamorig:Hips», «mixamorigHips» → «Hips»).
const stripPrefix = (name) => name.replace(/^mixamorig\d*:?/, '');

export function mixamoClip(asset, vrm) {
  const clip = THREE.AnimationClip.findByName(asset.animations, 'mixamo.com') ?? asset.animations[0];
  if (!clip) throw new Error('В файле нет анимации');

  const nodes = new Map();
  asset.traverse((o) => { if (o.isBone || o.type === 'Bone' || o.isObject3D) nodes.set(o.name, o); });
  const find = (base) => {
    for (const [name, node] of nodes) if (stripPrefix(name) === base) return node;
    return null;
  };

  asset.updateMatrixWorld(true);
  // Высота таза в анимации: из исходной позы, а если там 0 (бывает в FBX
  // с отдельным узлом Armature) — из первого кадра трека позиции таза.
  const hipsNode = find('Hips');
  let motionHipsHeight = hipsNode ? hipsNode.position.y : 0;
  if (!(motionHipsHeight > 1e-4)) {
    const hipsTrack = clip.tracks.find((t) => /hips\.position$/i.test(stripPrefix(t.name)));
    motionHipsHeight = hipsTrack ? hipsTrack.values[1] : 0;
  }
  const vrmHips = vrm.humanoid.getNormalizedBoneNode('hips');
  const vrmHipsY = vrmHips.getWorldPosition(new THREE.Vector3()).y;
  const vrmRootY = vrm.scene.getWorldPosition(new THREE.Vector3()).y;
  const hipsScale = motionHipsHeight > 1e-4 ? Math.abs(vrmHipsY - vrmRootY) / motionHipsHeight : 0;
  const vrm0 = vrm.meta?.metaVersion === '0';

  const restInv = new THREE.Quaternion();
  const parentRest = new THREE.Quaternion();
  const q = new THREE.Quaternion();
  const tracks = [];

  for (const track of clip.tracks) {
    const [trackNode, prop] = track.name.split('.');
    const base = stripPrefix(trackNode);
    const vrmBone = MIXAMO_TO_VRM[base];
    const vrmNode = vrmBone && vrm.humanoid.getNormalizedBoneNode(vrmBone);
    const rigNode = nodes.get(trackNode) ?? find(base);
    if (!vrmNode || !rigNode) continue;

    rigNode.getWorldQuaternion(restInv).invert();
    rigNode.parent.getWorldQuaternion(parentRest);

    if (track instanceof THREE.QuaternionKeyframeTrack) {
      const values = track.values.slice();
      for (let i = 0; i < values.length; i += 4) {
        q.fromArray(values, i).premultiply(parentRest).multiply(restInv);
        q.toArray(values, i);
      }
      // У VRM 0.x оси X и Z зеркальные.
      const out = values.map((val, i) => (vrm0 && i % 2 === 0 ? -val : val));
      tracks.push(new THREE.QuaternionKeyframeTrack(`${vrmNode.name}.quaternion`, track.times, out));
    } else if (track instanceof THREE.VectorKeyframeTrack && prop === 'position' && vrmBone === 'hips' && hipsScale > 0) {
      const out = track.values.map((val, i) => (vrm0 && i % 3 !== 1 ? -val : val) * hipsScale);
      // Убираем уход по сцене (X/Z): вычитаем линейный дрейф от первого кадра к последнему,
      // чтобы она оставалась на месте, но покачивания бёдрами сохранились.
      const n = out.length / 3;
      const T = track.times[n - 1] || 1;
      for (const axis of [0, 2]) {
        const start = out[axis];
        const end = out[(n - 1) * 3 + axis];
        for (let k = 0; k < n; k++) out[k * 3 + axis] -= start + (end - start) * (track.times[k] / T);
      }
      tracks.push(new THREE.VectorKeyframeTrack(`${vrmNode.name}.position`, track.times, out));
    }
  }
  if (!tracks.length) throw new Error('Это не похоже на анимацию Mixamo');
  // Защита: битые значения ломают физику волос, такие треки не берём.
  const ok = tracks.filter((t) => t.values.every(Number.isFinite));
  if (!ok.length) throw new Error('Анимация повреждена');
  return new THREE.AnimationClip('mixamo', clip.duration, ok);
}
