export function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) throw new Error('CSV is leeg of bevat geen data.');

    const header = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());

    const titleIdx = header.findIndex(h => h.includes('titel') || h.includes('title') || h.includes('film'));
    const dateIdx = header.findIndex(h => h.includes('datum') || h.includes('date'));
    const locIdx = header.findIndex(h => h.includes('locatie') || h.includes('location') || h.includes('bioscoop') || h.includes('waar'));
    const descIdx = header.findIndex(h => h.includes('toelichting') || h.includes('beschrijving') || h.includes('description'));
    const reviewIdx = header.findIndex(h => h.includes('oordeel') || h.includes('review') || h.includes('beoordeling'));

    if (titleIdx === -1) {
        throw new Error('Kolom "filmtitel" niet gevonden. Verwacht: filmtitel, kijkdatum, locatie');
    }

    const entries = [];
    const dateFormats = [
        /^(\d{2})-(\d{2})-(\d{4})$/, // dd-MM-yyyy
        /^(\d{4})-(\d{2})-(\d{2})$/, // yyyy-MM-dd
        /^(\d{2})\/(\d{2})\/(\d{4})$/, // dd/MM/yyyy
    ];

    for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        if (cols.length <= titleIdx) continue;

        const title = cols[titleIdx]?.trim();
        if (!title) continue;

        let watchDate = new Date().toISOString().split('T')[0];
        if (dateIdx >= 0 && cols[dateIdx]) {
            const d = cols[dateIdx].trim();
            watchDate = parseDate(d, dateFormats) || watchDate;
        }

        let location = 'thuis';
        if (locIdx >= 0 && cols[locIdx]) {
            const loc = cols[locIdx].toLowerCase().trim();
            if (loc.includes('bioscoop') || loc.includes('cinema') || loc.includes('theater')) {
                location = 'bioscoop';
            }
        }

        let description = null;
        if (descIdx >= 0 && cols[descIdx]) {
            description = cols[descIdx].trim() || null;
        }

        let review = null;
        if (reviewIdx >= 0 && cols[reviewIdx]) {
            review = cols[reviewIdx].trim() || null;
        }

        entries.push({ title, watchDate, location, description, review });
    }

    if (!entries.length) throw new Error('Geen geldige filmregels gevonden.');
    return entries;
}

function parseDate(str, formats) {
    // dd-MM-yyyy
    let m = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;

    // yyyy-MM-dd
    m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;

    // dd/MM/yyyy
    m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;

    return null;
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (const ch of line) {
        if (ch === '"') {
            inQuotes = !inQuotes;
        } else if ((ch === ',' || ch === ';') && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    result.push(current);
    return result;
}
