import { enrichMock, searchMocks } from './demo-data.mjs';

export default {
  id: 'buscar', title: 'Buscar prospectos', persona: 'member', start: '/dashboard',
  intro: 'Encuentra a quién escribirle: primero las empresas que calzan contigo, después las personas dentro de ellas.',
  learn: ['Partir de un punto de partida', 'Elegir empresas y buscar sus contactos', 'Guardarlos con su correo'],
  mocks: [...searchMocks, enrichMock],
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
      title: 'Guárdalos', text: 'Al guardar, te ofrecemos buscar su correo para que puedas escribirles.',
      say: 'Guárdalos con un clic.',
      target: { role: 'button', name: /^Guardar \d+$/ }, zoom: 1.4, arrow: true,
      waitFor: { role: 'dialog' },
    },
    {
      title: 'Elige qué buscar', text: 'Solo el correo, o correo y teléfono. Para todos o persona por persona.',
      say: 'Elige qué buscar: solo correo, o correo y teléfono.', postit: 'Cuesta 1 crédito por contacto, con o sin teléfono.',
      target: { role: 'radiogroup', name: 'Qué buscar para todos', within: { role: 'dialog' } }, action: 'none', zoom: 1.4, arrow: true,
    },
    {
      title: 'Busca sus datos', text: 'Quien tenga correo pasa directo a «Por escribir». «Guardar sin buscar» los deja esperando ahí.',
      say: 'Pulsa «Buscar datos».',
      target: { role: 'button', name: /^Buscar datos ·/, exact: false, within: { role: 'dialog' } }, zoom: 1.4, arrow: true,
      waitFor: { text: 'Datos de contacto listos' },
    },
  ],
  outro: {
    title: 'Ya tienes prospectos', text: 'Con su correo, quedan en «Por escribir», listos para investigar y escribirles.',
    items: ['Punto de partida → empresas → contactos', 'Guardar y buscar sus datos', 'Listos en «Por escribir»'],
  },
};
