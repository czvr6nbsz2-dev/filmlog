/**
 * Film Recommendation Engine
 * Generates personalized film recommendations using Claude API
 */

const ANTHROPIC_API_KEY_KEY = 'filmlog_anthropic_token';

export function isApiKeyConfigured() {
    return !!localStorage.getItem(ANTHROPIC_API_KEY_KEY);
}

function formatFilmsForPrompt(films) {
    if (!films || films.length === 0) return 'No films have been watched yet.';

    return films.slice(0, 40).map((film, idx) => {
        const rating = film.myRating ? ` (My rating: ${film.myRating}/10)` : '';
        const imdb = film.imdbRating ? ` [IMDb: ${film.imdbRating}]` : '';
        const directors = film.directors ? ` dir. ${film.directors}` : '';
        const year = film.year ? ` (${film.year})` : '';
        return `${idx + 1}. "${film.title}"${year}${directors}${imdb}${rating}`;
    }).join('\n');
}

function extractJsonArray(text) {
    if (!text) throw new Error('Leeg antwoord van API.');
    const trimmed = text.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) return JSON.parse(trimmed);
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : trimmed;
    const jsonMatch = candidate.match(/\[\s*{[\s\S]*}\s*\]/);
    if (!jsonMatch) throw new Error('Kon geen geldige JSON-array vinden in het antwoord.');
    return JSON.parse(jsonMatch[0]);
}

function parseRecommendationResponse(data) {
    let text = '';
    if (data?.content?.[0]?.text) text = data.content[0].text;
    else if (typeof data === 'string') text = data;
    else throw new Error('Onverwacht API-antwoord');

    const recommendations = extractJsonArray(text);
    if (!Array.isArray(recommendations) || recommendations.length === 0) {
        throw new Error('Geen aanbevelingen ontvangen');
    }

    return recommendations.map(rec => {
        if (!rec.title || !rec.director || !rec.why || !rec.genre) {
            throw new Error('Aanbeveling mist verplichte velden');
        }
        return {
            title: String(rec.title).trim(),
            director: String(rec.director).trim(),
            year: rec.year ? String(rec.year).trim() : '',
            why: String(rec.why).trim(),
            genre: String(rec.genre).trim()
        };
    });
}

export async function generateRecommendations(films, mode, theme = null) {
    const apiKey = localStorage.getItem(ANTHROPIC_API_KEY_KEY);
    if (!apiKey) throw new Error('Anthropic API-sleutel niet ingesteld. Sla deze op in Instellingen.');

    const filmsText = formatFilmsForPrompt(films);

    const systemPrompt = `You are an expert film recommendation engine. Your task is to suggest films based on a person's viewing history and preferences.

IMPORTANT: Never recommend films that already appear in the person's viewing history. All 10 recommendations must be films they have NOT yet seen.

Provide exactly 10 film recommendations. Each recommendation must be a real, released film.

Respond ONLY with a valid JSON array containing exactly 10 objects with these fields:
- title: string (film title)
- director: string (director name)
- year: string (release year)
- why: string (1-2 sentence explanation of why this film is recommended, in Dutch)
- genre: string (genre or category)`;

    let userPrompt;
    if (mode === 'yolo') {
        userPrompt = `Based on this person's viewing history, suggest 10 diverse films that match their demonstrated taste and viewing level:\n\n${filmsText}\n\nGenerate recommendations that explore different genres and styles they might enjoy.`;
    } else if (mode === 'theme') {
        userPrompt = `Based on this person's viewing history, suggest 10 films specifically focused on or related to: "${theme}"\n\nTheir viewing history:\n${filmsText}\n\nConsider their viewing taste when making recommendations for this specific theme/genre/director.`;
    } else {
        throw new Error('Ongeldige modus');
    }

    try {
        console.log('[FilmLog] Generating recommendations...', { mode, theme, filmsCount: films.length });

        let response;
        try {
            response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true'
                },
                body: JSON.stringify({
                    model: 'claude-sonnet-4-20250514',
                    max_tokens: 2000,
                    temperature: 0.7,
                    system: systemPrompt,
                    messages: [{ role: 'user', content: userPrompt }]
                })
            });
        } catch (fetchError) {
            throw new Error(`Netwerk-/fetch-fout: ${fetchError?.message || 'Onbekend'}`);
        }

        if (!response.ok) {
            const errorData = await response.text();
            console.error('[FilmLog] API error:', { status: response.status, body: errorData });

            if (response.status === 401) throw new Error('API-sleutel ongeldig. Controleer je Anthropic-token in Instellingen.');
            if (response.status === 429) throw new Error('Te veel verzoeken. Even geduld en daarna opnieuw proberen.');

            let message = `API-fout (${response.status})`;
            try {
                const errorJson = JSON.parse(errorData);
                message = errorJson.error?.message || errorJson.message || message;
            } catch (_) {}
            throw new Error(message);
        }

        const data = await response.json();
        return parseRecommendationResponse(data);

    } catch (err) {
        console.error('[FilmLog] Recommendation error:', err);
        throw err;
    }
}
