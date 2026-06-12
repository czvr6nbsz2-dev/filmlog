#!/usr/bin/env python3
"""
Genereert een 3D-LUT (.cube) die het Lightroom-profiel
"iPhone 15 + Leica Kleur" benadert, voor de live zoeker-preview
in de Rauw-app.

Let op: dit is een benadering voor de PREVIEW. De opgeslagen DNG blijft
neutraal; de echte look komt van de LR-preset bij import.

Bron-instellingen uit de XMP (v2, "iPhone 15 + Leica Kleur"),
bijgesteld op basis van D700-referentiebeelden (juni 2026):
  Belichting -0.55, Contrast +25 (was +15), Highlights -45 (was -55),
  Shadows +5 (was +15), Whites +5, Blacks -30 (was -20), Dehaze +10,
  Vibrance -20 (was -15), Saturation -4
  Witbalans 5150K/+20 t.o.v. as-shot 5600K/+15 (lichte koel/magenta-shift)
  Tooncurve: (0,5)(32,30)(64,62)(128,130)(192,192)(224,222)(255,250)
  Color grading: warme middentonen-grade verwijderd; de referenties
  zijn koel/neutraal, dus alleen een heel lichte teal-push in de mids.
  (Vignet -16 wordt in de app als apart CIVignetteEffect toegepast;
   korrel 16, clarity/texture en scherpte/NR zijn LR-werk en blijven
   buiten de LUT.)
"""

import colorsys
import math
import os

SIZE = 33

EXPOSURE_EV = -0.55
CONTRAST = 0.25
HIGHLIGHTS = -0.45
SHADOWS = 0.05
WHITES = 0.05
BLACKS = -0.30
DEHAZE = 0.10
VIBRANCE = -0.20
SATURATION = -0.04
# WB-shift t.o.v. de auto-witbalans van de zoeker: iets koeler + iets magenta
WB_GAIN = (0.985, 0.995, 1.015)

CURVE_PTS = [(0, 5), (32, 30), (64, 62), (128, 130), (192, 192), (224, 222), (255, 250)]

GRADE = [
    # (hue, sat/100, zone)
    (195, 0.04, "mids"),
]


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def monotone_cubic(points):
    """Fritsch-Carlson monotone kubieke interpolatie -> functie [0,1]->[0,1]."""
    xs = [p[0] / 255.0 for p in points]
    ys = [p[1] / 255.0 for p in points]
    n = len(xs)
    d = [(ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]) for i in range(n - 1)]
    m = [d[0]] + [(d[i - 1] + d[i]) / 2 for i in range(1, n - 1)] + [d[-1]]
    for i in range(n - 1):
        if d[i] == 0:
            m[i] = m[i + 1] = 0.0
        else:
            a, b = m[i] / d[i], m[i + 1] / d[i]
            s = a * a + b * b
            if s > 9:
                t = 3.0 / math.sqrt(s)
                m[i], m[i + 1] = t * a * d[i], t * b * d[i]

    def f(x):
        x = max(xs[0], min(xs[-1], x))
        for i in range(n - 1):
            if x <= xs[i + 1]:
                h = xs[i + 1] - xs[i]
                t = (x - xs[i]) / h
                h00 = (1 + 2 * t) * (1 - t) ** 2
                h10 = t * (1 - t) ** 2
                h01 = t * t * (3 - 2 * t)
                h11 = t * t * (t - 1)
                return ys[i] * h00 + m[i] * h * h10 + ys[i + 1] * h01 + m[i + 1] * h * h11
        return ys[-1]

    return f


curve = monotone_cubic(CURVE_PTS)


def hue_dir(hue_deg):
    r, g, b = colorsys.hsv_to_rgb(hue_deg / 360.0, 1.0, 1.0)
    mean = (r + g + b) / 3.0
    v = (r - mean, g - mean, b - mean)
    norm = math.sqrt(sum(c * c for c in v))
    return tuple(c / norm for c in v)


