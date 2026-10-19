import { enrichMock } from './demo-data.mjs';

// The research that «Investigar N» starts: the first lead running, the others in line. The status answer has the shape
// the workspace reads ({ run: { id, status, items } }); with any other it shows «No pudimos leer el estado de la investigación».
let researched = 1;
const researchRun = () => ({ run: { id: 'demo-run-1', status: 'running', total_count: researched, completed_count: 0,
  items: Array.from({ length: researched }, (_, position) => ({ position, status: position ? 'queued' : 'running' })) } });

export default {
  id: 'contactos', title: 'Tus contactos', start: '/saved/leads/enriched',
  intro: 'De un contacto guardado a uno listo para escribirle: busca su correo e investígalo, todo en «Por escribir».',
  learn: ['Buscar el correo de quien aún no lo tiene', 'Investigar antes de escribir', 'Escribir cuando termina'],
  mocks: [
    enrichMock,
    { url: '**/api/native-research/run', method: 'POST', respond: body => { researched = Math.max(1, body?.leads?.length || 1); return { runId: 'demo-run-1', items: [] }; } },
    { url: '**/api/native-research/run/*', respond: researchRun },
  ],
  scenes: [
    {
      title: 'Los que aún no tienen correo', text: 'Tus guardados sin correo esperan aquí arriba, en un aviso.',
      say: 'Arriba ves a quienes aún no tienen correo. Pulsa «Buscar sus datos».',
      target: { role: 'button', name: 'Buscar sus datos' }, zoom: 1.5, arrow: true,
      waitFor: { role: 'dialog' },
    },
    {
      title: 'Elige qué buscar', text: 'Solo el correo, o correo y teléfono, para todos o persona por persona.',
      say: 'Elige solo correo, o correo y teléfono.', postit: '1 crédito por contacto. Si no aparece un correo, queda marcado y no se cobra de nuevo.',
      target: { role: 'radiogroup', name: 'Qué buscar para todos', within: { role: 'dialog' } }, action: 'none', zoom: 1.4, arrow: true,
    },
    {
      title: 'Busca sus datos', text: 'Buscamos su correo verificado. Quien lo tiene queda listo en la lista.',
      say: 'Pulsa «Buscar datos».',
      target: { role: 'button', name: /^Buscar datos ·/, exact: false, within: { role: 'dialog' } }, zoom: 1.4, arrow: true,
      waitFor: { text: 'Datos de contacto listos' },
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
  outro: { title: 'Listo para escribirle', text: 'Correo encontrado e investigación en curso.', items: ['«Buscar sus datos» para quien no tiene correo', '«Investigar» antes de escribir', '«Escribir» cuando termina'] },
};
