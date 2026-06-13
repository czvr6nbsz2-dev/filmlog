#!/usr/bin/env python3
"""
Genereert TriX.cube: een zwartwit-zoekerlook in de stijl van Kodak Tri-X 400,
maar nét iets minder contrast dan de volle Tri-X-curve — wel "pittig".

Let op: dit is een benadering voor de PREVIEW. De opgeslagen DNG blijft
neutraal; de echte conversie doe je desgewenst in Lightroom.

Karakter:
  - Panchromatische weging die iets richting Tri-X leunt: blauwe luchten
    worden wat donkerder (dramatisch), huid en blad blijven helder.
  - Pittige S-curve met diepe maar niet dichtgeknepen zwarten en een
    zachte schouder in de hooglichten.
  - Heel subtiele bruinzwarte toning in de schaduwen (geen sepia): warm in
    de diepe tonen, neutraal naar de hooglichten toe, zodat wit schoon blijft.
  - Belichting -0.55 gelijk aan de kleurlook, zodat de zoeker even helder is.
"""

import math
import os

SIZE = 33

# Gelijk aan de kleur-LUT, zodat omschakelen de zoekerhelderheid niet verspringt.
EXPOSURE_EV = -0.55

# Tri-X-achtige panchromatische weging (telt samen op tot 1.0):
# wat meer groen/rood, minder blauw -> donkerdere luchten, heldere huid/blad.
W_R, W_G, W_B = 0.34, 0.42, 0.24

# Pittige, licht getemperde Tri-X-tooncurve (0-255 in en uit):
# zwarten net opgetild (4), stevige middenhelling, zachte schouder (251).
CURVE_PTS = [
    (0, 4), (32, 22), (64, 52), (96, 92), (128, 132),
    (160, 172), (192, 206), (224, 234), (255, 251),
]

# Bruinzwarte toning: maximale verschuiving per kanaal in de diepste tonen.
# Rood iets op, groen heel licht op, blauw iets eraf -> warm bruinzwart.
# Klein houden: dit moet "een tikkie" zijn, geen sepia.
TONE_R = 0.018
TONE_G = 0.006
TONE_B = -0.012


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


def transform(r, g, b):
    # Belichting in (benaderd) lineair licht
    gain = 2.0 ** EXPOSURE_EV
    r = (max(r, 0.0) ** 2.2 * gain) ** (1 / 2.2)
    g = (max(g, 0.0) ** 2.2 * gain) ** (1 / 2.2)
    b = (max(b, 0.0) ** 2.2 * gain) ** (1 / 2.2)

    # Panchromatische luminantie + Tri-X-tooncurve
    y = W_R * r + W_G * g + W_B * b
    y = curve(min(max(y, 0.0), 1.0))
    y = max(0.0, min(1.0, y))

    # Bruinzwarte toning, alleen in de schaduwen; valt weg richting hooglicht.
    w = 1.0 - smoothstep(0.0, 0.55, y)
    r = y + TONE_R * w
    g = y + TONE_G * w
    b = y + TONE_B * w
    return (max(0.0, min(1.0, c)) for c in (r, g, b))


def main():
    out = os.path.join(os.path.dirname(__file__), "..", "Rauw", "Looks", "TriX.cube")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        f.write('TITLE "Tri-X 400 (preview-benadering, iets zachter)"\n')
        f.write(f"LUT_3D_SIZE {SIZE}\n")
        for bi in range(SIZE):
            for gi in range(SIZE):
                for ri in range(SIZE):
                    r, g, b = transform(ri / (SIZE - 1), gi / (SIZE - 1), bi / (SIZE - 1))
                    f.write(f"{r:.6f} {g:.6f} {b:.6f}\n")
    print(f"Geschreven: {os.path.normpath(out)}")


if __name__ == "__main__":
    main()
