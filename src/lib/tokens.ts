export const KNOWN_TOKENS = [
  { key: '{{lead.firstName}}', label: 'Nombre del lead' },
  { key: '{{lead.title}}', label: 'Cargo' },
  { key: '{{company.name}}', label: 'Empresa' },
  { key: '{{company.domain}}', label: 'Dominio' },
];

export function highlightTokens(s: string) {
  return s.replace(/\{\{[^}]+\}\}/g, (m) => `«${m}»`);
}

export function hasCta(text: string) {
  return /(agenda|agend|reunión|llamada|call|calendar|15 ?min|10 ?min|20 ?min)/i.test(text);
}
