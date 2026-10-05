const NAV = { role: 'navigation', name: 'Navegación principal' };

export default {
  id: 'oportunidades', title: 'Oportunidades', start: '/dashboard',
  intro: 'Empresas que están contratando para lo que vendes, licitaciones públicas que calzan contigo y proyectos por partir.',
  learn: ['Ver quién está contratando', 'Revisar licitaciones y Compra Ágil', 'Ajustar lo que buscamos'],
  mocks: [{ url: '**/api/commercial-opportunities/*', method: 'PATCH', respond: { ok: true } }],
  scenes: [
    {
      title: 'Abre Oportunidades', text: 'Está en el menú, en «Prospectar».',
      say: 'Abre «Oportunidades» desde el menú.',
      target: { role: 'link', name: 'Oportunidades', within: NAV },
      waitFor: { role: 'tab', name: /Empresas contratando/, exact: false },
    },
    {
      title: 'Empresas que están contratando', text: 'Cuántos avisos publicaron y para qué cargos: una señal de que necesitan lo que vendes.',
      say: 'Primero, las empresas que están contratando.', postit: 'El calce pone arriba las que más se parecen a tu cliente ideal.',
      target: { role: 'heading', name: 'Retail Andino' }, action: 'none', zoom: 1.5, arrow: true,
    },
    {
      title: 'Mira la evidencia', text: 'Cada aviso, con dónde y cuándo se publicó.',
      say: 'Abre los avisos para ver la evidencia.',
      target: { role: 'button', name: /^Ver los avisos/, exact: false }, zoom: 1.55, arrow: true,
    },
    {
      title: 'Márcala', text: 'Queda a tu nombre, y tu equipo ve que la estás trabajando.',
      say: 'Si te interesa, márcala.', postit: '«Buscar decisores» te lleva a las personas de esa empresa.',
      target: { role: 'button', name: 'Me interesa' }, zoom: 1.6, arrow: true,
      waitFor: { role: 'button', name: /Me interesan\s*1/, exact: false },
    },
    {
      title: 'Las tuyas, juntas', text: '«Me interesan» junta las que marcaste para preparar el contacto.',
      say: 'Las que marcas quedan en «Me interesan».',
      target: { role: 'button', name: /Me interesan\s*1/, exact: false }, zoom: 1.5, arrow: true,
      waitFor: { role: 'button', name: 'Te interesa' },
    },
    {
      title: 'Licitaciones y Compra Ágil', text: 'Compras públicas abiertas que calzan con tus palabras.',
      say: 'Ahora, las licitaciones y Compra Ágil.',
      target: { role: 'tab', name: /Licitaciones y Compra Ágil/, exact: false }, zoom: 1.5, arrow: true,
      waitFor: { role: 'heading', name: 'Servicio de verificación de antecedentes para personal externo' },
    },
    {
      title: 'Lo esencial de cada una', text: 'Monto, cuántos días quedan para postular y las palabras que calzan.',
      say: 'Cada tarjeta dice el monto y cuándo cierra.', postit: 'Se buscan con tu ticket de Mercado Público, que es gratis.',
      target: { role: 'heading', name: 'Servicio de verificación de antecedentes para personal externo' }, action: 'none', zoom: 1.5,
    },
    {
      title: 'Ábrela en Mercado Público', text: 'Las bases y los plazos oficiales, en otra pestaña.',
      say: 'Ábrela en Mercado Público para ver las bases.',
      target: { role: 'link', name: /Ver en Mercado Público/, exact: false }, action: 'hover', zoom: 1.6, arrow: true,
    },
    {
      title: 'Ajusta lo que buscamos', text: 'Cargos, regiones, palabras y fuentes. Buscamos cada mañana con esto.',
      say: 'Y ajusta lo que buscamos cuando quieras.',
      target: { role: 'button', name: 'Editar búsqueda' }, zoom: 1.5, arrow: true,
      waitFor: { role: 'dialog', name: 'Qué buscamos' },
    },
  ],
  outro: {
    title: 'Oportunidades cada mañana', text: 'Revisa las nuevas y marca las que trabajarás.',
    items: ['Empresas contratando, con evidencia', 'Licitaciones y Compra Ágil con tu ticket', '«Editar búsqueda» para ajustar'],
  },
};
