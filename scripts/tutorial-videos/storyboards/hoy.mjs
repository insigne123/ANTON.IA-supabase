export default {
  id: 'hoy', title: 'Hoy', start: '/dashboard',
  intro: 'Tu punto de partida cada día: lo más importante primero, y cómo va tu semana.',
  learn: ['Ver lo más urgente', 'Ordenar lo que te espera', 'Leer tu semana en cuatro cifras'],
  scenes: [
    {
      title: 'Lo primero, siempre arriba', text: 'Una sola acción: la más importante ahora.',
      say: '«Hoy» te dice qué hacer primero.',
      target: { role: 'link', name: 'Abrir conversación' }, action: 'none', zoom: 1.5, arrow: true,
    },
    {
      title: 'Lo que te espera', text: 'Respuestas, compromisos y contactos listos, de lo más urgente a lo menos.',
      say: 'Debajo, lo que te espera, en orden de urgencia.',
      target: { role: 'link', name: /Matías Rojas/, exact: false }, action: 'hover', zoom: 1.4, arrow: true,
    },
    {
      title: 'Tu semana en cifras', text: 'Contactados, respuestas, campañas activas y contactos con correo.',
      say: 'Y cómo va tu semana, en cuatro cifras.', postit: 'Cada cifra abre la lista que la explica.',
      target: { role: 'link', name: /^Contactados/, exact: false }, action: 'hover', zoom: 1.5, arrow: true,
    },
    {
      title: 'Abre lo urgente', text: 'Un clic y estás en la conversación, lista para responder.',
      say: 'Abre la conversación y respóndele.',
      target: { role: 'link', name: 'Abrir conversación' }, zoom: 1.3,
      waitFor: { role: 'heading', name: 'Conversaciones' },
    },
  ],
  outro: { title: 'Empieza aquí cada día', text: 'Lo urgente arriba, lo demás en orden.', items: ['Una acción principal', 'Lo que te espera, por urgencia', 'Tu semana en cifras'] },
};
