import { getAllFilms, saveFilm, deleteFilm, saveMany, getSetting, setSetting, exportAll, importAll } from './db.js';
import { searchFilms, fetchDetail, enrichFilm, hasApiKey } from './omdb.js';
import { generatePDF } from './pdf.js';
import { parseCSV } from './csv.js';

// ---- State ----
let films = [];
let currentFilm = {}; // film being added
let selectedDetail = null;
let selectedRating = null;

// ---- DOM refs ----
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Screens
const setupScreen = $('#setup-screen');
const mainScreen = $('#main-screen');
const addModal = $('#add-modal');
const detailModal = $('#detail-modal');
const settingsModal = $('#settings-modal');

// ---- Init ----
document.addEventListener('DOMContentLoaded', init);

async function init() {
    if (!hasApiKey() && !getSetting('skippedSetup')) {
        setupScreen.hidden = false;
        initSetup();
    } else {
        showMain();
    }
    initEventListeners();
}

// ---- Setup ----
function initSetup() {
    const input = $('#setup-api-key');
    const saveBtn = $('#setup-save');
    const skipBtn = $('#setup-skip');

    input.addEventListener('input', () => {
        saveBtn.disabled = !input.value.trim();
    });

    saveBtn.addEventListener('click', () => {
        setSetting('apiKey', input.value.trim());
        setupScreen.hidden = true;
        showMain();
    });

    skipBtn.addEventListener('click', () => {
        setSetting('skippedSetup', '1');
        setupScreen.hidden = true;
        showMain();
    });
}

// ---- Main Screen ----
async function showMain() {
    mainScreen.hidden = false;
    films = await getAllFilms();
    renderFilmList();
}

function renderFilmList() {
    const list = $('#film-list');
    const empty = $('#empty-state');

    // Remove existing rows and headers
    list.querySelectorAll('.film-row, .year-header').forEach(el => el.remove());

    if (!films.length) {
        empty.hidden = false;
        return;
    }
    empty.hidden = true;

    let currentYear = null;

    for (const film of films) {
        const year = new Date(film.watchDate).getFullYear();
        if (year !== currentYear) {
            currentYear = year;
            const header = document.createElement('div');
            header.className = 'year-header';
            header.textContent = year;
            list.appendChild(header);
        }

        const row = document.createElement('div');
        row.className = 'film-row';
        row.addEventListener('click', () => showDetail(film));

        const posterHTML = film.posterURL
            ? `<img class="film-poster" src="${esc(film.posterURL)}" alt="" loading="lazy">`
            : `<div class="film-poster-placeholder">🎬</div>`;

        const dateStr = formatDate(film.watchDate);
        const locIcon = film.location === 'bioscoop' ? '🎭' : '🏠';
        const locName = film.location === 'bioscoop' ? 'Bioscoop' : 'Thuis';

        let ratingsHTML = '';
        if (film.imdbRating && film.imdbID) {
            ratingsHTML += `<a href="https://www.imdb.com/title/${esc(film.imdbID)}" target="_blank" class="badge-imdb" style="text-decoration:none;cursor:pointer">★ ${esc(film.imdbRating)}</a>`;
        }
        if (film.myRating) ratingsHTML += `<span class="badge-my">♥ ${film.myRating}/10</span>`;

        row.innerHTML = `
            ${posterHTML}
            <div class="film-info">
                <h3>${esc(film.title)}</h3>
                <div class="film-meta">${dateStr} · ${locIcon} ${locName}</div>
                <div class="film-ratings">${ratingsHTML}</div>
            </div>
        `;
        list.appendChild(row);
    }
}

