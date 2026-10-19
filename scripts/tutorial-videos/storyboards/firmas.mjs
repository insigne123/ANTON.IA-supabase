export default {
  id: 'firmas', title: 'Firmas y estilo', start: '/settings/email-studio?tab=firma',
  intro: 'Tu firma va al final de cada correo. Tus estilos le dicen a la IA cómo escribir. Tu agenda, cómo pedirte una reunión.',
  learn: ['Armar tu firma', 'Elegir el tono de tus correos', 'Sumar tu enlace para agendar'],
  mocks: [{
    url: '**/api/email-styles', method: 'POST',
    respond: body => ({ style: { id: '00000000-0000-4000-8000-00000000c0de', name: body?.name, profile: body?.profile, isDefault: body?.isDefault, revision: 3, libraryScope: 'personal', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), contentHash: 'demo', archivedAt: null } }),
  }],
  scenes: [
    {
      title: 'Elige un diseño', text: 'Clásica, con logo, compacta, o la imagen de firma que ya tengas.',
      say: 'En «Firma», elige un diseño.',
      target: { role: 'radio', name: /Compacta/, exact: false }, zoom: 1.6, arrow: true,
    },
    {
      title: 'Tus datos', text: 'Vienen de tu perfil. La vista previa cambia mientras escribes.',
      say: 'Completa tus datos, por ejemplo tu teléfono.',
      target: { label: 'Teléfono' }, type: '+56 9 1234 5678', zoom: 1.7,
    },
    {
      title: 'Así se ve en un correo', text: 'Va al final de cada correo, antes del enlace para darse de baja.',
      say: 'Así se verá al final de cada correo.',
      target: { role: 'group', name: 'Tu firma' }, action: 'none', zoom: 1.6, arrow: true,
    },
    {
      title: 'Guárdala', text: 'Una sola firma para Gmail y Outlook, o una distinta en cada cuenta.',
      say: 'Guárdala.', postit: 'Con «Usar al enviar» encendido, se agrega sola a todo lo que envías.',
      target: { role: 'button', name: 'Guardar firma' }, zoom: 1.5,
      waitFor: { text: /Firma guardada\./, exact: false },
    },
    {
      title: 'Tus estilos', text: 'Cómo suenan los correos que la IA te prepara.',
      say: 'En «Estilos», decide cómo suenan tus correos.',
      target: { role: 'tab', name: 'Estilos' }, zoom: 1.4,
      waitFor: { role: 'list', name: 'Estilos guardados' },
    },
    {
      title: 'Tono y largo', text: 'Con un clic: cercano, directo, breve…',
      say: 'Elige el tono con un clic.',
      target: { role: 'button', name: 'Cercano', within: { role: 'group', name: 'Tono' } }, zoom: 1.7, arrow: true,
    },
    {
      title: 'Datos de cada contacto', text: '«Insertar» agrega {Nombre} o {Empresa} donde está el cursor.',
      say: 'Inserta datos de cada contacto con una pastilla.',
      target: { role: 'button', name: 'Empresa', within: { role: 'group', name: 'Insertar en el asunto' } }, zoom: 1.7,
    },
    {
      title: 'Guarda tu estilo', text: 'El predeterminado se usa solo en Redactar, Campañas y Cowork.',
      say: 'Guarda tu estilo.', postit: 'La vista previa termina con tu firma real.',
      target: { role: 'button', name: 'Guardar estilo' }, zoom: 1.4, arrow: true,
    },
    {
      title: 'Tu agenda', text: 'El enlace donde eligen un horario contigo: Calendly, Google Calendar, Bookings…',
      say: 'En «Agenda», pega tu enlace para agendar.',
      target: { role: 'tab', name: 'Agenda' }, zoom: 1.4,
      waitFor: { label: 'Enlace de tu agenda' },
    },
    {
      title: 'Pega tu enlace', text: 'Reconoce el servicio y te deja probarlo.',
      say: 'Pega la dirección que compartes para agendar.', postit: '¿No tienes una? Debajo está cómo crearla gratis en Google Calendar.',
      target: { label: 'Enlace de tu agenda' }, type: 'calendly.com/camila-torres/30min', zoom: 1.6,
    },
    {
      title: '¿Cuándo va?', text: 'Automático: la IA lo suma solo cuando la persona muestra interés o pide una reunión. Nunca en un primer correo.',
      say: 'Elige cuándo va en tus correos.',
      target: { role: 'radio', name: /Automático/, exact: false }, zoomOn: { role: 'radiogroup' }, zoom: 1.3, arrow: true,
    },
    {
      title: 'Guárdala', text: 'Desde ahí, las respuestas sugeridas la incluyen cuando corresponde.',
      say: 'Y guárdala.',
      target: { role: 'button', name: 'Guardar agenda' }, zoom: 1.5,
      waitFor: { text: 'Agenda guardada' },
    },
  ],
  outro: { title: 'Correos con tu sello', text: 'Tu firma en cada envío, un estilo que la IA respeta y tu agenda cuando la piden.', items: ['Firma armada en un minuto', 'Tono y largo con un clic', 'Tu enlace para agendar'] },
};
