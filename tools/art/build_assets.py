"""
Производственный конвейер ассетов «Гильдии Теней» v1.7.

Источник: Guild_of_Shadows_Dark_Fantasy_Rebaseline_Pack_v1.1 / concept_art (утверждённый пак v1.1).
Все кропы и параметры зафиксированы здесь, чтобы ассеты можно было воспроизвести и проверить provenance.

Запуск (нужны pillow, numpy, rembg[cpu], opencv-python-headless):
  python tools/art/build_assets.py <concept_art_dir> <legacy_scenes_dir> <out_public_art_dir>
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter
from rembg import new_session, remove

SRC, LEGACY, OUT = (Path(p) for p in sys.argv[1:4])
HEROES_SHEET = SRC / 'Guild_of_Shadows_Fantasy_Heroes_v1.1.png'
ENEMIES_SHEET = SRC / 'Guild_of_Shadows_Fantasy_Enemies_Boss_v1.1.png'

session = new_session('isnet-general-use')
manifest: dict = {'source_pack': 'Guild_of_Shadows_Dark_Fantasy_Rebaseline_Pack_v1.1', 'assets': []}


def cut_sprite(sheet: Path, box, out: Path, max_h: int) -> Image.Image:
    """Вырезает фигуру с настоящим альфа-каналом (не прямоугольный фрагмент)."""
    im = Image.open(sheet).convert('RGB').crop(box)
    res = remove(im, session=session, alpha_matting=True, alpha_matting_foreground_threshold=235,
                 alpha_matting_background_threshold=20, alpha_matting_erode_size=6)
    a = np.array(res)
    # Убираем полупрозрачную «пыль» фона и одиночные островки.
    alpha = a[:, :, 3].astype(np.float32)
    alpha[alpha < 14] = 0
    n, labels, stats, _ = cv2.connectedComponentsWithStats((alpha > 0).astype(np.uint8), 8)
    if n > 1:
        main = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        keep = np.zeros_like(alpha, dtype=bool)
        for i in range(1, n):
            if i == main or stats[i, cv2.CC_STAT_AREA] > 0.004 * alpha.size:
                keep |= labels == i
        alpha[~keep] = 0
    a[:, :, 3] = alpha.astype(np.uint8)
    ys, xs = np.where(a[:, :, 3] > 0)
    res = Image.fromarray(a).crop((max(0, xs.min() - 6), max(0, ys.min() - 6), min(a.shape[1], xs.max() + 7), min(a.shape[0], ys.max() + 7)))
    if res.size[1] > max_h:
        res = res.resize((round(res.size[0] * max_h / res.size[1]), max_h), Image.LANCZOS)
    out.parent.mkdir(parents=True, exist_ok=True)
    res.save(out, 'WEBP', quality=88, method=6, exact=True)
    manifest['assets'].append({'file': str(out.relative_to(OUT)), 'source': sheet.name, 'crop': list(box), 'size': list(res.size), 'alpha': True})
    return res


def crop_portrait(sheet: Path, cx: int, top: int, w: int, out: Path, size=(256, 320)) -> None:
    hgt = round(w * size[1] / size[0])
    box = (cx - w // 2, top, cx - w // 2 + w, top + hgt)
    im = Image.open(sheet).convert('RGB').crop(box).resize(size, Image.LANCZOS)
    im = im.filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))
    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out, 'WEBP', quality=86, method=6)
    manifest['assets'].append({'file': str(out.relative_to(OUT)), 'source': sheet.name, 'crop': list(box), 'size': list(size), 'alpha': False})


def emissive_cracks(sprite: Image.Image, out: Path) -> None:
    """Карта трещин для фазы II: тонкие тёмные линии брони → маска свечения, которую шейдер окрашивает в синий."""
    a = np.array(sprite.convert('RGBA')).astype(np.float32)
    lum = (0.3 * a[:, :, 0] + 0.59 * a[:, :, 1] + 0.11 * a[:, :, 2])
    blackhat = cv2.morphologyEx(lum, cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    blue = np.clip((a[:, :, 2] - a[:, :, 0]) * 2.0, 0, 255)  # уже нарисованные синие прожилки на щите
    # Только выраженные тёмные прожилки (трещины), а не вся фактура брони.
    m = np.clip(blackhat * 2.8 - 30, 0, 255) * (a[:, :, 3] / 255.0)
    m = np.maximum(m, blue * (a[:, :, 3] / 255.0))
    m[m < 80] = 0
    keep = cv2.morphologyEx((m > 0).astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(keep, 8)
    # Длинные связные линии — трещины; одиночные точки фактуры отбрасываются.
    good = np.zeros_like(keep, dtype=bool)
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] >= 14:
            good |= lab == i
    m = m * good
    m = cv2.GaussianBlur(m, (0, 0), 1.4) * 1.6
    h, w = m.shape
    # Призрачное ядро в груди — главный признак пробуждения.
    yy, xx = np.mgrid[0:h, 0:w]
    core = np.exp(-(((xx - w * 0.47) / (w * 0.09)) ** 2 + ((yy - h * 0.34) / (h * 0.11)) ** 2)) * 255
    m = np.maximum(m, core * (a[:, :, 3] / 255.0))
    # Глазницы черепа загораются в фазе II.
    for ex in (0.515, 0.545):
        eye = np.exp(-(((xx - w * ex) / (w * 0.008)) ** 2 + ((yy - h * 0.098) / (h * 0.007)) ** 2)) * 255
        m = np.maximum(m, eye)
    rgba = np.zeros((h, w, 4), np.uint8)
    rgba[:, :, 0] = rgba[:, :, 1] = rgba[:, :, 2] = 255
    rgba[:, :, 3] = np.clip(m, 0, 255).astype(np.uint8)
    Image.fromarray(rgba).save(out, 'WEBP', quality=85, method=6, exact=True)
    manifest['assets'].append({'file': str(out.relative_to(OUT)), 'source': 'derived from bone_king/sprite', 'alpha': True})


def arena(src_img: Path, out: Path, inpaint_boxes=(), grade=(1.0, 1.0)) -> None:
    im = Image.open(src_img).convert('RGB')
    if inpaint_boxes:
        arr = np.array(im)
        mask = np.zeros(arr.shape[:2], np.uint8)
        for (x0, y0, x1, y1) in inpaint_boxes:
            cv2.ellipse(mask, ((x0 + x1) // 2, (y0 + y1) // 2), ((x1 - x0) // 2, (y1 - y0) // 2), 0, 0, 360, 255, -1)
        arr = cv2.inpaint(arr, mask, 9, cv2.INPAINT_TELEA)
        im = Image.fromarray(arr)
    im = im.resize((1920, 1080), Image.LANCZOS)
    im = ImageEnhance.Contrast(im).enhance(grade[0])
    im = ImageEnhance.Brightness(im).enhance(grade[1])
    im = im.filter(ImageFilter.UnsharpMask(radius=1.6, percent=45, threshold=3))
    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out, 'WEBP', quality=80, method=6)
    manifest['assets'].append({'file': str(out.relative_to(OUT)), 'source': src_img.name, 'inpaint': [list(b) for b in inpaint_boxes], 'size': [1920, 1080]})


# ---------- Герои: heroId → портрет + боевой спрайт ----------
HEROES = {
    'bran': {'sprite': (20, 0, 430, 815), 'face': (228, 30, 180)},
    'mira': {'sprite': (430, 0, 790, 815), 'face': (597, 46, 150)},
    'rook': {'sprite': (770, 0, 1160, 815), 'face': (906, 30, 160)},
    'nora': {'sprite': (1150, 0, 1520, 815), 'face': (1293, 32, 148)},
}
for hid, d in HEROES.items():
    cut_sprite(HEROES_SHEET, d['sprite'], OUT / 'heroes' / hid / 'sprite.webp', 780)
    cx, top, w = d['face']
    crop_portrait(HEROES_SHEET, cx, top, w, OUT / 'heroes' / hid / 'portrait.webp')

# ---------- Противники ----------
ENEMIES = {
    'goblin_raider': {'sprite': (0, 0, 415, 410), 'face': (250, 40, 170)},
    'ash_wolf': {'sprite': (418, 0, 835, 410), 'face': (640, 100, 190)},
    'bone_guard': {'sprite': (838, 0, 1252, 410), 'face': (1040, 8, 150)},
    'ash_mage': {'sprite': (1255, 0, 1672, 410), 'face': (1458, 4, 150)},
}
for eid, d in ENEMIES.items():
    cut_sprite(ENEMIES_SHEET, d['sprite'], OUT / 'enemies' / eid / 'sprite.webp', 400)
    cx, top, w = d['face']
    crop_portrait(ENEMIES_SHEET, cx, top, w, OUT / 'enemies' / eid / 'portrait.webp', (256, 256))

king = cut_sprite(ENEMIES_SHEET, (95, 415, 705, 941), OUT / 'boss' / 'bone_king' / 'sprite.webp', 520)
emissive_cracks(king, OUT / 'boss' / 'bone_king' / 'emissive.webp')
crop_portrait(ENEMIES_SHEET, 412, 432, 130, OUT / 'boss' / 'bone_king' / 'portrait.webp', (256, 256))

# ---------- Арены (окружение без запечённых бойцов) ----------
arena(LEGACY / 'crypt.webp', OUT / 'arena' / 'crypt.webp', grade=(1.05, 0.92))
# Тронный склеп из пака содержит запечённого короля на троне и скелетов-стражей: такой фон дублирует
# боевые слои и путает врагов с декором. Для арены босса используется та же чистая крипта в холодной гамме.
def cold_grade(src: Path, out: Path) -> None:
    im = Image.open(src).convert('RGB')
    arr = np.array(im).astype(np.float32)
    lum = arr.mean(axis=2, keepdims=True)
    arr = arr * 0.55 + lum * np.array([0.38, 0.47, 0.62]) * 0.75
    arr *= 0.86
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).save(out, 'WEBP', quality=80, method=6)
    manifest['assets'].append({'file': str(out.relative_to(OUT)), 'source': 'derived from arena/crypt (cold grade)', 'size': [1920, 1080]})


cold_grade(OUT / 'arena' / 'crypt.webp', OUT / 'arena' / 'crypt_boss.webp')

# Баннер гильдии: ключевой арт без индустриальных деталей (поезд и мост в нижней правой части кадра
# отсекаются), чтобы не смешивать основную Dark Fantasy ветку с индустриальной.
key = Image.open(SRC / 'Guild_of_Shadows_Fantasy_KeyArt_v1.1.png').convert('RGB')
kw, kh = key.size
banner_box = (0, int(kh * 0.02), kw, int(kh * 0.66))
(OUT / 'guild').mkdir(parents=True, exist_ok=True)
key.crop(banner_box).save(OUT / 'guild' / 'citadel.webp', 'WEBP', quality=82, method=6)
manifest['assets'].append({'file': 'guild/citadel.webp', 'source': 'Guild_of_Shadows_Fantasy_KeyArt_v1.1.png', 'crop': list(banner_box), 'note': 'train/bridge excluded'})

(OUT / 'asset-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
print('ok', len(manifest['assets']))
