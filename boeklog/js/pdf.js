export function generatePDF(books) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = 210;
    const margin = 20;
    const contentWidth = pageWidth - 2 * margin;
    const pageHeight = 297;
    const maxY = pageHeight - margin;

    const sorted = [...books].sort((a, b) => new Date(a.readDate) - new Date(b.readDate));

    let y = margin;

    // Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text('Mijn Boekenlogboek', margin, y);
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
        const book = sorted[i];

        if (y > maxY - 50) {
            doc.addPage();
            y = margin;
        }

        // Book number + title
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text(`${i + 1}. ${book.title}`, margin, y);
        y += 5;

        // Author
        if (book.author) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.setTextColor(60);
            doc.text(`door ${book.author}`, margin, y);
            y += 5;
        }

        // Date
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(100);
        const dateStr = new Date(book.readDate).toLocaleDateString('nl-NL', { dateStyle: 'long' });
        doc.text(`Gelezen: ${dateStr}`, margin, y);
        y += 5;

        // Year + pages
        doc.setTextColor(60);
        let info = '';
        if (book.publishYear) info += `Jaar: ${book.publishYear}`;
        if (book.numberOfPages) {
            if (info) info += '  |  ';
            info += `${book.numberOfPages} pagina's`;
        }
        if (info) {
            doc.text(info, margin, y);
            y += 5;
        }

        // Subjects
        if (book.subjects) {
            const lines = doc.splitTextToSize(`Onderwerpen: ${book.subjects}`, contentWidth);
            doc.text(lines, margin, y);
            y += lines.length * 4;
        }

        // Description
        if (book.description) {
            doc.setFont('helvetica', 'italic');
            doc.setFontSize(8.5);
            doc.setTextColor(100);
            const desc = book.description.length > 300
                ? book.description.substring(0, 300) + '...'
                : book.description;
            const lines = doc.splitTextToSize(desc, contentWidth);
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
        if (book.myRating) {
            doc.text(`Mijn score: ${book.myRating}/10`, margin, y);
            y += 5;
        }

        // My review
        if (book.myReview) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.setTextColor(60);
            const lines = doc.splitTextToSize(`Mijn oordeel: ${book.myReview}`, contentWidth);
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
    doc.text(`Totaal: ${sorted.length} boeken`, margin, y);

    doc.save('BoekLog.pdf');
}
