const TMDB_KEY  = '8bc1a2ab5515aaf8b9dda4fa487105c8';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG  = 'https://image.tmdb.org/t/p/w500';

async function tmdbFetch(path, params = {}) {
    const url = new URL(TMDB_BASE + path);
    url.searchParams.set('api_key', TMDB_KEY);
    url.searchParams.set('language', 'nl-NL');
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`TMDB ${res.status}`);
    return res.json();
}

/** Find TMDB movie via IMDb ID, returns enriched detail or null */
export async function fetchTmdbByImdbId(imdbID) {
    try {
        const find = await tmdbFetch(`/find/${imdbID}`, { external_source: 'imdb_id' });
        const movie = find?.movie_results?.[0];
        if (!movie) return null;
        return fetchTmdbDetail(movie.id);
    } catch {
        return null;
    }
}

/** Full movie detail + credits by TMDB movie ID */
async function fetchTmdbDetail(tmdbId) {
    try {
        const [detail, credits] = await Promise.all([
            tmdbFetch(`/movie/${tmdbId}`),
            tmdbFetch(`/movie/${tmdbId}/credits`),
        ]);

        const cast = (credits?.cast || [])
            .slice(0, 5)
            .map(c => c.name)
            .filter(Boolean);

        return {
            tmdbId,
            tmdbRating: detail.vote_average ? String(Math.round(detail.vote_average * 10) / 10) : null,
            genres: (detail.genres || []).map(g => g.name).join(', ') || null,
            runtime: detail.runtime ? String(detail.runtime) : null,
            cast,
            poster: detail.poster_path ? TMDB_IMG + detail.poster_path : null,
            overview: detail.overview || null,
        };
    } catch {
        return null;
    }
}

/** Search TMDB (fallback when OMDb finds nothing) */
export async function searchTmdb(query) {
    try {
        const data = await tmdbFetch('/search/movie', { query, include_adult: 'false' });
        return (data.results || []).slice(0, 8).map(r => ({
            title: r.title,
            year: r.release_date ? r.release_date.slice(0, 4) : '',
            tmdbId: r.id,
            poster: r.poster_path ? 'https://image.tmdb.org/t/p/w185' + r.poster_path : null,
            imdbID: null, // filled in later via fetchTmdbDetailById
        }));
    } catch {
        return [];
    }
}

/** Fetch detail for a TMDB result (to get imdbID + full data) */
export async function fetchTmdbResultDetail(tmdbId) {
    try {
        const [detail, credits, ids] = await Promise.all([
            tmdbFetch(`/movie/${tmdbId}`),
            tmdbFetch(`/movie/${tmdbId}/credits`),
            tmdbFetch(`/movie/${tmdbId}/external_ids`),
        ]);

        const cast = (credits?.cast || [])
            .slice(0, 5)
            .map(c => c.name)
            .filter(Boolean);

        return {
            title: detail.title,
            year: detail.release_date ? detail.release_date.slice(0, 4) : null,
            directors: (credits?.crew || [])
                .filter(c => c.job === 'Director')
                .map(c => c.name)
                .join(', ') || null,
            actors: cast.join(', ') || null,
            plot: detail.overview || null,
            imdbRating: null,
            imdbID: ids?.imdb_id || null,
            poster: detail.poster_path ? TMDB_IMG + detail.poster_path : null,
            tmdbId,
            tmdbRating: detail.vote_average ? String(Math.round(detail.vote_average * 10) / 10) : null,
            genres: (detail.genres || []).map(g => g.name).join(', ') || null,
            runtime: detail.runtime ? String(detail.runtime) : null,
            cast,
        };
    } catch {
        return null;
    }
}

/** Merge TMDB data into existing film object (fills gaps, doesn't overwrite OMDb data) */
export function enrichFilmTmdb(film, tmdb) {
    if (!tmdb) return film;
    return {
        ...film,
        tmdbId:     tmdb.tmdbId     || film.tmdbId     || null,
        tmdbRating: tmdb.tmdbRating || film.tmdbRating || null,
        genres:     tmdb.genres     || film.genres     || null,
        runtime:    tmdb.runtime    || film.runtime    || null,
        // Use TMDB actors if OMDb gave us nothing or fewer actors
        actors:     (!film.actors && tmdb.cast?.length) ? tmdb.cast.join(', ') : film.actors,
        // Use TMDB poster only if OMDb had none
        posterURL:  film.posterURL  || tmdb.poster     || null,
        // Use TMDB plot if OMDb had none
        plot:       film.plot       || tmdb.overview   || null,
    };
}
