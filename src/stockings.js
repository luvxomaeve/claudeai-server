import * as THREE from 'three';

// Чулки, нарисованные прямо на текстуре кожи модели.
// Ноги находим по скелету: всё, что ниже середины бедра, закрашиваем
// полупрозрачным тёмным цветом, сверху — плотная кружевная полоса.
// Работает с моделями VRoid (материал тела называется *Body*SKIN*).

// height: 'thigh' — чулки до середины бедра, 'waist' — колготки до талии, 'knee' — гольфы выше колена.
// band: 'lace' — кружевная резинка, 'plain' — гладкая, 'none' — без полосы.
const STYLES = {
  black: { base: 'rgba(18, 14, 22, 0.78)', band: 'rgba(10, 8, 12, 0.96)' },
  sheer: { base: 'rgba(25, 20, 28, 0.45)', band: 'rgba(15, 12, 18, 0.92)' },
  white: { base: 'rgba(250, 248, 252, 0.82)', band: 'rgba(255, 255, 255, 0.98)' },
  wine: { base: 'rgba(70, 12, 30, 0.72)', band: 'rgba(45, 6, 18, 0.95)' },
  tights: { base: 'rgba(20, 16, 24, 0.62)', height: 'waist', bandType: 'none' },
  tightsSheer: { base: 'rgba(30, 24, 32, 0.36)', height: 'waist', bandType: 'none' },
  tightsNude: { base: 'rgba(214, 170, 150, 0.32)', height: 'waist', bandType: 'none' },
  kneeBlack: { base: 'rgba(16, 12, 20, 0.92)', band: 'rgba(8, 6, 10, 1)', height: 'knee', bandType: 'plain' },
  kneeWhite: { base: 'rgba(250, 248, 252, 0.95)', band: 'rgba(235, 232, 240, 1)', height: 'knee', bandType: 'plain' },
};

function lacePattern(ctx, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 12;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, 12, 12);
  g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  g.arc(6, 6, 2.6, 0, Math.PI * 2);
  g.arc(0, 0, 1.6, 0, Math.PI * 2);
  g.arc(12, 0, 1.6, 0, Math.PI * 2);
  g.arc(0, 12, 1.6, 0, Math.PI * 2);
  g.arc(12, 12, 1.6, 0, Math.PI * 2);
  g.fill();
  return ctx.createPattern(c, 'repeat');
}

