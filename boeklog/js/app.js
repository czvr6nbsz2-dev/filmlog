import { getAllBooks, getAllBooksIncludingDeleted, saveBook, deleteBook, softDeleteBook, saveMany, getSetting, setSetting, exportAll, importAll, replaceAll } from './db.js';
import { searchBooks, getFullBookDetail, enrichBook } from './openlibrary.js';
import { isSyncEnabled, syncAll } from './github.js';
import { generatePDF } from './pdf.js';
import { parseCSV } from './csv.js';

// ---- State ----
let books = [];
let currentBook = {};
let selectedDetail = null;
let selectedRating = null;
let searchQuery = '';

// ---- DOM refs ----
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const mainScreen = $('#main-screen');
const addModal = $('#add-modal');
const detailModal = $('#detail-modal');
const settingsModal = $('#settings-modal');

const searchInput = $('#search-input');
const searchClear = $('#search-clear');

// ---- Init ----
document.addEventListener('DOMContentLoaded', init);

async function init() {
    showMain();
    initEventListeners();
    if (isSyncEnabled()) {
        triggerSync();
    }
    window.addEventListener('online', () => {
        if (isSyncEnabled()) triggerSync();
    });
}

// ---- Sync ----
let syncing = false;

function showSyncIndicator(state) {
    const el = $('#sync-indicator');
    if (!el) return;
    el.hidden = state === 'idle';
    el.className = 'sync-indicator ' + state;
}

async function triggerSync() {
    if (syncing) return;
    syncing = true;
    showSyncIndicator('syncing');
    try {
        const localBooks = await getAllBooksIncludingDeleted();
        const result = await syncAll(localBooks);
        await replaceAll(result.books);
        books = result.books.filter(b => !b.deletedAt).sort((a, b) => new Date(b.readDate) - new Date(a.readDate));
        renderBookList();
        showSyncIndicator('synced');
        setTimeout(() => showSyncIndicator('idle'), 3000);
    } catch {
        showSyncIndicator('error');
        setTimeout(() => showSyncIndicator('idle'), 5000);
    } finally {
        syncing = false;
    }
}

// ---- Main Screen ----
async function showMain() {
    mainScreen.hidden = false;
    books = await getAllBooks();
    renderBookList();
}

function filterBooks(books, query) {
    if (!query || !query.trim()) {
        return books;
    }

    const searchTerm = query.trim().toLowerCase();

    return books.filter(book => {
        const titleMatch = book.title && book.title.toLowerCase().includes(searchTerm);
        const authorMatch = book.author && book.author.toLowerCase().includes(searchTerm);
        return titleMatch || authorMatch;
    });
}

function renderBookList() {
    const list = $('#book-list');
    list.querySelectorAll('.book-row, .year-header, .no-results').forEach(el => el.remove());

    // Filter books based on search query
    const filteredBooks = filterBooks(books, searchQuery);

    // If search active but no results, show no-results message
    if (searchQuery.trim() && !filteredBooks.length) {
        const noResults = document.createElement('div');
        noResults.className = 'no-results';
        noResults.innerHTML = `
            <div class="no-results-icon">🔍</div>
            <p>Geen boeken gevonden<br>voor "${esc(searchQuery)}"</p>
        `;
        list.appendChild(noResults);
        return;
    }

    let currentYear = null;

    for (const book of filteredBooks) {
        const year = new Date(book.readDate).getFullYear();
        if (year !== currentYear) {
            currentYear = year;
            const header = document.createElement('div');
            header.className = 'year-header';
            header.textContent = year;
            list.appendChild(header);
        }

        const row = document.createElement('div');
        row.className = 'book-row';
        row.addEventListener('click', () => showDetail(book));

        const coverHTML = book.coverURL
            ? `<img class="book-cover" src="${esc(book.coverURL)}" alt="" loading="lazy">`
            : `<div class="book-cover-placeholder">📖</div>`;

        const dateStr = formatDate(book.readDate);
        const authorStr = book.author ? ` · ${esc(book.author)}` : '';

        let ratingsHTML = '';
        if (book.publishYear) ratingsHTML += `<span class="badge-year">${esc(book.publishYear)}</span>`;
        if (book.myRating) ratingsHTML += `<span class="badge-my">&#x2665; ${book.myRating}/10</span>`;

        row.innerHTML = `
            ${coverHTML}
            <div class="book-info">
                <h3>${esc(book.title)}</h3>
                <div class="book-meta">${dateStr}${authorStr}</div>
                <div class="book-ratings">${ratingsHTML}</div>
            </div>
        `;
        list.appendChild(row);
    }
}

