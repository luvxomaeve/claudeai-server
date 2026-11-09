// Реклама и платформа (Яндекс Игры). Если SDK нет (артефакт, локальный запуск) —
// всё работает без рекламы: «реклама за награду» сразу даёт награду.
let ysdk = null;
let pauseHook = () => {};
let lastFullscreen = 0;

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
  return !!ysdk;
}

// Звук и игру ставим на паузу на время рекламы (требование Яндекс Игр).
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

// Реклама за награду: onReward() вызывается, только если досмотрел.
export function rewarded(onReward, onFail = () => {}) {
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
  if (!ysdk) return;
  const now = Date.now();
  if (now - lastFullscreen < 180000) return;
  lastFullscreen = now;
  ysdk.adv.showFullscreenAdv({
    callbacks: {
      onOpen: () => pauseHook(true),
      onClose: () => pauseHook(false),
      onError: () => pauseHook(false),
    },
  });
}
