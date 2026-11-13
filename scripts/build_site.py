"""Package only public assets and version the service worker by content."""

import hashlib
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / ".site"
ASSETS = (
    "index.html", "styles.css", "app.js", "nav.mjs", "holdings.mjs", "manifest.webmanifest",
    "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
)


def build_site():
    # Restrict cleanup to this project's generated output, including on Windows.
    if OUTPUT.is_symlink() or OUTPUT.resolve() != ROOT / ".site":
        raise ValueError("Unexpected build directory.")
    digest = hashlib.sha256()
    for name in (*ASSETS, "sw.js"):
        digest.update(name.encode())
        digest.update((ROOT / name).read_bytes())
    if not (ROOT / "data/nav.json").is_file():
        raise ValueError("Run the NAV collector before packaging.")
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    OUTPUT.mkdir()
    for name in (*ASSETS, "data/nav.json"):
        destination = OUTPUT / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, destination)
    worker = (ROOT / "sw.js").read_text(encoding="utf-8")
    marker = 'const RELEASE = "dev-v1";'
    if worker.count(marker) != 1:
        raise ValueError("Service worker release marker is missing.")
    worker = worker.replace(marker, f'const RELEASE = "{digest.hexdigest()[:16]}";')
    (OUTPUT / "sw.js").write_text(worker, encoding="utf-8", newline="\n")
    print(f"Built {OUTPUT}")


if __name__ == "__main__":
    build_site()