// ---- Add Book ----
function openAddModal() {
    currentBook = { readDate: today() };
    selectedDetail = null;
    selectedRating = null;

    $('#book-title-input').value = '';
    $('#book-author-input').value = '';
    $('#book-date-input').value = today();
    $('#review-input').value = '';
    $$('.rating-dot').forEach(b => b.classList.remove('active'));
    $('#btn-search').disabled = true;

    showStep('add-step-input');
    addModal.hidden = false;
}

function showStep(stepId) {
    $$('#add-modal .step').forEach(s => s.hidden = s.id !== stepId);
}

async function doSearch() {
    const title = $('#book-title-input').value.trim();
    const author = $('#book-author-input').value.trim();
    if (!title && !author) return;

    currentBook.title = title || 'Onbekende titel';
    currentBook.author = author || null;
    currentBook.readDate = $('#book-date-input').value || today();

    showStep('add-step-loading');
    $('#loading-text').textContent = `'${title || author}' zoeken...`;

    try {
        const results = await searchBooks(title, author);
        if (results.length === 1) {
            await selectSearchResult(results[0]);
        } else if (results.length > 0) {
            renderSearchResults(results);
            showStep('add-step-results');
        } else {
            // No results found - show option to continue without OpenLibrary
            const msg = `'${title || author}' niet gevonden.\n\nJe kunt:\n• Opnieuw zoeken met andere woorden\n• Zonder zoekopdracht doorgaan en handmatig invullen`;
            if (confirm(msg + '\n\nKlik OK om handmatig door te gaan, of Cancel om opnieuw te zoeken.')) {
                renderConfirmation(currentBook);
                showStep('add-step-confirm');
            } else {
                showStep('add-step-input');
            }
        }
    } catch (err) {
        // Search error - offer to continue without OpenLibrary
        if (confirm(`Zoeken mislukt: ${err.message}\n\nWil je handmatig doorgaan?`)) {
            renderConfirmation(currentBook);
            showStep('add-step-confirm');
        } else {
            showStep('add-step-input');
        }
    }
}

function renderSearchResults(results) {
    const container = $('#search-results');
    container.innerHTML = '';

    for (const r of results) {
        const el = document.createElement('div');
        el.className = 'search-result';
        el.addEventListener('click', () => {
            showStep('add-step-loading');
            $('#loading-text').textContent = 'Gegevens ophalen...';
            selectSearchResult(r);
        });

        const coverHTML = r.coverURL
            ? `<img class="search-cover" src="${esc(r.coverURL)}" alt="" loading="lazy">`
            : `<div class="book-cover-placeholder" style="width:40px;height:56px;font-size:1rem">📖</div>`;

        el.innerHTML = `
            ${coverHTML}
            <div class="search-info">
                <h4>${esc(r.title)}</h4>
                <span>${esc(r.author)}${r.year ? ' (' + esc(r.year) + ')' : ''}</span>
            </div>
        `;
        container.appendChild(el);
    }
}

async function selectSearchResult(result) {
    try {
        const detail = await getFullBookDetail(result);
        selectedDetail = detail;
        currentBook = enrichBook(currentBook, detail);
        // Keep user-entered author if Open Library didn't have one
        if (!currentBook.author && result.author) {
            currentBook.author = result.author;
        }
        renderConfirmation(detail);
        showStep('add-step-confirm');
    } catch (err) {
        alert(err.message);
        showStep('add-step-input');
    }
}

function renderConfirmation(detail) {
    const card = $('#confirm-card');
    let html = '';

    if (detail.coverURL) {
        html += `<img class="cover-large" src="${esc(detail.coverURL)}" alt="">`;
    }

    html += `<div class="detail-row"><span class="detail-label">Titel</span><span class="detail-value">${esc(detail.title)}</span></div>`;
    if (detail.author) html += `<div class="detail-row"><span class="detail-label">Auteur</span><span class="detail-value">${esc(detail.author)}</span></div>`;
    if (detail.year) html += `<div class="detail-row"><span class="detail-label">Jaar</span><span class="detail-value">${esc(detail.year)}</span></div>`;
    if (detail.pages) html += `<div class="detail-row"><span class="detail-label">Pagina's</span><span class="detail-value">${detail.pages}</span></div>`;
    if (detail.subjects) html += `<div class="detail-row"><span class="detail-label">Onderwerpen</span><span class="detail-value">${esc(detail.subjects)}</span></div>`;
    if (detail.description) {
        const desc = detail.description.length > 500
            ? detail.description.substring(0, 500) + '...'
            : detail.description;
        html += `<div class="detail-description">${esc(desc)}</div>`;
    }

    card.innerHTML = html;
}

