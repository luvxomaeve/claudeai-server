package ru.ogroman.waifutouch;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;

import com.yandex.mobile.ads.common.AdError;
import com.yandex.mobile.ads.common.AdRequest;
import com.yandex.mobile.ads.common.AdRequestError;
import com.yandex.mobile.ads.common.ImpressionData;
import com.yandex.mobile.ads.common.YandexAds;
import com.yandex.mobile.ads.interstitial.InterstitialAd;
import com.yandex.mobile.ads.interstitial.InterstitialAdEventListener;
import com.yandex.mobile.ads.interstitial.InterstitialAdLoadListener;
import com.yandex.mobile.ads.interstitial.InterstitialAdLoader;
import com.yandex.mobile.ads.rewarded.Reward;
import com.yandex.mobile.ads.rewarded.RewardedAd;
import com.yandex.mobile.ads.rewarded.RewardedAdEventListener;
import com.yandex.mobile.ads.rewarded.RewardedAdLoadListener;
import com.yandex.mobile.ads.rewarded.RewardedAdLoader;

// Реклама Яндекса (Yandex Mobile Ads): полноэкранная и за награду.
// События уходят в игру: window.__waifuAdEvent('open' | 'reward' | 'close' | 'error').
public class Ads {
  // ЗАМЕНИТЬ на свои ID блоков из кабинета Рекламной сети Яндекса (вида R-M-1234567-1).
  // Боевые блоки РСЯ (приложение 20376815).
  static final String INTERSTITIAL_ID = "R-M-20376815-1"; // «Шкаф»
  static final String REWARDED_ID = "R-M-20376815-2"; // «Награда»

  final Activity act;
  final WebView web;
  final Handler ui = new Handler(Looper.getMainLooper());
  InterstitialAdLoader iLoader;
  RewardedAdLoader rLoader;
  volatile InterstitialAd inter;
  volatile RewardedAd rewarded;
  int iRetry = 0, rRetry = 0;

  Ads(Activity a, WebView w) {
    act = a;
    web = w;
    YandexAds.initialize(a, () -> {
      iLoader = new InterstitialAdLoader(act);
      rLoader = new RewardedAdLoader(act);
      loadInter();
      loadRewarded();
    });
  }

  final InterstitialAdLoadListener iListener = new InterstitialAdLoadListener() {
    @Override public void onAdLoaded(InterstitialAd ad) { inter = ad; iRetry = 0; }
    @Override public void onAdFailedToLoad(AdRequestError e) { retry(true); }
  };
  final RewardedAdLoadListener rListener = new RewardedAdLoadListener() {
    @Override public void onAdLoaded(RewardedAd ad) { rewarded = ad; rRetry = 0; }
    @Override public void onAdFailedToLoad(AdRequestError e) { retry(false); }
  };
  void loadInter() { if (iLoader != null) iLoader.loadAd(new AdRequest.Builder(INTERSTITIAL_ID).build(), iListener); }
  void loadRewarded() { if (rLoader != null) rLoader.loadAd(new AdRequest.Builder(REWARDED_ID).build(), rListener); }
  void retry(boolean isInter) {
    int n = isInter ? ++iRetry : ++rRetry;
    long delay = Math.min(120000, 5000L * n);
    ui.postDelayed(isInter ? this::loadInter : this::loadRewarded, delay);
  }

  void emit(String ev) {
    ui.post(() -> web.evaluateJavascript("window.__waifuAdEvent&&window.__waifuAdEvent('" + ev + "')", null));
  }

  boolean rewardedReady() { return rewarded != null; }

  void showInterstitial() {
    ui.post(() -> {
      InterstitialAd ad = inter;
      if (ad == null) return;
      inter = null;
      ad.setAdEventListener(new InterstitialAdEventListener() {
        @Override public void onAdShown() { emit("open"); }
        @Override public void onAdFailedToShow(AdError e) { emit("close"); ad.setAdEventListener(null); loadInter(); }
        @Override public void onAdDismissed() { emit("close"); ad.setAdEventListener(null); loadInter(); }
        @Override public void onAdClicked() {}
        @Override public void onAdImpression(ImpressionData d) {}
      });
      ad.show(act);
    });
  }

  void showRewarded() {
    ui.post(() -> {
      RewardedAd ad = rewarded;
      if (ad == null) { emit("error"); loadRewarded(); return; }
      rewarded = null;
      ad.setAdEventListener(new RewardedAdEventListener() {
        @Override public void onAdShown() { emit("open"); }
        @Override public void onAdFailedToShow(AdError e) { emit("error"); ad.setAdEventListener(null); loadRewarded(); }
        @Override public void onAdDismissed() { emit("close"); ad.setAdEventListener(null); loadRewarded(); }
        @Override public void onAdClicked() {}
        @Override public void onAdImpression(ImpressionData d) {}
        @Override public void onRewarded(Reward r) { emit("reward"); }
      });
      ad.show(act);
    });
  }

  void destroy() {
    if (iLoader != null) iLoader.cancelLoading();
    if (rLoader != null) rLoader.cancelLoading();
    ui.removeCallbacksAndMessages(null);
  }
}
