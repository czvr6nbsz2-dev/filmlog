"""Fase 1 - stap 1: embed alle JPG's in een map.

Gebruik:
    python index.py /pad/naar/jpg-map
    python index.py /pad/naar/jpg-map --out mijn_index

Resultaat (afgeleide cache, mag je altijd weggooien en opnieuw bouwen):
    <out>.npy        - beeld-embeddings, float32 [N, D]
    <out>.paths.json - bijbehorende bestandspaden (zelfde volgorde)

Herhaald draaien is veilig: al geindexeerde paden worden overgeslagen.
"""

from __future__ import annotations  # nieuwere type-hints werkend op Python 3.9

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from model import embed_images, load_model

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"}


def find_images(root: Path) -> list[str]:
    files = [
        str(p) for p in sorted(root.rglob("*"))
        if p.suffix.lower() in IMAGE_EXTS and p.is_file()
    ]
    return files


def load_existing(out: Path):
    """Laadt eerder opgeslagen embeddings + paden, indien aanwezig."""
    npy, pj = out.with_suffix(".npy"), out.with_suffix(".paths.json")
    if npy.exists() and pj.exists():
        emb = np.load(npy)
        paths = json.loads(pj.read_text())
        return emb, paths
    return None, []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image_dir", help="Map met preview-JPG's (recursief)")
    ap.add_argument("--out", default="index", help="Basisnaam outputbestanden")
    ap.add_argument("--batch-size", type=int, default=16)
    args = ap.parse_args()

    root = Path(args.image_dir).expanduser()
    if not root.is_dir():
        sys.exit(f"Map bestaat niet: {root}")

    out = Path(args.out)
    old_emb, old_paths = load_existing(out)
    done = set(old_paths)

    all_files = find_images(root)
    todo = [f for f in all_files if f not in done]
    print(f"Gevonden: {len(all_files)} beelden | nieuw te doen: {len(todo)}")
    if not todo:
        print("Niets te doen.")
        return

    model, processor, device = load_model()

    new_embs, new_paths = [], []
    for i in range(0, len(todo), args.batch_size):
        batch = todo[i:i + args.batch_size]
        imgs, ok = [], []
        for f in batch:
            try:
                imgs.append(Image.open(f).convert("RGB"))
                ok.append(f)
            except Exception as e:
                print(f"  overslaan (kan niet openen): {f} ({e})")
        if not imgs:
            continue
        new_embs.append(embed_images(model, processor, device, imgs))
        new_paths.extend(ok)
        print(f"  {min(i + args.batch_size, len(todo))}/{len(todo)}")

    emb = np.concatenate(new_embs).astype(np.float32)
    paths = new_paths
    if old_emb is not None:
        emb = np.concatenate([old_emb, emb])
        paths = old_paths + paths

    np.save(out.with_suffix(".npy"), emb)
    out.with_suffix(".paths.json").write_text(json.dumps(paths, indent=0))
    print(f"Klaar. {len(paths)} embeddings -> {out.with_suffix('.npy')}")


if __name__ == "__main__":
    main()
