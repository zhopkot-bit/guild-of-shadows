"""Сборка набора поз из PNG-мастеров художника в игровой формат.

    python3 tools/art/build_poses.py <папка мастеров> <папка выхода> [--quality 88] [--height 768]

В папке мастеров — PNG с прозрачным фоном на холсте одного размера и `poses.json`:

    { "poses": { "idle": "idle.png", "strike": ["strike_1.png", "strike_2.png"], ... }, "fps": 12,
      "glow": { "strike": "strike_glow.png" }, "glowColor": [1, 0.6, 0.25],
      "alternatives": { "hit": ["hit_b.png", ["hit_c1.png", "hit_c2.png"]] } }

Маски свечения (`glow`) и варианты поз (`alternatives`) — необязательны (ТЗ §3.8).

`pivot` и `figureHeight` можно не указывать — они вычисляются по стойке (idle): точка опоры — середина
ступней, высота фигуры — по непрозрачной области. На выходе — WebP и готовый `poses.json` для реестра.
После сборки запустите `node tools/art/validate_pack.mjs` на реестре.
"""
import argparse
import json
import sys
from pathlib import Path

from PIL import Image


def opaque_box(im: Image.Image, threshold: int = 24):
    return im.getchannel('A').point(lambda a: 255 if a > threshold else 0).getbbox()


def feet_center_x(im: Image.Image, bottom: int) -> float:
    """Середина непрозрачных пикселей в нижних 3% фигуры — между ступнями."""
    a = im.getchannel('A')
    band = max(2, int(im.height * 0.03))
    xs = []
    for y in range(max(0, bottom - band), bottom):
        for x in range(0, im.width, 2):
            if a.getpixel((x, y)) > 24:
                xs.append(x)
    return (min(xs) + max(xs)) / 2 if xs else im.width / 2


def as_list(v):
    return [v] if isinstance(v, str) else list(v or [])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('masters')
    ap.add_argument('out')
    ap.add_argument('--quality', type=int, default=88)
    # 768 px холста хватает с запасом: фигура на экране не выше ~470 px (1920×1080), а память на бой — ~120 МБ.
    ap.add_argument('--height', type=int, default=768, help='высота холста в игре (мастер уменьшается пропорционально)')
    args = ap.parse_args()
    src = Path(args.masters)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    spec = json.loads((src / 'poses.json').read_text(encoding='utf-8'))
    poses = spec.get('poses') or {}
    if 'idle' not in poses:
        print('Нет позы idle', file=sys.stderr)
        return 1

    glow = spec.get('glow') or {}
    alternatives = spec.get('alternatives') or {}
    all_files = [f for files in poses.values() for f in as_list(files)]
    all_files += [f for files in glow.values() for f in as_list(files)]
    all_files += [f for alts in alternatives.values() for a in alts for f in as_list(a)]

    images = {}
    size = None
    for f in all_files:
        if f not in images:
            im = Image.open(src / f).convert('RGBA')
            if size and im.size != size:
                print(f'{f}: {im.size}, а холст {size} — все позы на холсте одного размера', file=sys.stderr)
                return 1
            size = im.size
            images[f] = im
    assert size
    scale = min(1.0, args.height / size[1])
    w, h = round(size[0] * scale), round(size[1] * scale)

    idle = images[as_list(poses['idle'])[0]]
    box = opaque_box(idle)
    if not box:
        print('Стойка пустая (нет непрозрачных пикселей)', file=sys.stderr)
        return 1
    pivot = spec.get('pivot') or [round(feet_center_x(idle, box[3]) / size[0], 4), round(box[3] / size[1], 4)]
    figure_h = spec.get('figureHeight') or round((box[3] - box[1]) / size[1], 4)
    figure_w = spec.get('figureWidth') or round((box[2] - box[0]) / size[0], 4)

    total = 0

    def export(name, files, check_feet=True):
        kb_sum = 0
        names = []
        for f in as_list(files):
            im = images[f]
            b = opaque_box(im)
            if check_feet and b and name != 'down' and abs(b[3] / size[1] - pivot[1]) > 0.025:
                print(f'Внимание: {f} — ступни на {b[3] / size[1]:.1%}, точка опоры {pivot[1]:.1%}', file=sys.stderr)
            dst = Path(f).with_suffix('.webp').name
            (im.resize((w, h), Image.LANCZOS) if scale < 1 else im).save(out / dst, 'WEBP', quality=args.quality, method=6)
            kb_sum += (out / dst).stat().st_size
            names.append(dst)
        return (names[0] if len(names) == 1 else names), kb_sum

    out_poses = {}
    for name, files in poses.items():
        out_poses[name], kb = export(name, files)
        total += kb
    out_glow = {}
    for name, files in glow.items():
        out_glow[name], kb = export(name, files, check_feet=False)
        total += kb
    out_alts = {}
    for name, alts in alternatives.items():
        out_alts[name] = []
        for a in alts:
            res, kb = export(name, a)
            out_alts[name].append(res)
            total += kb

    pack = {'version': 1, 'frameWidth': w, 'frameHeight': h, 'pivot': pivot, 'figureHeight': figure_h, 'figureWidth': figure_w, 'poses': out_poses}
    for key in ('fps', 'glowColor', 'glowStrength'):
        if spec.get(key) is not None:
            pack[key] = spec[key]
    if out_glow:
        pack['glow'] = out_glow
    if out_alts:
        pack['alternatives'] = out_alts
    (out / 'poses.json').write_text(json.dumps(pack, ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps({'frame': [w, h], 'pivot': pivot, 'figureHeight': figure_h, 'figureWidth': figure_w, 'images': len(images), 'kb': round(total / 1024)}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
