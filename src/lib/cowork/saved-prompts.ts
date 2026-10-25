import type { CoworkStarter } from './starters';

/**
 * «Pedidos guardados» (COW-06): the requests that worked, kept by the person and offered again with «/», and the ones a teammate
 * shared. The rules both sides share live here; the server keeps them in cowork_prompts.
 */
export type CoworkSavedPrompt = { id: string; title: string; prompt: string; shared: boolean; mine: boolean; canDelete: boolean };

/** A template of the «/» list; a saved request says whose it is. */
export type CoworkTemplateItem = CoworkStarter & { note?: string };

/** At most this many of one's own: a library, not a history. */
export const COWORK_PROMPTS_PER_PERSON = 30;

/** The name in the list when none was given: the first words of the request, up to 60 characters. */
export function coworkPromptTitle(prompt: string, title?: string) {
  const given = (title || '').replace(/\s+/g, ' ').trim();
  if (given) return given.slice(0, 80).trimEnd();
  const words = prompt.replace(/\s+/g, ' ').trim();
  if (words.length <= 60) return words;
  const cut = words.slice(0, 60);
  const space = cut.lastIndexOf(' ');
  return `${(space > 30 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const plain = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The saved requests «/» offers before the fixed templates, narrowed by what follows the slash (name or text, without accents). */
export function coworkSavedTemplates(prompts: CoworkSavedPrompt[], query: string): CoworkTemplateItem[] {
  const asked = plain(query.trim());
  return prompts
    .filter(saved => !asked || plain(`${saved.title} ${saved.prompt}`).includes(asked))
    .map(saved => ({ id: `guardado-${saved.id}`, icon: 'bookmark', title: saved.title, prompt: saved.prompt, note: saved.mine ? 'Guardado' : 'De tu equipo' }));
}
