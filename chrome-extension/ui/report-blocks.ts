import type { ReportV2 } from '../../src/lib/report-v2-contracts';

// Only content fields are displayed. IDs, scope, hashes and validation metadata
// belong to the saved document, not to the commercial reading of a block.
const labels: Record<string, string> = {
  title: 'Título', label: 'Concepto', value: 'Valor', unit: 'Unidad', date: 'Fecha', text: 'Detalle', question: 'Pregunta',
  rationale: 'Motivo', name: 'Nombre', description: 'Descripción', formula: 'Fórmula', assumptions: 'Supuestos',
  events: 'Eventos', items: 'Elementos', rows: 'Filas', approved: 'Aprobado', scenarios: 'Escenarios', multiplier: 'Factor', eventsPerYear: 'Eventos por año',
  eventsPerMonth: 'Eventos por mes', hoursPerMonth: 'Horas por mes', caveats: 'Limitaciones', statement: 'Hallazgo',
  unknown: 'Por confirmar', howToFind: 'Cómo confirmarlo', content: 'Contenido', validationQuestion: 'Pregunta de validación',
  objection: 'Objeción', response: 'Respuesta', channel: 'Canal', timing: 'Momento', hooks: 'Motivos para contactar',
};
const reference = /^(?:c\d{2,4}|(?:src|f|sig|gap|est|asm|del)_[a-f0-9]{10})$/;
export function blockLines(value: unknown, prefix = ''): string[] {
  if (value == null) return [];
  if (typeof value !== 'object') {
    if (typeof value === 'string' && (!value.trim() || reference.test(value))) return [];
    return [`${prefix ? `${prefix}: ` : ''}${typeof value === 'boolean' ? value ? 'Sí' : 'No' : String(value)}`];
  }
  if (Array.isArray(value)) return value.flatMap((item, index) => blockLines(item, `${prefix ? `${prefix} · ` : ''}${index + 1}`));
  const row = value as Record<string, unknown>;
  if (Array.isArray(row.columns) && Array.isArray(row.rows)) {
    const columns = row.columns.map(item => typeof item === 'string' ? item : '');
    return row.rows.flatMap(item => Array.isArray(item)
      ? item.flatMap((cell, index) => blockLines(cell, columns[index] || 'Detalle')) : []);
  }
  return Object.entries(row).flatMap(([key, item]) => labels[key]
    ? blockLines(item, `${prefix ? `${prefix} · ` : ''}${labels[key]}`) : []);
}

export type ReportBlockReading = { title: string | null; lines: string[]; links: Array<{ label: string; url: string }> };
type Block = ReportV2['sections'][number]['blocks'][number];
export function presentReportBlock(block: Block, report: Pick<ReportV2, 'analysis' | 'evidenceGraph'>): ReportBlockReading {
  const graph = report.evidenceGraph;
  const links: ReportBlockReading['links'] = [];
  const safeLink = (label: string, value: string) => {
    try {
      const url = new URL(value);
      if (['https:', 'http:'].includes(url.protocol)) links.push({ label, url: url.href });
    } catch { /* Never turn an invalid source into a clickable URL. */ }
  };
  const resolve = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(resolve);
    if (typeof value !== 'string' || !reference.test(value)) return value;
    const source = graph?.sources?.find(item => item.id === value);
    if (source) { safeLink(source.title, source.canonicalUrl || source.url); return null; }
    const claim = graph?.claims?.find(item => item.id === value);
    if (claim) return `${claim.type === 'hypothesis' ? 'Hipótesis por validar: ' : claim.type === 'derived' ? 'Estimación: ' : claim.type === 'declared' ? 'Dato del perfil: ' : ''}${claim.statement}${claim.type === 'hypothesis' ? ` ${claim.validationQuestion}` : ''}`;
    const signal = graph?.signals?.find(item => item.id === value);
    if (signal) return resolve(signal.claimId);
    return graph?.facts?.find(item => item.id === value)?.text
      || graph?.gaps?.find(item => item.id === value)
      || graph?.estimates?.find(item => item.id === value)
      || graph?.assumptions?.find(item => item.id === value)
      || graph?.deliverables?.find(item => item.id === value) || null;
  };
  let lines: string[];
  if (block.type === 'sources') {
    const sources = Array.isArray(block.payload) ? block.payload : graph?.sources || [];
    for (const item of sources) {
      if (typeof item === 'string') resolve(item);
      else if (item && typeof item === 'object') {
        const source = item as { title?: string; canonicalUrl?: string; url?: string };
        safeLink(source.title || 'Fuente consultada', source.canonicalUrl || source.url || '');
      }
    }
    lines = [];
  } else if (block.type === 'committee') {
    lines = (report.analysis?.buyingCommittee || []).flatMap(person => [
      `${person.name || 'Rol por identificar'} · ${person.title}`, person.rationale,
    ].filter(Boolean));
  } else if (block.type === 'deliverable') {
    const items = Array.isArray(block.payload) ? block.payload : [block.payload];
    lines = items.flatMap(item => {
      const resolved = resolve(item);
      if (resolved && typeof resolved === 'object') {
        const deliverable = resolved as { status?: string; content?: string };
        return [deliverable.status === 'blocked' ? 'No utilizar todavía' : 'Revisar antes de usar', ...blockLines(deliverable.content)];
      }
      return blockLines(resolved);
    });
  } else {
    lines = blockLines(resolve(block.payload));
  }
  return { title: block.title, lines, links };
}
