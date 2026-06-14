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

## 🤖 Если генеришь в Grok (xAI / Aurora)

Grok не понимает флаги вроде `--ar` — пиши обычным текстом. Главное — **консистентность
персонажа** через загрузку референса.

**Процесс:**
1. Сгенерируй базовую Анну (промпт ниже), выбери удачный вариант.
2. **Загрузи эту картинку обратно в Grok** и проси: «тот же самый персонаж — то же
   лицо, причёска, одежда и стиль; измени только выражение на …». Повтори для 7 эмоций.
3. Grok плохо делает прозрачный фон → генерируй на **однотонном светло-сером фоне**,
   потом вырежи через remove.bg и сохрани PNG с нужным именем.

**Базовая Анна (neutral):**
```
Красивый персонаж в стиле аниме-новеллы: девушка по имени Анна, около 25 лет, тёплые
каштановые волнистые волосы до плеч с пробором по центру, мягкие миндалевидные
изумрудно-зелёные глаза, нежное лицо с лёгкими веснушками, уютный кремовый свитер с
открытыми плечами. Чистая аниме-иллюстрация (cel-shaded), мягкий тёплый свет. Поясной
план, по центру, смотрит на зрителя, спокойная мягкая улыбка. Однотонный светло-серый
фон. Вертикальный портрет, высокое качество.
```

**Эмоции** (дописывай к загруженному референсу «тот же персонаж, меняю только выражение»):
- `smile` — тёплая мягкая улыбка, добрые глаза
- `happy` — яркая радостная улыбка, сияющие глаза, чуть приподнятые брови
- `soft` — нежный влюблённый взгляд, полуприкрытые глаза, лёгкий румянец, чуть приоткрытые губы
- `laugh` — искренний смех, глаза прикрыты в улыбке, открытый радостный рот
- `surprise` — удивление, широко раскрытые глаза, приподнятые брови, маленький открытый рот, румянец
- `sad` — грусть, опущенный взгляд, лёгкая печаль, блестящие глаза

**Фоны для Grok** (без людей, широкий горизонтальный кадр):
```
park_night: романтичный фон аниме-новеллы — летний городской парк ночью, деревянная
скамейка под высокими деревьями, чистое небо, полное звёзд, яркое созвездие, мягкий
лунный свет, тёплое боке, без людей, кинематографично, широкий горизонтальный кадр.

cafe: уютный интерьер маленького кафе, тёплый свет ламп, деревянные полки с книгами и
чашками, окно с летним дневным светом, фон аниме-новеллы, без людей, горизонтальный.

park_eve: аллея летнего парка на закате, тёплое оранжево-фиолетовое небо, деревья,
дорожка, цветы, фон аниме-новеллы, без людей, кинематографично, горизонтальный.

bedroom: тёмная уютная спальня ночью, гирлянда над окном, мягкое тёплое свечение,
кровать, фон аниме-новеллы, интимное настроение, без людей, горизонтальный.
```

---

## После добавления файлов

Ничего пересобирать не нужно — просто положи картинки и обнови страницу.
Если назвал фоны `.png`, поменяй `bgExt: ".png"` в `js/assets.js`.

Совет: держи персонажей в **едином стиле** с фонами (один и тот же арт-стиль в
промптах — `clean cel-shaded anime style`), иначе спрайт будет «отклеиваться» от сцены.
