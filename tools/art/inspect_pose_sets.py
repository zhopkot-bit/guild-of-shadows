"""Measure the final WebP silhouettes; the stock validator only checks PNG feet.

    python3 tools/art/inspect_pose_sets.py

This records existing source-edge cuts and proportion conflicts separately from
export errors. It does not treat a canvas margin as a repair of a clipped source.
"""
import json
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
POSE_ROOT = ROOT / 'art-sources' / 'poses'
DOCS = ROOT / 'docs/art-review/technical-integration-2026-10-30'
layout = json.loads((POSE_ROOT / 'technical-layout.json').read_text())['characters']
normalization = json.loads((DOCS / 'normalization.json').read_text())
report = {}
all_errors = []
for name, entry in layout.items():
    pack_dir = ROOT / 'public/art/v17' / entry['runtime']
    pack = json.loads((pack_dir / 'poses.json').read_text())
    width, height = pack['frameWidth'], pack['frameHeight']
    result = {'frame': [width, height], 'pivot': pack['pivot'],
              'figureHeight': pack['figureHeight'], 'poses': {}, 'warnings': [], 'errors': []}
    if not .75 <= pack['figureHeight'] <= .85:
        result['warnings'].append(f"idle fraction {pack['figureHeight']:.1%} outside 75–85%")
    for pose in entry['poses']:
        path = pack_dir / pack['poses'][pose]
        im = Image.open(path).convert('RGBA')
        if im.size != (width, height):
            result['errors'].append(f'{pose}: inconsistent frame dimensions')
        box = im.getchannel('A').point(lambda a: 255 if a > 24 else 0).getbbox()
        if not box:
            result['errors'].append(f'{pose}: empty')
            continue
        margin = min(box[0], box[1], width - box[2], height - box[3])
        feet_delta = (box[3] / height) - pack['pivot'][1]
        row = {'visibleBox': list(box), 'edgeMargin': margin,
               'feetDeltaFraction': round(feet_delta, 4)}
        if margin < 4:
            result['errors'].append(f'{pose}: visible silhouette within {margin}px of canvas edge')
        if pose != 'down' and abs(feet_delta) > .015:
            result['errors'].append(f'{pose}: feet differ from pivot by {feet_delta:.1%}')
        if pose == 'down':
            pivot_x = pack['pivot'][0] * width
            reach = max(abs(pivot_x - box[0]), abs(box[2] - pivot_x)) / (pack['figureHeight'] * height)
            row['reachRelativeToIdleHeight'] = round(reach, 3)
            if reach > .6:
                result['warnings'].append(f'down: reaches {reach:.2f} idle heights from pivot, limit 0.60')
        source_edges = normalization[name]['sources'][pose]['sourceEdgePixels']
        if source_edges:
            row['sourceEdgePixels'] = source_edges
            result['warnings'].append(f'{pose}: source already touches canvas edge: {source_edges}')
        result['poses'][pose] = row
    report[name] = result
    all_errors.extend(f'{name}: {err}' for err in result['errors'])
    print(f"{name}: {len(result['errors'])} errors, {len(result['warnings'])} warnings", flush=True)

(DOCS / 'silhouette-checks.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
if all_errors:
    print('\n'.join(all_errors), file=sys.stderr)
    sys.exit(1)
