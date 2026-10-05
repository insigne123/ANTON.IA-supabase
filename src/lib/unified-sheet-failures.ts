// The reads behind the sheet and the pipeline (unified-sheet-data.ts), named as the person knows them, for the notice a
// screen shows when some of them fail.
export type UnifiedSource = 'saved' | 'enriched' | 'opportunities' | 'contacted' | 'custom';

export const UNIFIED_SOURCE_LABEL: Record<UnifiedSource, string> = {
  saved: '«Por completar»',
  enriched: '«Por escribir»',
  opportunities: 'las oportunidades guardadas',
  contacted: 'las conversaciones',
  custom: 'las etapas y notas',
};

/** «No pudimos leer «Por completar» y las conversaciones.» Each source once, in the order they failed. */
export function unifiedFailureText(failed: UnifiedSource[]) {
  const names = [...new Set(failed)].map(source => UNIFIED_SOURCE_LABEL[source]);
  if (!names.length) return '';
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names.at(-1)}` : names[0];
  return `No pudimos leer ${list}.`;
}
