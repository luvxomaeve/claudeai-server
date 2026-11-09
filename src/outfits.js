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
    tuneSkirt(vrm);
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
  }

  // wear: { tops: 'base' | 'o1' | ... | 'none', ... }
  apply(wear, onSkin) {
    if (!this.base) return;
    for (const cat of PIECE_CATS) {
      if (cat.skin) continue;
      const choice = wear[cat.id] ?? 'base';
      for (const m of this.base.pieces[cat.id] ?? []) m.visible = choice === 'base';
      for (const [id, s] of this.sources) for (const m of s.pieces[cat.id] ?? []) m.visible = choice === id;
    }
    // Одежда чуть «впереди» тела по глубине: там, где кожа почти касается ткани
    // (бёдра под юбкой в наклоне), она не просвечивает сквозь одежду.
    const clothOffset = (m) => {
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        if (!mat || mat.userData.clothOffset) continue;
        mat.userData.clothOffset = true;
        mat.polygonOffset = true;
        mat.polygonOffsetFactor = -2;
        mat.polygonOffsetUnits = -10;
      }
    };
    for (const id of ['tops', 'bottoms']) {
      for (const m of this.base.pieces[id] ?? []) clothOffset(m);
      for (const [, s] of this.sources) for (const m of s.pieces[id] ?? []) clothOffset(m);
    }
    // Светлые пятна на юбке — это блик (matcap), который на изнанке складок
    // вспыхивает светлым. Для низа отключаем его — ткань ровная, без «просветов».
    const noMatcap = (m) => {
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        if (!mat || mat.userData.noMatcap) continue;
        mat.userData.noMatcap = true;
        if (mat.matcapFactor?.setScalar) mat.matcapFactor.setScalar(0);
        if ('matcapTexture' in mat) mat.matcapTexture = null;
        mat.needsUpdate = true;
      }
    };
    for (const m of this.base.pieces.bottoms ?? []) noMatcap(m);
    for (const [, s] of this.sources) for (const m of s.pieces.bottoms ?? []) noMatcap(m);
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
    const map = this.compositeSkin(skinOf(topId), skinOf(wear.legs ?? 'base'));
    this.setSkin(map);
    onSkin?.(map);
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
    // Ноги — всё ниже линии бёдер (по высоте вершин тела в исходной позе).
    if (!this.legTris) {
      const hip = this.base.vrm.humanoid.getRawBoneNode('leftUpperLeg')?.getWorldPosition(new THREE.Vector3()).y ?? 0.9;
      const knee = this.base.vrm.humanoid.getRawBoneNode('leftLowerLeg')?.getWorldPosition(new THREE.Vector3()).y ?? 0.5;
      const cut = hip + (hip - knee) * 0.12;
      this.legTris = [];
      for (const mesh of this.base.skins) {
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
      this.skirtInertia(s, h, dt);
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
    const hz = new THREE.Vector3(-sk.v.x * 6, 0, -sk.v.z * 6).add(breeze);
    if (hz.length() > 0.3) hz.setLength(0.3);
    const down = -0.16 + THREE.MathUtils.clamp(-sk.v.y * 0.6, -0.25, 0.04); // вниз всегда
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
    j.settings.dragForce = 0.1;
    j.settings.stiffness = 0.25;
    j.settings.gravityPower = Math.max(j.settings.gravityPower, 0.14);
    j.settings.gravityDir.set(0, -1, 0);
    j.settings.hitRadius = Math.max(j.settings.hitRadius, 0.05); // юбка держится чуть дальше от ног
  }
}
