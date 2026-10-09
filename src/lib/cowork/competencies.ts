/** Versioned runtime competencies, curated locally. These descriptors grant no tools or authority. */
const skills = {
  segmentation: { purpose: 'Encontrar y priorizar clientes', criteria: ['Distinguir comprador, usuario y referente por cargo sin inferir autoridad.', 'Separar nuevos contactos y seguimientos; excluir bajas, reservas y duplicados.', 'No generalizar una muestra truncada.'] },
  email: { purpose: 'Correo inicial B2B', criteria: ['Abrir con tarea o señal pertinente a esa persona.', 'Una capacidad fiel y una petición fácil.', 'No convertir una prueba del vendedor en garantía o evidencia externa.'] },
  sequence: { purpose: 'Secuencia y seguimiento', criteria: ['Cada mensaje aporta un ángulo o valor diferente del mismo producto.', 'No repetir la presentación ni fabricar novedades.', 'Cadencia solicitada prevalece sobre ejemplos; solo el último cierra.'] },
  reply: { purpose: 'Respuesta a cliente y objeciones', criteria: ['Contestar primero la pregunta del último mensaje.', 'No inventar precio, plazo ni disponibilidad.', 'Opt-out no recibe otra venta; conservar el hilo exacto.'] },
  edit: { purpose: 'Edición localizada', criteria: ['Cambiar solo lo solicitado.', 'Preservar saludo de grupo, adjuntos, relación previa, prueba y cierre que no se pidió cambiar.', 'Entregar el texto; no pedir crear otra campaña.'] },
  analysis: { purpose: 'Informe comercial', criteria: ['Indicar población, alcance, período y base de cada cifra.', 'Calcular desde datos observados; cero eventos no es tasa cero.', 'Concluir con decisión útil y mantener el detalle descargable.'] },
  miniapp: { purpose: 'Landing, calculadora y tablero', criteria: ['Promesa, evidencia y CTA ligados a oferta real.', 'Supuestos y fórmulas contrastables.', 'Render responsive, accesible y light/dark; distinguir construcción, preview y publicación.'] },
} as const;
export function coworkCompetencies(request: string) {
  const text = request.toLocaleLowerCase('es');
  const selected: Array<keyof typeof skills> = [];
  if (/mejora|acorta|reescribe|edita|tono|versi[oó]n/.test(text)) selected.push('edit');
  if (/respon|objeci[oó]n|precio|presupuesto/.test(text)) selected.push('reply');
  if (/secuencia|seguimiento|no.*respondi/.test(text)) selected.push('sequence');
  if (/correo|escr[ií]be|redact/.test(text)) selected.push('email');
  if (/informe|m[eé]trica|n[uú]mero|resultado|semana|mes/.test(text)) selected.push('analysis');
  if (/landing|calculadora|tablero|miniapp/.test(text)) selected.push('miniapp');
  if (/cliente|contacto|prospect|a qui[eé]n|audiencia|segment/.test(text)) selected.push('segmentation');
  return selected.slice(0, 3).map(id => ({ id, version: '1', ...skills[id] }));
}
