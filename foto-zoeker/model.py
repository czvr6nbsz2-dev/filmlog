"""Gedeelde model-laadcode voor index.py en search.py.

Eén multitaal-model (SigLIP 2) dat zowel beelden als Nederlandse tekst
naar dezelfde vectorruimte vertaalt, zodat we tekst-tegen-beeld kunnen zoeken.
"""

from __future__ import annotations  # nieuwere type-hints werkend op Python 3.9

import os
import torch
from transformers import AutoModel, AutoProcessor

# SigLIP 2 is meertalig (begrijpt o.a. Nederlands) en sterk op retrieval.
# 'so400m-patch14-384' = goede kwaliteit/snelheid-balans (~1.7GB download).
# Voor sneller/lichter testen: zet MODEL_NAME=google/siglip2-base-patch16-224
MODEL_NAME = os.environ.get("MODEL_NAME", "google/siglip2-so400m-patch14-384")


def pick_device() -> str:
    """Apple Silicon (MPS) > NVIDIA (CUDA) > CPU."""
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def load_model(device: str | None = None):
    """Laadt model + processor. Eerste keer wordt het model gedownload."""
    device = device or pick_device()
    print(f"Model laden: {MODEL_NAME} op {device} ...")
    model = AutoModel.from_pretrained(MODEL_NAME).to(device).eval()
    processor = AutoProcessor.from_pretrained(MODEL_NAME)
    return model, processor, device


@torch.no_grad()
def embed_images(model, processor, device, pil_images):
    """Geeft L2-genormaliseerde beeld-embeddings terug (numpy, [N, D])."""
    inputs = processor(images=pil_images, return_tensors="pt").to(device)
    feats = model.get_image_features(**inputs)
    feats = feats / feats.norm(dim=-1, keepdim=True)
    return feats.cpu().numpy()


@torch.no_grad()
def embed_text(model, processor, device, texts):
    """Geeft L2-genormaliseerde tekst-embeddings terug (numpy, [N, D])."""
    # SigLIP verwacht vaste tekstlengte (padding op max_length).
    inputs = processor(
        text=texts, return_tensors="pt", padding="max_length"
    ).to(device)
    feats = model.get_text_features(**inputs)
    feats = feats / feats.norm(dim=-1, keepdim=True)
    return feats.cpu().numpy()
