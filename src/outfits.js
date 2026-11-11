import * as THREE from 'three';
import { VRMUtils } from '@pixiv/three-vrm';

// Одежда по частям: несколько .vrm одной и той же девушки (сделанных в VRoid в разных нарядах).
// Из каждого берём отдельные вещи — верх, низ, обувь, аксессуары, чулки/колготки (рисунок на коже) —
// и надеваем на неё в любых сочетаниях. Модели-доноры двигаются вместе с ней (копируем повороты
// костей каждый кадр), у юбок и бантиков работает своя физика. Видны только выбранные вещи.

export const PIECE_CATS = [
  { id: 'tops', name: 'Верх', re: /_Tops_/i },
  { id: 'bottoms', name: 'Низ', re: /_Bottoms_/i },
  { id: 'shoes', name: 'Обувь', re: /_Shoes_/i },
  { id: 'acc', name: 'Аксессуары', re: /_Accessory/i },
  { id: 'legs', name: 'Чулки / колготки', skin: true },
];
const SKIN_RE = /Body_00_SKIN/i;

function matName(mesh) {
  const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  return m?.name ?? '';
}

// Раскладываем меши модели по категориям одежды.
function indexVrm(vrm) {
  const pieces = {};
  const skins = [];
  vrm.scene.traverse((o) => {
    if (!o.isMesh) return;
    const n = matName(o);
    const cat = PIECE_CATS.find((c) => c.re?.test(n));
    if (cat) (pieces[cat.id] ??= []).push(o);
    if (SKIN_RE.test(n)) skins.push(o);
  });
  const skinMat = skins[0] ? (Array.isArray(skins[0].material) ? skins[0].material[0] : skins[0].material) : null;
  return { pieces, skins, skinMap: skinMat?.map ?? null };
}

// ---------- Ткань идёт за пальцем (для любой одежды, даже без «пружинок») ----------
// Вершины одежды рядом с точкой касания сдвигаются в шейдере: упруго, с затухающим
// покачиванием. Тело не трогаем — только материалы одежды. Одна пара uniform на все вещи.
const CLOTH_POKE = { pos: { value: new THREE.Vector3(0, -99, 0) }, dir: { value: new THREE.Vector3() }, r: { value: 0.13 }, sway: { value: new THREE.Vector3() }, time: { value: 0 } };
const swaySim = { x: new THREE.Vector3(), v: new THREE.Vector3(), prev: null };
const clothSim = { x: new THREE.Vector3(), v: new THREE.Vector3(), target: new THREE.Vector3(0, -99, 0) };
function installClothPoke(mesh) {
  for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
    if (!m || m.userData.clothPoke) continue;
    m.userData.clothPoke = true;
    // Обводка одежды: тонкая и нейтральная тёмная (без красных линий), одинаковая на всех вещах.
    if ('outlineWidthFactor' in m) {
      m.outlineWidthFactor *= 0.4;
      m.outlineColorFactor?.setRGB(0.1, 0.08, 0.13);
      if ('outlineLightingMixFactor' in m) m.outlineLightingMixFactor = 0.6;
    }
    const prevCompile = m.onBeforeCompile;
    m.onBeforeCompile = (shader, renderer) => {
      prevCompile?.call(m, shader, renderer);
      if (!shader.vertexShader.includes('#include <project_vertex>')) return;
      shader.uniforms.uPokePos = CLOTH_POKE.pos;
      shader.uniforms.uPokeDir = CLOTH_POKE.dir;
      shader.uniforms.uPokeR = CLOTH_POKE.r;
      shader.uniforms.uSway = CLOTH_POKE.sway;
      shader.uniforms.uClothT = CLOTH_POKE.time;
      shader.uniforms.uTuck = (m.userData.tuck ??= { value: 0 });
      shader.uniforms.uTuckY = (m.userData.tuckY ??= { value: 0 });
      shader.uniforms.uLift = (m.userData.lift ??= { value: 0 });
      shader.uniforms.uSquatC = SQUAT_FLEX;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n      transformed -= normalize( normal ) * ( ( aTuck + smoothstep( 0.03, 0.045, aTuck ) * 0.07 ) * uTuck * mix( 1.0, smoothstep( 0.034, 0.045, aTuck ), uTuckY ) );');
      shader.vertexShader = 'attribute float aTuck;\nattribute float aHem;\nuniform float uTuck;\nuniform float uTuckY;\nuniform float uLift;\nuniform float uSquatC;\nattribute float aDroop;\nuniform vec3 uSway;\nuniform float uClothT;\nuniform vec3 uPokePos;\nuniform vec3 uPokeDir;\nuniform float uPokeR;\n' + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      {
        vec4 pkW = modelMatrix * vec4( transformed, 1.0 );
        vec3 pkD = pkW.xyz - uPokePos;
        float pkK = exp( -dot( pkD, pkD ) / ( uPokeR * uPokeR ) );
        // подол: запаздывает за движением тела + лёгкая живая волна; у касания волна сильнее
        float hemW = aHem * aHem;
        vec3 wv = vec3( sin( uClothT * 2.1 + pkW.y * 15.0 + pkW.x * 7.0 ), 0.35 * sin( uClothT * 2.7 + pkW.x * 12.0 ), cos( uClothT * 1.7 + pkW.y * 12.0 + pkW.z * 7.0 ) );
        vec3 pkMove = uPokeDir * pkK + uSway * hemW + wv * ( hemW * ( 0.0026 + 0.25 * length( uSway ) + 0.2 * length( uPokeDir ) * pkK ) );
        // присела — задняя часть юбки не торчит коробом, а под своим весом свисает вниз (и не уходит под пол)
        float drp = 0.0; // свисание юбки в приседе выключено: выглядело хуже, чем без него
        pkMove.y -= drp * 0.17;
        pkMove.y += max( 0.0, 0.006 - ( pkW.y + pkMove.y ) ) * step( 0.0001, drp );
        // ткань не уходит «внутрь» тела и других слоёв: движение вглубь гасим, остаётся скольжение вдоль и наружу
        vec3 pkV = mat3( viewMatrix ) * pkMove;
        vec3 pkN = normalize( transformedNormal );
        pkV -= pkN * ( min( 0.0, dot( pkV, pkN ) ) * 0.9 );

        mvPosition = viewMatrix * pkW;
        mvPosition.xyz += pkV;
        // в приседе задняя часть юбки рисуется «поверх» тела — оно не проступает сквозь ткань пятнами
        mvPosition.xyz -= normalize( mvPosition.xyz ) * ( uLift + aDroop * uSquatC * 0.04 );
        gl_Position = projectionMatrix * mvPosition;
      }`);
    };
    const prevKey = m.customProgramCacheKey?.bind(m);
    m.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|clothPoke`;
    m.needsUpdate = true;
  }
}

// «Заправить» низ под чужой верх: часть низа, что сидит на торсе (высокая талия, платье-комбинезон),
// чуть утягивается внутрь, чтобы не пробивалась сквозь верх от другого наряда.
const TUCK_BONES = { spine: 0.022, chest: 0.045, upperChest: 0.05, neck: 0.05, leftShoulder: 0.05, rightShoulder: 0.05, leftUpperArm: 0.05, rightUpperArm: 0.05 };
function installTuck(vrm, mesh) {
  const g = mesh.geometry;
  if (!mesh.isSkinnedMesh || g.getAttribute('aTuck') || !g.getAttribute('skinIndex')) return;
  const amount = new Map();
  for (const [name, a] of Object.entries(TUCK_BONES)) {
    const node = vrm.humanoid?.getRawBoneNode(name);
    const i = node ? mesh.skeleton.bones.indexOf(node) : -1;
    if (i >= 0) amount.set(i, a);
  }
  const si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
  const arr = new Float32Array(si.count);
  for (let v = 0; v < si.count; v++) {
    let t = 0;
    for (let k = 0; k < 4; k++) t += (amount.get(si.getComponent(v, k)) ?? 0) * sw.getComponent(v, k);
    arr[v] = t;
  }
  g.setAttribute('aTuck', new THREE.BufferAttribute(arr, 1));
}
// Вес «подола»: 0 у пояса/ворота, 1 у нижнего края вещи (по исходной позе).
function installHem(mesh, from) {
  const g = mesh.geometry, pos = g.getAttribute('position');
  if (!pos || g.getAttribute('aHem')) return;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y < lo) lo = y; if (y > hi) hi = y; }
  const arr = new Float32Array(pos.count), span = Math.max(1e-4, (hi - lo) * (1 - from));
  for (let i = 0; i < pos.count; i++) arr[i] = Math.min(1, Math.max(0, 1 - (pos.getY(i) - lo) / span));
  g.setAttribute('aHem', new THREE.BufferAttribute(arr, 1));
}
// Какая часть низа «сзади» (за тазом): она в приседе свисает. 0 — спереди, 1 — сзади.
function installDroop(vrm, mesh) {
  const g = mesh.geometry, pos = g.getAttribute('position');
  if (!mesh.isSkinnedMesh || !pos || g.getAttribute('aDroop')) return;
  const bind = (name) => bindBone(vrm, mesh, name);
  const H = bind('hips'), foot = bind('leftFoot'), toe = bind('leftToes');
  if (!H || !foot) return;
  const back = Math.sign(foot.z - (toe?.z ?? foot.z + 0.1)) || -1;
  const arr = new Float32Array(pos.count), v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix);
    arr[i] = THREE.MathUtils.smoothstep((v.z - H.z) * back, -0.01, 0.07);
  }
  g.setAttribute('aDroop', new THREE.BufferAttribute(arr, 1));
}
function installHems(pieces) {
  for (const m of pieces.bottoms ?? []) installHem(m, 0.12);
  for (const m of pieces.tops ?? []) installHem(m, 0.55);
}
// Тело донора — только «заплатка» под одеждой: без чёрной обводки и чуть меньше, чтобы не торчало.
function patchDonorSkin(mesh) {
  for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
    if (!m) continue;
    m.polygonOffset = true; m.polygonOffsetFactor = 2; m.polygonOffsetUnits = 2;
    if (m.isOutline) { m.visible = false; continue; }
    if (m.userData.shrunk) continue;
    m.userData.shrunk = true;
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (shader, renderer) => {
      prev?.call(m, shader, renderer);
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n      transformed -= normalize( normal ) * 0.005;');
    };
    const pk = m.customProgramCacheKey?.bind(m);
    m.customProgramCacheKey = () => `${pk ? pk() : ''}|shrunk`;
    m.needsUpdate = true;
  }
}
function setLift(mesh, v) {
  for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (m) (m.userData.lift ??= { value: 0 }).value = v;
}
function setTuck(mesh, on, y = 0) {
  for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
    if (!m) continue;
    (m.userData.tuck ??= { value: 0 }).value = on ? 1 : 0;
    (m.userData.tuckY ??= { value: 0 }).value = y;
  }
}

