export default {
  id: 'conexiones', title: 'Conexiones', persona: 'member', start: '/dashboard',
  intro: 'Conecta tu correo para enviar desde tu cuenta, y tu ticket de Mercado Público para recibir licitaciones.',
  learn: ['Conectar Gmail u Outlook', 'Elegir la cuenta que envía', 'Conseguir tu ticket de Mercado Público'],
  // The card of the ticket shows to whoever can open «Oportunidades»; here, a person who has not connected one yet.
  mocks: [
    { url: '**/api/commercial-opportunities/access', method: 'GET', respond: { available: true } },
    {
      url: '**/api/commercial-opportunities/ticket', method: 'GET',
      respond: { ticket: { connected: false, hint: null, verifiedAt: null, lastError: null, shared: false } },
    },
  ],
  scenes: [
    {
      title: 'Conecta tu correo', text: '«Hoy» te lo pide primero: sin correo no puedes enviar.',
      say: 'Desde «Hoy», pulsa «Conectar correo».',
      target: { role: 'link', name: /Conectar correo/, exact: false }, zoom: 1.5, arrow: true,
      waitFor: { role: 'link', name: 'Conectar Gmail' },
    },
    {
      title: 'Gmail u Outlook', text: 'Te lleva a Google o Microsoft para dar permiso. Los correos salen desde tu cuenta.',
      say: 'Elige Gmail u Outlook y da el permiso.', postit: 'Puedes conectar las dos.',
      target: { role: 'link', name: 'Conectar Gmail' }, action: 'hover', zoom: 1.6, arrow: true,
    },
    {
      title: 'La cuenta que envía', text: 'Si conectas las dos, eliges cuál envía por defecto. Al redactar puedes cambiarla.',
      say: 'Con dos cuentas, eliges cuál envía por defecto.',
      target: { role: 'radiogroup', name: 'Cuenta que envía por defecto' }, action: 'none', zoom: 1.4,
    },
    {
      title: 'Tu ticket de Mercado Público', text: 'Con él buscamos licitaciones y Compra Ágil para ti cada mañana.',
      say: 'Aquí va tu ticket de Mercado Público.', postit: 'Es gratis y personal.',
      target: { label: 'Tu ticket de Mercado Público' }, action: 'none', zoom: 1.5, arrow: true,
    },
    {
      title: '¿No lo tienes?', text: 'Una guía de tres pasos te dice cómo pedirlo.',
      say: 'Si no lo tienes, abre la guía.',
      target: { role: 'button', name: '¿No lo tienes? Cómo conseguirlo' }, zoom: 1.6, arrow: true,
      waitFor: { role: 'dialog', name: 'Cómo conseguir tu ticket de Mercado Público' },
    },
    {
      title: 'Pídelo en ChileCompra', text: 'Llenas un formulario corto y te llega por correo.',
      say: 'Sigue los pasos: pídelo en ChileCompra.',
      target: { role: 'button', name: 'Siguiente' }, zoomOn: { role: 'dialog', name: 'Cómo conseguir tu ticket de Mercado Público' }, zoom: 1.15,
    },
    {
      title: 'Pégalo aquí', text: 'Lo probamos con Mercado Público antes de guardarlo.',
      say: 'Y pégalo aquí cuando te llegue.',
      target: { role: 'button', name: 'Siguiente' }, zoomOn: { role: 'dialog', name: 'Cómo conseguir tu ticket de Mercado Público' }, zoom: 1.15,
    },
  ],
  outro: {
    title: 'Todo conectado', text: 'Ya puedes enviar y recibir licitaciones.',
    items: ['Correo: Gmail u Outlook', 'Una cuenta que envía por defecto', 'Ticket de Mercado Público, gratis'],
  },
};
