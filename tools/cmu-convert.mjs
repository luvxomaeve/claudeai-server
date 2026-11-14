// Конвертер записей CMU Motion Capture (BVH, конвертация B. Hahne, первый кадр — T-поза)
// в компактный формат анимаций под скелет VRM (нормализованные кости, T-поза = покой).
//
// Данные CMU: «free for use in research and commercial projects worldwide»
// (mocap.cs.cmu.edu), конвертация BVH — без дополнительных ограничений.
//
// Запуск (нужен пакет three рядом):
//   node cmu-convert.mjs <папка с .bvh> <выходная папка> <id> [<id> ...]
//
// Формат результата (JSON): { name, fps, frames, bones: { vrmBone: [x,y,z,w, ...] }, hips: [dx,dy,dz, ...], hipsHeight }
// Повороты — в осях VRM 1.0 (для VRM 0.x игра зеркалит X/Z при загрузке).

import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';

const MAP = {
  Hips: 'hips', LowerBack: 'spine', Spine: 'chest', Spine1: 'upperChest', Neck: 'neck', Head: 'head',
  LeftShoulder: 'leftShoulder', LeftArm: 'leftUpperArm', LeftForeArm: 'leftLowerArm', LeftHand: 'leftHand',
  RightShoulder: 'rightShoulder', RightArm: 'rightUpperArm', RightForeArm: 'rightLowerArm', RightHand: 'rightHand',
  LeftUpLeg: 'leftUpperLeg', LeftLeg: 'leftLowerLeg', LeftFoot: 'leftFoot', LeftToeBase: 'leftToes',
  RightUpLeg: 'rightUpperLeg', RightLeg: 'rightLowerLeg', RightFoot: 'rightFoot', RightToeBase: 'rightToes',
};
// Родитель каждой кости в иерархии VRM.
const VRM_PARENT = {
  spine: 'hips', chest: 'spine', upperChest: 'chest', neck: 'upperChest', head: 'neck',
  leftShoulder: 'upperChest', leftUpperArm: 'leftShoulder', leftLowerArm: 'leftUpperArm', leftHand: 'leftLowerArm',
  rightShoulder: 'upperChest', rightUpperArm: 'rightShoulder', rightLowerArm: 'rightUpperArm', rightHand: 'rightLowerArm',
  leftUpperLeg: 'hips', leftLowerLeg: 'leftUpperLeg', leftFoot: 'leftLowerLeg', leftToes: 'leftFoot',
  rightUpperLeg: 'hips', rightLowerLeg: 'rightUpperLeg', rightFoot: 'rightLowerLeg', rightToes: 'rightFoot',
};

const OUT_FPS = 30;
const round = (v) => Math.round(v * 10000) / 10000;

function convert(file, id) {
  const { skeleton, clip } = new BVHLoader().parse(fs.readFileSync(file, 'utf8'));
  const root = skeleton.bones[0];
  const holder = new THREE.Object3D();
  holder.add(root);
  const mixer = new THREE.AnimationMixer(holder);
  const action = mixer.clipAction(clip);
  action.play();

  const byName = Object.fromEntries(skeleton.bones.map((b) => [b.name, b]));
  const vrmBones = Object.entries(MAP).filter(([bvh]) => byName[bvh]);

  const worldAt = (t) => {
    mixer.setTime(t);
    holder.updateMatrixWorld(true);
    const out = {};
    for (const [bvh, vrm] of vrmBones) {
      out[vrm] = byName[bvh].getWorldQuaternion(new THREE.Quaternion());
    }
    out._hipsPos = byName.Hips.getWorldPosition(new THREE.Vector3());
    return out;
  };

  // Первый кадр — T-поза: от неё считаем повороты.
  const rest = worldAt(0);
  const restInv = Object.fromEntries(Object.entries(rest).filter(([k]) => k !== '_hipsPos').map(([k, q]) => [k, q.clone().invert()]));
  const hipsHeight = rest._hipsPos.y;

  const start = Math.min(clip.duration, 0.5); // пропускаем T-позу и переход из неё
  const frames = Math.floor((clip.duration - start) * OUT_FPS);
  const bones = Object.fromEntries(vrmBones.map(([, vrm]) => [vrm, []]));
  const hips = [];

  for (let f = 0; f < frames; f++) {
    const w = worldAt(start + f / OUT_FPS);
    const delta = {};
    for (const [, vrm] of vrmBones) delta[vrm] = w[vrm].clone().multiply(restInv[vrm]);
    for (const [, vrm] of vrmBones) {
      const parent = VRM_PARENT[vrm];
      let local;
      if (!parent) local = delta[vrm];
      else local = delta[parent].clone().invert().multiply(delta[vrm]);
      if (local.w < 0) local.set(-local.x, -local.y, -local.z, -local.w);
      bones[vrm].push(round(local.x), round(local.y), round(local.z), round(local.w));
    }
    const d = w._hipsPos.clone().sub(rest._hipsPos);
    hips.push(round(d.x / hipsHeight), round(d.y / hipsHeight), round(d.z / hipsHeight));
  }
  // Разворачиваем запись лицом к камере: убираем средний поворот таза вокруг вертикали
  // (актёр при записи мог стоять боком), повороты и смещения таза поворачиваем обратно.
  let sx = 0;
  let sz = 0;
  const hq = bones.hips;
  const q = new THREE.Quaternion();
  const fwd = new THREE.Vector3();
  for (let f = 0; f < frames; f++) {
    q.fromArray(hq, f * 4);
    fwd.set(0, 0, 1).applyQuaternion(q);
    sx += fwd.x;
    sz += fwd.z;
  }
  const yaw = Math.atan2(sx, sz);
  const unYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
  const v = new THREE.Vector3();
  for (let f = 0; f < frames; f++) {
    q.fromArray(hq, f * 4).premultiply(unYaw);
    if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
    [hq[f * 4], hq[f * 4 + 1], hq[f * 4 + 2], hq[f * 4 + 3]] = [round(q.x), round(q.y), round(q.z), round(q.w)];
    v.fromArray(hips, f * 3).applyQuaternion(unYaw);
    [hips[f * 3], hips[f * 3 + 1], hips[f * 3 + 2]] = [round(v.x), round(v.y), round(v.z)];
  }

  return { name: id, fps: OUT_FPS, frames, bones, hips, hipsHeight: 1, yaw: round(yaw) };
}

const [, , inDir, outDir, ...ids] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
for (const id of ids) {
  const data = convert(path.join(inDir, `${id}.bvh`), id);
  const file = path.join(outDir, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify(data));
  console.log(id, data.frames, 'frames', (fs.statSync(file).size / 1024).toFixed(0), 'KB');
}
