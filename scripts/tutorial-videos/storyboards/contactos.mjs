const enrichMock = {
  url: '**/api/opportunities/enrich-apollo', method: 'POST',
  respond: body => ({
    enriched: (body?.leads || []).map(lead => ({
      id: `demo-enriched-${lead.clientRef}`, clientRef: lead.clientRef, fullName: lead.fullName, email: 'florencia.sepulveda@seguridadaustral.cl',
      emailStatus: 'verified', title: 'Jefa de Reclutamiento Masivo', companyName: lead.companyName, enrichmentStatus: 'completed',
    })),
    usage: { consumed: (body?.leads || []).length },
  }),
};

export default {
  id: 'contactos', title: 'Por completar y Por escribir', start: '/saved/leads',
  intro: 'De un contacto guardado a uno listo para escribirle: busca su correo e investígalo.',
  learn: ['Buscar el correo de un contacto', 'Pasar a «Por escribir»', 'Investigar antes de escribir'],
  mocks: [
    enrichMock,
    { url: '**/api/native-research/run', method: 'POST', respond: { runId: 'demo-run-1', items: [] } },
    { url: '**/api/native-research/run/*', respond: { runId: 'demo-run-1', status: 'running', items: [] } },
  ],
  scenes: [
    {
      title: 'Por completar', text: 'Tus guardados sin correo. Los filtros arriba los separan.',
      say: 'En «Por completar» están los contactos sin correo.',
      target: { role: 'button', name: /^Sin buscar/, exact: false }, zoom: 1.6, arrow: true,
    },
    {
      title: 'Elige a quién', text: 'Marca uno o varios.',
      say: 'Marca a quienes quieras completar.',
      target: { role: 'checkbox', name: 'Seleccionar a Florencia Sepúlveda' }, zoom: 1.6,
    },
    {
      title: 'Busca su correo', text: 'Usa un crédito por persona; antes de seguir te dice cuántos.',
      say: 'Pulsa «Buscar correo».',
      target: { role: 'button', name: /^Buscar correo \(\d+\)$/, exact: false }, zoom: 1.4, arrow: true,
      waitFor: { role: 'button', name: 'Completar datos' },
    },
    {
      title: 'Confirma', text: 'Buscamos su correo verificado. El teléfono es opcional.',
      say: 'Confirma.', postit: 'Si no aparece un correo, queda marcado y no se cobra de nuevo.',
      target: { role: 'button', name: 'Completar datos' }, zoom: 1.2,
      waitFor: { text: 'Búsqueda de correo lista' },
    },
    {
      title: 'Ya está en «Por escribir»', text: 'Los que tienen correo pasan aquí.',
      say: 'Ahora está en «Por escribir».',
      target: { role: 'link', name: 'Por escribir', within: { role: 'navigation', name: 'Navegación principal' } },
      waitFor: { role: 'button', name: 'Investigar' },
    },
    {
      title: 'Investiga antes de escribir', text: 'La IA lee su empresa y su rol, para que el correo no sea genérico.',
      say: 'Pulsa «Investigar».',
      target: { role: 'button', name: 'Investigar' }, zoom: 1.6, arrow: true,
      waitFor: { role: 'dialog' },
    },
    {
      title: 'Empieza', text: 'Tarda de uno a tres minutos y puedes seguir trabajando.',
      say: 'Inicia la investigación. Al terminar, «Escribir» prepara el correo.', postit: 'Cuando termina, pasa a «Listos para escribir».',
      target: { role: 'button', name: /^Investigar \d+$/, exact: false, within: { role: 'dialog' } }, zoom: 1.2,
      waitFor: { text: 'Investigación iniciada' },
    },
  ],
  outro: { title: 'Listo para escribirle', text: 'Correo encontrado e investigación en curso.', items: ['«Buscar correo» en Por completar', '«Investigar» en Por escribir', '«Escribir» cuando termina'] },
};
