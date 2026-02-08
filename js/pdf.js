export function generatePDF(films) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = 210;
    const margin = 20;
    const contentWidth = pageWidth - 2 * margin;
    const pageHeight = 297;
    const maxY = pageHeight - margin;

    const sorted = [...films].sort((a, b) => new Date(a.watchDate) - new Date(b.watchDate));

    let y = margin;

    // Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text('Mijn Filmlogboek', margin, y);
    y += 8;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(130);
    const now = new Date().toLocaleDateString('nl-NL', { dateStyle: 'long' });
    doc.text(`Gegenereerd op ${now}`, margin, y);
    y += 6;

    // Line
    doc.setDrawColor(200);
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;

    doc.setTextColor(30);

    for (let i = 0; i < sorted.length; i++) {
        const film = sorted[i];

        // Estimate space needed
        if (y > maxY - 50) {
            doc.addPage();
            y = margin;
        }

        // Film number + title
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text(`${i + 1}. ${film.title}`, margin, y);
        y += 5;

        // Date + location
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(100);
        const dateStr = new Date(film.watchDate).toLocaleDateString('nl-NL', { dateStyle: 'long' });
        const locStr = film.location === 'bioscoop' ? 'Bioscoop' : 'Thuis';
        doc.text(`${dateStr} — ${locStr}`, margin, y);
        y += 5;

        // Year + IMDb
        doc.setTextColor(60);
        let info = '';
        if (film.year) info += `Jaar: ${film.year}`;
        if (film.imdbRating) {
            if (info) info += '  |  ';
            info += `IMDb: ${film.imdbRating}`;
        }
        if (info) {
            doc.text(info, margin, y);
            y += 5;
        }

        // Directors
        if (film.directors) {
            doc.text(`Regie: ${film.directors}`, margin, y);
            y += 5;
        }

        // Actors
        if (film.actors) {
            const lines = doc.splitTextToSize(`Acteurs: ${film.actors}`, contentWidth);
            doc.text(lines, margin, y);
            y += lines.length * 4;
        }

        // Plot
        if (film.plot) {
            doc.setFont('helvetica', 'italic');
            doc.setFontSize(8.5);
            doc.setTextColor(100);
            const lines = doc.splitTextToSize(film.plot, contentWidth);
            if (y + lines.length * 3.5 > maxY) {
                doc.addPage();
                y = margin;
            }
            doc.text(lines, margin, y);
            y += lines.length * 3.5 + 2;
        }

        // My rating
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(30);
        if (film.myRating) {
            doc.text(`Mijn score: ${film.myRating}/10`, margin, y);
            y += 5;
        }

        // My review
        if (film.myReview) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.setTextColor(60);
            const lines = doc.splitTextToSize(`Mijn oordeel: ${film.myReview}`, contentWidth);
            if (y + lines.length * 4 > maxY) {
                doc.addPage();
                y = margin;
            }
            doc.text(lines, margin, y);
            y += lines.length * 4;
        }

        y += 4;
        doc.setDrawColor(220);
        doc.line(margin, y, pageWidth - margin, y);
        y += 8;
    }

    // Footer
    if (y + 10 > maxY) {
        doc.addPage();
        y = margin;
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Totaal: ${sorted.length} films`, margin, y);

    doc.save('FilmLog.pdf');
}
