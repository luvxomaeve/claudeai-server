/* ============================================================
   Тёплый дождь — движок визуальной новеллы
   Пассажная модель: STORY[id] = { bg, char, lines[], then }
   ============================================================ */
(() => {
  "use strict";

  const SAVE_KEY = "warmrain.save.v1";
  const CFG_KEY  = "warmrain.cfg.v1";

  // --- Конфиг по умолчанию ---
  const cfg = Object.assign({
    speed: 22,         // мс на символ (0 = мгновенно)
    adult: true,       // откровенный контент
    particles: true,
    ageOK: false,      // подтверждён возраст
  }, loadJSON(CFG_KEY, {}));

  // --- Состояние игры ---
  let state = null;          // { passage, vars }
  let lineIdx = 0;
  let typing = false;
  let typeTimer = null;
  let autoMode = false;
  let skipMode = false;
  let autoTimer = null;

  // --- DOM ---
  const $ = (s) => document.querySelector(s);
  const el = {
    bg: $("#bg"), character: $("#character"), particles: $("#particles"),
    game: $("#game"), dialogue: $("#dialogue"),
    speaker: $("#speaker"), text: $("#text"), advance: $("#advance"),
    choices: $("#choices"), toast: $("#toast"),
    menu: $("#menu"), continueBtn: $("#continueBtn"),
  };

  // ============================================================
  //  Утилиты
  // ============================================================
  function loadJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  }
  function saveJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  }
  function persistCfg() { saveJSON(CFG_KEY, cfg); }

  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add("show");
    setTimeout(() => el.toast.classList.remove("show"), 1600);
  }

  function show(id) { document.querySelectorAll(".screen").forEach(s => s.classList.remove("active")); if (id) $("#"+id).classList.add("active"); }
  function hideAllScreens() { document.querySelectorAll(".screen").forEach(s => s.classList.remove("active")); }

  // подстановка переменных в текст: {name} -> имя игрока и т.п.
  function interp(str) {
    if (!str) return "";
    return str.replace(/\{(\w+)\}/g, (_, k) => (state && state.vars[k] != null) ? state.vars[k] : "");
  }

  // ============================================================
  //  Частицы (дождь)
  // ============================================================
  function buildParticles() {
    el.particles.innerHTML = "";
    if (!cfg.particles) return;
    const n = 34;
    for (let i = 0; i < n; i++) {
      const p = document.createElement("i");
      const size = 3 + Math.random() * 6;
      const dur = 9 + Math.random() * 12;
      p.style.left = Math.random() * 100 + "%";
      p.style.top = (60 + Math.random() * 60) + "%";
      p.style.width = size + "px";
      p.style.height = size + "px";
      p.style.animationDuration = dur + "s";
      p.style.animationDelay = -Math.random() * dur + "s";
      p.style.opacity = 0.3 + Math.random() * 0.5;
      el.particles.appendChild(p);
    }
  }

  // ============================================================
  //  Сцена / фон / персонаж (инлайн-SVG из art.js)
  // ============================================================
  let curBg = null, charReady = false;

  function setBackground(name) {
    if (!name || name === curBg) return;
    curBg = name;
    const svg = (typeof SCENES !== "undefined" && SCENES[name]) || "";
    el.bg.style.opacity = "0";
    setTimeout(() => {
      el.bg.className = "bg show svgbg " + name;
      if (svg) el.bg.innerHTML = svg;
      el.bg.style.opacity = "1";
    }, 260);
  }

  function setCharacter(charKey) {
    if (charKey == null) {            // null => спрятать
      el.character.classList.remove("show");
      return;
    }
    if (!charReady && typeof CHARACTER !== "undefined") {
      el.character.innerHTML = CHARACTER;
      charReady = true;
    }
    el.character.classList.add("show");
  }
  function setExpr(expr) { if (expr) el.character.dataset.expr = expr; }
  function setBlush(b) { el.character.dataset.blush = b ? "1" : "0"; }

  // ============================================================
  //  Печать текста
  // ============================================================
  function typeText(node, raw) {
    clearTimeout(typeTimer);
    const str = interp(raw);
    node.innerHTML = "";
    typing = true;
    el.advance.classList.add("hide");

    if (cfg.speed === 0 || skipMode) {
      node.textContent = str;
      finishTyping();
      return;
    }
    let i = 0;
    const step = () => {
      if (i >= str.length) { finishTyping(); return; }
      const span = document.createElement("span");
      span.className = "char-in";
      span.textContent = str[i];
      node.appendChild(span);
      i++;
      typeTimer = setTimeout(step, cfg.speed);
    };
    step();
  }

  function finishTyping() {
    typing = false;
    el.advance.classList.remove("hide");
    if (autoMode && !el.choices.classList.contains("active")) {
      clearTimeout(autoTimer);
      autoTimer = setTimeout(advance, 1100 + el.text.textContent.length * 18);
    }
    if (skipMode && !el.choices.classList.contains("active")) {
      clearTimeout(autoTimer);
      autoTimer = setTimeout(advance, 120);
    }
  }

  // ============================================================
  //  Поток игры
  // ============================================================
  function startGame(fresh) {
    if (fresh || !state) {
      state = { passage: "start", vars: { name: "Роман", affection: 0, trust: 0 } };
      lineIdx = 0;
    }
    hideAllScreens();
    el.game.classList.add("active");
    buildParticles();
    enterPassage(state.passage, lineIdx);
  }

  function enterPassage(id, startLine = 0) {
    const p = STORY[id];
    if (!p) { console.error("Нет пассажа:", id); return; }
    state.passage = id;
    lineIdx = startLine;

    if (p.bg) setBackground(p.bg);
    if ("char" in p) setCharacter(p.char);
    if (p.expr) setExpr(p.expr);
    if ("blush" in p) setBlush(p.blush);

    el.choices.classList.remove("active");
    el.choices.innerHTML = "";
    el.dialogue.style.display = "block";

    renderLine();
  }

  function currentPassage() { return STORY[state.passage]; }

  function renderLine() {
    const p = currentPassage();
    const lines = p.lines || [];

    if (lineIdx >= lines.length) {
      resolveThen(p);
      return;
    }
    let line = lines[lineIdx];

    // строка может быть условной: { if:(v)=>..., line:{...} }
    if (typeof line === "function") line = line(state.vars) || { text: "" };
    if (line.cond && !line.cond(state.vars)) { lineIdx++; renderLine(); return; }

    // эффект на строке (изменение переменных, фон, персонаж)
    if (line.set) Object.assign(state.vars, line.set);
    if (line.bg) setBackground(line.bg);
    if ("char" in line) setCharacter(line.char);
    if (line.expr) setExpr(line.expr);
    if ("blush" in line) setBlush(line.blush);

    // адалт-гейт: если строка только для 18+, а режим мягкий — заменяем
    let text = line.text;
    if (line.adult) {
      text = cfg.adult ? line.adult : (line.soft || "…");
    }

    el.speaker.textContent = interp(line.who || "");
    el.text.className = "text" + (line.who ? "" : " narration");
    typeText(el.text, text);
  }

  function resolveThen(p) {
    const then = typeof p.then === "function" ? p.then(state.vars) : p.then;
    if (!then) { return; }
    if (then.ending) { showEnding(then.ending); return; }
    if (then.input) { renderInput(then.input); return; }
    if (then.choices) { renderChoices(then.choices); return; }
    if (then.goto) { enterPassage(then.goto, 0); return; }
  }

  function renderInput(spec) {
    el.dialogue.style.display = "none";
    el.choices.innerHTML = "";
    autoMode = skipMode = false; updateHud();

    const wrap = document.createElement("div");
    wrap.className = "choice";
    wrap.style.cursor = "default";
    wrap.innerHTML = `<span>${interp(spec.prompt || "Как тебя зовут?")}</span>`;

    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 16;
    input.placeholder = spec.placeholder || "имя";
    input.value = (state.vars[spec.var] && state.vars[spec.var] !== "ты") ? state.vars[spec.var] : "";
    Object.assign(input.style, {
      width: "100%", marginTop: "12px", padding: "12px 14px",
      borderRadius: "12px", border: "1px solid var(--panel-border)",
      background: "rgba(255,255,255,.06)", color: "var(--ink)",
      fontSize: "17px", fontFamily: "var(--sans)", outline: "none",
    });

    const ok = document.createElement("button");
    ok.className = "btn btn-primary";
    ok.textContent = "Дальше";
    ok.style.marginTop = "12px";
    const commit = () => {
      const v = input.value.trim();
      state.vars[spec.var] = v || (spec.fallback || "Незнакомец");
      el.choices.classList.remove("active");
      el.dialogue.style.display = "block";
      enterPassage(spec.goto, 0);
    };
    ok.addEventListener("click", commit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); });

    wrap.appendChild(input);
    wrap.appendChild(ok);
    el.choices.appendChild(wrap);
    el.choices.classList.add("active");
    setTimeout(() => input.focus(), 50);
  }

  function renderChoices(choices) {
    el.dialogue.style.display = "none";
    el.choices.innerHTML = "";
    autoMode = skipMode = false; updateHud();

    choices
      .filter(c => !c.cond || c.cond(state.vars))
      .forEach((c, i) => {
        const b = document.createElement("button");
        b.className = "choice";
        b.style.animationDelay = (i * 0.06) + "s";
        b.innerHTML = `<span>${interp(c.label)}</span>` + (c.hint ? `<span class="hint">${c.hint}</span>` : "");
        b.addEventListener("click", () => {
          if (c.set) {
            for (const k in c.set) {
              if (typeof c.set[k] === "number" && typeof state.vars[k] === "number")
                state.vars[k] += c.set[k];      // числовые — прибавляем (affection)
              else
                state.vars[k] = c.set[k];
            }
          }
          if (c.affection) state.vars.affection += c.affection;
          el.choices.classList.remove("active");
          el.dialogue.style.display = "block";
          enterPassage(c.goto, 0);
        });
        el.choices.appendChild(b);
      });
    el.choices.classList.add("active");
  }

  function advance() {
    if (el.choices.classList.contains("active")) return;
    if (typing) {                       // дописать мгновенно
      clearTimeout(typeTimer);
      const p = currentPassage();
      let line = p.lines[lineIdx];
      if (typeof line === "function") line = line(state.vars) || {};
      let t = line.adult ? (cfg.adult ? line.adult : (line.soft || "…")) : line.text;
      el.text.textContent = interp(t);
      finishTyping();
      return;
    }
    lineIdx++;
    renderLine();
  }

  // ============================================================
  //  Финал
  // ============================================================
  function showEnding(key) {
    const e = ENDINGS[key] || ENDINGS.warm;
    if (e.bg) setBackground(e.bg);
    setCharacter(null);
    $("#ending-title").textContent = e.title;
    $("#ending-text").textContent = interp(e.text);
    $("#ending-stat").textContent = "Близость: " + affLabel(state.vars.affection) + " · ты прошёл историю до конца ♡";
    el.game.classList.remove("active");
    show("ending");
    clearSave();
  }
  function affLabel(a) {
    if (a >= 7) return "пылкая";
    if (a >= 4) return "тёплая";
    if (a >= 1) return "робкая";
    return "сдержанная";
  }

  // ============================================================
  //  Сохранение
  // ============================================================
  function saveGame() {
    if (!state) return;
    saveJSON(SAVE_KEY, { passage: state.passage, lineIdx, vars: state.vars, ts: Date.now() });
    toast("Сохранено ♡");
    refreshContinue();
  }
  function clearSave() { localStorage.removeItem(SAVE_KEY); refreshContinue(); }
  function hasSave() { return !!localStorage.getItem(SAVE_KEY); }
  function refreshContinue() { el.continueBtn.disabled = !hasSave(); }

  function continueGame() {
    const s = loadJSON(SAVE_KEY, null);
    if (!s) { toast("Нет сохранения"); return; }
    state = { passage: s.passage, vars: s.vars };
    lineIdx = s.lineIdx || 0;
    startGame(false);
  }

  // ============================================================
  //  HUD / режимы
  // ============================================================
  function updateHud() {
    $("#hud-auto").classList.toggle("on", autoMode);
    $("#hud-skip").classList.toggle("on", skipMode);
  }

  // ============================================================
  //  Настройки UI
  // ============================================================
  function syncSettingsUI() {
    $("#set-speed").value = 60 - cfg.speed;   // ползунок: вправо = быстрее
    $("#set-adult").checked = cfg.adult;
    $("#set-particles").checked = cfg.particles;
    $("#age-safe").checked = !cfg.adult;
  }

  // ============================================================
  //  Привязка событий
  // ============================================================
  function bind() {
    // продвижение по клику/тапу/пробелу
    el.dialogue.addEventListener("click", advance);
    document.addEventListener("keydown", (e) => {
      if (!el.game.classList.contains("active")) return;
      if (e.code === "Space" || e.code === "Enter" || e.code === "ArrowRight") { e.preventDefault(); advance(); }
    });

    // меню
    document.querySelectorAll("[data-act]").forEach(b => {
      b.addEventListener("click", () => handleAct(b.dataset.act));
    });

    // возрастной шлюз
    $("#age-yes").addEventListener("click", () => {
      cfg.ageOK = true;
      cfg.adult = !$("#age-safe").checked;
      persistCfg();
      show(null);
      startGame(true);
    });
    $("#age-no").addEventListener("click", () => {
      show("menu");
      toast("История доступна только для 18+");
    });

    // настройки
    $("#set-speed").addEventListener("input", e => { cfg.speed = 60 - (+e.target.value); persistCfg(); });
    $("#set-adult").addEventListener("change", e => { cfg.adult = e.target.checked; persistCfg(); });
    $("#set-particles").addEventListener("change", e => { cfg.particles = e.target.checked; persistCfg(); if (el.game.classList.contains("active")) buildParticles(); });

    // HUD
    $("#hud-menu").addEventListener("click", () => { el.game.classList.remove("active"); show("menu"); });
    $("#hud-save").addEventListener("click", saveGame);
    $("#hud-auto").addEventListener("click", () => { autoMode = !autoMode; skipMode = false; updateHud(); if (autoMode && !typing) finishTyping(); });
    $("#hud-skip").addEventListener("click", () => { skipMode = !skipMode; autoMode = false; updateHud(); if (skipMode && !typing) advance(); });
  }

  function handleAct(act) {
    switch (act) {
      case "new":
        if (!cfg.ageOK) { show("agegate"); }
        else { syncSettingsUI(); show(null); startGame(true); }
        break;
      case "continue": continueGame(); break;
      case "settings": syncSettingsUI(); show("settings"); break;
      case "about": show("about"); break;
      case "close-settings":
      case "close-about": show("menu"); break;
      case "restart": show(null); startGame(true); break;
      case "to-menu": el.game.classList.remove("active"); show("menu"); break;
    }
  }

  // ============================================================
  //  Старт
  // ============================================================
  function init() {
    bind();
    refreshContinue();
    show("menu");
    el.character.dataset.expr = "neutral";
    setBackground("menu");
    buildParticles();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
