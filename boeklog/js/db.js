const DB_NAME = 'boeklog';
const DB_VERSION = 1;
const STORE = 'boeken';

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE)) {
                const store = db.createObjectStore(STORE, { keyPath: 'id' });
                store.createIndex('readDate', 'readDate', { unique: false });
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

export async function getAllBooks() {
    const store = await tx('readonly');
    const books = await reqToPromise(store.getAll());
    return books.filter(b => !b.deletedAt).sort((a, b) => new Date(b.readDate) - new Date(a.readDate));
}

export async function getAllBooksIncludingDeleted() {
    const store = await tx('readonly');
    return reqToPromise(store.getAll());
}

export async function saveBook(book) {
    if (!book.id) book.id = crypto.randomUUID();
    book.updatedAt = new Date().toISOString();
    const store = await tx('readwrite');
    await reqToPromise(store.put(book));
    return book;
}

export async function deleteBook(id) {
    const store = await tx('readwrite');
    await reqToPromise(store.delete(id));
}

export async function softDeleteBook(id) {
    const store = await tx('readwrite');
    const book = await reqToPromise(store.get(id));
    if (book) {
        book.deletedAt = new Date().toISOString();
        book.updatedAt = new Date().toISOString();
        await reqToPromise(store.put(book));
    }
}

export async function replaceAll(books) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, 'readwrite');
        const store = transaction.objectStore(STORE);
        store.clear();
        for (const book of books) {
            store.put(book);
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

export async function saveMany(books) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, 'readwrite');
        const store = transaction.objectStore(STORE);
        for (const book of books) {
            if (!book.id) book.id = crypto.randomUUID();
            book.updatedAt = new Date().toISOString();
            store.put(book);
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

export async function exportAll() {
    const books = await getAllBooks();
    return JSON.stringify(books, null, 2);
}

export async function importAll(json) {
    const books = JSON.parse(json);
    await saveMany(books);
    return books.length;
}

export function getSetting(key) {
    return localStorage.getItem('boeklog_' + key);
}

export function setSetting(key, value) {
    localStorage.setItem('boeklog_' + key, value);
}
