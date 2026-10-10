const SEARCH_URL = 'https://openlibrary.org/search.json';

// Only request the fields we actually use — smaller, faster responses.
const SEARCH_FIELDS =
    'key,title,subtitle,author_name,first_publish_year,cover_i,number_of_pages_median';

async function runSearch(params) {
    params.set('fields', SEARCH_FIELDS);
    params.set('limit', '10');

    const res = await fetch(`${SEARCH_URL}?${params}`);
    if (!res.ok) throw new Error('Netwerkfout bij Open Library.');

    const data = await res.json();
    return Array.isArray(data.docs) ? data.docs : [];
}

export async function searchBooks(title, author) {
    title = (title || '').trim();
    author = (author || '').trim();

    let docs = [];

    // 1. Free-text query combining everything the user typed. This is far more
    //    forgiving than the strict title= field: it matches subtitles
    //    (e.g. "Noise: A Flaw in Human Judgment"), punctuation and word order,
    //    and ranks by relevance.
    const queryParts = [title, author].filter(Boolean);
    if (queryParts.length) {
        docs = await runSearch(new URLSearchParams({ q: queryParts.join(' ') }));
    }

    // 2. Fallback: title only, in case a slightly-wrong author narrowed it to
    //    nothing.
    if (!docs.length && title && author) {
        docs = await runSearch(new URLSearchParams({ q: title }));
    }

    // 3. Last resort: the old structured field search (also handles an
    //    author-only lookup, which has no free-text title to query on).
    if (!docs.length) {
        const params = new URLSearchParams();
        if (title) params.set('title', title);
        if (author) params.set('author', author);
        if ([...params].length) {
            docs = await runSearch(params);
        }
    }

    if (!docs.length) {
        throw new Error('Geen boeken gevonden.');
    }

    return docs.slice(0, 6).map(doc => ({
        // Show the full title incl. subtitle so the match is recognisable.
        title: doc.subtitle ? `${doc.title}: ${doc.subtitle}` : doc.title,
        author: (doc.author_name || []).join(', '),
        year: doc.first_publish_year ? String(doc.first_publish_year) : null,
        workKey: doc.key, // e.g. "/works/OL123W"
        coverId: doc.cover_i || null,
        coverURL: doc.cover_i
            ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
            : null,
        pages: doc.number_of_pages_median || null,
    }));
}

export async function fetchWorkDetail(workKey) {
    // workKey is like "/works/OL123W"
    const res = await fetch(`https://openlibrary.org${workKey}.json`);
    if (!res.ok) throw new Error('Kon boekgegevens niet ophalen.');

    const data = await res.json();

    let description = null;
    if (data.description) {
        description = typeof data.description === 'string'
            ? data.description
            : data.description.value || null;
    }

    const subjects = (data.subjects || []).slice(0, 5).join(', ');

    return {
        description,
        subjects: subjects || null,
    };
}

export async function getFullBookDetail(searchResult) {
    const detail = { ...searchResult, description: null, subjects: null };

    if (searchResult.workKey) {
        try {
            const workData = await fetchWorkDetail(searchResult.workKey);
            detail.description = workData.description;
            detail.subjects = workData.subjects;
        } catch {
            // Continue without description
        }
    }

    return detail;
}

export function enrichBook(book, detail) {
    return {
        ...book,
        openLibraryKey: detail.workKey || null,
        publishYear: detail.year || null,
        coverURL: detail.coverURL || null,
        description: detail.description || null,
        subjects: detail.subjects || null,
        numberOfPages: detail.pages || null,
    };
}