def luma(r, g, b):
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def zone_weight(zone, y):
    if zone == "shadows":
        return (1.0 - smoothstep(0.05, 0.55, y)) * smoothstep(0.0, 0.04, y)
    if zone == "mids":
        return smoothstep(0.15, 0.4, y) * (1.0 - smoothstep(0.6, 0.9, y))
    return smoothstep(0.55, 0.9, y)


def transform(r, g, b):
    # 0. Belichting + witbalans-shift in (benaderd) lineair licht
    gain = 2.0 ** EXPOSURE_EV
    r = (max(r, 0.0) ** 2.2 * gain * WB_GAIN[0]) ** (1 / 2.2)
    g = (max(g, 0.0) ** 2.2 * gain * WB_GAIN[1]) ** (1 / 2.2)
    b = (max(b, 0.0) ** 2.2 * gain * WB_GAIN[2]) ** (1 / 2.2)

    # 0b. Dehaze-benadering: waas (gelijkmatige lift) eraf halen
    veil = DEHAZE * 0.25
    r = max(0.0, (r - veil) / (1.0 - veil))
    g = max(0.0, (g - veil) / (1.0 - veil))
    b = max(0.0, (b - veil) / (1.0 - veil))

    # 1. Basic-panel benadering via luminantieschaling
    y = luma(r, g, b)
    dy = 0.0
    dy += HIGHLIGHTS * 0.30 * smoothstep(0.40, 0.90, y) * (1.05 - y)
    dy += SHADOWS * 0.30 * (1.0 - smoothstep(0.05, 0.55, y)) * smoothstep(0.0, 0.05, y)
    dy += WHITES * 0.25 * smoothstep(0.70, 1.0, y)
    dy += BLACKS * 0.25 * (1.0 - smoothstep(0.0, 0.25, y))
    y1 = y + dy
    # contrast: s-curve rond middengrijs
    y2 = y1 + CONTRAST * 0.35 * (y1 - 0.5) * (1.0 - (2 * y1 - 1) ** 2)
    if y > 1e-5:
        k = max(0.0, y2) / y
        r, g, b = r * k, g * k, b * k

    # 2. Tooncurve per kanaal
    r, g, b = curve(min(r, 1.0)), curve(min(g, 1.0)), curve(min(b, 1.0))

    # 3. Vibrance -15 (zachte desaturatie, huidtinten licht ontzien)
    mx, mn = max(r, g, b), min(r, g, b)
    if mx > 1e-5:
        sat = (mx - mn) / mx
        h = colorsys.rgb_to_hsv(r, g, b)[0] * 360.0
        skin = smoothstep(10, 25, h) * (1.0 - smoothstep(45, 60, h))
        amount = VIBRANCE * (1.0 - 0.5 * sat) * (1.0 - 0.5 * skin)
        gray = luma(r, g, b)
        # vibrance + globale verzadiging (-4) + dehaze-kleurcompensatie
        f = (1.0 + amount) * (1.0 + SATURATION) * (1.0 + DEHAZE * 0.3)
        r = gray + (r - gray) * f
        g = gray + (g - gray) * f
        b = gray + (b - gray) * f

    # 4. Color grading (3-way)
    y = luma(r, g, b)
    for hue, s, zone in GRADE:
        w = zone_weight(zone, y) * s * 0.22
        dr, dg, db = hue_dir(hue)
        r += dr * w
        g += dg * w
        b += db * w

    return (max(0.0, min(1.0, c)) for c in (r, g, b))


def main():
    out = os.path.join(os.path.dirname(__file__), "..", "Rauw", "Looks", "D700.cube")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        f.write('TITLE "iPhone 15 Leica Kleur (preview-benadering)"\n')
        f.write(f"LUT_3D_SIZE {SIZE}\n")
        for bi in range(SIZE):
            for gi in range(SIZE):
                for ri in range(SIZE):
                    r, g, b = transform(ri / (SIZE - 1), gi / (SIZE - 1), bi / (SIZE - 1))
                    f.write(f"{r:.6f} {g:.6f} {b:.6f}\n")
    print(f"Geschreven: {os.path.normpath(out)}")


if __name__ == "__main__":
    main()
