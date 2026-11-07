// Запуск: сервер с игрой на :8766, затем NODE_PATH=$(npm root -g) node tools/record-frames.js idle|idle2|sit|poses
// Кадры пишутся в ./rec (создай папку). Виртуальное время — честные 30 кадров/с даже в медленном headless.
// Покадровая запись: виртуальное время, ровно 30 кадров/с, независимо от скорости браузера.
const { chromium, devices } = require('playwright');
const scenario = process.argv[2] || 'all';
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ ...devices['Pixel 7'], deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    let vt = performance.now(); const realNow = performance.now.bind(performance);
    window.__manual = false; const q = [];
    const rafReal = window.requestAnimationFrame.bind(window);
    performance.now = () => (window.__manual ? vt : (vt = realNow()));
    window.requestAnimationFrame = (cb) => { if (window.__manual) { q.push(cb); return q.length; } return rafReal(cb); };
    window.__step = (ms) => { vt += ms; const cbs = q.splice(0); for (const cb of cbs) cb(vt); return cbs.length; };
    window.__goManual = () => { window.__manual = true; };
  });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('pageerror:', e.message));
  await p.goto('http://localhost:8766/');
  await p.waitForSelector('#loading.done', { timeout: 120000 });
  await p.waitForTimeout(1500);
  await p.tap('#btn-camera'); await p.tap('#btn-zoom'); await p.waitForTimeout(1500);
  await p.evaluate(() => window.__goManual());
  await p.waitForTimeout(300);
  let n = 0;
  const frames = async (sec, every = 1, fn) => { for (let i = 0; i < sec * 30; i++) { if (fn) await p.evaluate(fn, i); await p.evaluate(() => window.__step(1000 / 30)); if (i % every === 0) await p.screenshot({ path: `rec/${scenario}_${String(n++).padStart(4, '0')}.png`, clip: { x: 0, y: 90, width: 412, height: 700 } }); } };
  if (scenario === 'idle') await frames(8, 6);
  if (scenario === 'idle2') await frames(15, 20);
  if (scenario === 'sit') {
    // палец ведёт у левого края вниз за ~1.5 с
    await frames(5, 5, (i) => { const w = window.__waifu; if (i < 45) w.sit = Math.min(1.3, w.sit + 1.3 / 45); });
    await frames(5, 5, (i) => { const w = window.__waifu; if (i < 30) w.sit = Math.max(0, w.sit - 1.3 / 30); });
  }
  if (scenario === 'poses') {
    for (const name of ['flirty', 'hips', 'crossed', 'shy', 'stand']) { await p.evaluate((nm) => window.__waifu.setPose(nm), name); await frames(1.4, 5); }
  }
  console.log('frames', n);
  b.close();
})();