// Где кость была в исходной позе, в координатах сетки. Вещь может быть привязана к своим копиям костей
// (другой объект с тем же именем) — тогда ищем по имени.
function bindBone(vrm, mesh, name) {
  const node = vrm.humanoid?.getRawBoneNode(name);
  if (!node) return null;
  const from = (m) => {
    const bones = m.skeleton?.bones ?? [];
    let i = bones.indexOf(node);
    if (i < 0) i = bones.findIndex((b) => b.name === node.name);
    return i >= 0 && m.skeleton.boneInverses[i] ? new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(m.skeleton.boneInverses[i]).invert()) : null;
  };
  let p = from(mesh);
  // У вещи в скелете только часть костей (например, без стоп) — берём положение из любой другой сетки
  // той же модели: исходная поза у них общая.
  if (!p) vrm.scene.traverse((o) => { if (!p && o.isSkinnedMesh && o !== mesh) p = from(o); });
  return p;
}
// В глубоком приседе сетка тела между ног собирается в торчащий бугорок (кости бёдер разошлись,
// а «дно» таза осталось на месте). Чем сильнее согнуты ноги, тем больше утягиваем это место вверх, в таз.
export const SQUAT_FLEX = { value: 0 };
function installCrotchFix(vrm, mesh) {
  const g = mesh.geometry, pos = g.getAttribute('position');
  if (!mesh.isSkinnedMesh || !pos || g.getAttribute('aCrotch')) return;
  const bind = (name) => bindBone(vrm, mesh, name);
  const L = bind('leftUpperLeg'), R = bind('rightUpperLeg'), K = bind('leftLowerLeg');
  if (!L || !R || !K) return;
  const k0 = Math.max(0.25, L.y - K.y) / 0.4;
  const C = L.clone().add(R).multiplyScalar(0.5); C.y -= 0.085 * k0;
  const sigma = 0.075 * k0, lift = 0.12 * k0;
  const arr = new Float32Array(pos.count), v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix);
    const d = v.distanceTo(C) / sigma;
    arr[i] = d < 2.5 ? Math.exp(-d * d) * lift : 0;
  }
  g.setAttribute('aCrotch', new THREE.BufferAttribute(arr, 1));
  for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
    if (!m || m.userData.crotchFix) continue;
    m.userData.crotchFix = true;
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (shader, renderer) => {
      prev?.call(m, shader, renderer);
      shader.uniforms.uSquat = SQUAT_FLEX;
      shader.vertexShader = 'attribute float aCrotch;\nuniform float uSquat;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n      transformed.y += aCrotch * uSquat;');
    };
    const pk = m.customProgramCacheKey?.bind(m);
    m.customProgramCacheKey = () => `${pk ? pk() : ''}|crotchFix`;
    m.needsUpdate = true;
  }
}

// Сохранение объёма при сгибе ноги. В приседе сетка у тазобедренного сустава «схлопывается», и бёдра сзади
// становятся плоскими, хотя стоя у модели там нормальный объём. Чем сильнее согнута нога, тем больше
// возвращаем потерянное — ровно до формы, какая у неё стоя (HIP_FLEX задаётся в character.js).
// Саму модель не меняем: стоя добавка равна нулю. Ткань низа идёт вместе с телом, чтобы не прорезалась.
function installHipKeep(vrm, mesh, cloth) {
  const g = mesh.geometry, pos = g.getAttribute('position'), nor = g.getAttribute('normal');
  if (!mesh.isSkinnedMesh || !pos || !nor || g.getAttribute('hipBulge')) return;
  const bind = (name) => bindBone(vrm, mesh, name);
  const L = bind('leftUpperLeg'), R = bind('rightUpperLeg'), K = bind('leftLowerLeg'), foot = bind('leftFoot'), toe = bind('leftToes');
  if (!L || !R || !K || !foot) return;
  const k0 = Math.max(0.25, L.y - K.y) / 0.4;
  const back = new THREE.Vector3(0, 0, Math.sign(foot.z - (toe?.z ?? foot.z + 0.1)) || -1);
  const centers = [L, R].map((c) => c.clone().addScaledVector(back, 0.07 * k0).add(new THREE.Vector3(0, -0.02 * k0, 0)));
  const sigma = 0.095 * k0, gain = cloth ? 1.15 : 1;
  const arr = new Float32Array(pos.count * 2), v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix);
    n.fromBufferAttribute(nor, i);
    // Тело: только то, что смотрит назад. Ткань: вся задняя половина и шире — она висит дальше от тела
    // и должна отойти не меньше, чем оно, иначе тело проглянет сквозь юбку.
    const facing = cloth ? THREE.MathUtils.smoothstep((v.z - L.z) * back.z, -0.04 * k0, 0.03 * k0) : Math.min(1, Math.max(0, n.dot(back) * 0.85 + 0.3));
    if (facing <= 0) continue;
    const waist = 1 - THREE.MathUtils.smoothstep(v.y, L.y - 0.02 * k0, L.y + 0.07 * k0); // выше сустава сходит на нет
    const sg = cloth ? sigma * 1.3 : sigma;
    for (let c = 0; c < 2; c++) { const d = v.distanceTo(centers[c]) / sg; arr[i * 2 + c] = d < 2.5 ? Math.exp(-d * d) * facing * gain * waist : 0; }
  }
  g.setAttribute('hipBulge', new THREE.BufferAttribute(arr, 2));
  for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
    patchBulge(m);
  }
}

// Дорисовать кожу там, где её в текстуре нет (под снятым верхом, под чулками): цвет берём не «средний
// по телу», а от ближайшей настоящей кожи — он плавно растекается от её краёв, поэтому совпадает по тону
// и не оставляет прямоугольных заплаток. Считаем на уменьшенной копии (быстро), красим в полном размере.
function skinFill(d, w, h, need) {
  const L = 256, n = L * L;
  const r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n), c = new Float32Array(n);
  const isSkin = (i) => d[i + 3] >= 250 && d[i] > d[i + 1] && d[i + 1] >= d[i + 2] && d[i] - d[i + 2] > 18 && d[i] > 150;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    const i = (y * w + x) * 4;
    if (need[i >> 2] || !isSkin(i)) continue;
    // Образец — только чистая кожа: рядом с краем ткани (чулка, майки) она затемнена и даёт полосы.
    const E = 10;
    if (x < E || y < E || x >= w - E || y >= h - E) continue;
    if (!isSkin(i - E * 4) || !isSkin(i + E * 4) || !isSkin(i - E * w * 4) || !isSkin(i + E * w * 4)
      || need[(i >> 2) - E] || need[(i >> 2) + E] || need[(i >> 2) - E * w] || need[(i >> 2) + E * w]) continue;
    const k = ((y * L / h) | 0) * L + ((x * L / w) | 0);
    r[k] += d[i]; g[k] += d[i + 1]; b[k] += d[i + 2]; c[k]++;
  }
  let ok = new Uint8Array(n), any = false;
  for (let k = 0; k < n; k++) if (c[k] >= 2) { r[k] /= c[k]; g[k] /= c[k]; b[k] /= c[k]; ok[k] = 1; any = true; } else { r[k] = g[k] = b[k] = 0; }
  if (!any) return;
  const src = ok.slice(); // настоящая кожа — её не трогаем
  for (let it = 0; it < 300; it++) {
    const nx = ok.slice();
    let left = 0;
    for (let y = 0; y < L; y++) for (let x = 0; x < L; x++) {
      const k = y * L + x;
      if (ok[k]) continue;
      let sr = 0, sg = 0, sb = 0, sn = 0;
      if (x > 0 && ok[k - 1]) { sr += r[k - 1]; sg += g[k - 1]; sb += b[k - 1]; sn++; }
      if (x < L - 1 && ok[k + 1]) { sr += r[k + 1]; sg += g[k + 1]; sb += b[k + 1]; sn++; }
      if (y > 0 && ok[k - L]) { sr += r[k - L]; sg += g[k - L]; sb += b[k - L]; sn++; }
      if (y < L - 1 && ok[k + L]) { sr += r[k + L]; sg += g[k + L]; sb += b[k + L]; sn++; }
      if (sn) { r[k] = sr / sn; g[k] = sg / sn; b[k] = sb / sn; nx[k] = 1; } else left++;
    }
    ok = nx;
    if (!left) break;
  }
  // Сглаживаем дорисованное (несколько проходов), настоящую кожу оставляем как есть.
  for (let it = 0; it < 90; it++) for (let y = 1; y < L - 1; y++) for (let x = 1; x < L - 1; x++) {
    const k = y * L + x;
    if (src[k]) continue;
    r[k] = (r[k - 1] + r[k + 1] + r[k - L] + r[k + L]) / 4; g[k] = (g[k - 1] + g[k + 1] + g[k - L] + g[k + L]) / 4; b[k] = (b[k - 1] + b[k + 1] + b[k - L] + b[k + L]) / 4;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    if (!need[p]) continue;
    const fx = Math.min(L - 1.001, Math.max(0, (x + 0.5) * L / w - 0.5)), fy = Math.min(L - 1.001, Math.max(0, (y + 0.5) * L / h - 0.5));
    const x0 = fx | 0, y0 = fy | 0, tx = fx - x0, ty = fy - y0, k = y0 * L + x0;
    const mix = (a) => (a[k] * (1 - tx) + a[k + 1] * tx) * (1 - ty) + (a[k + L] * (1 - tx) + a[k + L + 1] * tx) * ty;
    const i = p * 4;
    d[i] = mix(r); d[i + 1] = mix(g); d[i + 2] = mix(b); d[i + 3] = 255;
  }
}

