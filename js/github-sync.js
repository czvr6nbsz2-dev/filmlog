import { getSetting } from './db.js';

const REPO = 'czvr6nbsz2-dev/filmlog';
const PATH = 'data/films.json';
const API = 'https://api.github.com';

function getToken() {
    return getSetting('githubToken') || '';
}

export function isSyncEnabled() {
    return !!getToken();
}

export async function syncToGitHub(films) {
    const token = getToken();
    if (!token) return;

    try {
        const content = btoa(unescape(encodeURIComponent(JSON.stringify(films, null, 2))));

        // Get current file SHA (needed for update)
        let sha = null;
        try {
            const res = await fetch(`${API}/repos/${REPO}/contents/${PATH}`, {
                headers: { Authorization: `token ${token}` },
            });
            if (res.ok) {
                const data = await res.json();
                sha = data.sha;
            }
        } catch {
            // File doesn't exist yet, that's fine
        }

        const body = {
            message: 'FilmLog sync',
            content,
        };
        if (sha) body.sha = sha;

        const res = await fetch(`${API}/repos/${REPO}/contents/${PATH}`, {
            method: 'PUT',
            headers: {
                Authorization: `token ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(`GitHub sync mislukt (${res.status}): ${err.message || 'onbekend'}`);
        }
    } catch (err) {
        throw err;
    }
}

export async function initSync() {
    // Nothing needed at init for now
}
