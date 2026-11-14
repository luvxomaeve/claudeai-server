#!/usr/bin/env python3
"""Ужимает VRM/GLB без видимой потери: убирает одинаковые картинки,
уменьшает текстуры больше MAX до MAX, пересжимает PNG (lossless, optimize).
Геометрию, кости, VRM-расширения не трогает — только картинки и раскладку буфера.
Использование: python3 optimize-vrm.py in.vrm out.vrm [MAX=1024]"""
import io, json, struct, sys, hashlib
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
MAX = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
b = open(src, 'rb').read()
jl = struct.unpack('<I', b[12:16])[0]
j = json.loads(b[20:20 + jl])
bin_off = 20 + jl + 8
binlen = struct.unpack('<I', b[20 + jl:24 + jl])[0]
BIN = b[bin_off:bin_off + binlen]

def view_bytes(i):
    bv = j['bufferViews'][i]
    o = bv.get('byteOffset', 0)
    return BIN[o:o + bv['byteLength']]

# 1. Картинки: дедуп и пересжатие.
img_views = {im['bufferView'] for im in j.get('images', []) if 'bufferView' in im}
new_img_data = {}
seen = {}
remap_img = {}
for idx, im in enumerate(j.get('images', [])):
    if 'bufferView' not in im:
        continue
    raw = view_bytes(im['bufferView'])
    h = hashlib.sha1(raw).hexdigest()
    if h in seen:
        remap_img[idx] = seen[h]
        continue
    seen[h] = idx
    data = raw
    try:
        I = Image.open(io.BytesIO(raw))
        I.load()
        w, hgt = I.size
        changed = False
        if max(w, hgt) > MAX:
            k = MAX / max(w, hgt)
            I = I.resize((max(1, round(w * k)), max(1, round(hgt * k))), Image.LANCZOS)
            changed = True
        if (im.get('mimeType') or 'image/png') == 'image/png':
            out = io.BytesIO()
            I.save(out, 'PNG', optimize=True)
            if changed or len(out.getvalue()) < len(raw):
                data = out.getvalue()
    except Exception as e:
        print('skip image', idx, e)
    new_img_data[im['bufferView']] = data

# Текстуры, ссылающиеся на дубликаты, — на первую копию.
for t in j.get('textures', []):
    if t.get('source') in remap_img:
        t['source'] = remap_img[t['source']]
# Дубликаты картинок помечаем как неиспользуемые: оставляем запись (индексы не сдвигаем),
# но направляем её на bufferView первой копии.
for dup, first in remap_img.items():
    j['images'][dup]['bufferView'] = j['images'][first]['bufferView']

used_views = set()
def mark(o):
    if isinstance(o, dict):
        for k, v in o.items():
            if k == 'bufferView' and isinstance(v, int):
                used_views.add(v)
            else:
                mark(v)
    elif isinstance(o, list):
        for v in o:
            mark(v)
mark({k: v for k, v in j.items() if k != 'bufferViews'})

# 2. Пересобираем BIN: все bufferViews заново, по порядку, с выравниванием 4.
out_bin = bytearray()
for i, bv in enumerate(j['bufferViews']):
    data = new_img_data.get(i, None)
    if data is None:
        data = view_bytes(i) if i in used_views else b''
    while len(out_bin) % 4:
        out_bin += b'\0'
    bv['byteOffset'] = len(out_bin)
    bv['byteLength'] = len(data)
    bv['buffer'] = 0
    out_bin += data
while len(out_bin) % 4:
    out_bin += b'\0'
j['buffers'] = [{'byteLength': len(out_bin)}]

js = json.dumps(j, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
while len(js) % 4:
    js += b' '
total = 12 + 8 + len(js) + 8 + len(out_bin)
with open(dst, 'wb') as f:
    f.write(struct.pack('<4sII', b'glTF', 2, total))
    f.write(struct.pack('<I4s', len(js), b'JSON'))
    f.write(js)
    f.write(struct.pack('<I4s', len(out_bin), b'BIN\0'))
    f.write(out_bin)
print(f'{src}: {len(b)//1024} KB -> {total//1024} KB')
