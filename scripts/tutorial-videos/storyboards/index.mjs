// The storyboards, one per module, in the order the Centro de ayuda shows them. Each scene names a control by what the
// person reads on it (`target`), says what happens (`title`, `text`, `say`), and can zoom, point an arrow, leave a
// post-it, click, type and wait for the app (`waitFor`). See README.md.
import hoy from './hoy.mjs';
import informeSemanal from './informe-semanal.mjs';
import perfil from './perfil.mjs';
import buscar from './buscar.mjs';
import importar from './importar.mjs';
import contactos from './contactos.mjs';
import firmas from './firmas.mjs';
import campanas from './campanas.mjs';
import conversaciones from './conversaciones.mjs';
import pipeline from './pipeline.mjs';
import empresas from './empresas.mjs';
import oportunidades from './oportunidades.mjs';
import mercadoPublico from './mercado-publico.mjs';
import cowork from './cowork.mjs';
import conexiones from './conexiones.mjs';
import administracion from './administracion.mjs';

export function STORYBOARDS() {
  return [hoy, informeSemanal, perfil, buscar, importar, contactos, firmas, campanas, conversaciones, pipeline, empresas, oportunidades, mercadoPublico, cowork, conexiones, administracion];
}
