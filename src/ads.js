// Реклама и платформа.
// - Яндекс Игры (браузер): SDK window.YaGames.
// - Приложение для Android (RuStore): мост window.WaifuAndroid → Yandex Mobile Ads.
// Если ни того ни другого нет (артефакт, локальный запуск) — всё работает без рекламы:
// «реклама за награду» сразу даёт награду.
let ysdk = null;
let pauseHook = () => {};
const native = typeof window !== 'undefined' ? window.WaifuAndroid : null;
// В приложении первая полноэкранная — не сразу после запуска, а через 3 минуты.
let lastFullscreen = native ? Date.now() : 0;

// «Без рекламы» (покупка): полноэкранной рекламы нет, реклама за награду — по желанию.
const NOADS_KEY = 'waifu-noads';
export function noAds() {
  try { return localStorage.getItem(NOADS_KEY) === '1'; } catch { return false; }
}
export function setNoAds(on) {
  try { localStorage.setItem(NOADS_KEY, on ? '1' : '0'); } catch { /* ignore */ }
}

export async function initPlatform() {
  if (!window.YaGames) return null;
  try {
    ysdk = await window.YaGames.init();
  } catch {
    ysdk = null;
  }
  return ysdk;
}

export function hasAds() {
  return !!ysdk || !!native;
}

// Звук и игру ставим на паузу на время рекламы.
export function onAdPause(fn) {
  pauseHook = fn;
}

export function gameReady() {
  try { ysdk?.features?.LoadingAPI?.ready(); } catch { /* ignore */ }
}

// Язык из SDK (для автоопределения языка).
export function platformLang() {
  try { return ysdk?.environment?.i18n?.lang ?? null; } catch { return null; }
}

// События рекламы из приложения: 'open' | 'reward' | 'close' | 'error'.
let nativeCb = null;
if (native) {
  window.__waifuAdEvent = (ev) => {
    const cb = nativeCb;
    if (ev === 'open') { pauseHook(true); return; }
    if (ev === 'reward') { if (cb) cb.got = true; return; }
    pauseHook(false);
    nativeCb = null;
    if (!cb) return;
    if (ev === 'close' && cb.got) cb.onReward();
    else if (ev === 'error') cb.onReward(); // реклама не загрузилась — не мучаем, даём награду
    else cb.onFail();
  };
}

// Реклама за награду: onReward() вызывается, только если досмотрел.
export function rewarded(onReward, onFail = () => {}) {
  if (native) {
    try {
      if (!native.rewardedReady()) { onReward(); return; }
      nativeCb = { onReward, onFail, got: false };
      native.showRewarded();
    } catch { onReward(); }
    return;
  }
  if (!ysdk) { onReward(); return; }
  let got = false;
  ysdk.adv.showRewardedVideo({
    callbacks: {
      onOpen: () => pauseHook(true),
      onRewarded: () => { got = true; },
      onClose: () => { pauseHook(false); if (got) onReward(); else onFail(); },
      onError: () => { pauseHook(false); onFail(); },
    },
  });
}

// Полноэкранная реклама — не чаще раза в 3 минуты, только в паузах (не посреди действия).
export function interstitial() {
  if (noAds()) return;
  if (!ysdk && !native) return;
  const now = Date.now();
  if (now - lastFullscreen < 180000) return;
  lastFullscreen = now;
  if (native) {
    try { native.showInterstitial(); } catch { /* ignore */ }
    return;
  }
  ysdk.adv.showFullscreenAdv({
    callbacks: {
      onOpen: () => pauseHook(true),
      onClose: () => pauseHook(false),
      onError: () => pauseHook(false),
    },
  });
}
