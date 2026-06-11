# Rauw

Eigen iPhone-camera-app: **RAW (DNG), AF-S, single shot, geen flits** — met een
live zoeker-preview van het Lightroom-profiel
*"D700 + Nikkor 50mm f/1.4 AI + Leica Kleur"*.

De foto zelf blijft een **neutrale DNG**. De stijl komt in Lightroom van je
eigen preset, zodat iPhone-foto's met dezelfde look in je catalogus landen als
je Nikon-foto's.

## Hoe de app werkt

| Onderdeel | Gedrag |
|---|---|
| Bestandsformaat | Bayer RAW (DNG), 12 MP — Apple staat buiten ProRAW geen 48 MP RAW toe. Net als de D700 dus. |
| Belichting | **A**: automaat met EV-compensatie in 1/3 stops (het iPhone-equivalent van A-priority: diafragma ligt per lens vast). **M**: handmatige sluitertijd + ISO. |
| AE-lock | Lang indrukken op de sluiterknop (slotje verschijnt). |
| Scherpstellen | AF-S: tik in de zoeker, één scan, daarna blijft de focus staan. |
| Lenzen | 13 mm (f/2.2) en 26 mm (f/1.6) — de echte camera's; "2x" op non-Pro is een digitale crop en bestaat niet voor RAW. 13 mm heeft op non-Pro geen autofocus (fixed focus). |
| Sluiter | Schermknop, volumeknoppen en Camera Control (iPhone 16/17). |
| Film-preview | "D700"-LUT, alleen in de zoeker (+ subtiel vignet conform het profiel). Uit te zetten via de filmknop bovenin. |
| Frontcamera | Geen RAW mogelijk (Apple-beperking) → HEIF. |
| Overig | Raster, waterpas, instellingen blijven bewaard, scherm blijft aan. |

## Installeren (Mac, gratis Apple ID)

1. Installeer **Xcode** uit de Mac App Store (gratis, ±15 GB).
2. Open `rauw/Rauw.xcodeproj`.
3. Xcode > Settings > Accounts > **+** > log in met je Apple ID
   (er wordt automatisch een gratis "Personal Team" aangemaakt).
4. Klik op het project (blauw icoon) > target **Rauw** > tab
   **Signing & Capabilities** > kies je Personal Team.
   Geeft de bundle-ID een conflict, verander hem dan in iets unieks
   (bijv. `com.jouwnaam.rauw`).
5. iPhone via kabel aansluiten (eerste keer): **vertrouw** de Mac op de iPhone.
6. Zet op de iPhone **Ontwikkelaarsmodus** aan:
   Instellingen > Privacy en beveiliging > Ontwikkelaarsmodus (herstart).
7. Kies bovenin Xcode je iPhone als doel en druk **⌘R**.
8. Eerste start: Instellingen > Algemeen > VPN en apparaatbeheer >
   vertrouw je eigen ontwikkelaarscertificaat.

**Let op (gratis account):** de handtekening verloopt na **7 dagen**; daarna
start de app niet meer tot je opnieuw ⌘R doet vanaf de Mac (de app en
instellingen blijven staan). Met het betaalde Apple Developer Program
(€99/jaar) is dat een jaar en kan TestFlight.

## Lightroom-koppeling (eenmalig)

Doel: elke iPhone-DNG krijgt automatisch jouw preset bij import.

1. Importeer één testfoto-DNG in Lightroom Classic.
2. Zet je preset *"D700 + Nikkor 50mm f/1.4 AI + Leica Kleur"* desgewenst in
   een variant zonder de lens-specifieke onderdelen (de iPhone heeft eigen
   ingebouwde lenscorrecties).
3. Voorkeuren > Voorinstellingen (Presets) > **Onbewerkte standaarden
   (Raw Defaults)** > "Hoofdinstellingen vervangen voor specifieke camera's"
   > kies het iPhone-cameramodel uit de lijst > selecteer je preset.
4. Vanaf nu rendert elke DNG van die camera automatisch met jouw look —
   gescheiden van je Nikon-standaarden.

Korrel (Amount 16), vignet en verscherping zitten in je preset en worden dus
ook op de iPhone-bestanden toegepast.

## Zoeker-LUT opnieuw genereren

De zoeker-preview (`Rauw/Looks/D700.cube`) is een benadering van het
LR-profiel, gegenereerd uit de XMP-waardes:

```sh
python3 tools/xmp_to_cube.py
```

Pas de constanten bovenin het script aan als je preset verandert en draai het
opnieuw; daarna de app opnieuw builden.

## Bekende beperkingen

- Eén frame, geen computational photography: bij weinig licht zie je echte
  sensorruis in de DNG (zoals bij een echte camera). LR Denoise werkt er goed op.
- De zoeker-LUT is een voorvertoning, geen pixel-exacte LR-rendering.
- Witbalans staat op auto; die bepaalt alleen het startpunt van de DNG in LR.