async function doSave() {
    currentBook.myReview = $('#review-input').value.trim() || null;
    currentBook.myRating = selectedRating;

    showStep('add-step-loading');
    $('#loading-text').textContent = 'Opslaan...';

    try {
        const saved = await saveBook(currentBook);
        books.unshift(saved);
        books.sort((a, b) => new Date(b.readDate) - new Date(a.readDate));
        renderBookList();
        addModal.hidden = true;
        if (isSyncEnabled()) triggerSync();
    } catch (err) {
        alert('Fout bij opslaan: ' + err.message);
        showStep('add-step-review');
    }
}

// ---- Detail ----
function showDetail(book) {
    const content = $('#detail-content');
    $('#detail-title').textContent = book.title;

    let html = '';

    if (book.coverURL) {
        html += `<img class="cover-large" src="${esc(book.coverURL)}" alt="" loading="lazy">`;
    }

    // Book info
    html += `<div class="detail-section"><h3>Boekgegevens</h3><div class="card">`;
    html += `<div class="detail-row"><span class="detail-label">Titel</span><span class="detail-value">${esc(book.title)}</span></div>`;
    if (book.author) html += `<div class="detail-row"><span class="detail-label">Auteur</span><span class="detail-value">${esc(book.author)}</span></div>`;
    if (book.publishYear) html += `<div class="detail-row"><span class="detail-label">Jaar</span><span class="detail-value">${esc(book.publishYear)}</span></div>`;
    if (book.numberOfPages) html += `<div class="detail-row"><span class="detail-label">Pagina's</span><span class="detail-value">${book.numberOfPages}</span></div>`;
    if (book.subjects) html += `<div class="detail-row"><span class="detail-label">Onderwerpen</span><span class="detail-value">${esc(book.subjects)}</span></div>`;
    html += `</div></div>`;

    // Read info
    const dateStr = formatDate(book.readDate);
    html += `<div class="detail-section"><h3>Leesdetails</h3><div class="card">`;
    html += `<div class="detail-row"><span class="detail-label">Uitgelezen</span><span class="detail-value">${dateStr}</span></div>`;
    html += `</div></div>`;

    // Description
    if (book.description) {
        html += `<div class="detail-section"><h3>Samenvatting</h3><div class="card"><p class="detail-description">${esc(book.description)}</p></div></div>`;
    }

    // Review
    html += `<div class="detail-section" id="review-section"><h3>Mijn oordeel</h3><div class="card" id="review-card">`;
    if (book.myRating) html += `<div class="detail-row"><span class="detail-label">Score</span><span class="detail-value" style="color:var(--pink);font-weight:600">&#x2665; ${book.myRating}/10</span></div>`;
    if (book.myReview) html += `<p class="review-text">${esc(book.myReview)}</p>`;
    if (!book.myRating && !book.myReview) html += `<p style="color:var(--text-secondary);font-size:0.85rem">Nog geen oordeel.</p>`;
    html += `</div></div>`;

    // Delete
    html += `<button class="btn-danger" id="btn-delete-book" data-id="${book.id}">Boek verwijderen</button>`;

    content.innerHTML = html;

    const editBtn = $('#btn-edit-review');
    editBtn.onclick = () => showEditReview(book);

    $('#btn-delete-book').addEventListener('click', async () => {
        if (!confirm(`'${book.title}' verwijderen?`)) return;
        if (isSyncEnabled()) {
            await softDeleteBook(book.id);
        } else {
            await deleteBook(book.id);
        }
        books = books.filter(b => b.id !== book.id);
        renderBookList();
        detailModal.hidden = true;
        if (isSyncEnabled()) triggerSync();
    });

    detailModal.hidden = false;
}

