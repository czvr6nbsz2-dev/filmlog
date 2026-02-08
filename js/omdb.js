import { getSetting } from './db.js';

const BASE_URL = 'https://www.omdbapi.com/';

function getApiKey() {
    return getSetting('apiKey') || '';
}

export async function searchFilms(query) {
    const key = getApiKey();
    if (!key) throw new Error('Geen API-sleutel ingesteld.');

    const url = `${BASE_URL}?apikey=${encodeURIComponent(key)}&s=${encodeURIComponent(query)}&type=movie`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Netwerkfout');

    const data = await res.json();

    if (data.Response === 'False') {
        if (data.Error?.includes('Too many results')) {
            throw new Error('Te veel resultaten. Specificeer de titel nauwkeuriger.');
        }
        if (data.Error?.includes('not found')) {
            throw new Error('Geen films gevonden.');
        }
        throw new Error(data.Error || 'Onbekende fout');
    }

    return (data.Search || []).map(r => ({
        title: r.Title,
        year: r.Year,
        imdbID: r.imdbID,
        poster: r.Poster !== 'N/A' ? r.Poster : null,
    }));
}

export async function fetchDetail(imdbID) {
    const key = getApiKey();
    if (!key) throw new Error('Geen API-sleutel ingesteld.');

    const url = `${BASE_URL}?apikey=${encodeURIComponent(key)}&i=${encodeURIComponent(imdbID)}&plot=short`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Netwerkfout');

    const data = await res.json();
    if (data.Response === 'False') throw new Error(data.Error || 'Film niet gevonden.');

    const actors = (data.Actors || '').split(', ').slice(0, 5).join(', ');

    return {
        title: data.Title,
        year: data.Year,
        directors: data.Director !== 'N/A' ? data.Director : null,
        actors: actors !== 'N/A' ? actors : null,
        plot: data.Plot !== 'N/A' ? data.Plot : null,
        imdbRating: data.imdbRating !== 'N/A' ? data.imdbRating : null,
        imdbID: data.imdbID,
        poster: data.Poster !== 'N/A' ? data.Poster : null,
    };
}

export function enrichFilm(film, detail) {
    return {
        ...film,
        imdbID: detail.imdbID,
        year: detail.year,
        directors: detail.directors,
        actors: detail.actors,
        plot: detail.plot,
        imdbRating: detail.imdbRating,
        posterURL: detail.poster,
    };
}

export function hasApiKey() {
    return !!getApiKey();
}
