const SEARCH_URL = 'https://openlibrary.org/search.json';

export async function searchBooks(title, author) {
    const params = new URLSearchParams({ limit: '6' });
    if (title) params.set('title', title);
    if (author) params.set('author', author);

    const res = await fetch(`${SEARCH_URL}?${params}`);
    if (!res.ok) throw new Error('Netwerkfout bij Open Library.');

    const data = await res.json();

    if (!data.docs || data.docs.length === 0) {
        throw new Error('Geen boeken gevonden.');
    }

    return data.docs.slice(0, 6).map(doc => ({
        title: doc.title,
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
