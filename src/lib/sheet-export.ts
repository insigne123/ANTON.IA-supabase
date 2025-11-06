// src/lib/sheet-export.ts
// Utilidades de exportación a XLSX y PDF (cliente). Se usan imports dinámicos
// para evitar SSR issues. No exponen secretos.

export async function exportToXlsx(
  headers: string[],
  rows: (string | number)[][],
  filename: string
) {
  const XLSX = await import('xlsx');
  const data = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet');
  const safe = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  XLSX.writeFile(wb, safe, { compression: true });
}

export async function exportToPdf(
  headers: string[],
  rows: (string | number)[][],
  filename: string
) {
  const jsPDFlib = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDFlib.jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: 'a4',
  });

  const margin = 24;
  doc.setFontSize(12);
  doc.text('LeadFlow.AI — Export', margin, 22);
  doc.setFontSize(8);
  doc.text(new Date().toLocaleString(), margin, 36);

  autoTable(doc, {
    head: [headers],
    body: rows,
    startY: 48,
    styles: { fontSize: 8, halign: 'left', cellPadding: 4 },
    headStyles: { fillColor: [29, 78, 216], textColor: 255 },
    bodyStyles: { valign: 'top' },
    didDrawPage: (data) => {
      // footer simple
      const pageSize = doc.internal.pageSize;
      const pageHeight = pageSize.height ? pageSize.height : (pageSize as any).getHeight();
      doc.setFontSize(8);
      doc.text(
        `Página ${doc.internal.getNumberOfPages()}`,
        pageSize.width - margin - 60,
        pageHeight - 12
      );
    },
  });

  const safe = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  doc.save(safe);
}

/** NUEVO: exportación a CSV genérica */
export function exportToCsv(
  headers: string[],
  rows: (string | number)[][],
  filename: string
) {
  const safe = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  const escape = (val: string | number) => {
    const s = String(val ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
  const lines = [
    headers.map(escape).join(','),
    ...rows.map((r) => r.map(escape).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safe;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
