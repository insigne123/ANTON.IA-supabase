export default {
  id: 'cowork', title: 'Cowork', start: '/cowork',
  intro: 'Pídele a Cowork lo que necesitas con tus palabras: escribe correos, busca prospectos y te cuenta cómo vas.',
  learn: ['Pedir algo con tus palabras', 'Partir de un ejemplo', 'Retomar un trabajo guardado'],
  scenes: [
    {
      title: 'Pídelo con tus palabras', text: 'Correos, mensajes de LinkedIn, prospectos nuevos o cómo vas.',
      say: 'Escribe lo que necesitas, como se lo pedirías a alguien.', postit: 'Antes de enviar o cambiar algo, te pide aprobación.',
      target: { label: 'Escribe tu mensaje' }, action: 'none', zoom: 1.4, arrow: true,
    },
    {
      title: 'O parte de un ejemplo', text: 'Un clic lo envía. Si falta algo tuyo, como el correo a mejorar, espera en el cuadro.',
      say: 'O elige un ejemplo.',
      // A starter ready as it is goes with one click; «Mejorar un correo» has a [placeholder], so it waits in the composer
      // with that part selected, which is what the next scene shows.
      target: { role: 'button', name: 'Mejorar un correo' }, zoom: 1.6, arrow: true,
    },
    {
      title: 'Revisa y envía', text: 'Pega tu correo donde está marcado. «Enviar» lo pone a andar y ves cada paso.',
      say: 'Completa el pedido y envíalo.',
      target: { role: 'button', name: 'Enviar mensaje' }, action: 'hover', zoomOn: { label: 'Escribe tu mensaje' }, zoom: 1.4, arrow: true,
    },
    {
      title: 'Tus trabajos quedan guardados', text: 'Retómalos cuando quieras, donde quedaron.',
      say: 'Tus trabajos quedan guardados: abre uno.',
      target: { role: 'button', name: /Campaña logística · reclutamiento/, exact: false }, zoom: 1.4, arrow: true,
      waitFor: { text: /Armé la campaña/, exact: false },
    },
    {
      title: 'Qué hizo y qué sigue', text: 'Cada respuesta cuenta qué hizo. Lo que necesita tu aprobación llega como tarjeta.',
      say: 'Cada respuesta dice qué hizo y qué sigue.',
      target: { text: /Armé la campaña/, exact: false }, action: 'none', zoom: 1.45,
    },
    {
      title: 'Sigue la conversación', text: 'Pide un cambio o el paso siguiente, en el mismo trabajo.',
      say: 'Y sigue la conversación cuando quieras.',
      // Typed, so the box shows a follow-up for this campaign and not the example still written from the home.
      target: { label: 'Escribe tu mensaje' }, type: 'Agrega un seguimiento a los 3 días', zoom: 1.4, arrow: true,
    },
  ],
  outro: {
    title: 'Cowork trabaja contigo', text: 'Tú pides y apruebas; Cowork prepara.',
    items: ['Pídelo con tus palabras o con un ejemplo', 'Nada se envía sin tu aprobación', 'Los trabajos quedan guardados'],
  },
};
