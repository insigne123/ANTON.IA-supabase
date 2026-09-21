// Preserve every scalar in structured report blocks without dumping JSON syntax.
const labels: Record<string, string> = { title: 'Título', label: 'Concepto', value: 'Valor', unit: 'Unidad', date: 'Fecha', text: 'Detalle', question: 'Pregunta', rationale: 'Motivo', name: 'Nombre', description: 'Descripción', status: 'Estado', formula: 'Fórmula', assumptions: 'Supuestos', rows: 'Filas', columns: 'Columnas', events: 'Eventos', items: 'Elementos' };
export function blockLines(value: unknown, prefix = ''): string[] {
  if (value == null) return [];
  if (typeof value !== 'object') return [`${prefix ? `${prefix}: ` : ''}${typeof value === 'boolean' ? value ? 'Sí' : 'No' : String(value)}`];
  if (Array.isArray(value)) return value.flatMap((item, index) => blockLines(item, `${prefix ? `${prefix} · ` : ''}${index + 1}`));
  return Object.entries(value).flatMap(([key, item]) => blockLines(item, `${prefix ? `${prefix} · ` : ''}${labels[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ')}`));
}
