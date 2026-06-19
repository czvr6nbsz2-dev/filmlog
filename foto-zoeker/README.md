# Foto-zoeker — Fase 1 (CLI-prototype)

Lokaal tekst-naar-beeld zoeken over een map met preview-JPG's, met SigLIP 2
(meertalig, begrijpt Nederlands). 100% lokaal, geen cloud.

## Eenmalig installeren

```bash
cd ~/photo-search          # of waar je deze map neerzet
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Gebruik

1. **Indexeren** (eenmalig per map, traag — model wordt 1e keer gedownload):

   ```bash
   python index.py "/Users/arthur/Desktop/Previews"
   ```

   Maakt `index.npy` + `index.paths.json` (afgeleide cache, mag je weggooien).

2. **Zoeken** (snel, zo vaak je wilt):

   ```bash
   python search.py "brug bij ochtendlicht"
   python search.py "mens klein in landschap" --top-k 30
   ```

   Output: gesorteerde lijst `score  bestandspad`.

## Tips

- Eerste run downloadt het model (~1.7GB) naar `~/.cache/huggingface`.
- Te traag of te zwaar? Gebruik een lichter model:
  ```bash
  MODEL_NAME=google/siglip2-base-patch16-224 python index.py "/pad"
  ```
  (gebruik dan hetzelfde MODEL_NAME bij `search.py`).
- Op je iMac met Apple Silicon wordt automatisch de GPU (MPS) gebruikt.
- `index.py` opnieuw draaien op dezelfde map slaat al gedane foto's over.

## Wat dit NIET doet (komt later)

Fase 1 raakt je Lightroom-catalogus niet aan. Geen XMP, geen keywords —
puur zoekkwaliteit testen. Bevalt het, dan bouwen we Fase 3.
