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
    ap.add_argument("--html", nargs="?", const="results.html", default=None,
                    help="Schrijf een HTML-contactafdruk (en open hem)")
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

    if args.html is not None:
        write_html(args.html, args.query,
                   [(float(scores[i]), paths[i]) for i in order])


def write_html(path, query, results):
    """Maakt een thumbnail-pagina met ingebakken (base64) beelden en opent die.

    Beelden worden in de HTML zelf gezet, zodat browsers geen lokale
    file://-bestanden hoeven te laden (dat blokkeert Safari).
    """
    import base64
    import html
    import io
    import webbrowser

    from PIL import Image

    def thumb_data_uri(p, max_side=400):
        try:
            im = Image.open(p).convert("RGB")
            im.thumbnail((max_side, max_side))
            buf = io.BytesIO()
            im.save(buf, format="JPEG", quality=72)
            b64 = base64.b64encode(buf.getvalue()).decode()
            return f"data:image/jpeg;base64,{b64}"
        except Exception:
            return ""

    cards = "\n".join(
        f'<figure><img src="{thumb_data_uri(p)}" loading="lazy">'
        f'<figcaption>{rank}. {score:.3f}<br>{html.escape(Path(p).name)}</figcaption></figure>'
        for rank, (score, p) in enumerate(results, 1)
    )
    doc = f"""<!doctype html><meta charset="utf-8">
<title>{html.escape(query)}</title>
<style>
 body{{font-family:sans-serif;background:#222;color:#eee;margin:1rem}}
 .grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}}
 figure{{margin:0}} img{{width:100%;height:200px;object-fit:cover;border-radius:4px}}
 figcaption{{font-size:.8rem;opacity:.8;padding:2px 0}}
</style>
<h2>{html.escape(query)}</h2>
<div class="grid">{cards}</div>"""
    out = Path(path).resolve()
    out.write_text(doc)
    print(f"\nHTML-contactafdruk: {out}")
    webbrowser.open(out.as_uri())


if __name__ == "__main__":
    main()
