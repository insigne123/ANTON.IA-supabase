import { searchMocks } from './demo-data.mjs';

export default {
  id: 'buscar', title: 'Buscar prospectos', persona: 'member', start: '/dashboard',
  intro: 'Encuentra a quién escribirle: primero las empresas que calzan contigo, después las personas dentro de ellas.',
  learn: ['Partir de un punto de partida', 'Elegir empresas y buscar sus contactos', 'Guardar a quienes te sirven'],
  mocks: searchMocks,
  scenes: [
    {
      title: 'Entra a «Buscar prospectos»', text: 'Está en el menú, en «Prospectar».',
      say: 'Abre «Buscar prospectos» desde el menú.',
      target: { role: 'link', name: 'Buscar prospectos', within: { role: 'navigation', name: 'Navegación principal' } },
      waitFor: { role: 'button', name: 'Buscar empresas' },
    },
    {
      title: 'Parte de un punto de partida', text: 'Llena cargos e industrias según lo que vendes. Después puedes ajustarlos.',
      say: 'Elige un punto de partida: llena los criterios por ti.', postit: 'Si definiste tu cliente ideal en «Perfil», aparece primero.',
      target: { role: 'button', name: /^Recursos Humanos/ }, zoom: 1.7, arrow: true,
    },
    {
      title: 'Busca las empresas', text: 'Primero eliges empresas; los contactos se buscan solo dentro de las que marques.',
      say: 'Pulsa «Buscar empresas».',
      target: { role: 'button', name: 'Buscar empresas' }, zoom: 1.5, arrow: true,
      waitFor: { role: 'button', name: 'Marcar todas' },
    },
    {
      title: 'Marca las que te interesan', text: 'Una por una, o todas de una vez.',
      say: 'Marca las empresas que te interesan.',
      target: { role: 'button', name: 'Marcar todas' }, zoom: 1.6, arrow: true,
    },
    {
      title: 'Busca sus contactos', text: 'Hasta el número de contactos por empresa que elegiste en los criterios.',
      say: 'Ahora, «Buscar contactos» dentro de esas empresas.',
      target: { role: 'button', name: 'Buscar contactos' }, zoom: 1.5, arrow: true,
      waitFor: { role: 'button', name: 'Marcar todos' },
    },
    {
      title: 'Elige a quiénes guardar', text: 'El apellido y el correo quedan ocultos hasta que buscas su correo.',
      say: 'Marca a las personas que te sirven.', postit: 'Los que ya guardaste aparecen como «Guardado»: no se repiten.',
      target: { role: 'button', name: 'Marcar todos' }, zoom: 1.5, arrow: true,
    },
    {
      title: 'Guárdalos', text: 'Quedan en «Por completar», donde buscas su correo.',
      say: 'Y guárdalos con un clic.',
      target: { role: 'button', name: /^Guardar \d+$/ }, zoom: 1.4, arrow: true,
      waitFor: { text: /Guardaste \d+ contactos?/, exact: false },
    },
  ],
  outro: {
    title: 'Ya tienes prospectos', text: 'Siguiente paso: buscar sus correos en «Por completar».',
    items: ['Punto de partida → empresas → contactos', 'Guardar los deja en «Por completar»'],
  },
};
