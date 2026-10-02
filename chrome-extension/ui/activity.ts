/**
 * The person's latest posts in the panel (plan 8, phase 4, PR-4e): read from their open profile when a message is written, and
 * what the panel says about them. The post a message opens from travels with its sources, so a restored draft still shows it.
 */
export type ActivityPost = { text: string; when: string; kind: 'post' | 'repost' | 'comment' };
export type ActivityRead = { posts: ActivityPost[]; onProfile: boolean };
type Source = { kind?: string; activityKind?: ActivityPost['kind']; when?: string; text?: string; statement: string; url?: string };

const OPENS_FROM: Record<ActivityPost['kind'], string> = { post: 'su publicación', repost: 'lo que compartió', comment: 'su comentario' };

/** «Abre desde su publicación · 2 sem» and its words, when the message opens from one of the person's posts. */
export function activityOpened(sources: Source[]) {
  const source = sources.find(item => item.kind === 'activity' && item.text);
  if (!source) return null;
  return { label: `Abre desde ${OPENS_FROM[source.activityKind || 'post'] || OPENS_FROM.post}${source.when ? ` · ${source.when}` : ''}`, quote: source.text || '' };
}

/** One sentence on the posts: used, read but not used, none on the profile, or the profile is not the open tab. */
export function activityNote(read: ActivityRead, used: boolean) {
  if (used) return 'Abre desde su actividad reciente: revisa que la cita sea fiel.';
  if (!read.onProfile) return 'Abre su perfil en LinkedIn para usar sus publicaciones recientes.';
  return read.posts.length ? 'Sus publicaciones recientes no calzaban con tu objetivo.' : 'No vimos publicaciones recientes en su perfil.';
}
