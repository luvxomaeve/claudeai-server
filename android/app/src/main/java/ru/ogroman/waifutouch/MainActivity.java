package ru.ogroman.waifutouch;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.net.Uri;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import android.webkit.JavascriptInterface;

public class MainActivity extends Activity {
  private static final String HOST = "appassets.androidplatform.net";
  private WebView web;
  private Ads ads;

  @Override
  protected void onCreate(Bundle b) {
    super.onCreate(b);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    web = new WebView(this);
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setDatabaseEnabled(true);
    s.setMediaPlaybackRequiresUserGesture(false);
    s.setAllowFileAccess(false);
    web.setWebViewClient(new Client(this));
    ads = new Ads(this, web);
    web.addJavascriptInterface(new Bridge(ads), "WaifuAndroid");
    setContentView(web);
    immersive();
    if (b != null) web.restoreState(b);
    else web.loadUrl("https://" + HOST + "/index.html");
  }

  private static String mime(String p) {
    p = p.toLowerCase();
    if (p.endsWith(".html")) return "text/html";
    if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
    if (p.endsWith(".css")) return "text/css";
    if (p.endsWith(".json")) return "application/json";
    if (p.endsWith(".png")) return "image/png";
    if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
    if (p.endsWith(".svg")) return "image/svg+xml";
    if (p.endsWith(".glb") || p.endsWith(".vrm")) return "model/gltf-binary";
    if (p.endsWith(".mp3")) return "audio/mpeg";
    if (p.endsWith(".wasm")) return "application/wasm";
    return "application/octet-stream";
  }

  private void immersive() {
    getWindow().getDecorView().setSystemUiVisibility(
        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
  }

  @Override public void onWindowFocusChanged(boolean f) { super.onWindowFocusChanged(f); if (f) immersive(); }
  @Override protected void onSaveInstanceState(Bundle o) { super.onSaveInstanceState(o); web.saveState(o); }
  @Override protected void onPause() { super.onPause(); web.onPause(); web.evaluateJavascript("try{window.__waifuAudio&&window.__waifuAudio.suspend();speechSynthesis.cancel()}catch(e){}", null); }
  @Override protected void onResume() { super.onResume(); web.onResume(); }
  @Override public void onBackPressed() { moveTaskToBack(true); }
  // Вызовы из игры (src/ads.js): показать рекламу.
  static class Bridge {
    final Ads ads;
    Bridge(Ads a) { ads = a; }
    @JavascriptInterface public void showInterstitial() { ads.showInterstitial(); }
    @JavascriptInterface public void showRewarded() { ads.showRewarded(); }
    @JavascriptInterface public boolean rewardedReady() { return ads.rewardedReady(); }
  }
  @Override protected void onDestroy() { if (ads != null) ads.destroy(); super.onDestroy(); }
  static class Client extends WebViewClient {
    final Activity a;
    Client(Activity a) { this.a = a; }
      @Override
      public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
        Uri u = r.getUrl();
        if (!HOST.equals(u.getHost())) return null;
        String path = u.getPath();
        if (path == null || path.equals("/")) path = "/index.html";
        try {
          InputStream in = a.getAssets().open("www" + path);
          Map<String, String> h = new HashMap<>();
          h.put("Access-Control-Allow-Origin", "*");
          h.put("Cache-Control", "no-cache");
          return new WebResourceResponse(mime(path), "utf-8", 200, "OK", h, in);
        } catch (Exception e) {
          return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<String, String>(), new java.io.ByteArrayInputStream(new byte[0]));
        }
      }
      @Override
      public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
        return !HOST.equals(r.getUrl().getHost());
      }
  }
}
