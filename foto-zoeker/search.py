"""Fase 1 - stap 2: zoek met een tekstquery in de index.

Gebruik:
    python search.py "brug bij ochtendlicht"
    python search.py "mens klein in landschap" --top-k 30
    python search.py "zonsondergang aan zee" --out mijn_index

Output: gesorteerde lijst van score + bestandspad (hoogste score eerst).
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np

from model import embed_text, load_model


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("query", help="Zoekterm in natuurlijke taal")
    ap.add_argument("--out", default="index", help="Basisnaam indexbestanden")
    ap.add_argument("--top-k", type=int, default=20)
    args = ap.parse_args()

    out = Path(args.out)
    npy, pj = out.with_suffix(".npy"), out.with_suffix(".paths.json")
    if not (npy.exists() and pj.exists()):
        sys.exit(f"Geen index gevonden ({npy}). Draai eerst index.py.")

    emb = np.load(npy)                      # [N, D], al genormaliseerd
    paths = json.loads(pj.read_text())

    model, processor, device = load_model()
    q = embed_text(model, processor, device, [args.query])[0]  # [D]

    # Cosine similarity = dotproduct, want alles is L2-genormaliseerd.
    scores = emb @ q
    order = np.argsort(-scores)[:args.top_k]

    print(f"\nTop {len(order)} voor: \"{args.query}\"\n")
    for rank, idx in enumerate(order, 1):
        print(f"{rank:>3}. {scores[idx]:.3f}  {paths[idx]}")


if __name__ == "__main__":
    main()
