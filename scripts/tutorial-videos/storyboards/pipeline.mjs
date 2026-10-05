const NAV = { role: 'navigation', name: 'Navegación principal' };

export default {
  id: 'pipeline', title: 'Pipeline', start: '/dashboard',
  intro: 'Tu pipeline como un CRM: cuánto tienes en cada etapa, cómo vas contra el período anterior y qué mover hoy.',
  learn: ['Leer el panel de un vistazo', 'Ver los leads de una etapa', 'Mover un lead de etapa'],
  scenes: [
    {
      title: 'Abre el Pipeline', text: 'Está en el menú, en «Seguimiento».',
      say: 'Abre el Pipeline desde el menú.',
      target: { role: 'link', name: 'Pipeline', within: NAV },
      waitFor: { css: '[aria-label="Cifras del pipeline"]' },
    },
    {
      title: 'La lectura, en palabras', text: 'Frases automáticas sobre lo que cambió: no tienes que interpretar los gráficos.',
      say: 'Arriba, una lectura automática de cómo vas.', postit: 'Se actualiza sola cada minuto y al volver a la pestaña.',
      target: { css: '[aria-label="Lectura del pipeline"]' }, action: 'none', zoom: 1.35, arrow: true,
    },
    {
      title: 'Seis cifras con su comparación', text: 'Cada una contra el período anterior: la flecha dice si sube o baja.',
      say: 'Seis cifras, cada una comparada con el período anterior.',
      target: { css: '[aria-label="Cifras del pipeline"]' }, action: 'none', zoom: 1.2,
    },
    {
      title: 'Elige el período', text: 'También filtras por responsable y por origen, en la misma fila.',
      say: 'Cambia el período o filtra por responsable.',
      target: { role: 'combobox', name: 'Período' }, action: 'hover', zoom: 1.6, arrow: true,
    },
    {
      title: 'Dónde está cada lead', text: 'La dona reparte tus leads abiertos por etapa. Pasa el mouse para ver el detalle.',
      say: 'La dona muestra cuántos leads hay en cada etapa.',
      target: { css: 'section[aria-label="Pipeline abierto por etapa"]' }, action: 'none', zoom: 1.45,
    },
    {
      title: 'Toca una etapa', text: 'Se abre la lista de esa etapa.',
      say: 'Toca una etapa para ver quiénes están ahí.',
      target: { role: 'button', name: /^Contactado/, exact: false, within: { role: 'list', name: 'Etapas' } }, zoom: 1.5, arrow: true,
      waitFor: { role: 'dialog', name: 'Contactado' }, hold: 1.2,
    },
    {
      title: 'Quiénes están ahí', text: 'Toca a alguien para ver su detalle y lo que sigue con esa persona.',
      say: 'Ahí están los leads de esa etapa.',
      target: { role: 'dialog', name: 'Contactado' }, action: 'none', zoom: 1.2, highlight: false,
    },
    {
      title: 'Contactos por mes', text: 'Las barras son tus envíos de cada mes. La línea, tu promedio de los 3 meses anteriores.',
      say: 'Y cuántos contactaste cada mes, contra tu promedio.', postit: '«Ver como tabla» muestra los mismos números en una tabla.',
      before: async (frame, page) => { await page.keyboard.press('Escape'); await page.waitForTimeout(300); },
      target: { css: 'section[aria-label="Contactos por mes"]' }, action: 'none', zoom: 1.4,
    },
    {
      title: 'Pasa al Tablero', text: 'Una columna por etapa, con cada lead como tarjeta.',
      say: 'Para mover leads, pasa al Tablero.',
      target: { role: 'button', name: 'Tablero' }, zoom: 1.5, arrow: true,
      waitFor: { role: 'button', name: /^Mover/, exact: false },
    },
    {
      title: 'Mueve un lead', text: 'Eliges la etapa nueva y queda registrada.',
      say: 'Pulsa «Mover» en la tarjeta.', postit: 'Las respuestas proponen cambios de etapa; nada se mueve sin que lo aceptes.',
      target: { role: 'button', name: /^Mover/, exact: false }, zoom: 1.6, arrow: true,
      waitFor: { role: 'menuitemradio', name: 'Reunión' },
    },
    {
      title: 'Elige la etapa', text: 'El panel se actualiza con el cambio.',
      say: 'Y elige «Reunión».',
      target: { role: 'menuitemradio', name: 'Reunión' }, zoom: 1.6,
    },
  ],
  outro: {
    title: 'Tu pipeline, al día', text: 'Míralo cada semana para saber qué mover.',
    items: ['Lectura y cifras con comparación', 'La dona: toca una etapa para ver sus leads', 'Tablero: «Mover» a la etapa nueva'],
  },
};
