/**
 * Book Recommendation Engine
 * Generates personalized book recommendations using Claude API
 */

const ANTHROPIC_API_KEY_KEY = 'boeklog_anthropic_token';

/**
 * Check if Anthropic API key is configured
 */
export function isApiKeyConfigured() {
    return localStorage.getItem(ANTHROPIC_API_KEY_KEY) ? true : false;
}

/**
 * Format books into a readable list for the prompt
 */
function formatBooksForPrompt(books) {
    if (!books || books.length === 0) {
        return 'No books have been read yet.';
    }

    return books
        .map((book, idx) => {
            const rating = book.myRating ? ` (Rating: ${book.myRating}/10)` : '';
            const author = book.author ? ` by ${book.author}` : '';
            const year = book.year ? ` (${book.year})` : '';
            return `${idx + 1}. "${book.title}"${author}${year}${rating}`;
        })
        .join('\n');
}

/**
 * Parse recommendation JSON response
 */
function parseRecommendationResponse(text) {
    // Try to extract JSON from response
    const jsonMatch = text.match(/\[\s*{[\s\S]*}\s*\]/);
    if (!jsonMatch) {
        throw new Error('Could not parse recommendations from response');
    }

    const recommendations = JSON.parse(jsonMatch[0]);

    if (!Array.isArray(recommendations) || recommendations.length === 0) {
        throw new Error('Invalid recommendations format');
    }

    // Validate structure
    return recommendations.map(rec => {
        if (!rec.title || !rec.author || !rec.why || !rec.genre) {
            throw new Error('Recommendation missing required fields');
        }
        return {
            title: String(rec.title).trim(),
            author: String(rec.author).trim(),
            why: String(rec.why).trim(),
            genre: String(rec.genre).trim()
        };
    });
}

/**
 * Generate book recommendations using Claude API
 */
export async function generateRecommendations(books, mode, theme = null) {
    const apiKey = localStorage.getItem(ANTHROPIC_API_KEY_KEY);

    if (!apiKey) {
        throw new Error('Anthropic API key is not configured. Please save it in Settings first.');
    }

    const booksText = formatBooksForPrompt(books);

    let systemPrompt = `You are an expert book recommendation engine. Your task is to suggest books based on a person's reading history and preferences.

Provide exactly 10 book recommendations. Each recommendation must be a real, published book.

Respond ONLY with a valid JSON array containing exactly 10 objects with these fields:
- title: string (book title)
- author: string (author name)
- why: string (1-2 sentence explanation of why this book is recommended)
- genre: string (genre or category)`;

    let userPrompt;
    if (mode === 'yolo') {
        userPrompt = `Based on this person's reading history, suggest 10 diverse books that match their demonstrated interests and reading level:

${booksText}

Generate recommendations that explore different genres and styles they might enjoy.`;
    } else if (mode === 'theme') {
        userPrompt = `Based on this person's reading history, suggest 10 books specifically focused on or related to: "${theme}"

Their reading history:
${booksText}

Consider their reading style and level when making recommendations for this specific theme/genre/author.`;
    } else {
        throw new Error('Invalid recommendation mode');
    }

    try {
        console.log('[BoekLog] Generating recommendations...', { mode, theme, booksCount: books.length });

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2024-06-01'
            },
            body: JSON.stringify({
                model: 'claude-3-5-sonnet-20241022',
                max_tokens: 2000,
                temperature: 0.7,
                system: systemPrompt,
                messages: [
                    { role: 'user', content: userPrompt }
                ]
            })
        });

        console.log('[BoekLog] API response received:', { status: response.status });

        if (!response.ok) {
            const errorData = await response.text();
            console.error('[BoekLog] API error response:', { status: response.status, body: errorData });

            if (response.status === 401) {
                throw new Error('API-sleutel ongeldig. Controleer je Anthropic-token in Instellingen.');
            } else if (response.status === 429) {
                throw new Error('Te veel verzoeken. Even geduld en daarna opnieuw proberen.');
            } else if (response.status >= 500) {
                // Try to parse error message from Anthropic
                try {
                    const errorJson = JSON.parse(errorData);
                    const message = errorJson.error?.message || errorJson.message || 'Onbekende fout';
                    throw new Error(`Anthropic API-fout (${response.status}): ${message}`);
                } catch (e) {
                    throw new Error(`Anthropic API-fout (${response.status}). Probeer het later opnieuw.`);
                }
            } else {
                throw new Error(`API-fout: ${response.status}`);
            }
        }

        const data = await response.json();

        if (!data.content || !data.content[0] || !data.content[0].text) {
            throw new Error('Onverwacht API-antwoord');
        }

        return parseRecommendationResponse(data.content[0].text);

    } catch (err) {
        console.error('[BoekLog] Recommendation error:', err);
        if (err instanceof SyntaxError) {
            throw new Error('Fout bij verwerken van API-antwoord. Probeer het opnieuw.');
        }
        if (err instanceof TypeError && err.message.includes('Failed to fetch')) {
            throw new Error('Netwerk- of CORS-fout. Controleer je internetverbinding en probeer het opnieuw.');
        }
        throw err;
    }
}