// ---- Add Film ----
function openAddModal() {
    currentFilm = { location: 'bioscoop', watchDate: today() };
    selectedDetail = null;
    selectedRating = null;

    // Reset form
    $('#film-title-input').value = '';
    $('#film-date-input').value = today();
    $('#review-input').value = '';
    $$('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.value === 'bioscoop'));
    $$('.rating-dot').forEach(b => b.classList.remove('active'));
    $('#btn-search').disabled = true;

    showStep('add-step-input');
    addModal.hidden = false;
}

function showStep(stepId) {
    $$('#add-modal .step').forEach(s => s.hidden = s.id !== stepId);
}

async function doSearch() {
    const query = $('#film-title-input').value.trim();
    if (!query) return;

    currentFilm.title = query;
    currentFilm.watchDate = $('#film-date-input').value || today();

    if (!hasApiKey()) {
        // Skip IMDb, go straight to review
        showStep('add-step-review');
        return;
    }

    showStep('add-step-loading');
    $('#loading-text').textContent = `'${query}' zoeken...`;

    try {
        const results = await searchFilms(query);
        if (results.length === 1) {
            await selectSearchResult(results[0].imdbID);
        } else if (results.length > 0) {
            renderSearchResults(results);
            showStep('add-step-results');
        } else {
            // No results found - show option to continue without IMDb
            const msg = `'${query}' niet gevonden op IMDb.\n\nJe kunt:\n• Opnieuw zoeken met andere woorden\n• Zonder IMDb-data doorgaan en de film handmatig invullen`;
            if (confirm(msg + '\n\nKlik OK om zonder IMDb door te gaan, of Cancel om opnieuw te zoeken.')) {
                showStep('add-step-review');
            } else {
                showStep('add-step-input');
            }
        }
    } catch (err) {
        // Search error - offer to continue without IMDb
        if (confirm(`Zoeken mislukt: ${err.message}\n\nWil je zonder IMDb-data doorgaan?`)) {
            showStep('add-step-review');
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
            selectSearchResult(r.imdbID);
        });

        const posterHTML = r.poster
            ? `<img class="search-poster" src="${esc(r.poster)}" alt="" loading="lazy">`
            : `<div class="film-poster-placeholder" style="width:40px;height:56px;font-size:1rem">🎬</div>`;

        el.innerHTML = `
            ${posterHTML}
            <div class="search-info">
                <h4>${esc(r.title)}</h4>
                <span>${esc(r.year)}</span>
            </div>
        `;
        container.appendChild(el);
    }
}

