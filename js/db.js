const DB_NAME = 'filmlog';
const DB_VERSION = 1;
const STORE = 'films';

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE)) {
                const store = db.createObjectStore(STORE, { keyPath: 'id' });
                store.createIndex('watchDate', 'watchDate', { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function tx(mode) {
    return openDB().then(db => {
        const transaction = db.transaction(STORE, mode);
        return transaction.objectStore(STORE);
    });
}

function reqToPromise(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function getAllFilms() {
    const store = await tx('readonly');
    const films = await reqToPromise(store.getAll());
    return films.sort((a, b) => new Date(b.watchDate) - new Date(a.watchDate));
}

export async function saveFilm(film) {
    if (!film.id) film.id = crypto.randomUUID();
    film.updatedAt = new Date().toISOString();
    const store = await tx('readwrite');
    await reqToPromise(store.put(film));
    return film;
}

export async function deleteFilm(id) {
    const store = await tx('readwrite');
    await reqToPromise(store.delete(id));
}

export async function getFilm(id) {
    const store = await tx('readonly');
    return reqToPromise(store.get(id));
}

export async function saveMany(films) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, 'readwrite');
        const store = transaction.objectStore(STORE);
        for (const film of films) {
            if (!film.id) film.id = crypto.randomUUID();
            film.updatedAt = new Date().toISOString();
            store.put(film);
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

export async function exportAll() {
    const films = await getAllFilms();
    return JSON.stringify(films, null, 2);
}

export async function importAll(json) {
    const films = JSON.parse(json);
    await saveMany(films);
    return films.length;
}

// Settings stored in localStorage
export function getSetting(key) {
    return localStorage.getItem('filmlog_' + key);
}

export function setSetting(key, value) {
    localStorage.setItem('filmlog_' + key, value);
}
