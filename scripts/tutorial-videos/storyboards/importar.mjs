import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/mi-lista.csv');

export default {
  id: 'importar', title: 'Importar tu lista de contactos', dataset: 'empty', start: '/saved/leads',
  intro: '¿Ya tienes tus prospectos en un Excel o CSV? Súbelos y quedan listos para escribirles.',
  learn: ['Subir un Excel o CSV', 'Revisar columnas y repetidos', 'Ver dónde queda cada persona'],
  scenes: [
    {
      title: 'Importa tu lista', text: 'Está en «Por completar», en «Por escribir» y en «Buscar prospectos».',
      say: 'Pulsa «Importar lista».',
      target: { role: 'link', name: 'Importar lista' }, zoom: 1.6, arrow: true,
      waitFor: { role: 'button', name: 'Elegir archivo' },
    },
    {
      title: 'Sube tu archivo', text: 'Excel (.xlsx) o CSV, hasta 2.000 filas. Si tiene varias hojas, eliges cuál.',
      say: 'Elige tu archivo.', postit: '¿Empiezas de cero? Descarga la plantilla.',
      target: { role: 'button', name: 'Elegir archivo' }, upload: FILE, zoom: 1.5, arrow: true,
      waitFor: { role: 'heading', name: '¿Qué tiene cada columna?' },
    },
    {
      title: 'Las columnas se asocian solas', text: 'Nombre, correo, empresa y cargo, en español o en inglés. Puedes corregirlas.',
      say: 'Cada columna se reconoce sola.',
      target: { role: 'heading', name: '¿Qué tiene cada columna?' }, action: 'none', zoom: 1.3,
    },
    {
      title: 'Revisa antes de importar', text: 'Quién queda listo para escribir, a quién le falta el correo y quién está repetido.',
      say: 'Revisa los contactos.',
      target: { role: 'button', name: 'Revisar contactos' }, zoom: 1.4,
      waitFor: { role: 'button', name: /^Importar \d+ contactos?$/, exact: false },
    },
    {
      title: 'Importa', text: 'Quienes traen correo van a «Por escribir»; el resto, a «Por completar».',
      say: 'Importa: cada persona queda donde le toca.', postit: 'Una persona repetida en el archivo se importa una sola vez.',
      target: { role: 'button', name: /^Importar \d+ contactos?$/, exact: false }, zoom: 1.4, arrow: true,
      waitFor: { role: 'heading', name: /^Importaste/, exact: false },
    },
  ],
  outro: { title: 'Tu lista ya está en la app', text: 'Sigue con «Escribirles» o con «Buscar sus correos».', items: ['Excel o CSV', 'Columnas automáticas', 'Repetidos, una sola vez'] },
};