async function selectSearchResult(imdbID) {
    try {
        const detail = await fetchDetail(imdbID);
        selectedDetail = detail;
        currentFilm = enrichFilm(currentFilm, detail);
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

    if (detail.poster) {
        html += `<img class="poster-large" src="${esc(detail.poster)}" alt="">`;
    }

    html += `
        <div class="detail-row"><span class="detail-label">Titel</span><span class="detail-value">${esc(detail.title)}</span></div>
        <div class="detail-row"><span class="detail-label">Jaar</span><span class="detail-value">${esc(detail.year)}</span></div>
    `;
    if (detail.directors) html += `<div class="detail-row"><span class="detail-label">Regie</span><span class="detail-value">${esc(detail.directors)}</span></div>`;
    if (detail.actors) html += `<div class="detail-row"><span class="detail-label">Acteurs</span><span class="detail-value">${esc(detail.actors)}</span></div>`;
    if (detail.imdbRating) {
        const imdbLink = detail.imdbID
            ? `<a href="https://www.imdb.com/title/${esc(detail.imdbID)}" target="_blank" style="text-decoration:none;color:inherit;cursor:pointer">★ ${esc(detail.imdbRating)}</a>`
            : `★ ${esc(detail.imdbRating)}`;
        html += `<div class="detail-row"><span class="detail-label">IMDb</span><span class="detail-value">${imdbLink}</span></div>`;
    }
    if (detail.plot) html += `<div class="detail-plot">${esc(detail.plot)}</div>`;

    card.innerHTML = html;
}

async function doSave() {
    currentFilm.myReview = $('#review-input').value.trim() || null;
    currentFilm.myRating = selectedRating;

    showStep('add-step-loading');
    $('#loading-text').textContent = 'Opslaan...';

    try {
        const saved = await saveFilm(currentFilm);
        films.unshift(saved);
        films.sort((a, b) => new Date(b.watchDate) - new Date(a.watchDate));
        renderFilmList();
        addModal.hidden = true;
    } catch (err) {
        alert('Fout bij opslaan: ' + err.message);
        showStep('add-step-review');
    }
}

// ---- Detail ----
function showDetail(film) {
    const content = $('#detail-content');
    $('#detail-title').textContent = film.title;

    let html = '';

    if (film.posterURL) {
        html += `<img class="poster-large" src="${esc(film.posterURL)}" alt="" loading="lazy">`;
    }

    // Film info
    html += `<div class="detail-section"><h3>Filmgegevens</h3><div class="card">`;
    html += `<div class="detail-row"><span class="detail-label">Titel</span><span class="detail-value">${esc(film.title)}</span></div>`;
    if (film.year) html += `<div class="detail-row"><span class="detail-label">Jaar</span><span class="detail-value">${esc(film.year)}</span></div>`;
    if (film.directors) html += `<div class="detail-row"><span class="detail-label">Regie</span><span class="detail-value">${esc(film.directors)}</span></div>`;
    if (film.actors) html += `<div class="detail-row"><span class="detail-label">Acteurs</span><span class="detail-value">${esc(film.actors)}</span></div>`;
    if (film.imdbRating) {
        const imdbLink = film.imdbID
            ? `<a href="https://www.imdb.com/title/${esc(film.imdbID)}" target="_blank" style="text-decoration:none;color:inherit;cursor:pointer">★ ${esc(film.imdbRating)}</a>`
            : `★ ${esc(film.imdbRating)}`;
        html += `<div class="detail-row"><span class="detail-label">IMDb</span><span class="detail-value">${imdbLink}</span></div>`;
    }
    html += `</div></div>`;

    // Watch info
    const dateStr = formatDate(film.watchDate);
    const locIcon = film.location === 'bioscoop' ? '🎭' : '🏠';
    const locName = film.location === 'bioscoop' ? 'Bioscoop' : 'Thuis';
    html += `<div class="detail-section"><h3>Kijkdetails</h3><div class="card">`;
    html += `<div class="detail-row"><span class="detail-label">Datum</span><span class="detail-value">${dateStr}</span></div>`;
    html += `<div class="detail-row"><span class="detail-label">Locatie</span><span class="detail-value">${locIcon} ${locName}</span></div>`;
    html += `</div></div>`;

    // Plot
    if (film.plot) {
        html += `<div class="detail-section"><h3>Beschrijving</h3><div class="card"><p class="detail-plot">${esc(film.plot)}</p></div></div>`;
    }

    // Review
    html += `<div class="detail-section" id="review-section"><h3>Mijn oordeel</h3><div class="card" id="review-card">`;
    if (film.myRating) html += `<div class="detail-row"><span class="detail-label">Score</span><span class="detail-value" style="color:var(--pink);font-weight:600">♥ ${film.myRating}/10</span></div>`;
    if (film.myReview) html += `<p class="review-text">${esc(film.myReview)}</p>`;
    if (!film.myRating && !film.myReview) html += `<p style="color:var(--text-secondary);font-size:0.85rem">Nog geen oordeel.</p>`;
    html += `</div></div>`;

    // Delete
    html += `<button class="btn-danger" id="btn-delete-film" data-id="${film.id}">Film verwijderen</button>`;

    content.innerHTML = html;

    // Edit button state
    const editBtn = $('#btn-edit-review');
    editBtn.onclick = () => showEditReview(film);

    // Delete handler
    $('#btn-delete-film').addEventListener('click', async () => {
        if (!confirm(`'${film.title}' verwijderen?`)) return;
        await deleteFilm(film.id);
        films = films.filter(f => f.id !== film.id);
        renderFilmList();
        detailModal.hidden = true;
    });

    detailModal.hidden = false;
}

function showEditReview(film) {
    const card = $('#review-card');
    const editRating = film.myRating || null;

    let ratingHTML = '<div class="rating-picker edit-rating-picker">';
    for (let i = 1; i <= 10; i++) {
        ratingHTML += `<button class="rating-dot ${i === editRating ? 'active' : ''}" data-rating="${i}">${i}</button>`;
    }
    ratingHTML += '</div>';

    card.innerHTML = `
        <div class="edit-form">
            <textarea id="edit-review-text" rows="4">${esc(film.myReview || '')}</textarea>
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
        film.myReview = $('#edit-review-text').value.trim() || null;
        film.myRating = newRating;
        await saveFilm(film);
        const idx = films.findIndex(f => f.id === film.id);
        if (idx >= 0) films[idx] = film;
        renderFilmList();
        showDetail(film); // refresh detail view
    });
}

// ---- Settings ----
function openSettings() {
    $('#settings-api-key').value = getSetting('apiKey') || '';
    const csvSection = $('#csv-section');
    if (getSetting('importCompleted')) {
        csvSection.innerHTML = '<h3>CSV Import</h3><p style="color:var(--green)">✓ Import voltooid</p>';
    }
    $('#stats').textContent = `${films.length} films in je logboek`;
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
        const newFilms = [];

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            fill.style.width = `${((i + 1) / entries.length) * 100}%`;
            status.textContent = `${i + 1}/${entries.length}: ${entry.title}`;

            let film = {
                title: entry.title,
                watchDate: entry.watchDate,
                location: entry.location,
                myReview: [entry.description, entry.review].filter(Boolean).join(' — ') || null,
            };

            if (hasApiKey()) {
                try {
                    const results = await searchFilms(entry.title);
                    if (results.length > 0) {
                        const detail = await fetchDetail(results[0].imdbID);
                        film = { ...enrichFilm(film, detail), myReview: film.myReview };
                    }
                    // Respect rate limit
                    await sleep(350);
                } catch {
                    // Continue without IMDb data
                }
            }

            newFilms.push(film);
        }

        await saveMany(newFilms);
        setSetting('importCompleted', '1');
        films = await getAllFilms();
        renderFilmList();

        status.textContent = `✓ ${newFilms.length} films geïmporteerd!`;
        alert(`${newFilms.length} films succesvol geïmporteerd.`);
    } catch (err) {
        alert('Importfout: ' + err.message);
        progress.hidden = true;
    }
}

// ---- Event Listeners ----
function initEventListeners() {
    // Add film
    $('#btn-add').addEventListener('click', openAddModal);
    $('#btn-settings').addEventListener('click', openSettings);

    // Close modals
    $$('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => {
            const modalId = btn.dataset.close;
            $(`#${modalId}`).hidden = true;
        });
    });

    // Title input → enable search
    $('#film-title-input').addEventListener('input', (e) => {
        $('#btn-search').disabled = !e.target.value.trim();
    });

    // Enter key to search
    $('#film-title-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.value.trim()) doSearch();
    });

    // Segmented control
    $$('.seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.parentElement.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilm.location = btn.dataset.value;
        });
    });

    // Search button
    $('#btn-search').addEventListener('click', doSearch);
    $('#btn-skip-imdb').addEventListener('click', () => showStep('add-step-review'));
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

    // Settings: save key
    $('#btn-save-key').addEventListener('click', () => {
        const key = $('#settings-api-key').value.trim();
        setSetting('apiKey', key);
        alert(key ? 'API-sleutel opgeslagen.' : 'API-sleutel verwijderd.');
    });

    // Settings: PDF
    $('#btn-pdf').addEventListener('click', () => generatePDF(films));

    // Settings: CSV
    $('#btn-csv').addEventListener('click', () => $('#csv-file').click());
    $('#csv-file').addEventListener('change', (e) => {
        if (e.target.files[0]) handleCSVImport(e.target.files[0]);
    });

    // Settings: JSON export/import
    $('#btn-export-json').addEventListener('click', async () => {
        const json = await exportAll();
        download('filmlog-backup.json', json, 'application/json');
    });
    $('#btn-import-json').addEventListener('click', () => $('#json-file').click());
    $('#json-file').addEventListener('change', async (e) => {
        if (!e.target.files[0]) return;
        try {
            const text = await e.target.files[0].text();
            const count = await importAll(text);
            films = await getAllFilms();
            renderFilmList();
            alert(`${count} films geïmporteerd uit backup.`);
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

// Register service worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
}
