# 🎨 Как добавить красивый арт

Движок сам подхватывает картинки, если они лежат по нужным путям. Пока файла нет —
показывается встроенная SVG-заглушка. То есть можно добавлять арт постепенно.

## Куда класть файлы

```
assets/
├── bg/                     # фоны, 1280×800 (.jpg), горизонтальные
│   ├── menu.jpg
│   ├── phone.jpg
│   ├── cafe.jpg
│   ├── park_eve.jpg
│   ├── park_night.jpg      ← ключевая сцена со звёздами
│   ├── sky.jpg
│   ├── home.jpg
│   ├── bedroom.jpg
│   ├── dawn.jpg
│   └── morning.jpg
└── characters/
    └── anna/               # PNG с ПРОЗРАЧНЫМ фоном, ~900×1400, по центру
        ├── neutral.png
        ├── smile.png
        ├── happy.png
        ├── soft.png
        ├── laugh.png
        ├── surprise.png
        └── sad.png
```

Имена и форматы настраиваются в `js/assets.js` (например, `.png` вместо `.jpg` для фонов).

## ⭐ Главное правило для персонажа: один «лист» эмоций

Чтобы Анна на всех 7 картинках была **одним и тем же человеком**, генерируй их
**одной сессией** через "character sheet" или режим референса/консистентности
(в Midjourney — `--cref` / тот же seed; в большинстве сервисов — «character reference»).
Сначала сделай `neutral`, потом проси «то же лицо/причёска/одежда/ракурс, но выражение —
улыбка / смех / смущение …».

Технические требования к персонажу:
- **PNG с прозрачным фоном** (вырезанный по контуру), без рамок и подписей
- Поясной или ростовой план, фигура **по центру**, смотрит на зрителя
- Одинаковые свет, ракурс, причёска и одежда на всех эмоциях
- ~900×1400 px (вертикаль)

---

## 📝 Готовые промпты

### Анна (героиня) — базовый (neutral)

```
anime visual novel character sprite, single full-body portrait of a young woman
named Anna, mid-20s, warm chestnut wavy shoulder-length hair with a center part,
soft almond emerald-green eyes, gentle natural face, light freckles, wearing a
cozy cream knit off-shoulder sweater, calm soft smile, soft warm cinematic
lighting, clean cel-shaded anime style, highly detailed, looking at viewer,
standing centered, transparent background, full character, no text, no frame
--ar 2:3
```

Затем для каждой эмоции — добавляй к тому же референсу/seed:

| Файл | Что добавить в промпт |
|---|---|
| `neutral.png`  | `calm neutral expression, faint soft smile` |
| `smile.png`    | `warm gentle smile, happy eyes` |
| `happy.png`    | `bright cheerful smile, sparkling eyes, slightly raised brows` |
| `soft.png`     | `tender loving look, half-lidded eyes, light blush, slightly parted lips` |
| `laugh.png`    | `laughing happily, eyes closed in a smile, open joyful mouth` |
| `surprise.png` | `surprised expression, wide eyes, raised eyebrows, small open mouth, blush` |
| `sad.png`      | `sad melancholic expression, downcast eyes, slight frown, glistening eyes` |

> Важно дописывать в каждую: `same character, same hair, same outfit, same art style,
> transparent background, centered, no text`.

### Роман (опционально, если захочешь показывать его в кадре)

```
anime visual novel character sprite, young man named Roman, late 20s, amateur
photographer, dark tousled hair, warm brown eyes, light stubble, camera strap
over a casual olive jacket, kind confident look, clean cel-shaded anime style,
soft cinematic lighting, looking at viewer, centered, transparent background,
full character, no text --ar 2:3
```
(потом так же 7 эмоций; и добавь `roman` в `js/assets.js` → `chars`,
а в `story.js` используй `char: "roman"`.)

### Фоны (примеры)

```
park_night:  romantic anime visual novel background, summer city park at night,
  a wooden bench under tall trees, a clear sky full of stars and a bright
  constellation, soft moonlight, warm bokeh, no people, cinematic, detailed,
  horizontal --ar 16:10

cafe:        cozy small cafe interior, warm lamplight, wooden shelves with books
  and cups, a window with summer daylight, anime visual novel background, no
  people, detailed, horizontal --ar 16:10

park_eve:    summer park alley at golden sunset, warm orange and purple sky, trees,
  a path, flowers, anime visual novel background, no people, cinematic --ar 16:10

bedroom:     dim cozy bedroom at night, fairy lights over the window, soft warm
  glow, a bed, anime visual novel background, intimate mood, no people --ar 16:10
```
(аналогично: `menu`, `phone`, `sky`, `home`, `dawn`, `morning` — см. встроенные
SVG-сцены в `js/art.js` как ориентир по композиции.)

---

## После добавления файлов

Ничего пересобирать не нужно — просто положи картинки и обнови страницу.
Если назвал фоны `.png`, поменяй `bgExt: ".png"` в `js/assets.js`.

Совет: держи персонажей в **едином стиле** с фонами (один и тот же арт-стиль в
промптах — `clean cel-shaded anime style`), иначе спрайт будет «отклеиваться» от сцены.
