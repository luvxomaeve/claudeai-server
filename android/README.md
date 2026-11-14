# Waifu Touch для Android (RuStore)

WebView с игрой + реклама Яндекса (Yandex Mobile Ads).

Сборка:
1. Скопировать игру в `app/src/main/assets/www/` (index.html, src, lib, style.css, mocap, models).
2. Создать `keystore.properties`: `storeFile=/путь/к/waifutouch-release.jks` и `password=...`.
3. `gradle assembleRelease` → `app/build/outputs/apk/release/app-release.apk`.

Реклама: ID блоков — в `Ads.java` (`INTERSTITIAL_ID`, `REWARDED_ID`). Сейчас тестовые (`demo-*-yandex`).
Игра вызывает рекламу через `window.WaifuAndroid` (см. `src/ads.js`).