function showEditReview(book) {
    const card = $('#review-card');
    const editRating = book.myRating || null;

    let ratingHTML = '<div class="rating-picker edit-rating-picker">';
    for (let i = 1; i <= 10; i++) {
        ratingHTML += `<button class="rating-dot ${i === editRating ? 'active' : ''}" data-rating="${i}">${i}</button>`;
    }
    ratingHTML += '</div>';

    card.innerHTML = `
        <div class="edit-form">
            <textarea id="edit-review-text" rows="4">${esc(book.myReview || '')}</textarea>
            <label style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:6px;display:block">Score</label>
            ${ratingHTML}
            <div class="edit-actions">
                <button class="btn-primary" id="btn-save-edit">Opslaan</button>
            </div>
        </div>
    `;

    let newRating = editRating;

    card.querySelectorAll('.edit-rating-picker .rating-dot').forEach(btn => {
        btn.addEventListener('click', () => {
            const val = parseInt(btn.dataset.rating);
            newRating = newRating === val ? null : val;
            card.querySelectorAll('.edit-rating-picker .rating-dot').forEach(b =>
                b.classList.toggle('active', parseInt(b.dataset.rating) === newRating)
            );
        });
    });

    $('#btn-save-edit').addEventListener('click', async () => {
        book.myReview = $('#edit-review-text').value.trim() || null;
        book.myRating = newRating;
        await saveBook(book);
        const idx = books.findIndex(b => b.id === book.id);
        if (idx >= 0) books[idx] = book;
        renderBookList();
        showDetail(book);
        if (isSyncEnabled()) triggerSync();
    });
}

// ---- Settings ----
function openSettings() {
    const csvSection = $('#csv-section');
    if (getSetting('importCompleted')) {
        csvSection.innerHTML = '<h3>CSV Import</h3><p style="color:var(--green)">\u2713 Import voltooid</p>';
    }
    // GitHub sync settings
    $('#github-token').value = getSetting('github_token') || '';
    $('#github-repo').value = getSetting('github_repo') || 'czvr6nbsz2-dev/filmlog';
    $('#github-path').value = getSetting('github_path') || 'boeklog/data/boeken.json';
    const ghStatus = $('#github-status');
    ghStatus.textContent = isSyncEnabled() ? '\u2713 Sync is actief' : '';
    ghStatus.className = isSyncEnabled() ? 'hint success' : 'hint';

    $('#stats').textContent = `${books.length} boeken in je logboek`;
    settingsModal.hidden = false;
}

// ---- CSV Import ----
async function handleCSVImport(file) {
    const progress = $('#import-progress');
    const fill = $('#progress-fill');
    const status = $('#import-status');

    try {
        const text = await file.text();
        const entries = parseCSV(text);

        progress.hidden = false;
        const newBooks = [];

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            fill.style.width = `${((i + 1) / entries.length) * 100}%`;
            status.textContent = `${i + 1}/${entries.length}: ${entry.title}`;

            let book = {
                title: entry.title,
                author: entry.author,
                readDate: entry.readDate,
            };

            try {
                const results = await searchBooks(entry.title, entry.author);
                if (results.length > 0) {
                    const detail = await getFullBookDetail(results[0]);
                    book = enrichBook(book, detail);
                    // Keep CSV author if it was provided
                    if (entry.author) book.author = entry.author;
                }
                // Rate limit: Open Library asks for max 1 req/sec
                await sleep(600);
            } catch {
                // Continue without enrichment
            }

            newBooks.push(book);
        }

        await saveMany(newBooks);
        setSetting('importCompleted', '1');
        books = await getAllBooks();
        renderBookList();

        status.textContent = `\u2713 ${newBooks.length} boeken ge\u00EFmporteerd!`;
        alert(`${newBooks.length} boeken succesvol ge\u00EFmporteerd.`);
        if (isSyncEnabled()) triggerSync();
    } catch (err) {
        alert('Importfout: ' + err.message);
        progress.hidden = true;
    }
}

