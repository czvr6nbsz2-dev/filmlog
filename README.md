# FilmLog

Persoonlijk filmlogboek als web app. Open het op je telefoon, voeg toe aan je homescreen, klaar.

## Hoe te gebruiken

1. Ga naar de URL van deze app op je telefoon
2. Tik op **Deel** → **Zet op beginscherm** (iOS) of **Installeren** (Android)
3. Open de app, voer je OMDb API-sleutel in
4. Begin met het loggen van films!

## OMDb API-sleutel

Gratis aan te vragen op [omdbapi.com/apikey.aspx](https://www.omdbapi.com/apikey.aspx).
Voer de sleutel in bij de eerste keer openen, of later via Instellingen.

## Functies

- Films toevoegen met automatische IMDb-verrijking
- Bioscoop of thuis bijhouden
- Persoonlijk oordeel + score (1-10)
- PDF export van je complete filmlogboek
- CSV import van bestaande filmlijst
- JSON backup/restore
- Werkt offline (PWA)

## CSV formaat

```csv
filmtitel,kijkdatum,locatie
The Shawshank Redemption,15-03-2024,bioscoop
Pulp Fiction,22-01-2024,thuis
```

## Zelf hosten

Push naar een GitHub repo en zet **GitHub Pages** aan (Settings → Pages → Source: main branch).
Je app draait dan op `https://<gebruikersnaam>.github.io/<repo-naam>/`.
