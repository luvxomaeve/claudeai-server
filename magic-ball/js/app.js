/*
 * Магический Шар & Таро — основная логика.
 * Magic Ball & Tarot — main application logic.
 *
 * Зависит от: i18n.js (I18N, BALL_ANSWERS), tarot.js (TAROT_DECK, TAROT_SPREADS)
 */

(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Состояние / State                                                  */
  /* ------------------------------------------------------------------ */
  const state = {
    lang: 'ru',
    sound: true,
    ballBusy: false,
    spread: 'three',
    playCount: 0, // для показа рекламы каждые N действий / for ad cadence
  };

  // Сохранённые настройки (Yandex player data перетрёт при наличии).
  try {
    const saved = JSON.parse(localStorage.getItem('mb_settings') || '{}');
    if (saved.lang) state.lang = saved.lang;
    if (typeof saved.sound === 'boolean') state.sound = saved.sound;
  } catch (e) { /* ignore */ }

  function persist() {
    try {
      localStorage.setItem('mb_settings', JSON.stringify({ lang: state.lang, sound: state.sound }));
    } catch (e) { /* ignore */ }
    YA.saveData({ lang: state.lang, sound: state.sound });
  }

  const t = (key) => (I18N[state.lang] && I18N[state.lang][key]) || key;
  const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];

  /* ------------------------------------------------------------------ */
  /* Yandex Games SDK (с заглушками) / with graceful fallbacks          */
  /* ------------------------------------------------------------------ */
  const YA = {
    sdk: null,
    player: null,
    ready: false,

    async init() {
      if (typeof YaGames === 'undefined') {
        // SDK не загружен (локальный запуск или другая площадка) — работаем без него.
        console.info('[YA] SDK not present — running standalone.');
        return;
      }
      try {
        this.sdk = await YaGames.init();
        this.ready = true;
        console.info('[YA] SDK initialised.');
        // Загрузка сохранённых данных игрока.
        try {
          this.player = await this.sdk.getPlayer({ scopes: false });
          const data = await this.player.getData(['lang', 'sound']);
          if (data && data.lang) state.lang = data.lang;
          if (data && typeof data.sound === 'boolean') state.sound = data.sound;
          applyLang();
          updateSoundBtn();
        } catch (e) { /* гость / guest */ }
        // Сообщаем платформе, что игра загрузилась.
        if (this.sdk.features && this.sdk.features.LoadingAPI) {
          this.sdk.features.LoadingAPI.ready();
        }
      } catch (e) {
        console.warn('[YA] init failed:', e);
      }
    },

    saveData(obj) {
      if (this.ready && this.player) {
        try { this.player.setData(obj, false); } catch (e) { /* ignore */ }
      }
    },

    // Полноэкранная (межстраничная) реклама. Заглушка, если SDK нет.
    showFullscreenAd() {
      if (this.ready && this.sdk && this.sdk.adv) {
        try {
          this.sdk.adv.showFullscreenAdv({
            callbacks: {
              onClose: () => console.info('[YA] fullscreen ad closed'),
              onError: (e) => console.warn('[YA] ad error', e),
            },
          });
          return;
        } catch (e) { /* fall through */ }
      }
      console.info('[YA] (stub) fullscreen ad would show here.');
    },

    // Реклама за вознаграждение. cb вызывается при «досмотре».
    showRewardedAd(cb) {
      if (this.ready && this.sdk && this.sdk.adv) {
        try {
          this.sdk.adv.showRewardedVideo({
            callbacks: {
              onRewarded: () => cb && cb(true),
              onClose: () => {},
              onError: (e) => { console.warn('[YA] rewarded error', e); cb && cb(false); },
            },
          });
          return;
        } catch (e) { /* fall through */ }
      }
      console.info('[YA] (stub) rewarded ad — granting reward immediately.');
      cb && cb(true);
    },
  };

  // Показ полноэкранной рекламы каждые 3 действия (щадящая частота).
  function maybeShowAd() {
    state.playCount += 1;
    if (state.playCount % 3 === 0) {
      YA.showFullscreenAd();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Звук (Web Audio, без файлов) / Sound via Web Audio, no assets      */
  /* ------------------------------------------------------------------ */
  let audioCtx = null;
  function beep(freq, durationMs, type) {
    if (!state.sound) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + durationMs / 1000);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + durationMs / 1000);
    } catch (e) { /* ignore */ }
  }
  const sfxShake = () => { beep(180, 90, 'triangle'); setTimeout(() => beep(140, 90, 'triangle'), 80); };
  const sfxReveal = () => { beep(520, 120, 'sine'); setTimeout(() => beep(780, 160, 'sine'), 90); };
  const sfxFlip = () => beep(360, 70, 'square');

  /* ------------------------------------------------------------------ */
  /* DOM ссылки / refs                                                  */
  /* ------------------------------------------------------------------ */
  const $ = (id) => document.getElementById(id);
  const el = {
    appTitle: $('appTitle'),
    tabBallBtn: $('tabBallBtn'),
    tabTarotBtn: $('tabTarotBtn'),
    ballView: $('ballView'),
    tarotView: $('tarotView'),
    ball: $('ball'),
    ballWindow: document.querySelector('.ball-window'),
    ballAnswer: $('ballAnswer'),
    ballThink: $('ballThink'),
    die: $('die'),
    ballHint: $('ballHint'),
    question: $('question'),
    shakeBtn: $('shakeBtn'),
    spreadSelect: $('spreadSelect'),
    drawBtn: $('drawBtn'),
    cards: $('cards'),
    tarotHint: $('tarotHint'),
    langBtn: $('langBtn'),
    soundBtn: $('soundBtn'),
  };

  /* ------------------------------------------------------------------ */
  /* Локализация интерфейса / apply language                            */
  /* ------------------------------------------------------------------ */
  function applyLang() {
    document.documentElement.lang = state.lang;
    el.appTitle.textContent = t('appTitle');
    el.tabBallBtn.textContent = t('tabBall');
    el.tabTarotBtn.textContent = t('tabTarot');
    el.ballHint.textContent = t('ballHint');
    el.question.placeholder = t('askPlaceholder');
    el.shakeBtn.textContent = t('shakeBtn');
    el.drawBtn.textContent = t('drawBtn');
    el.langBtn.textContent = t('langBtn');
    el.tarotHint.textContent = t('chooseSpread');
    rebuildSpreadOptions();
  }

  function updateSoundBtn() {
    el.soundBtn.textContent = state.sound ? t('soundOn') : t('soundOff');
  }

  function rebuildSpreadOptions() {
    const cur = el.spreadSelect.value || state.spread;
    el.spreadSelect.innerHTML = '';
    Object.keys(TAROT_SPREADS).forEach((key) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = TAROT_SPREADS[key].name[state.lang];
      el.spreadSelect.appendChild(opt);
    });
    el.spreadSelect.value = cur;
  }

  /* ------------------------------------------------------------------ */
  /* Вкладки / Tabs                                                     */
  /* ------------------------------------------------------------------ */
  function showTab(tab) {
    const ball = tab === 'ball';
    el.ballView.classList.toggle('hidden', !ball);
    el.tarotView.classList.toggle('hidden', ball);
    el.tabBallBtn.classList.toggle('active', ball);
    el.tabTarotBtn.classList.toggle('active', !ball);
  }

  /* ------------------------------------------------------------------ */
  /* Магический шар / Magic Ball                                        */
  /* ------------------------------------------------------------------ */
  function pickBallAnswer() {
    const pools = BALL_ANSWERS[state.lang];
    // 50% да, 25% нейтрально, 25% нет — слегка позитивный перекос.
    const r = Math.random();
    if (r < 0.5) return rnd(pools.yes);
    if (r < 0.75) return rnd(pools.neutral);
    return rnd(pools.no);
  }

  function shakeBall() {
    if (state.ballBusy) return;
    state.ballBusy = true;
    sfxShake();

    // Фаза 1 — тряска: муть, активные пузырьки, треугольник тонет.
    el.ball.classList.add('shaking');
    el.ballWindow.classList.add('churning');
    el.die.classList.remove('surfacing', 'floating');
    el.ballThink.textContent = t('ballThinking');
    el.ballThink.classList.add('show');

    setTimeout(() => {
      // Фаза 2 — ответ всплывает из глубины.
      el.ball.classList.remove('shaking');
      el.ballWindow.classList.remove('churning');
      el.ballThink.classList.remove('show');
      el.ballAnswer.textContent = pickBallAnswer();
      // Перезапуск анимации всплытия (сброс класса -> reflow -> добавить).
      el.die.classList.remove('surfacing', 'floating');
      void el.die.offsetWidth;
      el.die.classList.add('surfacing');
      sfxReveal();
      maybeShowAd();
      // Страховка: освободить блокировку, даже если animationend не придёт.
      setTimeout(() => { state.ballBusy = false; }, 1300);
    }, 1100);
  }

  // После всплытия включаем лёгкое вечное покачивание треугольника.
  if (el.die) {
    el.die.addEventListener('animationend', (e) => {
      if (e.animationName === 'surface') {
        el.die.classList.add('floating');
        state.ballBusy = false;
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Таро / Tarot                                                       */
  /* ------------------------------------------------------------------ */
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function drawSpread() {
    const key = el.spreadSelect.value;
    state.spread = key;
    const spread = TAROT_SPREADS[key];
    const deck = shuffle(TAROT_DECK);
    const picks = deck.slice(0, spread.positions.length);

    el.cards.innerHTML = '';
    el.cards.className = 'cards spread-' + key;
    el.tarotHint.textContent = t('tapToFlip');

    picks.forEach((card, i) => {
      const reversed = Math.random() < 0.5;
      const pos = spread.positions[i];

      const wrap = document.createElement('div');
      wrap.className = 'card-slot';

      const label = document.createElement('div');
      label.className = 'card-pos';
      label.textContent = pos[state.lang];

      const cardEl = document.createElement('div');
      cardEl.className = 'card';

      const inner = document.createElement('div');
      inner.className = 'card-inner';

      // Рубашка / back
      const back = document.createElement('div');
      back.className = 'card-face card-back';
      back.innerHTML = '<span>✦</span>';

      // Лицо / front
      const front = document.createElement('div');
      front.className = 'card-face card-front suit-' + card.suit + (reversed ? ' reversed' : '');
      const meaning = reversed ? card.rev[state.lang] : card.up[state.lang];
      const orient = reversed ? ' ' + t('reversedLabel') : '';
      front.innerHTML =
        '<div class="card-emoji">' + card.emoji + '</div>' +
        '<div class="card-name">' + card.name[state.lang] + orient + '</div>' +
        '<div class="card-meaning">' + meaning + '</div>';

      inner.appendChild(back);
      inner.appendChild(front);
      cardEl.appendChild(inner);
      wrap.appendChild(label);
      wrap.appendChild(cardEl);
      el.cards.appendChild(wrap);

      cardEl.addEventListener('click', () => {
        if (cardEl.classList.contains('flipped')) return;
        cardEl.classList.add('flipped');
        sfxFlip();
        // Когда все карты открыты — подсказка + реклама.
        if (el.cards.querySelectorAll('.card.flipped').length === picks.length) {
          el.tarotHint.textContent = t('spreadDoneHint');
          maybeShowAd();
        }
      });

      // Лёгкая каскадная анимация появления.
      setTimeout(() => cardEl.classList.add('dealt'), 60 * i);
    });

    el.drawBtn.textContent = t('redrawBtn');
  }

  /* ------------------------------------------------------------------ */
  /* Детекция тряски устройства / Shake detection                      */
  /* ------------------------------------------------------------------ */
  function initShake() {
    let last = { x: 0, y: 0, z: 0, t: 0 };
    const THRESHOLD = 14;

    function onMotion(e) {
      const acc = e.accelerationIncludingGravity || e.acceleration;
      if (!acc) return;
      const now = Date.now();
      if (now - last.t < 250) return;
      const dx = Math.abs((acc.x || 0) - last.x);
      const dy = Math.abs((acc.y || 0) - last.y);
      const dz = Math.abs((acc.z || 0) - last.z);
      if (dx + dy + dz > THRESHOLD) {
        last.t = now;
        if (!el.ballView.classList.contains('hidden')) shakeBall();
      }
      last.x = acc.x || 0; last.y = acc.y || 0; last.z = acc.z || 0;
    }

    // iOS 13+ требует запроса разрешения по жесту пользователя.
    function enable() {
      if (typeof DeviceMotionEvent !== 'undefined' &&
          typeof DeviceMotionEvent.requestPermission === 'function') {
        DeviceMotionEvent.requestPermission()
          .then((res) => { if (res === 'granted') window.addEventListener('devicemotion', onMotion); })
          .catch(() => {});
      } else {
        window.addEventListener('devicemotion', onMotion);
      }
    }
    // Включаем после первого касания (и разблокируем аудио).
    window.addEventListener('pointerdown', function once() {
      enable();
      window.removeEventListener('pointerdown', once);
    }, { once: true });
  }

  /* ------------------------------------------------------------------ */
  /* События / Wire up                                                  */
  /* ------------------------------------------------------------------ */
  function bind() {
    el.tabBallBtn.addEventListener('click', () => showTab('ball'));
    el.tabTarotBtn.addEventListener('click', () => showTab('tarot'));
    el.ball.addEventListener('click', shakeBall);
    el.shakeBtn.addEventListener('click', shakeBall);
    el.drawBtn.addEventListener('click', drawSpread);
    el.spreadSelect.addEventListener('change', () => { state.spread = el.spreadSelect.value; });

    el.langBtn.addEventListener('click', () => {
      state.lang = state.lang === 'ru' ? 'en' : 'ru';
      applyLang();
      updateSoundBtn();
      // Сбросить открытые ответы/карты, чтобы тексты не смешивались.
      el.die.classList.remove('surfacing', 'floating');
      el.ballThink.classList.remove('show');
      el.cards.innerHTML = '';
      el.tarotHint.textContent = t('chooseSpread');
      el.drawBtn.textContent = t('drawBtn');
      persist();
    });

    el.soundBtn.addEventListener('click', () => {
      state.sound = !state.sound;
      updateSoundBtn();
      persist();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Старт / Boot                                                       */
  /* ------------------------------------------------------------------ */
  function boot() {
    bind();
    applyLang();
    updateSoundBtn();
    rebuildSpreadOptions();
    el.spreadSelect.value = state.spread;
    showTab('ball');
    initShake();
    YA.init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
