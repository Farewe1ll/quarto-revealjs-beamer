"""Build optional upstream references; generated sources/PDFs stay under tmp/."""
from pathlib import Path
import shutil
import subprocess
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
COMMIT = "5616b785a9dff1024fa31cc3a3bd11f8d9b40aaf"  # Beamer v3.76
WORK = ROOT / "tmp" / "reference-beamer"
SOURCE = WORK / "source"
OUTPUT = WORK / "output"
ARCHIVE = WORK / "upstream.zip"
WORK.mkdir(parents=True, exist_ok=True)
SOURCE.mkdir(exist_ok=True)
OUTPUT.mkdir(exist_ok=True)
if not ARCHIVE.exists():
    with urllib.request.urlopen(
        f"https://github.com/josephwright/beamer/archive/{COMMIT}.zip", timeout=60
    ) as response, ARCHIVE.open("wb") as target:
        shutil.copyfileobj(response, target)

# Put every upstream base/theme/font file on one explicit search path. This
# prevents a cached TeX bundle from silently supplying a different theme version.
with zipfile.ZipFile(ARCHIVE) as archive:
    prefix = f"beamer-{COMMIT}/base/"
    names = set()
    for item in archive.infolist():
        if not item.filename.startswith(prefix) or item.is_dir():
            continue
        name = Path(item.filename).name
        if name in names:
            raise RuntimeError(f"Duplicate upstream filename: {name}")
        names.add(name)
        (SOURCE / name).write_bytes(archive.read(item))

for path in Path(__file__).resolve().parent.glob("*.tex"):
    shutil.copyfile(path, SOURCE / path.name)
for variant in ("madrid", "cambridgeus"):
    command = [
        "tectonic", "--keep-logs", "--keep-intermediates",
        "-Z", f"search-path={SOURCE}", "--outdir", str(OUTPUT),
        str(SOURCE / f"{variant}.tex"),
    ]
    subprocess.run(command, cwd=SOURCE, check=True, timeout=600)
    subprocess.run(
        ["pdftoppm", "-scale-to-x", "1280", "-scale-to-y", "720", "-png",
         str(OUTPUT / f"{variant}.pdf"), str(OUTPUT / variant)],
        check=True, timeout=60,
    )
print(f"Beamer v3.76 ({COMMIT}) references: {OUTPUT}")