// ---------- Облегающая юбка: собираем сетку сами ----------
// Трубка по форме её тела: на каждой высоте берём контур тела (выпуклую оболочку — она перекрывает
// промежуток между ног) и чуть отступаем наружу. Привязка: верх — к тазу, низ — к бёдрам, поэтому
// в приседе и при шаге юбка тянется за ногами, как эластичная ткань.
function hull2d(pts) {
  const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of P.slice().reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function buildTightSkirt(vrm, skins, clothMat) {
  const body = skins.find((m) => m.isSkinnedMesh);
  if (!body) return null;
  const B = (n) => bindBone(vrm, body, n);
  const hipJ = B('leftUpperLeg'), hipR = B('rightUpperLeg'), knee = B('leftLowerLeg'), hips = B('hips');
  if (!hipJ || !hipR || !knee || !hips) return null;
  const bones = body.skeleton.bones;
  const bi = (name) => { const node = vrm.humanoid.getRawBoneNode(name); let i = bones.indexOf(node); if (i < 0) i = bones.findIndex((b) => b.name === node?.name); return i; };
  const iH = bi('hips'), iL = bi('leftUpperLeg'), iR = bi('rightUpperLeg');
  if (iH < 0 || iL < 0 || iR < 0) return null;
  const leg = hipJ.y - knee.y;
  const top = hipJ.y + leg * 0.42, hem = hipJ.y - leg * 0.5; // от талии до середины бедра
  const cx = (hipJ.x + hipR.x) / 2, cz = hips.z;
  // Все точки тела в исходной позе (без рук — они далеко в стороны).
  const pts = [], v = new THREE.Vector3();
  for (const m of skins) {
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.bindMatrix);
      if (v.y > hem - 0.04 && v.y < top + 0.04 && Math.abs(v.x - cx) < 0.32) pts.push([v.x, v.y, v.z]);
    }
  }
  if (pts.length < 50) return null;
  const RINGS = 12, SEG = 40, margin = 0.011;
  const positions = [], skinI = [], skinW = [], uvs = [], hemW = [];
  const sgn = Math.sign(hipJ.x - cx) || 1;
  let prevR = null;
  for (let r = 0; r <= RINGS; r++) {
    const y = top + (hem - top) * (r / RINGS);
    const band = pts.filter((p) => Math.abs(p[1] - y) < 0.022).map((p) => [p[0], p[2]]);
    const H = band.length >= 3 ? hull2d(band) : null;
    const radii = [];
    for (let k = 0; k < SEG; k++) {
      const a = (k / SEG) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
      let best = 0;
      if (H) for (let e = 0; e < H.length; e++) {
        const p = H[e], q = H[(e + 1) % H.length];
        const ex = q[0] - p[0], ez = q[1] - p[1], den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((p[0] - cx) * ez - (p[1] - cz) * ex) / den, u = ((p[0] - cx) * dz - (p[1] - cz) * dx) / den;
        if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6) best = Math.max(best, t);
      }
      radii.push(best || (prevR ? prevR[k] : 0.12));
    }
    // Юбка книзу не сужается резко: каждое кольцо не уже 96% предыдущего (прямой силуэт, а не «штаны»).
    if (prevR) for (let k = 0; k < SEG; k++) radii[k] = Math.max(radii[k], prevR[k] * 0.96);
    prevR = radii;
    const below = THREE.MathUtils.clamp((hipJ.y + 0.03 - y) / (hipJ.y + 0.03 - hem), 0, 1);
    const wLeg = 0.92 * Math.pow(below, 0.8);
    for (let k = 0; k <= SEG; k++) {
      const kk = k % SEG, a = (kk / SEG) * Math.PI * 2;
      const rr = radii[kk] + margin;
      const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      positions.push(x, y, z);
      const sL = THREE.MathUtils.smoothstep((x - cx) * sgn, -0.035, 0.035);
      skinI.push(iH, iL, iR, 0);
      skinW.push(1 - wLeg, wLeg * sL, wLeg * (1 - sL), 0);
      uvs.push(k / SEG, r / RINGS);
      hemW.push(Math.pow(r / RINGS, 1.5));
    }
  }
  const idx = [];
  for (let r = 0; r < RINGS; r++) for (let k = 0; k < SEG; k++) {
    const a = r * (SEG + 1) + k, b2 = a + 1, c = a + SEG + 1, d = c + 1;
    idx.push(a, c, b2, b2, c, d);
  }
  const g = new THREE.BufferGeometry();
  // Координаты — в исходной позе (как у тела); в систему сетки возвращаем обратной матрицей привязки.
  const inv = body.bindMatrix.clone().invert();
  const pa = new Float32Array(positions);
  for (let i = 0; i < pa.length; i += 3) { v.set(pa[i], pa[i + 1], pa[i + 2]).applyMatrix4(inv); pa[i] = v.x; pa[i + 1] = v.y; pa[i + 2] = v.z; }
  g.setAttribute('position', new THREE.BufferAttribute(pa, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinI, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinW, 4));
  g.setAttribute('aHem', new THREE.BufferAttribute(new Float32Array(hemW), 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Шов по кругу: первая и последняя точки кольца совпадают — усредняем их нормали, чтобы не было полосы.
  const nor = g.attributes.normal;
  for (let r = 0; r <= RINGS; r++) {
    const a = r * (SEG + 1), b2 = a + SEG;
    const nx = nor.getX(a) + nor.getX(b2), ny = nor.getY(a) + nor.getY(b2), nz = nor.getZ(a) + nor.getZ(b2), l = Math.hypot(nx, ny, nz) || 1;
    nor.setXYZ(a, nx / l, ny / l, nz / l); nor.setXYZ(b2, nx / l, ny / l, nz / l);
  }
  // Проверка, что сетка вывернута наружу: если нормаль смотрит к оси — переворачиваем треугольники.
  v.fromBufferAttribute(g.attributes.position, 0).applyMatrix4(body.bindMatrix);
  const n0 = new THREE.Vector3().fromBufferAttribute(nor, 0);
  if (n0.x * (v.x - cx) + n0.z * (v.z - cz) < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
  const mat = clothMat.clone();
  mat.name = 'Gen_Bottoms_TightSkirt';
  mat.map = null;
  if ('shadeMultiplyTexture' in mat) mat.shadeMultiplyTexture = null;
  if ('matcapTexture' in mat) mat.matcapTexture = null;
  if ('normalMap' in mat) mat.normalMap = null;
  mat.side = THREE.DoubleSide;
  mat.transparent = false;
  mat.alphaTest = 0;
  mat.userData = {};
  mat.needsUpdate = true;
  const mesh = new THREE.SkinnedMesh(g, mat);
  mesh.name = 'GenTightSkirt';
  mesh.frustumCulled = false;
  mesh.bind(body.skeleton, body.bindMatrix);
  body.parent.add(mesh);
  mesh.visible = false;
  return mesh;
}

export class PieceWardrobe {
  constructor(scene) {
    this.scene = scene;
    this.base = null; // { vrm, pieces, skins, skinMap }
    this.sources = new Map(); // id -> { vrm, pieces, skinMap, active }
    this.paints = new Map(); // id «нарисованной» облегающей вещи → { tops|bottoms|legs: вид ткани }
  }

  attachBase(vrm) {
    this.base = { vrm, ...indexVrm(vrm) };
    for (const list of Object.values(this.base.pieces)) list.forEach(installClothPoke);
    for (const m of this.base.pieces.bottoms ?? []) installTuck(vrm, m);
    installHems(this.base.pieces);
    for (const m of this.base.pieces.bottoms ?? []) installDroop(vrm, m);
    for (const m of this.base.skins) { installCrotchFix(vrm, m); installHipKeep(vrm, m, false); }
    for (const m of this.base.pieces.bottoms ?? []) installHipKeep(vrm, m, true);
    // Облегающая юбка — своя сетка по её телу (материал берём у любой её вещи, без рисунка).
    try {
      const donor = [...(this.base.pieces.bottoms ?? []), ...(this.base.pieces.tops ?? []), ...this.base.skins][0];
      const dm = donor && [].concat(donor.material).find((m) => m && !m.isOutline);
      this.tightSkirt = dm ? buildTightSkirt(vrm, this.base.skins, dm) : null;
      if (this.tightSkirt) { installClothPoke(this.tightSkirt); installDroop(vrm, this.tightSkirt); installHipKeep(vrm, this.tightSkirt, true); setLift(this.tightSkirt, 0.014); }
    } catch (e) { console.warn('tight skirt', e); this.tightSkirt = null; }
  }

  // Палец ведёт ткань: point — где касание (мир), dir — куда ведут (мир), power — сила толчка.
  clothPush(point, dir, power = 1, scale = 1) {
    CLOTH_POKE.r.value = 0.13 * scale;
    // Точка идёт за пальцем; далеко перескочил (и ткань уже успокоилась) — начинаем с новой точки.
    if (clothSim.target.distanceTo(point) > 0.25 * scale && clothSim.x.length() < 0.004) clothSim.target.copy(point);
    else clothSim.target.lerp(point, 0.6);
    clothSim.v.addScaledVector(dir, 0.22 * power * scale);
    if (clothSim.v.length() > 0.45 * scale) clothSim.v.setLength(0.45 * scale);
  }

  updateCloth(dt) {
    const h = Math.min(dt, 0.033);
    // Пружина с затуханием: ткань уходит за пальцем и пару раз качнётся обратно.
    clothSim.v.addScaledVector(clothSim.x, -150 * h).multiplyScalar(Math.exp(-8.5 * h));
    clothSim.x.addScaledVector(clothSim.v, h);
    const lim = 0.032 * (CLOTH_POKE.r.value / 0.13);
    if (clothSim.x.length() > lim) clothSim.x.setLength(lim);
    CLOTH_POKE.pos.value.copy(clothSim.target);
    CLOTH_POKE.dir.value.copy(clothSim.x);
    // Тело двинулось — подолы запаздывают и качаются следом.
    CLOTH_POKE.time.value += h;
    const hips = this.base?.vrm.humanoid?.getRawBoneNode('hips');
    if (hips) {
      const p = hips.getWorldPosition(new THREE.Vector3());
      if (swaySim.prev) {
        const d = p.clone().sub(swaySim.prev);
        if (d.length() < 0.2) swaySim.v.addScaledVector(d, -7);
      }
      (swaySim.prev ??= new THREE.Vector3()).copy(p);
    }
    swaySim.v.addScaledVector(swaySim.x, -70 * h).multiplyScalar(Math.exp(-4.2 * h));
    swaySim.x.addScaledVector(swaySim.v, h);
    if (swaySim.x.length() > 0.022) swaySim.x.setLength(0.022);
    CLOTH_POKE.sway.value.copy(swaySim.x);
  }

  // Вещи с другой девушки: у неё другие пропорции (длина рук, ног, шеи). Подгоняем скелет
  // донора под текущую девушку — иначе его тело и одежда «съезжают» (двойные руки, ноги).
  fitToBase(vrm) {
    if (!this.base) return;
    const bh = this.base.vrm.humanoid;
    const h = vrm.humanoid;
    let moved = false;
    for (const name of Object.keys(bh.humanBones)) {
      if (name === 'hips') continue; // таз двигается вместе с её тазом каждый кадр
      const a = bh.getRawBoneNode(name);
      const b = h.getRawBoneNode(name);
      if (!a || !b) continue;
      if (a.position.distanceToSquared(b.position) > 1e-10) { b.position.copy(a.position); moved = true; }
    }
    if (moved) {
      vrm.scene.updateMatrixWorld(true);
      vrm.springBoneManager?.setInitState?.();
      vrm.springBoneManager?.reset?.();
    }
  }

  hasSource(id) { return id === 'base' || this.sources.has(id) || this.paints.has(id); }

  // ---------- «Нарисованные» облегающие вещи: лосины и кофточка ----------
  // Это не отдельная сетка, а плотная ткань, нарисованная прямо по телу (как у VRoid колготки и майка):
  // сидит точно по фигуре в любой позе и ничего не прорезает. Ткань непрозрачная.
  paintTris(kind) {
    this.paintCache ??= {};
    if (this.paintCache[kind]) return this.paintCache[kind];
    const fast = [], slow = [];
    for (const mesh of this.base.skins) {
      const g = mesh.geometry, pos = g.attributes.position, uv = g.attributes.uv;
      if (!uv) continue;
      const B = (n) => bindBone(this.base.vrm, mesh, n);
      const hipJ = B('leftUpperLeg'), knee = B('leftLowerLeg'), foot = B('leftFoot'), neck = B('neck'), hand = B('leftHand'), hips = B('hips');
      const upArm = B('leftUpperArm'), elbow = B('leftLowerArm');
      if (!hipJ || !knee || !foot || !neck || !hand || !hips || !upArm || !elbow) continue;
      const leg = hipJ.y - knee.y;
      const waist = hipJ.y + leg * 0.42; // пояс лосин — на талии
      const reach = Math.abs(hand.x - hips.x) - 0.012; // рукав — до запястья
      // Точка тела (в исходной позе) под тканью?
      const ux = Math.abs(upArm.x - hips.x), ex = Math.abs(elbow.x - hips.x);
      const shortSleeve = ux + (ex - ux) * 0.5; // короткий рукав — до середины плеча
      const toe = B('leftToes');
      const front = -(Math.sign(foot.z - (toe?.z ?? foot.z + 0.1)) || -1); // куда смотрит грудь (по оси z)
      const cx = hips.x, ax = (x) => Math.abs(x - cx);
      const hem = hipJ.y + leg * 0.3, cropHem = hipJ.y + leg * 0.5;
      // Поло: вырез-уголок спереди и широкий отложной воротник.
      const vBottom = neck.y - 0.085;
      const vOpen = (x, y, z) => (z - hips.z) * front > 0.015 && y > vBottom && ax(x) < (y - vBottom) * 0.55;
      // Вырез горловины — круглый (по расстоянию от основания шеи), а не срез по прямой: ложится ровно.
      const nk = (x, y, z) => Math.hypot(x - neck.x, y - (neck.y + 0.015), z - neck.z);
      const armhole = (x, y) => ax(x) < ux + 0.012 || y < upArm.y - 0.05; // без рукава: до плечевого сустава, подмышка закрыта
      // Верх: низ (hem), рукав (sl: предел по руке или null — без рукавов), радиус горловины (r).
      const TOPS = {
        top: { hem, sl: reach, r: 0.052 }, longcrop: { hem: cropHem, sl: reach, r: 0.052 },
        crop: { hem: cropHem, sl: shortSleeve, r: 0.074 }, tee: { hem, sl: shortSleeve, r: 0.07 },
        tank: { hem: cropHem, sl: null, r: 0.082 }, polo: { hem, sl: shortSleeve, r: 0 },
      };
      // Низ: верхний край — талия, нижний (lo).
      const BOTS = { leggings: foot.y + 0.03, capri: knee.y - (knee.y - foot.y) * 0.5, shorts: hipJ.y - leg * 0.4, minishorts: hipJ.y - leg * 0.26 };
      const [base, trim] = kind.split(':');
      const T = TOPS[base], lo = BOTS[base];
      const TW = 0.011; // ширина канта (манжета, ворот, пояс, низ)
      let inside;
      if (T) {
        const body = (x, y, z) => y > T.hem && y < neck.y + 0.03 && (T.sl == null ? armhole(x, y) : ax(x) < T.sl) && (base === 'polo' ? !vOpen(x, y, z) : nk(x, y, z) > T.r);
        inside = trim
          ? (x, y, z) => body(x, y, z) && (y < T.hem + TW || (T.sl != null && ax(x) > T.sl - TW) || (base !== 'polo' && nk(x, y, z) < T.r + TW))
          : body;
      } else if (lo != null) {
        const body = (x, y) => y < waist && y > lo;
        inside = trim ? (x, y) => body(x, y) && (y > waist - TW * 1.6 || y < lo + TW) : body;
      } else inside = {
        polocollar: (x, y, z) => y < neck.y + 0.03 && !vOpen(x, y, z)
          && (((z - hips.z) * front > 0.0 && y > vBottom - 0.012 && ax(x) < (y - vBottom) * 0.55 + 0.05) || (y > neck.y - 0.022 && ax(x) < 0.085)),
        upper: (x, y) => y > hem, // всё выше пояса (для заливки кожи под снятым верхом)
        legsall: (x, y) => y < hipJ.y - leg * 0.26, // ноги ниже белья (для «без чулок»)
      }[kind];
      const v = new THREE.Vector3(), idx = g.index, n = idx ? idx.count : pos.count;
      const id = (k) => (idx ? idx.getX(k) : k);
      for (let t = 0; t < n; t += 3) {
        const q = [id(t), id(t + 1), id(t + 2)];
        const P = q.map((i) => v.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix).clone());
        const ins = P.map((p) => inside(p.x, p.y, p.z));
        const cnt = ins.filter(Boolean).length;
        // Треугольник мог перешагнуть границу целиком мимо вершин (редко) — такие тоже проверяем по точкам.
        if (!cnt && !inside((P[0].x + P[1].x + P[2].x) / 3, (P[0].y + P[1].y + P[2].y) / 3, (P[0].z + P[1].z + P[2].z) / 3)) continue;
        const U = [uv.getX(q[0]), uv.getY(q[0]), uv.getX(q[1]), uv.getY(q[1]), uv.getX(q[2]), uv.getY(q[2])];
        if (cnt === 3) fast.push(...U);
        else slow.push({ U, P: [P[0].x, P[0].y, P[1].x, P[1].y, P[2].x, P[2].y], Z: [P[0].z, P[1].z, P[2].z], inside }); // край ткани — ровно по линии, а не по треугольникам
      }
    }
    return (this.paintCache[kind] = { fast, slow });
  }

  // Маска области на текстуре (грубо, по треугольникам).
  zoneMask(kind, w, h) {
    const z = this.paintTris(kind);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const c = cv.getContext('2d', { willReadFrequently: true });
    c.fillStyle = '#fff'; c.strokeStyle = '#fff'; c.lineWidth = 2;
    c.beginPath();
    for (const list of [z.fast, ...z.slow.map((x) => x.U)]) for (let i = 0; i < list.length; i += 6) { c.moveTo(list[i] * w, list[i + 1] * h); c.lineTo(list[i + 2] * w, list[i + 3] * h); c.lineTo(list[i + 4] * w, list[i + 5] * h); c.closePath(); }
    c.fill(); c.stroke();
    return c.getImageData(0, 0, w, h).data;
  }

  // «Без чулок»: ткань на ногах (чулки, колготки, носки) заменяем цветом её же кожи.
  bareLegs(map) {
    if (!map?.image || !this.base) return map;
    this.paintTexCache ??= new Map();
    const key = `${map.uuid}|bare`;
    if (this.paintTexCache.has(key)) return this.paintTexCache.get(key);
    const img = map.image, w = img.width, h = img.height;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h), d = data.data;
    const z = this.zoneMask('legsall', w, h);
    const skin = (i) => d[i + 3] >= 250 && d[i] > d[i + 1] && d[i + 1] >= d[i + 2] && d[i] - d[i + 2] > 18 && d[i] > 150;
    const need = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) if (z[i] >= 128 && !skin(i)) need[p] = 1;
    // Край чулка полупрозрачный и похож на кожу — захватываем ещё несколько точек вокруг, чтобы не осталось следа.
    for (let pass = 0; pass < 4; pass++) {
      const prev = need.slice();
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (!prev[p] && z[p * 4] >= 128 && (prev[p - 1] || prev[p + 1] || prev[p - w] || prev[p + w])) need[p] = 1;
      }
    }
    skinFill(d, w, h, need);
    ctx.putImageData(data, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    for (const kk of ['flipY', 'colorSpace', 'wrapS', 'wrapT', 'anisotropy', 'magFilter', 'minFilter']) tex[kk] = map[kk];
    tex.needsUpdate = true;
    this.paintTexCache.set(key, tex);
    return tex;
  }

  // keep: чулки остаются поверх — ниже белья красим только голую кожу, ткань чулок не трогаем.
  paintCloth(map, kind, hex, keep = false) {
    if (!map?.image || !this.base) return map;
    this.paintTexCache ??= new Map();
    const key = `${map.uuid}|${kind}|${hex}|${keep}`;
    if (this.paintTexCache.has(key)) return this.paintTexCache.get(key);
    const { fast: T, slow } = this.paintTris(kind);
    if (!T.length) return map;
    const img = map.image, w = img.width, h = img.height;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const mask = document.createElement('canvas');
    mask.width = w; mask.height = h;
    const mc = mask.getContext('2d', { willReadFrequently: true });
    mc.fillStyle = '#fff'; mc.strokeStyle = '#fff'; mc.lineWidth = 1; // обводка закрывает швы между треугольниками
    mc.beginPath();
    for (let i = 0; i < T.length; i += 6) { mc.moveTo(T[i] * w, T[i + 1] * h); mc.lineTo(T[i + 2] * w, T[i + 3] * h); mc.lineTo(T[i + 4] * w, T[i + 5] * h); mc.closePath(); }
    mc.fill(); mc.stroke();
    const m = mc.getImageData(0, 0, w, h).data;
    // Края (пояс, ворот, манжеты, щиколотки): по каждой точке считаем, где она на теле, — линия ровная.
    for (const { U, P, Z, inside } of slow) {
      const x0 = U[0] * w, y0 = U[1] * h, x1 = U[2] * w, y1 = U[3] * h, x2 = U[4] * w, y2 = U[5] * h;
      const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
      if (Math.abs(den) < 1e-9) continue;
      const xa = Math.max(0, Math.floor(Math.min(x0, x1, x2)) - 1), xb = Math.min(w - 1, Math.ceil(Math.max(x0, x1, x2)) + 1);
      const ya = Math.max(0, Math.floor(Math.min(y0, y1, y2)) - 1), yb = Math.min(h - 1, Math.ceil(Math.max(y0, y1, y2)) + 1);
      for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
        // 3×3 пробы на точку: край ткани получается сглаженным, без «лесенки».
        let hit = 0, tot = 0;
        for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
          const px = x + (sx + 0.5) / 3, py = y + (sy + 0.5) / 3;
          const a = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / den;
          const b2 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / den;
          const c = 1 - a - b2;
          if (a < -0.02 || b2 < -0.02 || c < -0.02) continue;
          tot++;
          if (inside(a * P[0] + b2 * P[2] + c * P[4], a * P[1] + b2 * P[3] + c * P[5], a * Z[0] + b2 * Z[1] + c * Z[2])) hit++;
        }
        if (tot) { const k = (y * w + x) * 4; m[k] = Math.max(m[k], Math.round(255 * hit / tot)); }
      }
    }
    const data = ctx.getImageData(0, 0, w, h), d = data.data;
    const R = (hex >> 16) & 255, G = (hex >> 8) & 255, Bl = hex & 255;
    // Под своим обычным верхом кожа в текстуре бывает прозрачной (руки, плечи). Нарисованный верх их не закрывает
    // целиком — заливаем такие места цветом кожи, иначе руки «пропадают».
    if (['top', 'crop', 'tank', 'longcrop', 'tee', 'polo'].includes(kind)) { // (кант красится поверх уже залитой кожи)
      const u = this.zoneMask('upper', w, h);
      const need = new Uint8Array(w * h);
      for (let i = 0, p = 0; i < d.length; i += 4, p++) if (u[i] >= 128 && d[i + 3] < 250) need[p] = 1;
      skinFill(d, w, h, need);
    }
    const zone = keep ? this.zoneMask('minishorts', w, h) : null;
    for (let i = 0; i < d.length; i += 4) {
      if (m[i] < 8) continue;
      if (zone && zone[i] < 128 && !(d[i] > d[i + 1] && d[i + 1] >= d[i + 2] && d[i] - d[i + 2] > 18 && d[i] > 150)) continue;
      // Ровная плотная ткань, без просвечивания.
      const k = 1; // ровный цвет: рисунок чулок и белья под тканью не проступает (тени даёт освещение)
      const al = m[i] / 255; // на краю ткань плавно сходит на нет
      d[i] = d[i] * (1 - al) + Math.min(255, R * k) * al; d[i + 1] = d[i + 1] * (1 - al) + Math.min(255, G * k) * al; d[i + 2] = d[i + 2] * (1 - al) + Math.min(255, Bl * k) * al; d[i + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    for (const kk of ['flipY', 'colorSpace', 'wrapS', 'wrapT', 'anisotropy', 'magFilter', 'minFilter']) tex[kk] = map[kk];
    tex.needsUpdate = true;
    this.paintTexCache.set(key, tex);
    return tex;
  }

  // Какие вещи есть у источника (для меню).
  catsOf(id) {
    const src = id === 'base' ? this.base : this.sources.get(id);
    if (!src) return [];
    const out = Object.keys(src.pieces);
    if (src.skinMap) out.push('legs');
    return out;
  }

  addSource(id, vrm) {
    VRMUtils.removeUnnecessaryVertices(vrm.scene);
    VRMUtils.rotateVRM0(vrm);
    vrm.scene.traverse((o) => {
      o.frustumCulled = false;
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; }
    });
    const idx = indexVrm(vrm);
    const pieceSet = new Set(Object.values(idx.pieces).flat());
    // Лицо, волосы, тело донора не нужны — только одежда.
    vrm.scene.traverse((o) => { if (o.isMesh && !pieceSet.has(o)) o.visible = false; });
    vrm.scene.visible = false;
    this.scene.add(vrm.scene);
    this.fitToBase(vrm);
    this.sources.set(id, { vrm, ...idx, active: false });
    for (const list of Object.values(idx.pieces)) list.forEach(installClothPoke);
    for (const m of idx.pieces.bottoms ?? []) installTuck(vrm, m);
    installHems(idx.pieces);
    idx.skins.forEach(patchDonorSkin);
    for (const m of idx.pieces.bottoms ?? []) installDroop(vrm, m);
    for (const m of idx.skins) { installCrotchFix(vrm, m); installHipKeep(vrm, m, false); }
    for (const m of idx.pieces.bottoms ?? []) installHipKeep(vrm, m, true);
    // Новое тело-донор: зона ног на текстуре кожи пересчитывается (ступни/голени под другой обувью).
    this.legTris = null;
    this.skinCache?.clear();
    this.darkCache?.clear();
    this.legTintCache?.clear();
  }

  // wear: { tops: 'base' | 'o1' | ... | 'none', ... }
  apply(wear, onSkin) {
    if (!this.base) return;
    for (const cat of PIECE_CATS) {
      if (cat.skin) continue;
      const choice = wear[cat.id] ?? 'base';
      // Пока выбранная вещь грузится — остаётся базовая (не мелькает голое тело).
      for (const m of this.base.pieces[cat.id] ?? []) m.visible = choice === 'base' || (choice !== 'none' && !this.sources.has(choice) && !this.paints.has(choice));
      for (const [id, s] of this.sources) for (const m of s.pieces[cat.id] ?? []) m.visible = choice === id;
    }
    if (this.tightSkirt) {
      this.tightSkirt.visible = !!this.paints.get(wear.bottoms)?.gen;
      const m = this.tightSkirt.material, c = wear.bottomHex ?? 0x24222c;
      m.color?.setHex(c);
      m.shadeColorFactor?.setHex(c).multiplyScalar(0.62);
    }
    // Низ под верхом от другого наряда — заправляем.
    const topC = wear.tops ?? 'base', botC = wear.bottoms ?? 'base';
    const tuck = topC !== 'none' && topC !== botC;
    // Юбку не деформируем (иначе пояс «ломается» под коротким топом): прячем только то, что на груди,
    // а верх рисуем на сантиметр «поверх» низа — где топ прозрачный, юбка видна как есть.
    const put = (m) => setTuck(m, tuck, 1);
    for (const m of this.base.pieces.tops ?? []) setLift(m, tuck ? 0.009 : 0);
    for (const [, s] of this.sources) for (const m of s.pieces.tops ?? []) setLift(m, tuck ? 0.009 : 0);
    for (const m of this.base.pieces.bottoms ?? []) put(m);
    for (const [, s] of this.sources) for (const m of s.pieces.bottoms ?? []) put(m);
    for (const [, s] of this.sources) {
      s.active = PIECE_CATS.some((c) => !c.skin && (s.pieces[c.id] ?? []).some((m) => m.visible));
      s.vrm.scene.visible = s.active;
      // VRoid вырезает тело под своей одеждой. Чужая вещь закрывает другие места — под ней
      // остаются дыры. Тело донора (с нашей кожей) показываем «позади» нашего: оно закрывает дыры.
      for (const m of s.skins) {
        m.visible = s.active;
      }
    }
    // Кожа собирается из двух нарядов: торс — от того, чей верх надет (у VRoid под каждым
    // верхом своя майка/бельё, нарисованные на коже), ноги — от выбранных чулок/колготок.
    const skinOf = (id) => (id === 'base' || id === 'none' ? this.base : this.sources.get(id))?.skinMap ?? this.base.skinMap;
    const topId = wear.tops ?? 'base';
    let map = this.compositeSkin(skinOf(topId), skinOf(wear.legs ?? 'base'));
    map = this.recolorShorts(map, wear.legsDark ? null : (wear.legsTint ?? null), !wear.legsDark && wear.legsTint == null);
    if (wear.legsDark) map = this.darkenLegs(map, wear.legsDark);
    else if (wear.legsTint != null) map = this.tintLegs(map, wear.legsTint);
    // Облегающие вещи рисуются поверх: сначала кофточка, потом лосины (пояс лосин — сверху).
    const kt = this.paints.get(wear.tops)?.tops, kb = this.paints.get(wear.bottoms)?.bottoms, kl = this.paints.get(wear.legs)?.legs;
    // (у облегающей юбки рисунка по телу нет — это отдельная сетка, см. tightSkirt)
    if (kl === 'bare') map = this.bareLegs(map);
    // Кант (манжеты, ворот, пояс, низ) — чуть темнее светлой ткани и чуть светлее тёмной: края выглядят аккуратно.
    const trimOf = (hex) => {
      const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255, lum = (r * 0.3 + g * 0.59 + b * 0.11) / 255;
      const f = (c) => Math.round(lum > 0.45 ? c * 0.8 : c + (255 - c) * 0.2);
      return (f(r) << 16) | (f(g) << 8) | f(b);
    };
    if (kt) {
      const hex = wear.topHex ?? 0xf1edf6;
      map = this.paintCloth(map, kt, hex);
      map = this.paintCloth(map, `${kt}:trim`, trimOf(hex));
      if (kt === 'polo') {
        // Воротник — светлый на тёмном поло и тёмный на светлом.
        const lum = (((hex >> 16) & 255) * 0.3 + ((hex >> 8) & 255) * 0.59 + (hex & 255) * 0.11) / 255;
        map = this.paintCloth(map, 'polocollar', lum > 0.72 ? 0x2b2530 : 0xf6f3fa);
      }
    }
    if (kb) {
      const hex = wear.bottomHex ?? 0x24222c, keep = !!wear.keepStockings && (kb === 'leggings' || kb === 'capri');
      map = this.paintCloth(map, kb, hex, keep);
      map = this.paintCloth(map, `${kb}:trim`, trimOf(hex), keep);
    }
    this.setSkin(map);
    onSkin?.(map);
  }

  // Высоты бедра/колена и вершин — в исходной (bind) позе меша, а не в текущей:
  // иначе, если она сидит/лежит, зона ног на текстуре считается неправильно.
  bindLegY(mesh) {
    const hum = this.base.vrm.humanoid;
    const boneY = (name, fb) => {
      const node = hum.getRawBoneNode(name);
      const bones = mesh.skeleton?.bones ?? [];
      let i = bones.indexOf(node);
      if (i < 0 && node) i = bones.findIndex((b) => b.name === node.name);
      if (i >= 0 && mesh.skeleton.boneInverses[i]) return new THREE.Matrix4().copy(mesh.skeleton.boneInverses[i]).invert().elements[13];
      return fb;
    };
    const hip = boneY('leftUpperLeg', 0.9), knee = boneY('leftLowerLeg', 0.5);
    const bm = mesh.isSkinnedMesh ? mesh.bindMatrix : mesh.matrixWorld;
    return { hip, knee, vy: (pos, q, v) => v.fromBufferAttribute(pos, q).applyMatrix4(bm).y };
  }

  ensureLegTris() {
    // Ноги — всё ниже линии бёдер (по высоте вершин тела в исходной позе).
    if (!this.legTris) {
      this.legTris = [];
      const allSkins = [...this.base.skins, ...[...this.sources.values()].flatMap((s) => s.skins)];
      for (const mesh of allSkins) {
        const g = mesh.geometry;
        const pos = g.attributes.position;
        const uv = g.attributes.uv;
        if (!uv) continue;
        const { hip, knee, vy } = this.bindLegY(mesh);
        const cut = hip + (hip - knee) * 0.12;
        const v = new THREE.Vector3();
        const idx = g.index;
        const n = idx ? idx.count : pos.count;
        const id = (k) => (idx ? idx.getX(k) : k);
        for (let t = 0; t < n; t += 3) {
          const a = id(t), b = id(t + 1), c = id(t + 2);
          if (Math.max(vy(pos, a, v), vy(pos, b, v), vy(pos, c, v)) > cut) continue;
          this.legTris.push(uv.getX(a), uv.getY(a), uv.getX(b), uv.getY(b), uv.getX(c), uv.getY(c));
        }
      }
    }
  }

  // Нарисованные на коже серые шортики — перекрашиваем в чёрный (подходит к любому наряду).
  // Меняем только серые (ненасыщенные) пиксели в зоне бёдер — кожу не трогаем.
  recolorShorts(map, hex = null, auto = false) {
    if (!map?.image || !this.base) return map;
    this.shortsCache ??= new Map();
    const sKey = `${map.uuid}|${hex}|${auto}`;
    if (this.shortsCache.has(sKey)) return this.shortsCache.get(sKey);
    if (!this.shortsTris) {
      this.shortsTris = [];
      this.calfUV = [];
      for (const mesh of this.base.skins) {
        const g = mesh.geometry, pos = g.attributes.position, uv = g.attributes.uv;
        if (!uv) continue;
        const { hip: hipY, knee: kneeY, vy } = this.bindLegY(mesh);
        const top = hipY + (hipY - kneeY) * 0.35;
        const bot = kneeY + (hipY - kneeY) * 0.45;
        const v = new THREE.Vector3(), idx = g.index, n = idx ? idx.count : pos.count;
        const id = (k) => (idx ? idx.getX(k) : k);
        for (let t = 0; t < n; t += 3) {
          const a = id(t), b = id(t + 1), c = id(t + 2);
          const ys = [a, b, c].map((q) => vy(pos, q, v));
          // икра (ниже колена) — по ней узнаём цвет чулок
          const leg = hipY - kneeY;
          if (Math.max(...ys) < kneeY - leg * 0.15 && Math.min(...ys) > kneeY - leg * 0.6) this.calfUV.push((uv.getX(a) + uv.getX(b) + uv.getX(c)) / 3, (uv.getY(a) + uv.getY(b) + uv.getY(c)) / 3);
          if (Math.max(...ys) > top || Math.min(...ys) < bot) continue;
          this.shortsTris.push(uv.getX(a), uv.getY(a), uv.getX(b), uv.getY(b), uv.getX(c), uv.getY(c));
        }
      }
    }
    const img = map.image, w = img.width, h = img.height;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    // Маска зоны шортиков.
    const mask = document.createElement('canvas');
    mask.width = w; mask.height = h;
    const mc = mask.getContext('2d', { willReadFrequently: true });
    mc.fillStyle = '#fff';
    mc.beginPath();
    const T = this.shortsTris;
    for (let i = 0; i < T.length; i += 6) {
      mc.moveTo(T[i] * w, T[i + 1] * h); mc.lineTo(T[i + 2] * w, T[i + 3] * h); mc.lineTo(T[i + 4] * w, T[i + 5] * h); mc.closePath();
    }
    mc.fill();
    const m = mc.getImageData(0, 0, w, h).data;
    const id = ctx.getImageData(0, 0, w, h);
    const d = id.data;
    // Без выбранного цвета — берём цвет самих чулок (с икры), чтобы бельё было им в тон.
    let autoTone = false;
    if (auto && hex == null && this.calfUV?.length) {
      let r = 0, g = 0, b = 0, n = 0, skin = 0, tot = 0;
      for (let k = 0; k < this.calfUV.length; k += 2) {
        const x = Math.min(w - 1, Math.max(0, Math.floor(this.calfUV[k] * w))), y = Math.min(h - 1, Math.max(0, Math.floor(this.calfUV[k + 1] * h)));
        const i = (y * w + x) * 4;
        if (d[i + 3] < 200) continue;
        tot++;
        if (d[i] > d[i + 1] && d[i + 1] >= d[i + 2] && d[i] - d[i + 2] > 30 && (d[i] + d[i + 1] + d[i + 2]) / 3 > 125) { skin++; continue; }
        r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
      }
      if (n && skin < tot * 0.6) { hex = (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n); autoTone = true; }
    }
    // Резинка шортиков выглядывает над юбкой серой полоской — закрашиваем её кожей
    // (цвет берём с кожи прямо над ней в том же столбце).
    {
      const grey = (i) => { const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); return d[i + 3] > 200 && mx - mn <= 26 && mx < 200; };
      const y0 = Math.round(h * 0.36), y1 = Math.round(h * 0.52), band = Math.round(h * 0.047);
      for (let x = Math.round(w * 0.24); x < Math.round(w * 0.76); x++) {
        let r = -1;
        for (let y = y0; y < y1; y++) if (grey((y * w + x) * 4)) { r = y; break; }
        if (r < 0) continue;
        const s = ((r - Math.round(h * 0.006)) * w + x) * 4;
        if (grey(s) || d[s + 3] < 200) continue;
        for (let y = r - 2; y < r + band; y++) {
          const i = (y * w + x) * 4;
          if (y >= r && !grey(i) && y < r + band - 6) continue; // край и шов — закрашиваем всегда
          d[i] = d[s]; d[i + 1] = d[s + 1]; d[i + 2] = d[s + 2];
        }
      }
    }
    // Гладкая ткань: грубые складки и швы сглаживаем — яркость тянем к средней.
    let lSum = 0, lN = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (!m[i]) continue;
      const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
      if (mx - mn > 26 || mx > 200) continue;
      lSum += (d[i] + d[i + 1] + d[i + 2]) / 3; lN++;
    }
    const lMid = lN ? lSum / lN : 0;
    for (let i = 0; i < d.length; i += 4) {
      if (!m[i]) continue;
      const r0 = d[i], g0 = d[i + 1], b0 = d[i + 2];
      const mx = Math.max(r0, g0, b0), mn = Math.min(r0, g0, b0);
      if (mx - mn > 26) continue; // кожа — не трогаем
      if (mx > 242 && (hex == null || autoTone)) continue; // белое (верх белых чулок) без цвета — остаётся белым
      const l0 = (r0 + g0 + b0) / 3;
      const l = mx > 200 ? l0 : lMid + (l0 - lMid) * 0.3;
      if (hex == null) {
        const k = 0.32; // темнее: серый → почти чёрный, складки остаются видны
        d[i] = l * k + 6; d[i + 1] = l * k + 3; d[i + 2] = l * k + 10;
      } else {
        // В тон чулкам: тот же цвет, чуть темнее (складки видны).
        // Светлое (кружевной верх чулок) — как сами чулки, тёмно-серое (шортики) — темнее.
        const k = autoTone ? Math.min(1, 0.7 + 0.6 * (l / 255)) : l > 200 ? 0.35 + 0.9 * (l / 255) : 0.3 + 0.75 * (l / 255);
        d[i] = Math.min(255, ((hex >> 16) & 255) * k); d[i + 1] = Math.min(255, ((hex >> 8) & 255) * k); d[i + 2] = Math.min(255, (hex & 255) * k);
      }
    }
    ctx.putImageData(id, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    for (const kk of ['flipY', 'colorSpace', 'wrapS', 'wrapT', 'anisotropy', 'magFilter', 'minFilter']) tex[kk] = map[kk];
    tex.needsUpdate = true;
    this.shortsCache.set(sKey, tex);
    return tex;
  }

  // Цвет чулок/колготок: красим только ткань (ненасыщенные пиксели ног), кожу не трогаем.
  tintLegs(map, hex) {
    if (!map?.image || !this.base || hex == null) return map;
    this.legTintCache ??= new Map();
    const key = `${map.uuid}|${hex}`;
    if (this.legTintCache.has(key)) return this.legTintCache.get(key);
    this.ensureLegTris();
    const img = map.image, w = img.width, h = img.height;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const mask = document.createElement('canvas');
    mask.width = w; mask.height = h;
    const mc = mask.getContext('2d', { willReadFrequently: true });
    mc.fillStyle = '#fff';
    mc.beginPath();
    const T = this.legTris;
    for (let i = 0; i < T.length; i += 6) {
      mc.moveTo(T[i] * w, T[i + 1] * h); mc.lineTo(T[i + 2] * w, T[i + 3] * h); mc.lineTo(T[i + 4] * w, T[i + 5] * h); mc.closePath();
    }
    mc.fill();
    // Шортики не красим (они в зоне бёдер): вырезаем их из маски.
    if (this.shortsTris) {
      mc.globalCompositeOperation = 'destination-out';
      mc.beginPath();
      const Q = this.shortsTris;
      for (let i = 0; i < Q.length; i += 6) {
        mc.moveTo(Q[i] * w, Q[i + 1] * h); mc.lineTo(Q[i + 2] * w, Q[i + 3] * h); mc.lineTo(Q[i + 4] * w, Q[i + 5] * h); mc.closePath();
      }
      mc.fill();
      mc.globalCompositeOperation = 'source-over';
    }
    const m = mc.getImageData(0, 0, w, h).data;
    const id = ctx.getImageData(0, 0, w, h);
    const d = id.data;
    const cr = (hex >> 16) & 255, cg = (hex >> 8) & 255, cb = hex & 255;
    for (let i = 0; i < d.length; i += 4) {
      if (m[i + 3] < 128) continue;
      const r0 = d[i], g0 = d[i + 1], b0 = d[i + 2];
      const mx = Math.max(r0, g0, b0), mn = Math.min(r0, g0, b0);
      if (mx - mn > 26) continue; // кожа (розовая) — не трогаем
      const l = (r0 + g0 + b0) / 765;
      const k = 0.35 + 0.9 * l; // тёмные колготки — насыщенный цвет, белые чулки — светлый
      d[i] = Math.min(255, cr * k); d[i + 1] = Math.min(255, cg * k); d[i + 2] = Math.min(255, cb * k);
    }
    ctx.putImageData(id, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    for (const kk of ['flipY', 'colorSpace', 'wrapS', 'wrapT', 'anisotropy', 'magFilter', 'minFilter']) tex[kk] = map[kk];
    tex.needsUpdate = true;
    this.legTintCache.set(key, tex);
    return tex;
  }

  // Колготки темнее (полупрозрачный чёрный): ноги на текстуре кожи затемняются «умножением».
  darkenLegs(map, k = 0.55) {
    if (!map?.image || !this.base) return map;
    this.darkCache ??= new Map();
    const key = `${map.uuid}|${k}`;
    if (this.darkCache.has(key)) return this.darkCache.get(key);
    this.ensureLegTris();
    const img = map.image;
    const w = img.width, h = img.height;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    const T = this.legTris;
    for (let i = 0; i < T.length; i += 6) {
      ctx.moveTo(T[i] * w, T[i + 1] * h);
      ctx.lineTo(T[i + 2] * w, T[i + 3] * h);
      ctx.lineTo(T[i + 4] * w, T[i + 5] * h);
      ctx.closePath();
    }
    ctx.clip();
    ctx.globalCompositeOperation = 'multiply';
    const v = Math.round(255 * (1 - k));
    ctx.fillStyle = `rgb(${v},${v - 4},${v + 4})`;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    const tex = new THREE.CanvasTexture(canvas);
    for (const kk of ['flipY', 'colorSpace', 'wrapS', 'wrapT', 'anisotropy', 'magFilter', 'minFilter']) tex[kk] = map[kk];
    tex.needsUpdate = true;
    this.darkCache.set(key, tex);
    return tex;
  }

  compositeSkin(torsoMap, legsMap) {
    if (!torsoMap || !legsMap || torsoMap === legsMap) return legsMap ?? torsoMap;
    this.skinCache ??= new Map();
    const key = `${torsoMap.uuid}|${legsMap.uuid}`;
    if (this.skinCache.has(key)) return this.skinCache.get(key);
    const body = this.base.skins.find((m) => /^Body/i.test(m.name) || /Body/i.test(m.parent?.name ?? '')) ?? this.base.skins[0];
    const ti = torsoMap.image;
    const li = legsMap.image;
    if (!body || !ti || !li) return legsMap;
    const w = li.width;
    const h = li.height;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(ti, 0, 0, w, h);
    this.ensureLegTris();
    ctx.save();
    ctx.beginPath();
    const T = this.legTris;
    for (let i = 0; i < T.length; i += 6) {
      ctx.moveTo(T[i] * w, T[i + 1] * h);
      ctx.lineTo(T[i + 2] * w, T[i + 3] * h);
      ctx.lineTo(T[i + 4] * w, T[i + 5] * h);
      ctx.closePath();
    }
    ctx.lineWidth = 2;
    ctx.clip();
    ctx.drawImage(li, 0, 0, w, h);
    ctx.restore();
    const tex = new THREE.CanvasTexture(canvas);
    for (const k of ['flipY', 'colorSpace', 'wrapS', 'wrapT', 'anisotropy', 'magFilter', 'minFilter']) tex[k] = legsMap[k];
    tex.needsUpdate = true;
    this.skinCache.set(key, tex);
    return tex;
  }

  setSkin(map) {
    if (!map) return;
    for (const mesh of this.base.skins) {
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (!mat) continue;
      if (!mat.userData.origMap) {
        mat.userData.origMap = mat.map;
        mat.userData.shadeSame = !!mat.shadeMultiplyTexture && mat.shadeMultiplyTexture.image === mat.map?.image;
      }
      mat.map = map;
      if (mat.userData.shadeSame) mat.shadeMultiplyTexture = map;
      mat.needsUpdate = true;
    }
    // Тела доноров (заплатки под чужой одеждой) — той же кожи.
    for (const [, s] of this.sources) {
      for (const mesh of s.skins) {
        const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        if (!mat || mat.map === map) continue;
        mat.map = map;
        if (mat.shadeMultiplyTexture) mat.shadeMultiplyTexture = map;
        mat.needsUpdate = true;
      }
    }
  }

  // Каждый кадр: доноры повторяют её позу (нормализованные кости), затем считают свою физику.
  sync(dt) {
    if (!this.base) return;
    this.restorePokes(dt);
    this.updateCloth(dt);
    // Облегающая юбка: чем сильнее согнуты ноги, тем увереннее рисуется поверх тела (бедро не проглядывает).
    if (this.tightSkirt?.visible) setLift(this.tightSkirt, 0.022 + 0.05 * SQUAT_FLEX.value);
    const bh = this.base.vrm.humanoid;
    for (const [, s] of this.sources) {
      if (!s.active) continue;
      const h = s.vrm.humanoid;
      for (const name of Object.keys(bh.humanBones)) {
        const a = bh.getNormalizedBoneNode(name);
        const b = h.getNormalizedBoneNode(name);
        if (!a || !b) continue;
        b.quaternion.copy(a.quaternion);
        if (name === 'hips') b.position.copy(a.position);
      }
      s.vrm.scene.position.copy(this.base.vrm.scene.position);
      s.vrm.scene.quaternion.copy(this.base.vrm.scene.quaternion);
      s.vrm.update(dt);
      // Дыхание: грудная клетка донора расширяется так же, как у неё (иначе тело проступит сквозь чужой верх).
      for (const name of ['upperChest', 'chest', 'neck', 'leftShoulder', 'rightShoulder']) {
        const a = bh.getRawBoneNode(name), b = h.getRawBoneNode(name);
        if (a && b) b.scale.copy(a.scale);
      }
    }
  }

  // Юбка по инерции: бёдра двигаются — подол запаздывает и тянется в обратную
  // сторону, потом догоняет; плюс еле заметный «ветерок». Сила всегда направлена
  // в основном вниз — юбка колышется, но не задирается.
  skirtInertia(s, h, dt) {
    s.skirtJoints ??= (s.vrm.springBoneManager?.joints ? [...s.vrm.springBoneManager.joints].filter((j) => /skirt/i.test(j.bone.name)) : []);
    if (!s.skirtJoints.length || !(dt > 0)) return;
    // Точка между бёдрами (подол качается за ними — и при сдвиге, и при повороте таза).
    const l = h.getNormalizedBoneNode('leftUpperLeg');
    const r = h.getNormalizedBoneNode('rightUpperLeg');
    if (!l || !r) return;
    s.vrm.scene.updateMatrixWorld(true);
    const p = l.getWorldPosition(new THREE.Vector3()).add(r.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
    const twist = r.getWorldPosition(new THREE.Vector3()).sub(l.getWorldPosition(new THREE.Vector3()));
    if (!s.sk) s.sk = { p: p.clone(), v: new THREE.Vector3(), tw: twist.clone(), w: new THREE.Vector3(), t: 0 };
    const sk = s.sk;
    const vel = p.clone().sub(sk.p).divideScalar(dt);
    const tv = twist.clone().sub(sk.tw).divideScalar(dt); // поворот таза — края подола движутся
    sk.p.copy(p);
    sk.tw.copy(twist);
    sk.v.lerp(vel.add(tv.multiplyScalar(1.2)), 1 - Math.exp(-dt * 8));
    sk.t += dt;
    const breeze = new THREE.Vector3(Math.sin(sk.t * 0.9) * 0.045 + Math.sin(sk.t * 2.3) * 0.02, 0, Math.cos(sk.t * 0.7) * 0.03);
    const hz = new THREE.Vector3(-sk.v.x * 4, 0, -sk.v.z * 4).add(breeze);
    if (hz.length() > 0.2) hz.setLength(0.2);
    const down = -0.14 + THREE.MathUtils.clamp(-sk.v.y * 0.6, -0.25, 0.04); // вниз всегда
    const g = new THREE.Vector3(hz.x, down, hz.z);
    const power = g.length();
    g.normalize();
    for (const j of s.skirtJoints) {
      if (j.userData?.poke) continue; // её сейчас трогают — не затираем толчок от пальца
      j.settings.gravityDir.copy(g);
      j.settings.gravityPower = power;
    }
  }

  // Касание толкает одежду с физикой и на вещах из шкафа (у них свои «пружинки»).
  // Толчок плавный: добавляется к «тяжести» и мягко затухает — вещь пружинит, а не дёргается.
  poke(point, dir, strength = 1, scale = 1) {
    const push = new THREE.Vector3(dir.x, 0, dir.z);
    if (push.lengthSq() < 1e-6) return;
    push.normalize();
    const radius = 0.24 * scale;
    const pos = new THREE.Vector3();
    this.poked ??= new Set();
    for (const [, s] of this.sources) {
      if (!s.active) continue;
      for (const j of s.vrm.springBoneManager?.joints ?? []) {
        if (/bust|breast|hair/i.test(j.bone.name)) continue; // у донора видна только одежда
        j.bone.getWorldPosition(pos);
        const d = pos.distanceTo(point);
        if (d > radius) continue;
        j.userData ??= {};
        if (!j.userData.poke) j.userData.poke = { power: j.settings.gravityPower, dir: j.settings.gravityDir.clone(), vec: new THREE.Vector3() };
        const k = (1 - d / radius) * strength;
        j.userData.poke.vec.addScaledVector(push, 0.55 * k);
        if (j.userData.poke.vec.length() > 0.85) j.userData.poke.vec.setLength(0.85);
        this.poked.add(j);
      }
    }
  }

  restorePokes(dt = 0.016) {
    if (!this.poked?.size) return;
    const decay = Math.exp(-Math.min(dt, 0.05) * 4.5);
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

  // Перекрасить вещь (цвет умножается на текстуру; null — оригинал).
  tint(cat, srcId, hex) {
    const src = srcId === 'base' ? this.base : this.sources.get(srcId);
    for (const mesh of src?.pieces[cat] ?? []) {
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (!m?.color) continue;
        m.userData.origColor ??= m.color.clone();
        if (m.shadeColorFactor) m.userData.origShade ??= m.shadeColorFactor.clone();
        if (hex == null) {
          m.color.copy(m.userData.origColor);
          if (m.shadeColorFactor) m.shadeColorFactor.copy(m.userData.origShade);
        } else {
          const c = new THREE.Color(hex);
          m.color.copy(c);
          if (m.shadeColorFactor) m.shadeColorFactor.copy(c).multiplyScalar(0.6);
        }
      }
    }
  }

  dispose() {
    for (const [, s] of this.sources) {
      this.scene.remove(s.vrm.scene);
      VRMUtils.deepDispose(s.vrm.scene);
    }
    this.sources.clear();
  }
}

// Юбка: мягко колышется и ложится по бёдрам. В VRoid у юбки почти нет затухания
// (дрожит и взлетает) и нет силы тяжести (не ложится по форме) — подправляем:
// больше плавности, лёгкий вес вниз (не задирается), чуть толще «касание» о ноги.
export function tuneSkirt(vrm) {
  const joints = vrm?.springBoneManager?.joints;
  if (!joints) return;
  for (const j of joints) {
    if (!/skirt/i.test(j.bone.name)) continue;
    // Мягче и живее: меньше жёсткости — дольше и шире колышется за движением,
    // умеренное затухание — плавно, без дрожи; лёгкий вес — ложится, не взлетает.
    j.settings.dragForce = 0.2;
    j.settings.stiffness = Math.max(j.settings.stiffness, 0.5);
    j.settings.gravityPower = Math.max(j.settings.gravityPower, 0.12);
    j.settings.gravityDir.set(0, -1, 0);
    j.settings.hitRadius = Math.max(j.settings.hitRadius, 0.03);
  }
}

// Форма бёдер. Статический небольшой объём + КОРРЕКТИРУЮЩИЙ объём, зависящий от позы:
// при сгибе бедра (присед, колени, сидя) кожа модели на сгибе «сминается» — мы выпукло
// выталкиваем её наружу пропорционально сгибу каждой ноги (HIP_FLEX), стоя — почти ноль.
export const HIP_FLEX = { value: new THREE.Vector2() };
function patchBulge(mat) {
  if (!mat || mat.userData.bulgePatched) return;
  mat.userData.bulgePatched = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.uniforms.hipFlex = HIP_FLEX;
    sh.vertexShader = 'attribute vec2 hipBulge;\nuniform vec2 hipFlex;\n' + sh.vertexShader;
    if (sh.vertexShader.includes('#include <begin_vertex>')) {
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n  transformed += normalize(objectNormal) * dot(hipBulge, hipFlex);');
    }
  };
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|bulge`;
  mat.needsUpdate = true;
}
export function shapeHips(vrm, amount = 0.036) {
  vrm?.scene?.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    // Тело и низ одежды (юбка/шорты) — вместе, чтобы ткань облегала новый объём.
    if (!mats.some((m) => SKIN_RE.test(m?.name ?? '') || /_Bottoms_/i.test(m?.name ?? ''))) return;
    const g = o.geometry;
    if (!g || g.userData.hipsShaped) return;
    // Кости в позе покоя → в координаты сетки (до любых поз).
    vrm.scene.updateMatrixWorld(true);
    const inv = o.matrixWorld.clone().invert();
    const bindPos = (name) => {
      const b = vrm.humanoid?.getRawBoneNode(name);
      return b ? b.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv) : null;
    };
    const L = bindPos('leftUpperLeg');
    const R = bindPos('rightUpperLeg');
    const H = bindPos('hips');
    const foot = bindPos('leftFoot');
    const toe = bindPos('leftToes');
    if (!L || !R || !H || !foot || !toe) return;
    const back = new THREE.Vector3(0, 0, Math.sign(foot.z - toe.z) || 1);
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    if (!pos || !nor) return;
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    const legLen = Math.max(0.3, H.y - foot.y);
    const k0 = legLen / 0.8;
    // Центр выпуклости — ягодица (сзади от тазобедренного сустава, чуть ниже).
    const centers = [L, R].map((c) => c.clone().addScaledVector(back, 0.07 * k0).add(new THREE.Vector3(0, -0.015 * k0, 0))); // повыше — подтянуто
    // Ткань — шире и чуть сильнее тела: всегда накрывает выпуклость, не прорезается.
    const cloth = mats.some((m) => /_Bottoms_/i.test(m?.name ?? ''));
    const sigma = 0.1 * k0; // одинаково для тела и ткани — ткань сидит по фигуре
    const gain = cloth ? 1.1 : 1; // ткань чуть сильнее — кожа не прорезает
    const bulge = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      n.fromBufferAttribute(nor, i);
      const facing = Math.min(1, Math.max(0, n.dot(back) * 0.85 + 0.3));
      if (facing <= 0) continue;
      // У пояса (выше тазобедренных суставов) объём плавно сходит на нет — пояс сидит по талии.
      const waist = 1 - THREE.MathUtils.smoothstep(v.y, L.y - 0.05 * k0, L.y + 0.04 * k0);
      const ws = centers.map((c) => { const d = v.distanceTo(c) / sigma; return Math.exp(-d * d) * facing * gain * waist; });
      bulge[i * 2] = ws[0];
      bulge[i * 2 + 1] = ws[1];
      const w = Math.max(ws[0], ws[1]);
      if (w < 0.01) continue;
      const k = amount * w;
      pos.setXYZ(i, v.x + n.x * k, v.y + n.y * k, v.z + n.z * k);
    }
    pos.needsUpdate = true;
    g.setAttribute('hipBulge', new THREE.BufferAttribute(bulge, 2));
    g.computeBoundingSphere();
    g.userData.hipsShaped = true;
    for (const m of mats) patchBulge(m);
  });
}
