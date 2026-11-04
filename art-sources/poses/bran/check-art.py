"""Audit A-01 without changing approved artwork; optionally reproduce the export.

python3 art-sources/poses/bran/check-art.py [--rebuild] [--out work/t3-bran/audit.json]
"""
import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
PACKAGE = Path(__file__).resolve().parent
RUNTIME = ROOT / 'public/art/v17/poses/bran'
SOURCE_COMMIT = '1f0144fa83b74ea6a428a1482aad46265780e43d'
POSES = ['idle', 'windup', 'strike', 'cast', 'hit', 'down', 'victory']


def sha(data):
    return hashlib.sha256(data).hexdigest()


def bounds(im):
    return im.getchannel('A').point(lambda a: 255 if a > 24 else 0).getbbox()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--rebuild', action='store_true')
    ap.add_argument('--out', default='work/t3-bran/audit.json')
    args = ap.parse_args()
    source_manifest = json.loads((PACKAGE / 'source-sha256.json').read_text())
    meta = json.loads((RUNTIME / 'poses.json').read_text())
    assert list(meta['poses']) == POSES, 'Expected all seven approved poses'
    assert 0.75 <= meta['figureHeight'] <= 0.85, 'Idle figure must fill 75–85% of canvas'
    idle_im = Image.open(RUNTIME / 'idle.webp').convert('RGBA')
    idle_box = bounds(idle_im)
    idle_height = idle_box[3] - idle_box[1]
    rows = []
    for pose in POSES:
        source = PACKAGE / 'proposals' / f'{pose}.png'
        source_hash = sha(source.read_bytes())
        assert source_hash == source_manifest['poses'][pose], f'Approved source changed: {pose}'
        with Image.open(source) as original:
            assert original.size == (1086, 1448) and original.mode == 'RGBA'
        path = RUNTIME / meta['poses'][pose]
        with Image.open(path) as exported:
            assert exported.format == 'WEBP' and exported.mode == 'RGBA'
            im = exported.copy()
        assert im.size == (meta['frameWidth'], meta['frameHeight'])
        box = bounds(im)
        assert box is not None
        margins = [box[0], box[1], im.width - box[2], im.height - box[3]]
        assert min(margins) >= 4, f'Insufficient alpha margin: {pose}: {margins}'
        delta = abs(box[3] - meta['pivot'][1] * im.height)
        if pose != 'down':
            assert delta <= 0.015 * im.height, f'Feet misaligned: {pose}'
        reach = max(abs(box[0] - meta['pivot'][0] * im.width), abs(box[2] - meta['pivot'][0] * im.width)) / idle_height
        if pose == 'down':
            assert reach <= 0.60, f'Fallen pose exceeds 0.60 of idle height: {reach}'
        assert path.stat().st_size <= 160 * 1024, f'Pose exceeds 160 KiB: {pose}'
        rows.append(dict(pose=pose, sourceSha256=source_hash, runtimeSha256=sha(path.read_bytes()),
                         bytes=path.stat().st_size, bounds=box, margins=margins,
                         feetDeltaPx=round(delta, 3), horizontalReach=round(reach, 4)))
    for rel, expected in source_manifest['references'].items():
        assert sha((ROOT / rel).read_bytes()) == expected, f'Canonical reference changed: {rel}'
    total = sum(row['bytes'] for row in rows)
    assert total <= 1200 * 1024, 'Pose set exceeds 1200 KiB'
    reproduced = False
    if args.rebuild:
        work = ROOT / 'work/t3-bran'
        work.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=work) as tmp:
            subprocess.run(['python3', str(ROOT / 'tools/art/build_poses.py'),
                            str(PACKAGE / 'proposals'), tmp], cwd=ROOT, check=True)
            expected_files = {p.name for p in RUNTIME.iterdir() if p.is_file()}
            assert expected_files == {p.name for p in Path(tmp).iterdir()}
            for name in expected_files:
                assert (Path(tmp) / name).read_bytes() == (RUNTIME / name).read_bytes(), f'Nonreproducible: {name}'
        reproduced = True
    report = dict(ok=True, sourceCommit=SOURCE_COMMIT, frame=[meta['frameWidth'], meta['frameHeight']],
                  figureHeight=meta['figureHeight'], pivot=meta['pivot'], bytes=total,
                  reproduced=reproduced, poses=rows,
                  limits={'alphaThreshold': 24, 'minimumMarginPx': 4, 'feetToleranceFraction': 0.015,
                          'maximumDownReach': 0.60, 'maximumPoseKiB': 160, 'maximumSetKiB': 1200})
    out = ROOT / args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(dict(ok=True, frame=report['frame'], bytes=total, reproduced=reproduced)))


if __name__ == '__main__':
    main()
