/** Versioned runtime competencies, curated locally. These descriptors grant no tools or authority. */
const skills = {
  segmentation: { purpose: 'Encontrar y priorizar clientes', criteria: ['Distinguir comprador, usuario y referente por cargo sin inferir autoridad.', 'Separar nuevos contactos y seguimientos; excluir bajas, reservas y duplicados.', 'No generalizar una muestra truncada.'] },
  email: { purpose: 'Correo inicial B2B', criteria: ['Abrir con tarea o señal pertinente a esa persona.', 'Una capacidad fiel y una petición fácil.', 'No convertir una prueba del vendedor en garantía o evidencia externa.'] },
  sequence: { purpose: 'Secuencia y seguimiento', criteria: ['Cada mensaje aporta un ángulo o valor diferente del mismo producto.', 'No repetir la presentación ni fabricar novedades.', 'Cadencia solicitada prevalece sobre ejemplos; solo el último cierra.'] },
  reply: { purpose: 'Respuesta a cliente y objeciones', criteria: ['Contestar primero la pregunta del último mensaje.', 'No inventar precio, plazo ni disponibilidad.', 'Opt-out no recibe otra venta; conservar el hilo exacto.'] },
  edit: { purpose: 'Edición localizada', criteria: ['Cambiar solo lo solicitado.', 'Preservar saludo de grupo, adjuntos, relación previa, prueba y cierre que no se pidió cambiar.', 'Entregar el texto; no pedir crear otra campaña.'] },
  analysis: { purpose: 'Informe comercial', criteria: ['Indicar población, alcance, período y base de cada cifra.', 'Calcular desde datos observados; cero eventos no es tasa cero.', 'Concluir con decisión útil y mantener el detalle descargable.'] },
  miniapp: { purpose: 'Landing, calculadora y tablero', criteria: ['Promesa, evidencia y CTA ligados a oferta real.', 'Supuestos y fórmulas contrastables.', 'Render responsive, accesible y light/dark; distinguir construcción, preview y publicación.'] },
  positioning: { purpose: 'Posicionamiento por audiencia', criteria: ['Relacionar una capacidad autorizada con una tarea del segmento.', 'Distinguir beneficio declarado, señal observada e hipótesis.', 'No importar superlativos, clientes ni resultados de competidores.'] },
  linkedin: { purpose: 'Contacto por LinkedIn', criteria: ['Identidad y URL exactas observadas; relación de red y canal elegible.', 'Mensaje breve pertinente a la relación, una petición.', 'Preparado o en cola no equivale a invitación o mensaje enviado.'] },
  voice: { purpose: 'Voz y trato del vendedor', criteria: ['Usar ejemplos autorizados y el trato solicitado de manera uniforme.', 'La instrucción actual prevalece sobre preferencias antiguas.', 'Una edición de voz conserva hechos, relación, firma y alcance.'] },
  campaign: { purpose: 'Plan de campaña', criteria: ['Objetivo, audiencia, contenido y medición ligados al brief.', 'Distinguir nuevos contactos, seguimientos y respuestas.', 'Recursos y límites conocidos; calendario propuesto no certifica activación o envío.'] },
  experiment: { purpose: 'Experimentación de marketing', criteria: ['Hipótesis, una variable, población elegible, período y criterio de éxito explícitos.', 'Baseline desconocida permanece desconocida, sin benchmarks inventados.', 'Medir resultado y esfuerzo; una muestra pequeña no demuestra causalidad.'] },
  content: { purpose: 'Contenido, SEO y competencia', criteria: ['Responder a la necesidad concreta de la audiencia y mantener la oferta.', 'Fuentes, fecha e intención de búsqueda observadas o límites explícitos.', 'No afirmar rankings, tráfico, volúmenes o publicaciones sin una lectura/integración que lo confirme.'] },
  account: { purpose: 'Priorización y siguiente acción de cuentas', criteria: ['Separar encaje comercial, canal disponible, relación y responsable.', 'Interacción pendiente y compromiso prevalecen sobre volumen de prospectos.', 'Conservar identidad por IDs; varias personas de una empresa no son oportunidades independientes por defecto.'] },
} as const;
export function coworkCompetencies(request: string) {
  const text = request.toLocaleLowerCase('es');
  const selected: Array<keyof typeof skills> = [];
  if (/landing|calculadora|tablero|miniapp/.test(text)) selected.push('miniapp');
  if (/linkedin|invitaci[oó]n|invita/.test(text)) selected.push('linkedin');
  if (/seo|contenido|competencia|competidor|art[ií]culo|blog/.test(text)) selected.push('content');
  if (/experimento|prueba a.?b|test a.?b|hip[oó]tesis/.test(text)) selected.push('experiment');
  if (/mejora|acorta|reescribe|edita|tono|versi[oó]n/.test(text)) selected.push('edit');
  if (/respon|objeci[oó]n|precio|presupuesto/.test(text)) selected.push('reply');
  if (/secuencia|seguimiento|no.*respondi/.test(text)) selected.push('sequence');
  if (/correo|escr[ií]be|redact/.test(text)) selected.push('email');
  if (/informe|m[eé]trica|n[uú]mero|resultado|semana|mes/.test(text)) selected.push('analysis');
  if (/posicion|diferencia|propuesta de valor/.test(text)) selected.push('positioning');
  if (/voz|marca|trato/.test(text)) selected.push('voice');
  if (/plan.*campa[nñ]a|estrategia|campa[nñ]a.*plan/.test(text)) selected.push('campaign');
  if (/cuenta|a qui[eé]n|priori|qu[eé] toca/.test(text)) selected.push('account');
  if (/cliente|contacto|prospect|a qui[eé]n|audiencia|segment/.test(text)) selected.push('segmentation');
  return selected.slice(0, 3).map(id => ({ id, version: '1', ...skills[id],
    inputs: ['Encargo y brief comercial', 'Evidencia observada y sus límites', 'Texto/selección ya aceptados cuando existen'],
    output: 'Entregable del encargo con una decisión o acción utilizable; la competencia no amplía herramientas ni permisos.' }));
}
