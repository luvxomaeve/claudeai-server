---
name: gen
description: Generate images and videos using Google Gemini API (Imagen, Veo). Trigger when user asks to generate, create, draw, or make an image/picture/photo/video, or mentions Imagen/Veo/Gemini generation. Also trigger on commands like /img, /image, /video, /gen.
allowed-tools: Bash,Read,Write,Edit
---

# Gemini Generation Skill

Generate images (Imagen) and videos (Veo) via Google Gemini API.

## Commands

User can trigger generation with these patterns:
- `/img <prompt>` or `/image <prompt>` — generate image (default: Imagen 4 Ultra)
- `/video <prompt>` — generate video (default: Veo 3)
- `/gen` — show generation menu with model buttons
- Or natural language: "сгенерируй картинку ...", "нарисуй ...", "сделай видео ..."

## Available Models

**Images (Imagen):**
- `imagen-4-ultra` — максимальное качество (по умолчанию)
- `imagen-4` — хорошее качество, быстрее
- `imagen-4-fast` — быстрая генерация
- `imagen-3` — предыдущее поколение

**Video (Veo):**
- `veo-3.1` — новейший, лучшее качество (preview)
- `veo-3` — высокое качество + звук (по умолчанию)
- `veo-3-fast` — быстрая генерация
- `veo-2` — хорошее качество

**Aspect ratios:** 1:1, 16:9, 9:16, 4:3, 3:4

## Generation Tool

```bash
# Image
python3 tools/media_tools/gemini_generate.py --type image --prompt "PROMPT" --model MODEL --aspect RATIO --count N

# Video
python3 tools/media_tools/gemini_generate.py --type video --prompt "PROMPT" --model MODEL --aspect RATIO --duration SEC

# With reference image
python3 tools/media_tools/gemini_generate.py --type image --prompt "PROMPT" --reference /path/to/image.jpg
```

## Behavior Rules

1. **Parse user request** — extract prompt, detect if image or video, detect model preference
2. **Default models** — Imagen 4 Ultra for images, Veo 3 for video
3. **Run generation** via the tool script above
4. **Send result** with `<file:/path/to/output>`
5. **Offer follow-up buttons** after generation:

### After image generation:
```
[button:🔄 Ещё вариант] [button:📐 16:9]
[button:🎨 Imagen 4 Fast] [button:⭐ Imagen 4 Ultra]
[button:🎬 Видео из этого]
```

### After video generation:
```
[button:🔄 Ещё вариант] [button:📐 9:16]
[button:⚡ Veo 3 Fast] [button:🌟 Veo 3.1]
```

### On /gen command — show full menu:
```
Что сгенерировать?

[button:🖼 Картинку] [button:🎬 Видео]
```

Then after type selection, show model choice:

For image:
```
Выбери модель:

[button:⭐ Imagen 4 Ultra] [button:🎨 Imagen 4]
[button:⚡ Imagen 4 Fast] [button:📷 Imagen 3]
```

For video:
```
Выбери модель:

[button:🌟 Veo 3.1] [button:🎬 Veo 3]
[button:⚡ Veo 3 Fast] [button:📹 Veo 2]
```

Then ask for prompt.

6. **If user sends a photo with caption** — use the photo as reference image for editing
7. **Video generation takes time** (~1-3 min) — warn user and send status updates
8. **Aspect ratio shortcuts**: "вертикальное"/"для сторис" → 9:16, "широкое"/"для ютуба" → 16:9, "квадрат" → 1:1
9. **Multiple images**: if user asks "несколько вариантов" or "4 варианта" → use --count (max 4)
10. **Language**: respond in Russian, prompts for Gemini can be in English or Russian (Gemini handles both)

## Error Handling

- If generation fails with safety filter → tell user to rephrase prompt
- If API quota exceeded → tell user to wait
- If model not available → fallback to next best model and inform user
