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

    const limited = books.slice(0, 40);

    return limited
        .map((book, idx) => {
            const rating = book.myRating ? ` (Rating: ${book.myRating}/10)` : '';
            const author = book.author ? ` by ${book.author}` : '';
            const yearValue = book.publishYear || book.year || '';
            const year = yearValue ? ` (${yearValue})` : '';
            return `${idx + 1}. "${book.title}"${author}${year}${rating}`;
        })
        .join('\n');
}

function extractTextFromResponse(data) {
    if (!data) return '';
    if (typeof data === 'string') return data;

    if (typeof data.output_text === 'string') return data.output_text;

    if (Array.isArray(data.content)) {
        return data.content
            .map(block => (typeof block?.text === 'string' ? block.text : ''))
            .join('\n')
            .trim();
    }

    if (data.message?.content) {
        if (Array.isArray(data.message.content)) {
            return data.message.content
                .map(block => (typeof block?.text === 'string' ? block.text : ''))
                .join('\n')
                .trim();
        }
        if (typeof data.message.content === 'string') return data.message.content;
    }

    if (Array.isArray(data.choices) && data.choices[0]?.message?.content) {
        return data.choices[0].message.content;
    }

    return '';
}

function extractJsonArray(text) {
    if (!text) throw new Error('Leeg antwoord van API.');

    const trimmed = text.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        return JSON.parse(trimmed);
    }

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : trimmed;
    const jsonMatch = candidate.match(/\[\s*{[\s\S]*}\s*\]/);
    if (!jsonMatch) {
        throw new Error('Kon geen geldige JSON-array vinden in het antwoord.');
    }
    return JSON.parse(jsonMatch[0]);
}

/**
 * Parse recommendation JSON response
 */
function parseRecommendationResponse(text) {
    const recommendations = extractJsonArray(text);

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
        console.log('[BoekLog] API key present:', !!apiKey, 'length:', apiKey?.length);

        let response;
        try {
            console.log('[BoekLog] Sending fetch request to Anthropic API...');
            response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2024-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true'
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
            console.log('[BoekLog] Fetch succeeded, got response');
        } catch (fetchError) {
            console.error('[BoekLog] Fetch failed:', fetchError?.message, fetchError?.stack);
            throw new Error(`Netwerk-/fetch-fout: ${fetchError?.message || 'Onbekend'}`);
        }

        console.log('[BoekLog] API response received:', { status: response.status });

        if (!response.ok) {
            const errorData = await response.text();
            console.error('[BoekLog] API error response:', { status: response.status, body: errorData });

            if (response.status === 401) {
                throw new Error('API-sleutel ongeldig. Controleer je Anthropic-token in Instellingen.');
            } else if (response.status === 429) {
                throw new Error('Te veel verzoeken. Even geduld en daarna opnieuw proberen.');
            }

            // Try to parse error message from Anthropic for any other status
            try {
                const errorJson = JSON.parse(errorData);
                const message = errorJson.error?.message || errorJson.message || 'Onbekende fout';
                throw new Error(`Anthropic API-fout (${response.status}): ${message}`);
            } catch (e) {
                if (response.status >= 500) {
                    throw new Error(`Anthropic API-fout (${response.status}). Probeer het later opnieuw.`);
                }
                throw new Error(`API-fout (${response.status}).`);
            }
        }

        const data = await response.json();

        const text = extractTextFromResponse(data);
        if (!text) throw new Error('Onverwacht API-antwoord');

        return parseRecommendationResponse(text);

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
