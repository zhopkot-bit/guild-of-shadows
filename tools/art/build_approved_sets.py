"""Export the approved, normalized pose masters listed in technical-layout.json."""
import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
POSE_ROOT = ROOT / 'art-sources' / 'poses'

parser = argparse.ArgumentParser()
parser.add_argument('characters', nargs='*')
parser.add_argument('--quality', type=int, help='Override the per-character WebP quality')
args = parser.parse_args()
layout = json.loads((POSE_ROOT / 'technical-layout.json').read_text())['characters']
selected = args.characters or list(layout)
unknown = set(selected) - layout.keys()
if unknown:
    parser.error(f'Unknown characters: {sorted(unknown)}')
for name in selected:
    print(f'Building {name}', flush=True)
    subprocess.run([sys.executable, str(ROOT / 'tools/art/build_poses.py'),
                    str(POSE_ROOT / name / 'masters'),
                    str(ROOT / 'public/art/v17' / layout[name]['runtime']),
                    '--quality', str(args.quality if args.quality is not None else layout[name].get('quality', 88))], check=True)
