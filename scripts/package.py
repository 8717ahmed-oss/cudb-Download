"""Build the installable, unpacked-extension ZIP without source pages or test data."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
import json

root = Path(__file__).resolve().parent.parent
source = root / "extension"
manifest = json.loads((source / "manifest.json").read_text())
destination = root / "dist" / f"CDAS-Exporter-v{manifest['version']}.zip"
destination.parent.mkdir(exist_ok=True)
with ZipFile(destination, "w", ZIP_DEFLATED) as archive:
    for path in sorted(source.rglob("*")):
        if path.is_file():
            archive.write(path, Path("CDAS-Exporter") / path.relative_to(source))
    archive.write(root / "README.md", "安装和使用说明.md")
    for name in ("UI-DESIGN.md", "ui-desktop.png", "ui-mobile.png"):
        path = root / "docs" / name
        if path.is_file():
            archive.write(path, Path("docs") / name)
print(destination)
