/**
 * The tutorial videos (Plan 11, section 7): one per module, recorded on demo data by scripts/tutorial-videos. Each one
 * lives in public/tutorial-videos as <id>.mp4, its poster <id>.jpg and its subtitles <id>.vtt. They show in the Centro
 * de ayuda, in the section of their module and in the «?» panel of their screens. After recording again, update
 * `seconds` with what the recorder prints.
 */
import { helpSectionFor, type HelpSection, type HelpVisibility } from './manual';

export type TutorialVideo = {
  id: string;
  title: string;
  /** What it shows, in one line. */
  summary: string;
  /** Length, in seconds. */
  seconds: number;
  /** The manual sections it belongs to; the first one is its home. */
  sections: string[];
  /** Screens without a manual section whose «?» panel offers it (Cowork). */
  routes?: RegExp;
  /** Hidden when the feature is off for the person, as in the menu. */
  feature?: 'opportunities' | 'admin';
};

export const TUTORIAL_VIDEOS: TutorialVideo[] = [
  { id: 'hoy', title: 'Hoy', summary: 'Lo más urgente primero, tus llamadas y LinkedIn con guion, a quién retomar y tu día en cifras.', seconds: 92, sections: ['hoy', 'primeros-pasos'] },
  { id: 'informe-semanal', title: 'Informe semanal', summary: 'En «Hoy», tu semana en una frase, tu equipo, lo que cierra en Oportunidades y el correo de cada lunes.', seconds: 87, sections: ['informe-semanal'] },
  { id: 'perfil', title: 'Perfil', summary: 'Cuenta qué vendes: tu oferta y tu cliente ideal guían la búsqueda y los correos.', seconds: 48, sections: ['perfil'] },
  { id: 'buscar', title: 'Buscar prospectos', summary: 'De un punto de partida a las empresas y sus contactos, y al guardarlos, sus correos.', seconds: 76, sections: ['buscar'] },
  { id: 'importar', title: 'Importar tu lista', summary: 'Sube tu Excel o CSV, revisa las columnas y los repetidos, e impórtala.', seconds: 42, sections: ['tabla', 'por-completar'] },
  { id: 'contactos', title: 'Tus contactos', summary: 'Busca sus correos, investiga a quienes eliges y escríbeles.', seconds: 47, sections: ['por-completar', 'por-escribir', 'correo'] },
  { id: 'firmas', title: 'Firmas y estilo', summary: 'Arma tu firma, crea estilos de correo que la IA usa al escribir y suma tu enlace para agendar.', seconds: 103, sections: ['firmas', 'correo'] },
  { id: 'campanas', title: 'Campañas', summary: 'Elige a quiénes, escribe el correo y los seguimientos, revisa y aprueba.', seconds: 115, sections: ['campanas'] },
  { id: 'conversaciones', title: 'Conversaciones', summary: 'Quién te respondió primero, el hilo completo y tu respuesta en el mismo hilo.', seconds: 53, sections: ['conversaciones'] },
  { id: 'pipeline', title: 'Pipeline', summary: 'El panel con tus cifras y etapas, y cómo mover un lead en el tablero.', seconds: 84, sections: ['pipeline'] },
  { id: 'empresas', title: 'Empresas', summary: 'Qué hace cada empresa, quién decide, quién lo usa y quién paga, a quién buscar y empresas parecidas.', seconds: 63, sections: ['pipeline'] },
  { id: 'oportunidades', title: 'Oportunidades', summary: 'El embudo con búsqueda y fuentes, cargar una desde su documento, el informe de la IA y «Cómo ganar».', seconds: 129, sections: ['oportunidades'], feature: 'opportunities' },
  { id: 'mercado-publico', title: 'Mercado público', summary: 'Lo que el Estado planea comprar, los contratos que se licitarán de nuevo y tus competidores.', seconds: 83, sections: ['oportunidades'], feature: 'opportunities' },
  { id: 'cowork', title: 'Cowork', summary: 'Pídele lo que necesitas con tus palabras y retoma tus conversaciones guardadas.', seconds: 53, sections: ['cowork', 'primeros-pasos'], routes: /^\/cowork(\/.*)?$/ },
  { id: 'conexiones', title: 'Conexiones', summary: 'Conecta tu correo, elige la cuenta que envía y consigue tu ticket de Mercado Público.', seconds: 61, sections: ['conexiones'] },
  { id: 'administracion', title: 'Administración', summary: 'Quién usa la app y para qué, qué necesita atención, tu equipo y sus créditos.', seconds: 117, sections: ['administracion'], feature: 'admin' },
];

export const tutorialVideoFiles = (video: Pick<TutorialVideo, 'id'>) => ({
  mp4: `/tutorial-videos/${video.id}.mp4`,
  poster: `/tutorial-videos/${video.id}.jpg`,
  captions: `/tutorial-videos/${video.id}.vtt`,
});

/** «1:05». */
export function formatVideoLength(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** The videos the person can see: the same rules as the menu for «Oportunidades» and «Administración». */
export function visibleTutorialVideos(visibility: Pick<HelpVisibility, 'opportunities'> & Partial<Pick<HelpVisibility, 'admin'>>) {
  return TUTORIAL_VIDEOS.filter(video => (video.feature !== 'opportunities' || visibility.opportunities)
    && (video.feature !== 'admin' || visibility.admin === true));
}

/** The videos of a manual section, its own first. */
export function videosForSection(sectionId: string, videos: TutorialVideo[] = TUTORIAL_VIDEOS) {
  return videos
    .filter(video => video.sections.includes(sectionId))
    .sort((a, b) => Number(b.sections[0] === sectionId) - Number(a.sections[0] === sectionId));
}

/** The video of the screen on view: the one its route names, or the first of its manual section. */
export function videoForPath(pathname: string, sections: HelpSection[], videos: TutorialVideo[] = TUTORIAL_VIDEOS) {
  const byRoute = videos.find(video => video.routes?.test(pathname));
  if (byRoute) return byRoute;
  const section = helpSectionFor(pathname, sections);
  return section ? videosForSection(section.id, videos)[0] || null : null;
}
