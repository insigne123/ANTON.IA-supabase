// The storyboards, one per module, in the order the Centro de ayuda shows them. Each scene names a control by what the
// person reads on it (`target`), says what happens (`title`, `text`, `say`), and can zoom, point an arrow, leave a
// post-it, click, type and wait for the app (`waitFor`). See README.md.
import hoy from './hoy.mjs';
import perfil from './perfil.mjs';
import buscar from './buscar.mjs';
import importar from './importar.mjs';
import contactos from './contactos.mjs';
import firmas from './firmas.mjs';
import campanas from './campanas.mjs';
import conversaciones from './conversaciones.mjs';
import pipeline from './pipeline.mjs';
import oportunidades from './oportunidades.mjs';
import cowork from './cowork.mjs';
import conexiones from './conexiones.mjs';

export function STORYBOARDS() {
  return [hoy, perfil, buscar, importar, contactos, firmas, campanas, conversaciones, pipeline, oportunidades, cowork, conexiones];
}
