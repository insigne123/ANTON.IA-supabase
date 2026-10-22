/**
 * «Informe - Servicio de verificación….pdf» instead of an internal id. A title that ends in a period («…de Cámaras.») would
 * otherwise give «Cámaras..pdf».
 */
export function opportunityExportName(kind: 'Informe' | 'Ficha comercial' | 'Expediente' | 'Borrador de oferta', title: string) {
  const clean = String(title || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90).replace(/[.\s]+$/, '');
  return `${kind} - ${clean || 'Oportunidad'}`;
}
