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
    for (const [, s] of this.sources) {
      s.active = PIECE_CATS.some((c) => !c.skin && (s.pieces[c.id] ?? []).some((m) => m.visible));
      s.vrm.scene.visible = s.active;
    }
    // Чулки/колготки нарисованы на коже — меняем рисунок кожи.
    const legs = wear.legs ?? 'base';
    const src = legs === 'base' ? this.base : this.sources.get(legs);
    const map = src?.skinMap ?? this.base.skinMap;
    this.setSkin(map);
    onSkin?.(map);
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

  dispose() {
    for (const [, s] of this.sources) {
      this.scene.remove(s.vrm.scene);
      VRMUtils.deepDispose(s.vrm.scene);
    }
    this.sources.clear();
  }
}