// ---- Event Listeners ----
function initEventListeners() {
    $('#btn-add').addEventListener('click', openAddModal);
    $('#btn-settings').addEventListener('click', openSettings);

    // Close modals
    $$('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => {
            const modalId = btn.dataset.close;
            $(`#${modalId}`).hidden = true;
        });
    });

    // Search functionality
    const debouncedSearch = debounce(() => {
        searchQuery = searchInput.value;
        renderBookList();
    }, 300);

    searchInput.addEventListener('input', (e) => {
        const hasValue = e.target.value.trim().length > 0;
        searchClear.hidden = !hasValue;
        debouncedSearch();
    });

    // Clear search button
    searchClear.addEventListener('click', () => {
        searchInput.value = '';
        searchQuery = '';
        searchClear.hidden = true;
        renderBookList();
    });

    // Enter key on mobile triggers search immediately (bypasses debounce)
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            searchQuery = searchInput.value;
            renderBookList();
        }
    });

    // Title/author input -> enable search
    const titleInput = $('#book-title-input');
    const authorInput = $('#book-author-input');
    const searchBtn = $('#btn-search');

    function updateSearchBtn() {
        searchBtn.disabled = !titleInput.value.trim() && !authorInput.value.trim();
    }
    titleInput.addEventListener('input', updateSearchBtn);
    authorInput.addEventListener('input', updateSearchBtn);

    // Enter to search
    titleInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !searchBtn.disabled) doSearch();
    });
    authorInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !searchBtn.disabled) doSearch();
    });

    // Search & save
    searchBtn.addEventListener('click', doSearch);
    $('#btn-skip-search').addEventListener('click', () => showStep('add-step-review'));
    $('#btn-add-without-search').addEventListener('click', () => {
        const title = $('#book-title-input').value.trim();
        const author = $('#book-author-input').value.trim();
        if (!title && !author) return;

        currentBook.title = title || 'Onbekende titel';
        currentBook.author = author || null;
        currentBook.readDate = $('#book-date-input').value || today();

        renderConfirmation(currentBook);
        showStep('add-step-confirm');
    });
    $('#btn-confirm').addEventListener('click', () => showStep('add-step-review'));
    $('#btn-save').addEventListener('click', doSave);

    // Rating picker
    $$('#rating-picker .rating-dot').forEach(btn => {
        btn.addEventListener('click', () => {
            const val = parseInt(btn.dataset.rating);
            selectedRating = selectedRating === val ? null : val;
            $$('#rating-picker .rating-dot').forEach(b =>
                b.classList.toggle('active', parseInt(b.dataset.rating) === selectedRating)
            );
        });
    });

    // Settings: PDF
    $('#btn-pdf').addEventListener('click', () => generatePDF(books));

    // Settings: CSV
    $('#btn-csv').addEventListener('click', () => $('#csv-file').click());
    $('#csv-file').addEventListener('change', (e) => {
        if (e.target.files[0]) handleCSVImport(e.target.files[0]);
    });

    // Settings: GitHub sync
    $('#btn-github-save').addEventListener('click', () => {
        const token = $('#github-token').value.trim();
        const repo = $('#github-repo').value.trim();
        const path = $('#github-path').value.trim();
        setSetting('github_token', token);
        if (repo) setSetting('github_repo', repo);
        if (path) setSetting('github_path', path);
        const ghStatus = $('#github-status');
        ghStatus.textContent = token ? '\u2713 Instellingen opgeslagen' : 'Token verwijderd';
        ghStatus.className = token ? 'hint success' : 'hint';
    });
    $('#btn-github-sync').addEventListener('click', async () => {
        const ghStatus = $('#github-status');
        if (!isSyncEnabled()) {
            ghStatus.textContent = 'Sla eerst een token op.';
            ghStatus.className = 'hint error';
            return;
        }
        ghStatus.textContent = 'Synchroniseren...';
        ghStatus.className = 'hint';
        try {
            await triggerSync();
            ghStatus.textContent = `\u2713 Gesynchroniseerd (${books.length} boeken)`;
            ghStatus.className = 'hint success';
        } catch (err) {
            ghStatus.textContent = 'Fout: ' + err.message;
            ghStatus.className = 'hint error';
        }
    });

    // Settings: JSON export/import
    $('#btn-export-json').addEventListener('click', async () => {
        const json = await exportAll();
        download('boeklog-backup.json', json, 'application/json');
    });
    $('#btn-import-json').addEventListener('click', () => $('#json-file').click());
    $('#json-file').addEventListener('change', async (e) => {
        if (!e.target.files[0]) return;
        try {
            const text = await e.target.files[0].text();
            const count = await importAll(text);
            books = await getAllBooks();
            renderBookList();
            alert(`${count} boeken geimporteerd uit backup.`);
        } catch (err) {
            alert('Fout bij importeren: ' + err.message);
        }
    });
}

// ---- Helpers ----
function today() {
    return new Date().toISOString().split('T')[0];
}

function formatDate(dateStr) {
    try {
        return new Date(dateStr).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch {
        return dateStr;
    }
}

function debounce(func, delay) {
    let timeoutId;
    return function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
}

function esc(str) {
    if (!str) return '';
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// Register service worker with cache busting
if ('serviceWorker' in navigator) {
    // Unregister old service workers first
    navigator.serviceWorker.getRegistrations().then(registrations => {
        for (const registration of registrations) {
            registration.unregister();
        }
    });
    // Register fresh service worker
    navigator.serviceWorker.register('sw.js?v=4').catch(() => {});
}
