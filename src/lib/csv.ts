
export type CsvHeader = { key: string; label: string };

const esc = (v: any) => {
  if (v === null || v === undefined) return '""';
  const raw = String(v).replace(/\r?\n/g, ' ');
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  const s = safe.replace(/"/g, '""');
  return `"${s}"`;
};

export function toCsv(rows: (string | number)[][], headers: string[]) {
  const head = headers.map(h => esc(h)).join(',');
  const body = rows.map(r => r.map(esc).join(',')).join('\r\n');
  return `${head}\r\n${body}`;
}

export function downloadCsv(filename: string, data: string) {
  const blob = new Blob([`\uFEFF${data}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
