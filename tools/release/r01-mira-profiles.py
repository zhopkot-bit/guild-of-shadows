"""Compare a bounded set of Mira encoders and retain each profile's evidence."""
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import sys


RUNTIME = Path("public/art/v17/heroes/mira/poses")
PROFILES = {"ubuntu22-system", "ubuntu24-system", "debian12-system", "wheel-1.4", "wheel-1.5", "wheel-1.6"}


def riff_chunks(path):
    data = path.read_bytes()
    if data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise ValueError(f"Not a RIFF WebP: {path}")
    offset = 12
    chunks = {}
    while offset < len(data):
        name, size = struct.unpack_from("<4sI", data, offset)
        start = offset + 8
        payload = data[start:start + size]
        if len(payload) != size:
            raise ValueError(f"Incomplete chunk in {path}")
        chunks.setdefault(name.decode("ascii").strip(), []).append({
            "bytes": size, "sha256": hashlib.sha256(payload).hexdigest(),
        })
        offset = start + size + (size % 2)
    return chunks


def profile(evidence, name, expected_webp):
    run = subprocess.run([sys.executable, "tools/release/r01-mira-compare.py", str(evidence)])
    report_path = evidence / "report.json"
    doc = json.loads(report_path.read_text())
    doc["profile"] = name
    chunks = {}
    for filename, row in doc["files"].items():
        if filename.endswith(".webp") and row["runtime"] and row["rebuilt"] and row["status"] != "identical_bytes":
            shipped = riff_chunks(RUNTIME / filename)
            rebuilt = riff_chunks(evidence / "rebuilt" / filename)
            chunks[filename] = {
                tag: {"runtime": shipped.get(tag), "rebuilt": rebuilt.get(tag)}
                for tag in sorted(shipped.keys() | rebuilt.keys()) if shipped.get(tag) != rebuilt.get(tag)
            }
    doc["different_webp_chunks"] = chunks
    version_ok = expected_webp == "system" or doc["libwebp"] == expected_webp
    doc["valid_profile"] = (
        doc.get("build_exit") == 0 and doc["file_sets_match"]
        and bool(doc["libwebp"]) and version_ok
        and run.returncode == (0 if doc["byte_reproducible"] else 1)
    )
    report_path.write_text(json.dumps(doc, indent=2) + "\n")
    if not doc["valid_profile"]:
        raise SystemExit(f"Incomplete or unexpected toolchain for {name}")
    print(f"{name}: Pillow {doc['pillow']}, libwebp {doc['libwebp']}, "
          f"byte_reproducible={doc['byte_reproducible']}")


def summarize(directory):
    tools = {}
    for path in sorted(directory.glob("*/report.json")):
        doc = json.loads(path.read_text())
        name = doc["profile"]
        if name in tools:
            raise ValueError(f"Duplicate profile: {name}")
        tools[name] = doc

    complete = set(tools) == PROFILES and all(
        d["valid_profile"] and d["commit"] == os.environ["GITHUB_SHA"] for d in tools.values()
    )
    matches = [name for name, d in tools.items() if d["byte_reproducible"]]
    table = ["| Profile | Python | Pillow | libwebp | Byte-identical files | Changed RIFF chunks |",
             "|---|---|---|---|---:|---|"]
    for name, d in tools.items():
        exact = sum(row["status"] == "identical_bytes" for row in d["files"].values())
        chunks = sorted({tag for v in d["different_webp_chunks"].values() for tag in v})
        table.append(f"| {name} | {d['python']} | {d['pillow']} | {d['libwebp']} | "
                     f"{exact}/{len(d['files'])} | {', '.join(chunks) or '—'} |")
    text = "\n".join(table) + "\n\nByte-identical profiles: " + (", ".join(matches) or "none") + "\n"
    print(text)
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as out:
        out.write(text)
    if not complete or not matches:
        raise SystemExit("Complete evidence and at least one byte-identical pack are required")


if __name__ == "__main__":
    if sys.argv[1] == "collect":
        summarize(Path(sys.argv[2]))
    else:
        profile(Path(sys.argv[2]), sys.argv[3], sys.argv[4])
