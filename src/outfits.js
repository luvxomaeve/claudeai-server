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

export class PieceWardrobe {
  constructor(scene) {
    this.scene = scene;
    this.base = null; // { vrm, pieces, skins, skinMap }
    this.sources = new Map(); // id -> { vrm, pieces, skinMap, active }
  }

  attachBase(vrm) {
    this.base = { vrm, ...indexVrm(vrm) };
  }

  hasSource(id) { return id === 'base' || this.sources.has(id); }

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
    this.sources.set(id, { vrm, ...idx, active: false });
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
      for (const m of this.base.pieces[cat.id] ?? []) m.visible = choice === 'base' || (choice !== 'none' && !this.sources.has(choice));
      for (const [id, s] of this.sources) for (const m of s.pieces[cat.id] ?? []) m.visible = choice === id;
    }
    for (const [, s] of this.sources) {
      s.active = PIECE_CATS.some((c) => !c.skin && (s.pieces[c.id] ?? []).some((m) => m.visible));
      s.vrm.scene.visible = s.active;
      // VRoid вырезает тело под своей одеждой. Чужая вещь закрывает другие места — под ней
      // остаются дыры. Тело донора (с нашей кожей) показываем «позади» нашего: оно закрывает дыры.
      for (const m of s.skins) {
        m.visible = s.active;
        const mat = Array.isArray(m.material) ? m.material[0] : m.material;
        if (!mat) continue;
        mat.polygonOffset = true;
        mat.polygonOffsetFactor = 2;
        mat.polygonOffsetUnits = 2;
      }
    }
    // Кожа собирается из двух нарядов: торс — от того, чей верх надет (у VRoid под каждым
    // верхом своя майка/бельё, нарисованные на коже), ноги — от выбранных чулок/колготок.
    const skinOf = (id) => (id === 'base' || id === 'none' ? this.base : this.sources.get(id))?.skinMap ?? this.base.skinMap;
    const topId = wear.tops ?? 'base';
    let map = this.compositeSkin(skinOf(topId), skinOf(wear.legs ?? 'base'));
    map = this.recolorShorts(map);
    if (wear.legsDark) map = this.darkenLegs(map, wear.legsDark);
    else if (wear.legsTint != null) map = this.tintLegs(map, wear.legsTint);
    this.setSkin(map);
    onSkin?.(map);
  }

  ensureLegTris() {
    // Ноги — всё ниже линии бёдер (по высоте вершин тела в исходной позе).
    if (!this.legTris) {
      const hip = this.base.vrm.humanoid.getRawBoneNode('leftUpperLeg')?.getWorldPosition(new THREE.Vector3()).y ?? 0.9;
      const knee = this.base.vrm.humanoid.getRawBoneNode('leftLowerLeg')?.getWorldPosition(new THREE.Vector3()).y ?? 0.5;
      const cut = hip + (hip - knee) * 0.12;
      this.legTris = [];
      const allSkins = [...this.base.skins, ...[...this.sources.values()].flatMap((s) => s.skins)];
      for (const mesh of allSkins) {
        const g = mesh.geometry;
        const pos = g.attributes.position;
        const uv = g.attributes.uv;
        if (!uv) continue;
        mesh.updateMatrixWorld(true);
        const v = new THREE.Vector3();
        const idx = g.index;
        const n = idx ? idx.count : pos.count;
        const id = (k) => (idx ? idx.getX(k) : k);
        for (let t = 0; t < n; t += 3) {
          const a = id(t), b = id(t + 1), c = id(t + 2);
          const maxY = Math.max(v.fromBufferAttribute(pos, a).applyMatrix4(mesh.matrixWorld).y,
            v.fromBufferAttribute(pos, b).applyMatrix4(mesh.matrixWorld).y,
            v.fromBufferAttribute(pos, c).applyMatrix4(mesh.matrixWorld).y);
          if (maxY > cut) continue;
          this.legTris.push(uv.getX(a), uv.getY(a), uv.getX(b), uv.getY(b), uv.getX(c), uv.getY(c));
        }
      }
    }
  }

  // Нарисованные на коже серые шортики — перекрашиваем в чёрный (подходит к любому наряду).
  // Меняем только серые (ненасыщенные) пиксели в зоне бёдер — кожу не трогаем.
  recolorShorts(map) {
    if (!map?.image || !this.base) return map;
    this.shortsCache ??= new Map();
    if (this.shortsCache.has(map.uuid)) return this.shortsCache.get(map.uuid);
    if (!this.shortsTris) {
      const hum = this.base.vrm.humanoid;
      const hipY = hum.getRawBoneNode('leftUpperLeg')?.getWorldPosition(new THREE.Vector3()).y ?? 0.9;
      const kneeY = hum.getRawBoneNode('leftLowerLeg')?.getWorldPosition(new THREE.Vector3()).y ?? 0.5;
      const top = hipY + (hipY - kneeY) * 0.35;
      const bot = kneeY + (hipY - kneeY) * 0.45;
      this.shortsTris = [];
      for (const mesh of this.base.skins) {
        const g = mesh.geometry, pos = g.attributes.position, uv = g.attributes.uv;
        if (!uv) continue;
        mesh.updateMatrixWorld(true);
        const v = new THREE.Vector3(), idx = g.index, n = idx ? idx.count : pos.count;
        const id = (k) => (idx ? idx.getX(k) : k);
        for (let t = 0; t < n; t += 3) {
          const a = id(t), b = id(t + 1), c = id(t + 2);
          const ys = [a, b, c].map((q) => v.fromBufferAttribute(pos, q).applyMatrix4(mesh.matrixWorld).y);
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
    for (let i = 0; i < d.length; i += 4) {
      if (!m[i]) continue;
      const r0 = d[i], g0 = d[i + 1], b0 = d[i + 2];
      const mx = Math.max(r0, g0, b0), mn = Math.min(r0, g0, b0);
      if (mx - mn > 26 || mx > 242) continue; // кожа и белое — не трогаем
      const l = (r0 + g0 + b0) / 3;
      const k = 0.32; // темнее: серый → почти чёрный, складки остаются видны
      d[i] = l * k + 6; d[i + 1] = l * k + 3; d[i + 2] = l * k + 10;
    }
    ctx.putImageData(id, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    for (const kk of ['flipY', 'colorSpace', 'wrapS', 'wrapT', 'anisotropy', 'magFilter', 'minFilter']) tex[kk] = map[kk];
    tex.needsUpdate = true;
    this.shortsCache.set(map.uuid, tex);
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
      j.settings.gravityDir.copy(g);
      j.settings.gravityPower = power;
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
