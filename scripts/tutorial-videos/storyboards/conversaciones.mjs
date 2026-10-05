export default {
  id: 'conversaciones', title: 'Conversaciones', start: '/contacted',
  intro: 'Quién te respondió, a quién esperas y qué sigue con cada persona.',
  learn: ['Ver primero quién respondió', 'Abrir el hilo', 'Responder en el mismo hilo'],
  mocks: [
    { url: '**/api/contacted/*/work', method: 'POST', respond: { ok: true } },
    { url: '**/api/providers/send', method: 'POST', respond: { success: true, status: 'sent', messageId: 'demo-reply-1' } },
  ],
  scenes: [
    {
      title: 'Primero, quien te respondió', text: '«Por responder» junta a quienes esperan tu respuesta.',
      say: 'Empieza por «Por responder».', postit: 'Las respuestas llegan solas cada cierto tiempo.',
      target: { role: 'button', name: /^Por responder/, exact: false }, zoom: 1.6, arrow: true,
    },
    {
      title: 'Abre la conversación', text: 'Ves el hilo completo y qué pidió.',
      say: 'Abre la conversación.',
      target: { role: 'button', name: /Andrea Soto/, exact: false }, zoom: 1.3,
      waitFor: { role: 'button', name: 'Responder' },
    },
    {
      title: 'Responde en el mismo hilo', text: 'Escribes tú, o pides una sugerencia a la IA.',
      say: 'Pulsa «Responder».', postit: '«Sugerir con IA» propone una respuesta que tú revisas.',
      target: { role: 'button', name: 'Responder' }, zoom: 1.6, arrow: true,
      waitFor: { label: 'Tu respuesta' },
    },
    {
      title: 'Escribe tu respuesta', text: 'Sale desde tu correo, en el hilo original.',
      say: 'Escribe tu respuesta.',
      target: { label: 'Tu respuesta' }, type: 'Hola Andrea, ¿te acomoda el jueves a las 10? Te envío la invitación.', zoom: 1.5,
    },
    {
      title: 'Envía', text: 'Incluye la opción de dejar de recibir mensajes comerciales.',
      say: 'Y envíala.',
      target: { role: 'button', name: 'Enviar respuesta' }, zoom: 1.5, arrow: true,
    },
  ],
  outro: { title: 'Respondida', text: 'La conversación sigue en el mismo hilo.', items: ['«Por responder» primero', 'El hilo completo', 'Respuesta desde tu correo'] },
};
