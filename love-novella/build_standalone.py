#!/usr/bin/env python3
"""
Собирает игру «Созвездие наших чувств» в ОДИН автономный HTML-файл.

Внутрь вшиваются:
  - css/style.css            -> <style>
  - js/{art,assets,story,engine}.js -> <script>
  - все PNG-спрайты персонажей -> data:URI (карта EMBED)

Картинки подменяются на лету: маленький шим переопределяет
HTMLImageElement.src, так что относительные пути вида
"assets/characters/anna/neutral.png" заменяются на встроенные data:URI.
Фоны (assets/bg) сейчас пустые -> движок сам рисует SVG-фон.

Запуск:  python3 build_standalone.py
Результат: standalone.html  (просто открой в браузере / на телефоне)
"""
import base64
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))


def read(path):
    with open(os.path.join(ROOT, path), "r", encoding="utf-8") as f:
        return f.read()


def collect_images():
    """Возвращает {относительный_путь: data_uri} для всех картинок-ассетов."""
    embed = {}
    base = os.path.join(ROOT, "assets")
    for dirpath, _dirs, files in os.walk(base):
        for name in files:
            if not name.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                continue
            abspath = os.path.join(dirpath, name)
            rel = os.path.relpath(abspath, ROOT).replace(os.sep, "/")
            mime = "image/png"
            if name.lower().endswith((".jpg", ".jpeg")):
                mime = "image/jpeg"
            elif name.lower().endswith(".webp"):
                mime = "image/webp"
            with open(abspath, "rb") as fh:
                b64 = base64.b64encode(fh.read()).decode("ascii")
            embed[rel] = f"data:{mime};base64,{b64}"
    return embed


def build():
    html = read("index.html")
    css = read("css/style.css")
    js_files = ["js/art.js", "js/assets.js", "js/story.js", "js/engine.js"]
    js_blob = "\n".join(f"/* ==== {p} ==== */\n{read(p)}" for p in js_files)
    embed = collect_images()

    import json
    embed_js = "var EMBED = " + json.dumps(embed, ensure_ascii=False) + ";"

    shim = """
/* === АВТОНОМНЫЙ РЕЖИМ: подмена путей картинок на встроенные data:URI === */
(function(){
  var d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    enumerable: true,
    get: function(){ return d.get.call(this); },
    set: function(v){
      if (typeof v === 'string' && EMBED[v]) v = EMBED[v];
      d.set.call(this, v);
    }
  });
})();
"""

    # 1) внешний CSS -> инлайн
    html = html.replace(
        '<link rel="stylesheet" href="css/style.css" />',
        "<style>\n" + css + "\n</style>",
    )

    # 2) убрать внешние <script src="js/...">
    html = re.sub(r'\s*<script src="js/[^"]+"></script>', "", html)

    # 3) вставить единый блок JS перед </body>
    bundle = (
        "<script>\n"
        + embed_js
        + "\n"
        + shim
        + "\n"
        + js_blob
        + "\n</script>\n"
    )
    html = html.replace("</body>", bundle + "</body>")

    out = os.path.join(ROOT, "standalone.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)

    size = os.path.getsize(out)
    print(f"OK -> {out}  ({size/1024:.0f} KB, {len(embed)} картинок вшито)")


if __name__ == "__main__":
    build()
