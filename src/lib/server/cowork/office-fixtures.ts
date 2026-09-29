// Files for the tests of the readers (file-binary.ts, zip-guard.ts): a real Excel, PDF and Word made
// with the libraries the app already uses, so the tests open what the libraries actually write.
// Not imported by the app.
import JSZip from 'jszip';
import * as XLSX from 'xlsx';

/** An Excel workbook with one sheet per key; each sheet is rows of cells. */
export function makeXlsx(sheets: Record<string, unknown[][]>): Uint8Array {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), name);
  return new Uint8Array(XLSX.write(book, { type: 'buffer', bookType: 'xlsx', cellDates: true }));
}

/** A PDF with the text of each page (an empty text leaves the page blank: a «scan»). */
export async function makePdf(pages: string[]): Promise<Uint8Array> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF();
  pages.forEach((text, index) => {
    if (index > 0) pdf.addPage();
    if (text) pdf.text(pdf.splitTextToSize(text, 180), 10, 20);
  });
  return new Uint8Array(pdf.output('arraybuffer'));
}

const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A Word document: one paragraph per string and one table per array of rows. */
export async function makeDocx(blocks: Array<string | string[][]>): Promise<Uint8Array> {
  const paragraph = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
  const table = (rows: string[][]) => `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>${
    (rows[0] || []).map(() => '<w:gridCol w:w="2400"/>').join('')}</w:tblGrid>${
    rows.map(row => `<w:tr>${row.map(cell => `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${paragraph(cell)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${
    blocks.map(block => typeof block === 'string' ? paragraph(block) : table(block)).join('')}</w:body></w:document>`);
  return zip.generateAsync({ type: 'uint8array' });
}

/** Only the end of a ZIP file: a central directory that declares these entries and sizes (all the guard reads), after `padding` bytes that stand for what a real file holds before it. */
export function zipDirectory(entries: Array<{ name: string; size: number }>, options: { zip64?: boolean; padding?: number } = {}): Uint8Array {
  const padding = options.padding ?? 0;
  const parts = entries.map(entry => {
    const name = new TextEncoder().encode(entry.name);
    const bytes = new Uint8Array(46 + name.length);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint32(20, entry.size, true);
    view.setUint32(24, entry.size, true);
    view.setUint16(28, name.length, true);
    bytes.set(name, 46);
    return bytes;
  });
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(10, options.zip64 ? 0xffff : entries.length, true);
  view.setUint32(12, size, true);
  view.setUint32(16, padding, true);
  const all = new Uint8Array(padding + size + 22);
  let at = padding;
  for (const part of parts) { all.set(part, at); at += part.length; }
  all.set(end, at);
  return all;
}
