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
  feature?: 'opportunities';
};

export const TUTORIAL_VIDEOS: TutorialVideo[] = [
  { id: 'hoy', title: 'Hoy', summary: 'Lo más urgente primero, lo que te espera y tu semana en cifras.', seconds: 39, sections: ['hoy', 'primeros-pasos'] },
  { id: 'perfil', title: 'Perfil', summary: 'Cuenta qué vendes: tu oferta y tu cliente ideal guían la búsqueda y los correos.', seconds: 48, sections: ['perfil'] },
  { id: 'buscar', title: 'Buscar prospectos', summary: 'De un punto de partida a las empresas, sus contactos y guardarlos.', seconds: 62, sections: ['buscar'] },
  { id: 'importar', title: 'Importar tu lista', summary: 'Sube tu Excel o CSV, revisa las columnas y los repetidos, e impórtala.', seconds: 42, sections: ['tabla', 'por-completar'] },
  { id: 'contactos', title: 'Por completar y Por escribir', summary: 'Busca sus correos, investiga a quienes eliges y escríbeles.', seconds: 61, sections: ['por-completar', 'por-escribir', 'correo'] },
  { id: 'firmas', title: 'Firmas y estilo', summary: 'Arma tu firma y crea estilos de correo que la IA usa al escribir.', seconds: 70, sections: ['firmas', 'correo'] },
  { id: 'campanas', title: 'Campañas', summary: 'Elige a quiénes, escribe el correo y los seguimientos, revisa y aprueba.', seconds: 115, sections: ['campanas'] },
  { id: 'conversaciones', title: 'Conversaciones', summary: 'Quién te respondió primero, el hilo completo y tu respuesta en el mismo hilo.', seconds: 53, sections: ['conversaciones'] },
  { id: 'pipeline', title: 'Pipeline', summary: 'El panel con tus cifras y etapas, y cómo mover un lead en el tablero.', seconds: 85, sections: ['pipeline'] },
  { id: 'oportunidades', title: 'Oportunidades', summary: 'Empresas que están contratando, licitaciones y cómo ajustar lo que buscamos.', seconds: 75, sections: ['oportunidades'], feature: 'opportunities' },
  { id: 'cowork', title: 'Cowork', summary: 'Pídele lo que necesitas con tus palabras y retoma tus trabajos guardados.', seconds: 50, sections: ['primeros-pasos'], routes: /^\/cowork(\/.*)?$/ },
  { id: 'conexiones', title: 'Conexiones', summary: 'Conecta tu correo, elige la cuenta que envía y consigue tu ticket de Mercado Público.', seconds: 61, sections: ['conexiones'] },
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

/** The videos the person can see: the same rule as the menu for «Oportunidades». */
export function visibleTutorialVideos(visibility: Pick<HelpVisibility, 'opportunities'>) {
  return TUTORIAL_VIDEOS.filter(video => video.feature !== 'opportunities' || visibility.opportunities);
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
