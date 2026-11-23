"""Build the eight Mira exports from their masters and compare them with the shipped pack."""
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys

from PIL import Image, ImageChops, features, __version__ as pillow_version


MASTERS = Path("art-sources/poses/mira/proposals")
RUNTIME = Path("public/art/v17/heroes/mira/poses")
EXPECTED = {"poses.json", *(name + ".webp" for name in (
    "idle", "aim", "shoot", "windup", "strike", "hit", "down", "victory"
))}


def file_info(path):
    if not path.is_file():
        return None
    data = path.read_bytes()
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def pixel_delta(before, after):
    diff = ImageChops.difference(before, after)
    channels = diff.split()
    maximum = channels[0]
    for channel in channels[1:]:
        maximum = ImageChops.lighter(maximum, channel)
    return {
        "changed_pixels": before.width * before.height - maximum.histogram()[0],
        "max_channel_delta": [hi for _, hi in diff.getextrema()],
    }


def compare(expected, rebuilt):
    shipped = file_info(expected)
    generated = file_info(rebuilt)
    result = {"runtime": shipped, "rebuilt": generated}
    if shipped is None or generated is None:
        return {**result, "status": "missing_file"}
    if shipped == generated:
        return {**result, "status": "identical_bytes"}
    if expected.suffix == ".json":
        same = json.loads(expected.read_text()) == json.loads(rebuilt.read_text())
        return {**result, "status": "json_format_only" if same else "json_content_differs"}
    if expected.suffix != ".webp":
        return {**result, "status": "different_bytes"}

    with Image.open(expected) as source, Image.open(rebuilt) as output:
        result.update(runtime_size=source.size, rebuilt_size=output.size)
        if source.size != output.size:
            return {**result, "status": "dimensions_differ"}
        left, right = source.convert("RGBA"), output.convert("RGBA")
        rgba = pixel_delta(left, right)
        # Premultiplication removes RGB differences hidden behind fully transparent pixels.
        visible = pixel_delta(left.convert("RGBa"), right.convert("RGBa"))
    if not rgba["changed_pixels"]:
        status = "encoding_only"
    elif not visible["changed_pixels"]:
        status = "same_premultiplied_pixels"
    else:
        status = "visible_pixels_differ"
    return {**result, "status": status, "rgba": rgba, "premultiplied_rgba": visible}


def main():
    evidence = Path(sys.argv[1])
    evidence.mkdir(parents=True, exist_ok=True)
    output = evidence / "rebuilt"
    output.mkdir()
    spec = json.loads((MASTERS / "poses.json").read_text())
    report = {
        "commit": os.environ.get("GITHUB_SHA"),
        "python": platform.python_version(),
        "pillow": pillow_version,
        "libwebp": features.version("webp"),
        "masters": {
            name: file_info(MASTERS / name) for name in sorted({*spec["poses"].values(), "poses.json"})
        },
    }
    if features.check("webp"):
        command = [sys.executable, "tools/art/build_poses.py", str(MASTERS), str(output),
                   "--quality", "88", "--height", "768"]
        report["command"] = command
        report["build_exit"] = subprocess.run(command, check=False).returncode
    else:
        report["error"] = "Pillow has no WebP codec"

    shipped = {p.name for p in RUNTIME.iterdir() if p.is_file()}
    built = {p.name for p in output.iterdir() if p.is_file()}
    report["file_sets_match"] = built == shipped == EXPECTED
    report["files"] = {
        name: compare(RUNTIME / name, output / name) for name in sorted(shipped | built | EXPECTED)
    }
    report["byte_reproducible"] = (
        report.get("build_exit") == 0 and report["file_sets_match"]
        and all(row["status"] == "identical_bytes" for row in report["files"].values())
    )
    result = json.dumps(report, ensure_ascii=False, indent=2)
    (evidence / "report.json").write_text(result + "\n", encoding="utf-8")
    print(result)
    return 0 if report["byte_reproducible"] else 1


if __name__ == "__main__":
    sys.exit(main())
