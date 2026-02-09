import { getSetting, setSetting } from './db.js';

const API_BASE = 'https://api.github.com';

function getConfig() {
    return {
        token: getSetting('github_token'),
        repo: getSetting('github_repo') || 'czvr6nbsz2-dev/filmlog',
        path: getSetting('github_path') || 'boeklog/data/boeken.json',
    };
}

export function isSyncEnabled() {
    return !!getConfig().token;
}

// UTF-8 safe base64
function toBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
}

function fromBase64(b64) {
    return decodeURIComponent(escape(atob(b64)));
}

export async function fetchFromGitHub() {
    const { token, repo, path } = getConfig();
    if (!token) throw new Error('GitHub token niet ingesteld.');

    const res = await fetch(`${API_BASE}/repos/${repo}/contents/${path}`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.v3+json',
        },
    });

    if (res.status === 404) {
        return { books: [], sha: null };
    }

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `GitHub fout (${res.status})`);
    }

    const data = await res.json();
    const content = fromBase64(data.content.replace(/\n/g, ''));
    const books = JSON.parse(content);
    setSetting('github_sha', data.sha);

    return { books, sha: data.sha };
}

export async function pushToGitHub(books, sha, message) {
    const { token, repo, path } = getConfig();
    if (!token) throw new Error('GitHub token niet ingesteld.');

    const content = toBase64(JSON.stringify(books, null, 2));

    const body = {
        message: message || 'BoekLog sync',
        content,
    };
    if (sha) body.sha = sha;

    const res = await fetch(`${API_BASE}/repos/${repo}/contents/${path}`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (res.status === 409) {
        // SHA mismatch - re-fetch and retry once
        const fresh = await fetchFromGitHub();
        const merged = mergeBooks(books, fresh.books);
        return pushToGitHub(merged, fresh.sha, message);
    }

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `GitHub push fout (${res.status})`);
    }

    const data = await res.json();
    const newSha = data.content.sha;
    setSetting('github_sha', newSha);
    return newSha;
}

function mergeBooks(localBooks, remoteBooks) {
    const merged = new Map();

    for (const book of remoteBooks) {
        merged.set(book.id, book);
    }

    for (const book of localBooks) {
        const existing = merged.get(book.id);
        if (!existing) {
            merged.set(book.id, book);
        } else {
            const localTime = new Date(book.updatedAt || 0).getTime();
            const remoteTime = new Date(existing.updatedAt || 0).getTime();
            if (localTime >= remoteTime) {
                merged.set(book.id, book);
            }
        }
    }

    // Garbage-collect soft-deletes older than 30 days
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const result = [];
    for (const book of merged.values()) {
        if (book.deletedAt && new Date(book.deletedAt).getTime() < cutoff) {
            continue;
        }
        result.push(book);
    }

    return result;
}

export async function syncAll(localBooks) {
    const remote = await fetchFromGitHub();
    const merged = mergeBooks(localBooks, remote.books);
    const sha = await pushToGitHub(merged, remote.sha, 'BoekLog sync');
    return { books: merged, sha };
}
