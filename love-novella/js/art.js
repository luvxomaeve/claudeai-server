/* ============================================================
   Созвездие наших чувств — художественная система (инлайн-SVG)
   Без внешних картинок: всё векторно, работает офлайн.
   SCENES[name]  -> разметка фона-локации
   CHARACTER     -> Анна, с переключаемой мимикой (data-expr)
   ============================================================ */

const SVG_OPEN = '<svg viewBox="0 0 1280 800" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">';

/* ---- звёздное поле ---- */
function stars(n, x, y, w, h, maxR) {
  let s = '<g>';
  for (let i = 0; i < n; i++) {
    const sx = (x + Math.random() * w).toFixed(0);
    const sy = (y + Math.random() * h).toFixed(0);
    const r = (0.6 + Math.random() * (maxR || 1.8)).toFixed(1);
    const o = (0.4 + Math.random() * 0.6).toFixed(2);
    const dur = (1.5 + Math.random() * 3).toFixed(1);
    s += `<circle cx="${sx}" cy="${sy}" r="${r}" fill="#fff" opacity="${o}">
      <animate attributeName="opacity" values="${o};${(o*0.25).toFixed(2)};${o}" dur="${dur}s" repeatCount="indefinite"/></circle>`;
  }
  return s + '</g>';
}
/* ---- созвездие: соединённые яркие звёзды ---- */
function constellation(pts, color) {
  let lines = '<g stroke="' + (color||'#bcd0ff') + '" stroke-width="1.4" opacity="0.5">';
  for (let i = 1; i < pts.length; i++)
    lines += `<line x1="${pts[i-1][0]}" y1="${pts[i-1][1]}" x2="${pts[i][0]}" y2="${pts[i][1]}"/>`;
  lines += '</g>';
  let dots = '<g>';
  for (const p of pts) {
    dots += `<circle cx="${p[0]}" cy="${p[1]}" r="${p[2]||3.5}" fill="#eaf0ff">
      <animate attributeName="r" values="${p[2]||3.5};${(p[2]||3.5)+1.5};${p[2]||3.5}" dur="3s" repeatCount="indefinite"/></circle>
      <circle cx="${p[0]}" cy="${p[1]}" r="${(p[2]||3.5)*2.4}" fill="#bcd0ff" opacity="0.25"/>`;
  }
  return lines + dots + '</g>';
}
function bokeh(cx, cy, spread, n, color) {
  let s = '<g>';
  for (let i = 0; i < n; i++) {
    const x = cx + (Math.random() - 0.5) * spread;
    const y = cy + (Math.random() - 0.5) * spread * 0.6;
    const r = 8 + Math.random() * 30;
    const o = (0.05 + Math.random() * 0.2).toFixed(2);
    s += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(0)}" fill="${color}" opacity="${o}">
      <animate attributeName="opacity" values="${o};${(o*0.3).toFixed(2)};${o}" dur="${(3+Math.random()*4).toFixed(1)}s" repeatCount="indefinite"/></circle>`;
  }
  return s + '</g>';
}

const SCENES = {

  /* ---------- Меню: звёздное небо над спящим городом ---------- */
  menu: SVG_OPEN + `
    <defs>
      <linearGradient id="m_sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#0c1230"/><stop offset="0.5" stop-color="#171a3a"/><stop offset="1" stop-color="#241a3a"/>
      </linearGradient>
      <radialGradient id="m_moon" cx="0.78" cy="0.22" r="0.18"><stop offset="0" stop-color="#fff6e0"/><stop offset="1" stop-color="#fff6e0" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="1280" height="800" fill="url(#m_sky)"/>
    ` + stars(180, 0, 0, 1280, 620, 2.2) + `
    <circle cx="1000" cy="170" r="52" fill="#fff4dc"/>
    <ellipse cx="1000" cy="170" rx="200" ry="200" fill="url(#m_moon)"/>
    ` + constellation([[300,140,4],[360,200,3],[430,180,3.5],[470,250,3],[540,210,4]], '#bcd0ff') + `
    <!-- холмы и деревья -->
    <path d="M0 620 q320 -60 640 -10 q320 50 640 -20 V800 H0 Z" fill="#10122a"/>
    <path d="M0 680 q420 -40 820 0 q300 30 460 -10 V800 H0 Z" fill="#0a0c1e"/>
    <g fill="#0a0c1e">
      <ellipse cx="180" cy="640" rx="60" ry="90"/><rect x="172" y="700" width="16" height="60"/>
      <ellipse cx="1080" cy="660" rx="70" ry="100"/><rect x="1072" y="730" width="18" height="60"/>
    </g>
  </svg>`,

  /* ---------- Телефон с приложением (знакомство) ---------- */
  phone: SVG_OPEN + `
    <defs>
      <linearGradient id="p_bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a2350"/><stop offset="1" stop-color="#14122a"/></linearGradient>
      <linearGradient id="p_land" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6b27a"/><stop offset="0.5" stop-color="#c87a8a"/><stop offset="1" stop-color="#4a3a6a"/></linearGradient>
    </defs>
    <rect width="1280" height="800" fill="url(#p_bg)"/>
    ` + bokeh(640, 400, 900, 24, '#8a7ad0') + `
    <!-- телефон -->
    <g transform="translate(470 90)">
      <rect x="0" y="0" width="340" height="640" rx="46" fill="#0d0b1a" stroke="#3a3460" stroke-width="4"/>
      <rect x="18" y="22" width="304" height="596" rx="30" fill="#1a1730"/>
      <rect x="130" y="34" width="80" height="14" rx="7" fill="#0d0b1a"/>
      <!-- пост с пейзажем -->
      <rect x="34" y="64" width="272" height="170" rx="14" fill="url(#p_land)"/>
      <circle cx="250" cy="110" r="22" fill="#fff3d0"/>
      <path d="M34 200 q70 -40 140 -10 q70 30 132 -6 V234 H34 Z" fill="#3a2a4a"/>
      <text x="48" y="262" fill="#cdc6ea" font-family="Manrope,sans-serif" font-size="15">Анна · закат у реки 🌄</text>
      <!-- сообщения -->
      <rect x="48" y="300" width="190" height="46" rx="16" fill="#2e2a52"/>
      <rect x="120" y="360" width="172" height="46" rx="16" fill="#caa15f"/>
      <rect x="48" y="420" width="150" height="40" rx="16" fill="#2e2a52"/>
      <rect x="140" y="476" width="152" height="40" rx="16" fill="#caa15f"/>
      <circle cx="170" cy="560" r="5" fill="#8a82c0"><animate attributeName="opacity" values="1;0.2;1" dur="1.2s" repeatCount="indefinite"/></circle>
      <circle cx="190" cy="560" r="5" fill="#8a82c0"><animate attributeName="opacity" values="1;0.2;1" dur="1.2s" begin="0.3s" repeatCount="indefinite"/></circle>
      <circle cx="210" cy="560" r="5" fill="#8a82c0"><animate attributeName="opacity" values="1;0.2;1" dur="1.2s" begin="0.6s" repeatCount="indefinite"/></circle>
    </g>
  </svg>`,

  /* ---------- Уютное кафе (первая встреча) ---------- */
  cafe: SVG_OPEN + `
    <defs>
      <linearGradient id="c_wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a4030"/><stop offset="1" stop-color="#2e2018"/></linearGradient>
      <radialGradient id="c_lamp" cx="0.5" cy="0" r="0.9"><stop offset="0" stop-color="#ffd98a" stop-opacity="0.9"/><stop offset="1" stop-color="#ffd98a" stop-opacity="0"/></radialGradient>
      <linearGradient id="c_win" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6a8ab0"/><stop offset="1" stop-color="#33506e"/></linearGradient>
    </defs>
    <rect width="1280" height="800" fill="url(#c_wall)"/>
    <!-- окно с летним днём -->
    <rect x="60" y="120" width="300" height="380" rx="10" fill="url(#c_win)"/>
    <circle cx="140" cy="200" r="34" fill="#fff3d0" opacity="0.8"/>
    <path d="M60 360 q70 -36 150 -8 q70 26 150 -6 V500 H60 Z" fill="#6a8a5a" opacity="0.6"/>
    <rect x="60" y="120" width="300" height="380" rx="10" fill="none" stroke="#1a120c" stroke-width="16"/>
    <line x1="210" y1="120" x2="210" y2="500" stroke="#1a120c" stroke-width="10"/>
    <line x1="60" y1="310" x2="360" y2="310" stroke="#1a120c" stroke-width="10"/>
    <!-- полки -->
    <g>
      <rect x="900" y="150" width="320" height="22" fill="#3a281c"/><rect x="900" y="270" width="320" height="22" fill="#3a281c"/>
      <g fill="#7a5a3a"><rect x="915" y="100" width="18" height="50"/><rect x="940" y="95" width="18" height="55"/><rect x="965" y="105" width="18" height="45"/></g>
      <g fill="#caa15f"><circle cx="1080" cy="138" r="14"/><circle cx="1120" cy="138" r="14"/><circle cx="1160" cy="138" r="14"/></g>
      <g fill="#7a5a3a"><rect x="915" y="222" width="18" height="48"/><rect x="940" y="218" width="18" height="52"/><rect x="965" y="225" width="18" height="45"/></g>
    </g>
    <!-- лампы -->
    <line x1="500" y1="0" x2="500" y2="120" stroke="#1a120c" stroke-width="4"/>
    <path d="M460 120 h80 l-14 46 h-52 z" fill="#caa15f"/>
    <ellipse cx="500" cy="180" rx="160" ry="120" fill="url(#c_lamp)"><animate attributeName="opacity" values="0.85;1;0.85" dur="5s" repeatCount="indefinite"/></ellipse>
    <!-- стойка и чашка -->
    <rect x="0" y="560" width="1280" height="240" fill="#241813"/><rect x="0" y="540" width="1280" height="30" fill="#3a281c"/>
    <g transform="translate(1040 500)">
      <path d="M0 20 h60 v34 a30 30 0 0 1 -60 0 z" fill="#efe3d2"/><ellipse cx="30" cy="20" rx="30" ry="9" fill="#cdbca6"/>
      <path d="M60 26 q24 4 18 26 q-6 16 -22 12" fill="none" stroke="#efe3d2" stroke-width="6"/>
      <g stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.5">
        <path d="M18 12 q-8 -16 0 -30"><animate attributeName="opacity" values="0;0.5;0" dur="3s" repeatCount="indefinite"/></path>
      </g>
    </g>
  </svg>`,

  /* ---------- Летний парк на закате ---------- */
  park_eve: SVG_OPEN + `
    <defs>
      <linearGradient id="pe_sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f6b27a"/><stop offset="0.4" stop-color="#e08a8a"/><stop offset="0.75" stop-color="#9a6aa0"/><stop offset="1" stop-color="#4a3a6a"/>
      </linearGradient>
      <radialGradient id="pe_sun" cx="0.5" cy="0.6" r="0.5"><stop offset="0" stop-color="#fff0c0" stop-opacity="0.9"/><stop offset="1" stop-color="#fff0c0" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="1280" height="800" fill="url(#pe_sky)"/>
    <circle cx="640" cy="420" r="60" fill="#fff3d0"/>
    <ellipse cx="640" cy="420" rx="360" ry="320" fill="url(#pe_sun)"/>
    <!-- аллея деревьев -->
    <g fill="#3a2a4a" opacity="0.9">
      <ellipse cx="160" cy="420" rx="90" ry="150"/><rect x="148" y="540" width="24" height="120"/>
      <ellipse cx="1120" cy="420" rx="90" ry="150"/><rect x="1108" y="540" width="24" height="120"/>
      <ellipse cx="360" cy="470" rx="60" ry="100"/><ellipse cx="920" cy="470" rx="60" ry="100"/>
    </g>
    <!-- дорожка и трава -->
    <path d="M0 660 q640 -40 1280 0 V800 H0 Z" fill="#3a4a32"/>
    <path d="M520 800 L600 640 L680 640 L760 800 Z" fill="#caa97a" opacity="0.7"/>
    <!-- цветы -->
    <g>${[120,300,980,1160].map(x=>`<circle cx="${x}" cy="700" r="6" fill="#f0d0e0"/><rect x="${x-2}" y="700" width="4" height="40" fill="#3a5a2a"/>`).join('')}</g>
    ` + bokeh(640, 600, 1000, 14, '#ffe0a0') + `
  </svg>`,

  /* ---------- Звёздный парк ночью (ключевая сцена) ---------- */
  park_night: SVG_OPEN + `
    <defs>
      <linearGradient id="pn_sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#0a1030"/><stop offset="0.55" stop-color="#161a44"/><stop offset="1" stop-color="#2a2050"/>
      </linearGradient>
      <radialGradient id="pn_glow" cx="0.5" cy="0.35" r="0.5"><stop offset="0" stop-color="#6a7ad0" stop-opacity="0.3"/><stop offset="1" stop-color="#6a7ad0" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="1280" height="800" fill="url(#pn_sky)"/>
    ` + stars(220, 0, 0, 1280, 600, 2.4) + `
    <ellipse cx="640" cy="280" rx="500" ry="300" fill="url(#pn_glow)"/>
    ` + constellation([[420,160,4],[500,230,3],[560,180,3.5],[640,250,4.5],[720,200,3],[800,270,3.5],[860,180,4]], '#cfe0ff') + `
    <!-- падающая звезда -->
    <g><line x1="200" y1="120" x2="320" y2="180" stroke="#fff" stroke-width="2" opacity="0">
      <animate attributeName="opacity" values="0;1;0" dur="1.4s" begin="2s;7s;13s" repeatCount="indefinite"/></line></g>
    <!-- деревья и силуэт скамьи -->
    <path d="M0 600 q640 -30 1280 0 V800 H0 Z" fill="#0a0c20"/>
    <g fill="#070818">
      <ellipse cx="150" cy="430" rx="90" ry="150"/><rect x="138" y="550" width="24" height="120"/>
      <ellipse cx="1130" cy="430" rx="90" ry="150"/><rect x="1118" y="550" width="24" height="120"/>
    </g>
    <!-- скамейка -->
    <g fill="#05060f">
      <rect x="540" y="640" width="200" height="14" rx="4"/><rect x="540" y="610" width="200" height="12" rx="4"/>
      <rect x="552" y="654" width="12" height="50"/><rect x="716" y="654" width="12" height="50"/>
    </g>
    <rect width="1280" height="800" fill="#080a1e" opacity="0.15"/>
  </svg>`,

  /* ---------- Небо в видоискателе (момент фото) ---------- */
  sky: SVG_OPEN + `
    <defs>
      <linearGradient id="sk_sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#070b26"/><stop offset="1" stop-color="#1a1840"/></linearGradient>
    </defs>
    <rect width="1280" height="800" fill="url(#sk_sky)"/>
    ` + stars(260, 0, 0, 1280, 800, 2.6) + constellation([[460,250,4],[560,200,3.5],[640,300,5],[720,210,3.5],[820,260,4],[640,300,5],[600,400,3],[680,400,3]], '#dfe8ff') + `
    <!-- рамка видоискателя -->
    <g stroke="#eaf0ff" stroke-width="3" fill="none" opacity="0.8">
      <path d="M150 150 h70 M150 150 v70"/><path d="M1130 150 h-70 M1130 150 v70"/>
      <path d="M150 650 h70 M150 650 v-70"/><path d="M1130 650 h-70 M1130 650 v-70"/>
      <circle cx="640" cy="400" r="40" opacity="0.5"/>
      <line x1="600" y1="400" x2="680" y2="400" opacity="0.5"/><line x1="640" y1="360" x2="640" y2="440" opacity="0.5"/>
    </g>
    <text x="180" y="630" fill="#9aff9a" font-family="monospace" font-size="22" opacity="0.8">● REC  f/1.8  ISO3200</text>
    <!-- вспышка кадра -->
    <rect width="1280" height="800" fill="#fff" opacity="0"><animate attributeName="opacity" values="0;0.7;0" dur="0.5s" begin="1s" repeatCount="1"/></rect>
  </svg>`,

  /* ---------- Уютная квартира ---------- */
  home: SVG_OPEN + `
    <defs>
      <linearGradient id="h_wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2a3a"/><stop offset="1" stop-color="#201620"/></linearGradient>
      <radialGradient id="h_lamp" cx="0.8" cy="0.3" r="0.7"><stop offset="0" stop-color="#ffb877" stop-opacity="0.9"/><stop offset="1" stop-color="#ffb877" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="1280" height="800" fill="url(#h_wall)"/>
    <!-- стена с фотографиями (Максим — фотограф) -->
    <g>
      ${[[120,140],[260,150],[400,135],[180,290],[330,300]].map(([x,y])=>`<rect x="${x}" y="${y}" width="110" height="84" rx="4" fill="#161018" stroke="#caa15f" stroke-width="3"/><rect x="${x+8}" y="${y+8}" width="94" height="68" fill="#3a4a6a"/><circle cx="${x+30}" cy="${y+30}" r="10" fill="#f0c98a"/>`).join('')}
    </g>
    <!-- торшер -->
    <rect x="980" y="180" width="14" height="380" fill="#1a1014"/>
    <path d="M945 120 h84 l-18 60 h-48 z" fill="#e8b97a"/>
    <ellipse cx="987" cy="200" rx="200" ry="220" fill="url(#h_lamp)"/>
    <!-- диван -->
    <g>
      <rect x="700" y="560" width="500" height="160" rx="24" fill="#5a3a48"/>
      <rect x="700" y="520" width="500" height="80" rx="24" fill="#6a4252"/>
      <rect x="730" y="540" width="120" height="90" rx="16" fill="#7a4a5a"/>
      <rect x="1050" y="540" width="120" height="90" rx="16" fill="#7a4a5a"/>
    </g>
    <rect x="0" y="700" width="1280" height="100" fill="#181018"/>
  </svg>`,

  /* ---------- Спальня, полумрак ---------- */
  bedroom: SVG_OPEN + `
    <defs>
      <linearGradient id="b_wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2048"/><stop offset="1" stop-color="#140c20"/></linearGradient>
      <linearGradient id="b_win" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#101638"/><stop offset="1" stop-color="#0a0c1e"/></linearGradient>
      <radialGradient id="b_warm" cx="0.5" cy="0.5" r="0.7"><stop offset="0" stop-color="#e89a8a" stop-opacity="0.35"/><stop offset="1" stop-color="#e89a8a" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="1280" height="800" fill="url(#b_wall)"/>
    <rect x="120" y="90" width="320" height="430" rx="12" fill="url(#b_win)"/>
    ` + stars(40, 130, 100, 300, 200, 1.8) + `
    <rect x="120" y="90" width="320" height="430" rx="12" fill="none" stroke="#120a1c" stroke-width="16"/>
    <line x1="280" y1="90" x2="280" y2="520" stroke="#120a1c" stroke-width="9"/>
    <path d="M120 90 q160 60 320 0" fill="none" stroke="#2a1620" stroke-width="3"/>
    <g fill="#ffcf8a">${[160,210,260,310,360].map((x,i)=>`<circle cx="${x}" cy="${108+Math.sin(i)*8}" r="6"><animate attributeName="opacity" values="0.5;1;0.5" dur="${2+i*0.3}s" repeatCount="indefinite"/></circle>`).join('')}</g>
    <g>
      <rect x="560" y="430" width="700" height="60" rx="16" fill="#3a2f5c"/>
      <rect x="560" y="470" width="700" height="280" rx="20" fill="#4a4170"/>
      <rect x="560" y="470" width="700" height="150" rx="20" fill="#564d80"/>
      <ellipse cx="700" cy="500" rx="90" ry="46" fill="#e9d4c4"/><ellipse cx="850" cy="500" rx="90" ry="46" fill="#e9d4c4"/>
    </g>
    <ellipse cx="780" cy="560" rx="520" ry="320" fill="url(#b_warm)"/>
    <rect width="1280" height="800" fill="#140a1e" opacity="0.25"/>
  </svg>`,

  /* ---------- Рассвет ---------- */
  dawn: SVG_OPEN + `
    <defs>
      <linearGradient id="d_sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3b8a8"/><stop offset="0.45" stop-color="#c98aa0"/><stop offset="1" stop-color="#5a3a52"/></linearGradient>
      <radialGradient id="d_sun" cx="0.7" cy="0.35" r="0.4"><stop offset="0" stop-color="#fff0d0" stop-opacity="0.95"/><stop offset="1" stop-color="#fff0d0" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="1280" height="800" fill="#241620"/>
    <rect x="180" y="60" width="920" height="620" rx="14" fill="url(#d_sky)"/>
    <circle cx="820" cy="280" r="70" fill="#fff0d0"/><ellipse cx="820" cy="280" rx="320" ry="320" fill="url(#d_sun)"/>
    <g fill="#3a2438" opacity="0.85"><rect x="180" y="520" width="200" height="160"/><polygon points="380,520 460,460 540,520"/><rect x="540" y="540" width="160" height="140"/><rect x="940" y="500" width="160" height="180"/></g>
    <rect x="180" y="60" width="920" height="620" rx="14" fill="none" stroke="#1a0f16" stroke-width="22"/>
    <line x1="640" y1="60" x2="640" y2="680" stroke="#1a0f16" stroke-width="12"/>
    <line x1="180" y1="370" x2="1100" y2="370" stroke="#1a0f16" stroke-width="12"/>
  </svg>`,

  /* ---------- Солнечное утро ---------- */
  morning: SVG_OPEN + `
    <defs>
      <linearGradient id="mo_wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0d9b8"/><stop offset="1" stop-color="#c79a78"/></linearGradient>
      <radialGradient id="mo_sun" cx="0.2" cy="0.1" r="0.8"><stop offset="0" stop-color="#fff6e0" stop-opacity="0.9"/><stop offset="1" stop-color="#fff6e0" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="1280" height="800" fill="url(#mo_wall)"/>
    <ellipse cx="220" cy="100" rx="520" ry="460" fill="url(#mo_sun)"/>
    <rect x="820" y="120" width="340" height="320" rx="10" fill="#bfe0ef"/>
    <rect x="820" y="120" width="340" height="320" rx="10" fill="none" stroke="#8a6a4a" stroke-width="16"/>
    <line x1="990" y1="120" x2="990" y2="440" stroke="#8a6a4a" stroke-width="9"/>
    <g fill="#7fae6a" opacity="0.85"><ellipse cx="860" cy="430" rx="40" ry="60"/><ellipse cx="1130" cy="430" rx="40" ry="60"/></g>
    <rect x="0" y="560" width="1280" height="240" fill="#9a6b4a"/><rect x="0" y="540" width="1280" height="26" fill="#b0855f"/>
    <g transform="translate(560 506)" fill="#fff"><path d="M0 16 h48 v26 a24 24 0 0 1 -48 0 z"/><ellipse cx="24" cy="16" rx="24" ry="7" fill="#e8dccb"/></g>
  </svg>`,
};

/* aliases на случай старых имён */
SCENES.rain = SCENES.menu;
SCENES.street = SCENES.menu;
SCENES.cafe_eve = SCENES.cafe;

/* ============================================================
   ГЕРОИНЯ — Анна. Мимика: data-expr; румянец: data-blush="1".
   ============================================================ */
const CHARACTER = `
<svg viewBox="0 0 600 820" preserveAspectRatio="xMidYMax meet" xmlns="http://www.w3.org/2000/svg" class="anna-svg">
  <defs>
    <linearGradient id="hair" x1="0.2" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="#7a5038"/><stop offset="0.55" stop-color="#5a3526"/><stop offset="1" stop-color="#3a2018"/></linearGradient>
    <linearGradient id="hairhi" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c89368" stop-opacity="0.9"/><stop offset="1" stop-color="#9a6a4a" stop-opacity="0"/></linearGradient>
    <linearGradient id="skin" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="#fbe6d6"/><stop offset="1" stop-color="#f1ccb4"/></linearGradient>
    <linearGradient id="cloth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0e7d8"/><stop offset="1" stop-color="#d6c6ad"/></linearGradient>
    <radialGradient id="iris" cx="0.5" cy="0.32" r="0.7"><stop offset="0" stop-color="#7fd0aa"/><stop offset="0.5" stop-color="#3f9476"/><stop offset="1" stop-color="#214c3c"/></radialGradient>
    <radialGradient id="blush" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#f5908e" stop-opacity="0.8"/><stop offset="1" stop-color="#f5908e" stop-opacity="0"/></radialGradient>
    <clipPath id="eyeL"><path d="M222 360 Q258 332 296 358 Q284 384 258 386 Q232 382 222 360 Z"/></clipPath>
    <clipPath id="eyeR"><path d="M378 360 Q342 332 304 358 Q316 384 342 386 Q368 382 378 360 Z"/></clipPath>
  </defs>

  <!-- волосы сзади (длинные, волнистые) -->
  <path d="M188 360 C176 198 252 148 300 148 C348 148 424 198 412 360 C438 540 408 668 390 726 C404 548 388 402 300 398 C212 402 196 548 210 726 C192 668 162 540 188 360 Z" fill="url(#hair)"/>

  <!-- плечи / уютный свитер -->
  <path d="M150 820 C150 686 212 610 300 610 C388 610 450 686 450 820 Z" fill="url(#cloth)"/>
  <path d="M150 820 C152 712 196 648 250 624 L262 820 Z" fill="#dccdb4" opacity="0.7"/>
  <path d="M450 820 C448 712 404 648 350 624 L338 820 Z" fill="#dccdb4" opacity="0.7"/>
  <!-- вырез -->
  <path d="M258 616 Q300 660 342 616 L334 676 Q300 700 266 676 Z" fill="#f5ddc9"/>
  <path d="M258 616 Q300 656 342 616" fill="none" stroke="#c9b79a" stroke-width="4"/>

  <!-- шея -->
  <path d="M276 486 h48 v52 q-24 20 -48 0 z" fill="#f1ccb4"/>
  <path d="M276 500 q24 16 48 0 v8 q-24 16 -48 0 z" fill="#e3b497" opacity="0.5"/>

  <!-- лицо -->
  <path d="M214 330 C214 250 250 215 300 215 C350 215 386 250 386 330 C386 412 350 472 300 502 C250 472 214 412 214 330 Z" fill="url(#skin)"/>
  <!-- лёгкая тень под чёлкой -->
  <path d="M222 300 Q300 270 378 300 Q300 318 222 300 Z" fill="#e6b89b" opacity="0.45"/>
  <!-- ушки -->
  <path d="M214 352 q-20 4 -16 30 q4 18 18 14 z" fill="#f1ccb4"/>
  <path d="M386 352 q20 4 16 30 q-4 18 -18 14 z" fill="#f1ccb4"/>

  <!-- румянец -->
  <g class="blush"><ellipse cx="250" cy="404" rx="32" ry="18" fill="url(#blush)"/><ellipse cx="350" cy="404" rx="32" ry="18" fill="url(#blush)"/></g>

  <!-- брови -->
  <g class="brows" stroke="#7a5038" stroke-width="5.5" stroke-linecap="round" fill="none">
    <path class="brow-l" d="M226 322 Q258 308 290 318"/>
    <path class="brow-r" d="M374 322 Q342 308 310 318"/>
  </g>

  <!-- ГЛАЗА -->
  <g class="eyes">
    <!-- белки -->
    <path d="M222 360 Q258 332 296 358 Q284 384 258 386 Q232 382 222 360 Z" fill="#fff7f4"/>
    <path d="M378 360 Q342 332 304 358 Q316 384 342 386 Q368 382 378 360 Z" fill="#fff7f4"/>
    <!-- радужки + зрачки + блики (в клипе) -->
    <g clip-path="url(#eyeL)">
      <ellipse cx="258" cy="360" rx="19" ry="25" fill="url(#iris)"/>
      <ellipse cx="258" cy="347" rx="19" ry="8" fill="#103024" opacity="0.3"/>
      <ellipse cx="258" cy="362" rx="8" ry="12" fill="#12231b"/>
      <circle cx="250" cy="350" r="7" fill="#ffffff" opacity="0.95"/>
      <circle cx="265" cy="371" r="3.5" fill="#ffffff" opacity="0.8"/>
    </g>
    <g clip-path="url(#eyeR)">
      <ellipse cx="342" cy="360" rx="19" ry="25" fill="url(#iris)"/>
      <ellipse cx="342" cy="347" rx="19" ry="8" fill="#103024" opacity="0.3"/>
      <ellipse cx="342" cy="362" rx="8" ry="12" fill="#12231b"/>
      <circle cx="334" cy="350" r="7" fill="#ffffff" opacity="0.95"/>
      <circle cx="349" cy="371" r="3.5" fill="#ffffff" opacity="0.8"/>
    </g>
    <!-- верхняя линия ресниц + уголок -->
    <path d="M221 360 Q257 330 297 356" fill="none" stroke="#2a121c" stroke-width="7" stroke-linecap="round"/>
    <path d="M379 360 Q343 330 303 356" fill="none" stroke="#2a121c" stroke-width="7" stroke-linecap="round"/>
    <path d="M216 354 l13 8 l-1 -14 z" fill="#2a121c"/>
    <path d="M384 354 l-13 8 l1 -14 z" fill="#2a121c"/>
    <!-- складка века -->
    <path d="M232 350 Q258 334 286 348" fill="none" stroke="#dca78c" stroke-width="2.5" stroke-linecap="round" opacity="0.7"/>
    <path d="M368 350 Q342 334 314 348" fill="none" stroke="#dca78c" stroke-width="2.5" stroke-linecap="round" opacity="0.7"/>
    <!-- нижние ресницы -->
    <path d="M240 384 Q258 388 276 382" fill="none" stroke="#7a3a40" stroke-width="2.5" stroke-linecap="round" opacity="0.55"/>
    <path d="M360 384 Q342 388 324 382" fill="none" stroke="#7a3a40" stroke-width="2.5" stroke-linecap="round" opacity="0.55"/>
    <!-- веки для прищура/нежности (скрыты, опускаются через CSS) -->
    <path class="lid-l" d="M220 360 Q258 328 298 356 Q298 372 258 378 Q232 372 220 360 Z" fill="url(#skin)"/>
    <path class="lid-r" d="M380 360 Q342 328 302 356 Q302 372 342 378 Q368 372 380 360 Z" fill="url(#skin)"/>
  </g>

  <!-- нос -->
  <path d="M297 392 Q292 406 301 410" fill="none" stroke="#e2a684" stroke-width="3" stroke-linecap="round" opacity="0.8"/>

  <!-- РОТ -->
  <g class="mouths">
    <path class="m-neutral" d="M285 446 Q300 454 315 446" fill="none" stroke="#cf7e78" stroke-width="4.5" stroke-linecap="round"/>
    <g class="m-smile"><path d="M282 444 Q300 464 318 444 Q300 454 282 444 Z" fill="#d98a86"/><path d="M286 446 Q300 451 314 446" fill="none" stroke="#fff" stroke-width="2" opacity="0.5"/></g>
    <path class="m-soft" d="M288 448 Q300 454 312 448" fill="none" stroke="#cf7e78" stroke-width="4.5" stroke-linecap="round"/>
    <g class="m-laugh"><path d="M283 442 Q300 474 317 442 Q300 452 283 442 Z" fill="#c2706c"/><path d="M291 460 Q300 466 309 460" fill="#e89a96"/></g>
    <ellipse class="m-surprise" cx="300" cy="450" rx="9" ry="12" fill="#c2706c"/>
    <path class="m-sad" d="M286 452 Q300 444 314 452" fill="none" stroke="#cf7e78" stroke-width="4.5" stroke-linecap="round"/>
  </g>

  <!-- ЧЁЛКА (поверх лица) -->
  <path d="M205 342 C196 218 250 172 304 174 C300 256 280 304 244 330 C268 316 292 300 302 266 C296 312 252 336 205 342 Z" fill="url(#hair)"/>
  <path d="M395 342 C404 218 350 172 296 174 C300 256 320 304 356 330 C332 316 308 300 298 266 C304 312 348 336 395 342 Z" fill="url(#hair)"/>
  <path d="M300 176 C282 176 266 230 256 296 C250 244 270 196 300 188 C330 196 350 244 344 296 C334 230 318 176 300 176 Z" fill="url(#hair)"/>
  <!-- блик на волосах -->
  <path d="M236 232 Q300 196 366 232 Q300 216 236 232 Z" fill="url(#hairhi)" opacity="0.8"/>
  <path d="M250 258 Q272 232 296 250 Q276 248 250 258 Z" fill="#c89368" opacity="0.5"/>
  <!-- боковые пряди вдоль лица -->
  <path d="M206 342 C188 446 198 556 220 656 C232 566 220 458 230 372 C222 360 212 350 206 342 Z" fill="url(#hair)"/>
  <path d="M394 342 C412 446 402 556 380 656 C368 566 380 458 370 372 C378 360 388 350 394 342 Z" fill="url(#hair)"/>
</svg>`;
