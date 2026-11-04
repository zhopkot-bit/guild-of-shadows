"""Prepare same-canvas pose masters from approved proposals without redrawing them.

The hand-chosen horizontal anchors and per-pose scale factors live in
art-sources/poses/technical-layout.json. Source PNGs stay untouched; the PNGs in
each `masters` directory are reproducible technical derivatives. Alpha value 1
(less than half a percent opacity) is cleared as background noise; all other
source pixels are kept. Scale, alignment and the wolf's requested levels
adjustment are recorded in the report.

    python3 tools/art/normalize_pose_masters.py [character ...] [--audit-only]
    python3 tools/art/build_poses.py art-sources/poses/rook/masters public/art/v17/poses/rook
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
POSE_ROOT = ROOT / 'art-sources' / 'poses'
SPEC_PATH = POSE_ROOT / 'technical-layout.json'
REPORT = ROOT / 'docs' / 'art-review' / 'technical-integration-2026-10-30' / 'normalization.json'


def opaque_box(im):
    return im.getchannel('A').point(lambda a: 255 if a > 24 else 0).getbbox()


def levels(im, white):
    """Map RGB output white to `white`, preserving the source alpha exactly."""
    if not 0 < white <= 1:
        raise ValueError('outputWhite must be in (0, 1]')
    lut = [round(x * white) for x in range(256)]
    r, g, b, a = im.split()
    return Image.merge('RGBA', (r.point(lut), g.point(lut), b.point(lut), a))


def source_edge_counts(im):
    alpha = im.getchannel('A')
    w, h = im.size
    edges = {
        'left': alpha.crop((0, 0, 1, h)), 'right': alpha.crop((w - 1, 0, w, h)),
        'top': alpha.crop((0, 0, w, 1)), 'bottom': alpha.crop((0, h - 1, w, h)),
    }
    return {name: sum(edge.histogram()[25:])
            for name, edge in edges.items() if edge.getextrema()[1] > 24}


def prepare_character(name, entry, spec, audit_only):
    src = POSE_ROOT / name / 'proposals'
    out = POSE_ROOT / name / 'masters'
    poses = entry['poses']
    if 'idle' not in poses or set(poses) != set(entry['feetX']):
        raise ValueError(f'{name}: each pose needs one horizontal anchor and idle is required')
    source = {}
    for pose in poses:
        path = src / f'{pose}.png'
        im = Image.open(path).convert('RGBA')
        box = opaque_box(im)
        retained = im.getchannel('A').point(lambda a: 255 if a > 1 else 0).getbbox()
        if not box:
            raise ValueError(f'{path}: empty image')
        x = float(entry['feetX'][pose])
        if not 0 <= x <= im.width:
            raise ValueError(f'{name}/{pose}: anchor outside source image')
        source[pose] = {'path': path, 'size': im.size, 'box': box, 'retained': retained, 'x': x,
                        'y': box[3], 'edge': source_edge_counts(im),
                        'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
        im.close()

    idle_box = source['idle']['box']
    unit = spec['targetIdlePixels'] / (idle_box[3] - idle_box[1])
    scales = entry.get('poseScale', {})
    # Fit all pixels with alpha > 1, including the soft edges around the
    # silhouette. Account for build_poses' later poseScale, and for the
    # unscaled master's frame when scale is < 1.
    left = right = above = below = 0.0
    for pose, info in source.items():
        scale = unit * max(1.0, float(scales.get(pose, 1)))
        x0, y0, x1, y1 = info['retained']
        x, y = info['x'], info['y']
        left, right = max(left, (x - x0) * scale), max(right, (x1 - x) * scale)
        above, below = max(above, (y - y0) * scale), max(below, (y1 - y) * scale)
    margin = spec['marginPixels']
    width = math.ceil(left + right + 2 * margin)
    min_height = max(spec['minimumCanvasHeight'], math.ceil(spec['targetIdlePixels'] / spec['targetIdleFraction']))
    height = max(min_height, math.ceil(above + margin) + math.ceil(below + margin))
    pivot_x = math.ceil(left + margin)
    # Distribute any spare space above the figure; retain full lower margins.
    pivot_y = height - math.ceil(below + margin)
    if pivot_y < math.ceil(above + margin):
        raise ValueError(f'{name}: insufficient canvas')
    pivot = [round(pivot_x / width, 6), round(pivot_y / height, 6)]
    ratio = spec['targetIdlePixels'] / height

    report = {'canvas': [width, height], 'pivotPixels': [pivot_x, pivot_y], 'alphaNoiseClearedThrough': 1,
              'baseScale': round(unit, 6), 'idleFraction': round(ratio, 4),
              'poseScale': scales, 'levels': entry.get('levels', {}), 'sources': {}}
    if not audit_only:
        out.mkdir(parents=True, exist_ok=True)
    for pose, info in source.items():
        x0, y0, x1, y1 = info['retained']
        offset = [round(pivot_x + (x0 - info['x']) * unit), round(pivot_y + (y0 - info['y']) * unit)]
        size = [round((x1 - x0) * unit), round((y1 - y0) * unit)]
        report['sources'][pose] = {
            'path': str(info['path'].relative_to(ROOT)), 'sha256': info['sha256'],
            'size': list(info['size']), 'visibleBox': list(info['box']), 'retainedBox': list(info['retained']),
            'anchor': [info['x'], info['y']], 'sourceEdgePixels': info['edge'],
            'masterOffset': offset, 'scaledSize': size,
        }
        if not audit_only:
            im = Image.open(info['path']).convert('RGBA')
            if pose in entry.get('levels', {}):
                im = levels(im, float(entry['levels'][pose]['outputWhite']))
            r, g, b, a = im.split()
            im = Image.merge('RGBA', (r, g, b, a.point(lambda alpha: 0 if alpha <= 1 else alpha)))
            resized = im.crop(info['retained']).resize(tuple(size), Image.Resampling.LANCZOS)
            canvas = Image.new('RGBA', (width, height), (0, 0, 0, 0))
            canvas.alpha_composite(resized, tuple(offset))
            canvas.save(out / f'{pose}.png', compress_level=9)
            im.close()
    if not audit_only:
        build_spec = {'poses': {p: f'{p}.png' for p in poses}, 'fps': 12,
                      'alignFeet': True, 'poseScale': scales, 'pivot': pivot}
        (out / 'poses.json').write_text(json.dumps(build_spec, ensure_ascii=False, indent=2) + '\n')
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('characters', nargs='*')
    parser.add_argument('--audit-only', action='store_true')
    args = parser.parse_args()
    spec = json.loads(SPEC_PATH.read_text())
    selected = args.characters or list(spec['characters'])
    unknown = set(selected) - spec['characters'].keys()
    if unknown:
        parser.error(f'Unknown characters: {sorted(unknown)}')
    report = {}
    for name in selected:
        report[name] = prepare_character(name, spec['characters'][name], spec, args.audit_only)
        r = report[name]
        edges = {k: v['sourceEdgePixels'] for k, v in r['sources'].items() if v['sourceEdgePixels']}
        print(f"{name}: canvas {r['canvas']}, idle {r['idleFraction']:.1%}, "
              f"pivot {r['pivotPixels']}, source edges {edges}", flush=True)
    if not args.audit_only:
        REPORT.parent.mkdir(parents=True, exist_ok=True)
        previous = json.loads(REPORT.read_text()) if REPORT.exists() else {}
        previous.update(report)
        REPORT.write_text(json.dumps(previous, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
