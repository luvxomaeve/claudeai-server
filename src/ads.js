// Реклама и платформа.
// - Яндекс Игры (браузер): SDK window.YaGames.
// - Приложение для Android (RuStore): мост window.WaifuAndroid → Yandex Mobile Ads.
// - VK Игры / OK Игры: VK Bridge (window.vkBridge), реклама VKWebAppShowNativeAds.
// Если ни того ни другого нет (артефакт, локальный запуск) — всё работает без рекламы:
// «реклама за награду» сразу даёт награду.
let ysdk = null;
let vk = null; // VK Bridge, если игра открыта внутри VK
let pauseHook = () => {};
const native = typeof window !== 'undefined' ? window.WaifuAndroid : null;
// Полноэкранная — не чаще раза в 6 минут; в приложении первая — не раньше чем через 5 минут.
const FULLSCREEN_GAP = 6 * 60000;
let lastFullscreen = native ? Date.now() - FULLSCREEN_GAP + 5 * 60000 : 0;

// «Без рекламы» (покупка): полноэкранной рекламы нет, реклама за награду — по желанию.
const NOADS_KEY = 'waifu-noads';
export function noAds() {
  try { return localStorage.getItem(NOADS_KEY) === '1'; } catch { return false; }
}
export function setNoAds(on) {
  try { localStorage.setItem(NOADS_KEY, on ? '1' : '0'); } catch { /* ignore */ }
}

// Запущены внутри VK: в адресе есть подпись запуска (vk_app_id / sign).
const inVk = () => typeof location !== 'undefined' && /[?&](vk_app_id|vk_user_id|api_id|viewer_id)=/.test(location.search);
const vkAds = (format) => vk.send('VKWebAppCheckNativeAds', { ad_format: format }).catch(() => null); // подгрузить заранее

export async function initPlatform() {
  if (window.vkBridge && inVk()) {
    try {
      await window.vkBridge.send('VKWebAppInit');
      vk = window.vkBridge;
      lastFullscreen = Date.now() - FULLSCREEN_GAP + 5 * 60000; // первая полноэкранная — через 5 минут
      vkAds('interstitial');
      vkAds('reward');
    } catch { vk = null; }
    return vk;
  }
  if (!window.YaGames) return null;
  try {
    ysdk = await window.YaGames.init();
  } catch {
    ysdk = null;
  }
  return ysdk;
}

export function hasAds() {
  return !!ysdk || !!native || !!vk;
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
    lastFullscreen = Math.max(lastFullscreen, Date.now()); // сразу после ролика — без полноэкранной
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
  if (vk) {
    pauseHook(true);
    vk.send('VKWebAppShowNativeAds', { ad_format: 'reward' })
      .then((r) => { pauseHook(false); lastFullscreen = Math.max(lastFullscreen, Date.now()); if (r?.result) onReward(); else onFail(); })
      .catch(() => { pauseHook(false); onReward(); }) // рекламы нет — не мучаем, даём награду
      .finally(() => vkAds('reward'));
    return;
  }
  if (!ysdk) { onReward(); return; }
  let got = false;
  ysdk.adv.showRewardedVideo({
    callbacks: {
      onOpen: () => pauseHook(true),
      onRewarded: () => { got = true; },
      onClose: () => { pauseHook(false); lastFullscreen = Math.max(lastFullscreen, Date.now()); if (got) onReward(); else onFail(); },
      onError: () => { pauseHook(false); onFail(); },
    },
  });
}

// Полноэкранная реклама — не чаще раза в 6 минут, только в паузах (не посреди действия).
export function interstitial() {
  if (noAds()) return;
  if (!ysdk && !native && !vk) return;
  const now = Date.now();
  if (now - lastFullscreen < FULLSCREEN_GAP) return;
  lastFullscreen = now;
  if (native) {
    try { native.showInterstitial(); } catch { /* ignore */ }
    return;
  }
  if (vk) {
    pauseHook(true);
    vk.send('VKWebAppShowNativeAds', { ad_format: 'interstitial' })
      .catch(() => null)
      .finally(() => { pauseHook(false); vkAds('interstitial'); });
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