function findBody(vrm) {
  let found = null;
  vrm.scene.traverse((o) => {
    if (found || !o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const m = mats.find((mm) => /body/i.test(mm.name) && /skin/i.test(mm.name) && !/outline/i.test(mm.name));
    if (m?.map?.image) found = { mesh: o, material: m };
  });
  return found;
}

export class Stockings {
  constructor(vrm) {
    this.vrm = vrm;
    this.body = findBody(vrm);
    this.textures = {};
    if (!this.body) return;
    this.original = this.body.material.map;
    this.originalShade = this.body.material.shadeMultiplyTexture;

    // Высоты в исходной позе: колено и тазобедренный сустав.
    const y = (bone) => {
      const node = vrm.humanoid.getRawBoneNode(bone);
      if (!node) return null;
      return node.getWorldPosition(new THREE.Vector3()).y;
    };
    const hip = y('leftUpperLeg');
    const knee = y('leftLowerLeg');
    this.ok = hip !== null && knee !== null;
    this.top = knee + (hip - knee) * 0.45; // верх чулка: чуть ниже середины бедра
    this.tops = { thigh: this.top, waist: hip + (hip - knee) * 0.35, knee: knee + (hip - knee) * 0.12 };
    this.band = (hip - knee) * 0.12; // ширина кружевной полосы
  }

  get available() {
    return !!this.body && this.ok;
  }

  build(styleName) {
    if (this.textures[styleName]) return this.textures[styleName];
    const style = STYLES[styleName] ?? STYLES.black;
    const img = this.original.image;
    const w = img.width;
    const h = img.height;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);

    const geo = this.body.mesh.geometry;
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    const index = geo.index;
    const world = this.body.mesh.matrixWorld;
    const v = new THREE.Vector3();
    const ys = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) ys[i] = v.fromBufferAttribute(pos, i).applyMatrix4(world).y;

    const triCount = index ? index.count / 3 : pos.count / 3;
    const idx = (n) => (index ? index.getX(n) : n);
    const lace = lacePattern(ctx, style.band ?? style.base);
    // Два прохода, чтобы полупрозрачный слой не накладывался сам на себя:
    // сначала собираем маску ног, потом заливаем её одним цветом.
    const mask = document.createElement('canvas');
    mask.width = w;
    mask.height = h;
    const mctx = mask.getContext('2d');
    const bandCanvas = document.createElement('canvas');
    bandCanvas.width = w;
    bandCanvas.height = h;
    const bctx = bandCanvas.getContext('2d');
    for (let t = 0; t < triCount; t++) {
      const a = idx(t * 3);
      const b = idx(t * 3 + 1);
      const c = idx(t * 3 + 2);
      const maxY = Math.max(ys[a], ys[b], ys[c]);
      const top = this.tops[style.height ?? 'thigh'];
      if (maxY > top) continue;
      const bandW = style.bandType === 'none' ? 0 : style.bandType === 'plain' ? this.band * 0.6 : this.band;
      const target = maxY > top - bandW ? bctx : mctx;
      target.beginPath();
      target.moveTo(uv.getX(a) * w, uv.getY(a) * h);
      target.lineTo(uv.getX(b) * w, uv.getY(b) * h);
      target.lineTo(uv.getX(c) * w, uv.getY(c) * h);
      target.closePath();
      target.fillStyle = '#000';
      target.strokeStyle = '#000';
      target.lineWidth = 1.5;
      target.fill();
      target.stroke();
    }
    // Тело чулка.
    mctx.globalCompositeOperation = 'source-in';
    mctx.fillStyle = style.base;
    mctx.fillRect(0, 0, w, h);
    ctx.drawImage(mask, 0, 0);
    // Кружевная полоса.
    bctx.globalCompositeOperation = 'source-in';
    bctx.fillStyle = style.bandType === 'plain' ? style.band : lace;
    bctx.fillRect(0, 0, w, h);
    ctx.drawImage(bandCanvas, 0, 0);

    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = this.original.flipY;
    tex.colorSpace = this.original.colorSpace;
    tex.wrapS = this.original.wrapS;
    tex.wrapT = this.original.wrapT;
    tex.anisotropy = this.original.anisotropy;
    this.textures[styleName] = tex;
    return tex;
  }

  // Новая основа кожи (чулки/колготки из другого наряда) — рисуем поверх неё.
  setBase(tex) {
    if (!this.available || !tex || tex === this.original) return;
    this.original = tex;
    this.originalShade = tex;
    for (const t of Object.values(this.textures)) t.dispose();
    this.textures = {};
  }

  // styleName: 'off' | 'black' | 'sheer' | 'white' | 'wine'
  apply(styleName) {
    if (!this.available) return false;
    const m = this.body.material;
    const tex = styleName === 'off' ? this.original : this.build(styleName);
    m.map = tex;
    // У MToon тень часто использует ту же текстуру — меняем и её.
    if (this.originalShade && this.originalShade.image === this.original.image) {
      m.shadeMultiplyTexture = tex;
    }
    m.needsUpdate = true;
    return true;
  }
}

export const STOCKING_STYLES = [
  { id: 'off', name: 'Без' },
  { id: 'black', name: 'Чёрные' },
  { id: 'sheer', name: 'Тонкие' },
  { id: 'wine', name: 'Бордо' },
  { id: 'white', name: 'Белые' },
  { id: 'tights', name: 'Колготки' },
  { id: 'tightsSheer', name: 'Колготки тонкие' },
  { id: 'kneeBlack', name: 'Гольфы чёрные' },
  { id: 'kneeWhite', name: 'Гольфы белые' },
];
