// Запуск: поднять сервер с игрой на :8766 (модель в WAIFU_MODEL_URL), затем NODE_PATH=$(npm root -g) node tools/joint-check.js
// Автотест суставов: прогон посадки и движений пальцем, замер углов.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 400, height: 600 } });
  p.on('pageerror', e => console.log('pageerror:', e.message));
  await p.goto('http://localhost:8766/');
  await p.waitForSelector('#loading.done', { timeout: 90000 });
  await p.waitForTimeout(800); await p.evaluate(() => { window.__waifu.idleTimer = 999; window.__waifu.stopClip(); });
  const measure = () => p.evaluate(() => {
    const w = window.__waifu; const deg = (r) => Math.round(r * 57.3);
    const q = (n) => w.bones[n].quaternion;
    const out = {};
    for (const s of ['left', 'right']) {
      const k = q(s + 'LowerLeg'); const ks = k.w < 0 ? -1 : 1; const kneeBend = 2 * Math.atan2(k.x * ks, k.w * ks) * w.flip; const kneeOff = Math.hypot(k.y, k.z) * 2;
      const h = q(s + 'UpperLeg'); const hs = h.w < 0 ? -1 : 1; const hipTwist = 2 * Math.atan2(h.y * hs, h.w * hs);
      const f = q(s + 'Foot'); const ankle = 2 * Math.acos(Math.min(1, Math.abs(f.w)));
      const e = q(s + 'LowerArm'); const elbow = 2 * Math.acos(Math.min(1, Math.abs(e.w)));
      out[s[0]] = `knee ${deg(kneeBend)} off ${deg(kneeOff)} hipTw ${deg(hipTwist)} ankle ${deg(ankle)} elbow ${deg(elbow)}`;
    }
    return out.l + ' | ' + out.r;
  });
  for (const s of [0, 0.25, 0.5, 0.65, 0.8, 0.9, 1, 1.15, 1.3]) {
    await p.evaluate((s) => { const w = window.__waifu; w.sit = s; w.sitS = s; }, s);
    await p.waitForTimeout(2500);
    console.log('sit', s, await measure());
  }
  await p.evaluate(() => { const w = window.__waifu; w.sit = 0; w.sitS = 0; });
  await p.waitForTimeout(2000);
  for (const [name, off] of [['legUp', [0.1, 0.45, 0.2]], ['legSide', [0.25, 0.1, 0]], ['legBack', [0, 0.2, -0.25]]]) {
    await p.evaluate((off) => { const w = window.__waifu; const V = w.restHips.constructor; w.setFootTarget('left', w.restFoot.left.pos.clone().add(new V(...off))); }, off);
    await p.waitForTimeout(2000);
    console.log(name, await measure());
    await p.evaluate(() => window.__waifu.clearTouchPose());
  }
  b.close();
})();
