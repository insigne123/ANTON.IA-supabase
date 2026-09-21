export function reportReady(research: any) {
  return !!research?.reportDocumentV2 && ['completed', 'partial'].includes(research.reportDocumentV2.synthesis?.status);
}
export function reportPending(research: any) {
  if (reportReady(research)) return false;
  // Collection can persist its snapshot before the separate synthesis state exists.
  // Keep polling across that handoff instead of leaving the panel stuck forever.
  if (research?.researchSnapshotId && !research?.reportSynthesisV2 && ['completed', 'partial'].includes(research?.status)) return true;
  return ['queued', 'running'].includes(research?.status) || ['queued', 'running', 'retry_scheduled'].includes(research?.reportSynthesisV2?.status);
}
export function reportStatusLabel(research: any) {
  if (reportReady(research)) return research.reportDocumentV2.synthesis.status === 'partial' ? 'Informe comercial parcial' : 'Informe comercial listo';
  if (['queued', 'running'].includes(research?.status)) return 'Recopilando información…';
  if (reportPending(research)) return 'Preparando el análisis comercial…';
  if (research?.reportSynthesisV2?.status === 'failed_permanent') return 'No se pudo preparar el informe comercial';
  if (research?.status === 'failed') return 'La recopilación de información falló';
  if (research?.researchSnapshotId && !research?.reportSynthesisV2) return 'No hay un informe comercial disponible para esta investigación';
  return 'El informe comercial no está disponible todavía';
}
