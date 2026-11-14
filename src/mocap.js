import * as THREE from 'three';

// Встроенная база движений из CMU Motion Capture Database (mocap.cs.cmu.edu):
// записи живых людей, свободны для любого использования. Сконвертированы
// tools/cmu-convert.mjs в повороты нормализованных костей VRM (T-поза = покой).

export const MOCAP = [
  // Записи ожидания: в «живом ожидании» берётся только сглаженное движение верха тела.
  { id: '137_23', name: 'Изящное ожидание', idle: true },
  { id: '137_28', name: 'Ожидание', idle: true },
  { id: '111_28', name: 'Стоит спокойно', idle: true },
  // Жесты — по кнопке, один раз.
  { id: '111_04', name: 'Реверанс' },
  { id: '111_02', name: 'Поклон' },
  { id: '111_37', name: 'Машет рукой' },
  { id: '111_32', name: 'Потягивается' },
  { id: '111_25', name: 'Пожимает плечами' },
];

const cache = new Map();

export async function loadMocap(id, base = window.WAIFU_MOCAP_BASE ?? 'mocap/') {
  if (!cache.has(id)) {
    cache.set(id, fetch(`${base}${id}.json`).then((r) => {
      if (!r.ok) throw new Error(`mocap ${id}: HTTP ${r.status}`);
      return r.json();
    }));
  }
  return cache.get(id);
}

// Клип для конкретной модели.
export function mocapClip(data, vrm) {
  const vrm0 = vrm.meta?.metaVersion === '0';
  const times = Float32Array.from({ length: data.frames }, (_, i) => i / data.fps);
  const tracks = [];
  for (const [bone, values] of Object.entries(data.bones)) {
    const node = vrm.humanoid.getNormalizedBoneNode(bone);
    if (!node) continue;
    // У VRM 0.x оси X и Z зеркальные.
    const v = vrm0 ? values.map((x, i) => (i % 4 === 0 || i % 4 === 2 ? -x : x)) : values;
    tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, v));
  }
  // Таз: смещение относительно покоя в долях роста таза; уход по сцене убираем.
  const hipsNode = vrm.humanoid.getNormalizedBoneNode('hips');
  if (hipsNode && data.hips?.length) {
    const rest = hipsNode.position.clone();
    const height = hipsNode.getWorldPosition(new THREE.Vector3()).y || 1;
    const n = data.frames;
    const h = data.hips;
    const drift = (axis, k) => h[axis] + (h[(n - 1) * 3 + axis] - h[axis]) * (k / Math.max(1, n - 1));
    const out = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const dx = (h[k * 3] - drift(0, k)) * height;
      const dy = h[k * 3 + 1] * height;
      const dz = (h[k * 3 + 2] - drift(2, k)) * height;
      out[k * 3] = rest.x + (vrm0 ? -dx : dx);
      out[k * 3 + 1] = rest.y + dy;
      out[k * 3 + 2] = rest.z + (vrm0 ? -dz : dz);
    }
    tracks.push(new THREE.VectorKeyframeTrack(`${hipsNode.name}.position`, times, out));
  }
  return new THREE.AnimationClip(data.name, data.frames / data.fps, tracks);
}

// Только верх тела (для живого ожидания): позвоночник, плечи, руки, шея, голова.
const UPPER = new Set(['spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand']);
export function mocapUpperClip(data, vrm) {
  // Сглаживаем (скользящее среднее ~0.5 с): убираем мелкую дрожь записи,
  // остаётся только спокойное живое движение.
  const R = 7;
  const bones = {};
  for (const [bone, v] of Object.entries(data.bones)) {
    if (!UPPER.has(bone)) continue;
    const n = v.length / 4;
    const out = new Array(v.length);
    for (let f = 0; f < n; f++) {
      let x = 0, y = 0, z = 0, w = 0;
      for (let k = -R; k <= R; k++) {
        const g = Math.min(n - 1, Math.max(0, f + k)) * 4;
        const sgn = v[g + 3] * v[f * 4 + 3] + v[g] * v[f * 4] + v[g + 1] * v[f * 4 + 1] + v[g + 2] * v[f * 4 + 2] < 0 ? -1 : 1;
        x += v[g] * sgn; y += v[g + 1] * sgn; z += v[g + 2] * sgn; w += v[g + 3] * sgn;
      }
      const len = Math.hypot(x, y, z, w) || 1;
      out[f * 4] = x / len; out[f * 4 + 1] = y / len; out[f * 4 + 2] = z / len; out[f * 4 + 3] = w / len;
    }
    bones[bone] = out;
  }
  return mocapClip({ ...data, bones, hips: [] }, vrm);
}
