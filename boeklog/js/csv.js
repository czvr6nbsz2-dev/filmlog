export function parseCSV(text) {
    // Strip BOM character if present
    text = text.replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) throw new Error('CSV is leeg of bevat geen data.');

    const header = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());

    const authorIdx = header.findIndex(h => h.includes('auteur') || h.includes('author') || h.includes('schrijver'));
    const titleIdx = header.findIndex(h => h.includes('titel') || h.includes('title') || h.includes('boek'));
    const dateIdx = header.findIndex(h => h.includes('datum') || h.includes('date') || h.includes('gelezen'));

    if (titleIdx === -1 && authorIdx === -1) {
        throw new Error('Kolom "titel" of "auteur" niet gevonden. Verwacht: auteur, titel, datum');
    }

    const entries = [];

    for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);

        const author = (authorIdx >= 0 && cols[authorIdx]) ? cols[authorIdx].trim() : null;
        const title = (titleIdx >= 0 && cols[titleIdx]) ? cols[titleIdx].trim() : null;

        if (!title && !author) continue;

        let readDate = new Date().toISOString().split('T')[0];
        if (dateIdx >= 0 && cols[dateIdx]) {
            const d = cols[dateIdx].trim();
            readDate = parseDate(d) || readDate;
        }

        entries.push({
            title: title || 'Onbekende titel',
            author: author || null,
            readDate,
        });
    }

    if (!entries.length) throw new Error('Geen geldige boekregels gevonden.');
    return entries;
}

function parseDate(str) {
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
