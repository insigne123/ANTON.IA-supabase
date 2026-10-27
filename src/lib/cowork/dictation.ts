/**
 * Dictation in the composer (COW-13): the browser turns the person's voice into text (Web Speech API), and these pure pieces
 * decide what the box says while it hears. Nothing is recorded or sent by ANTON.IA; without the API the microphone is not offered.
 */

/** The person's own Spanish when the browser has one with a region, Chilean Spanish otherwise. */
export function dictationLanguage(languages: readonly string[] | null | undefined) {
  const spanish = (languages || []).find(tag => /^es-[a-z]{2,3}$/i.test(String(tag || '')));
  return spanish || 'es-CL';
}

/** Final pieces joined once: Chrome on Android repeats what it already heard at the start of each new piece. */
export function joinDictated(pieces: readonly string[]) {
  let text = '';
  for (const raw of pieces) {
    const piece = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!piece) continue;
    if (text && piece.toLowerCase().startsWith(text.toLowerCase())) text = piece;
    else text = text ? `${text} ${piece}` : piece;
  }
  return text;
}

const capitalized = (text: string) => text.charAt(0).toLocaleUpperCase('es-CL') + text.slice(1);

/** The box while dictating: what was written before, then what was heard, with a capital where a sentence starts. */
export function dictatedValue(before: string, heard: string) {
  const said = heard.trim().replace(/\s+/g, ' ');
  if (!said) return before;
  if (!before.trim()) return capitalized(said);
  const gap = /\s$/.test(before) ? '' : ' ';
  return `${before}${gap}${/[.!?¡¿:]\s*$/.test(before) ? capitalized(said) : said}`;
}

/** What to tell the person when the browser stops hearing; nothing when they stopped it. */
export function dictationProblem(code: string | null | undefined) {
  switch (code) {
    case 'aborted': return null;
    case 'not-allowed':
    case 'service-not-allowed': return 'Para dictar, permite que el navegador use el micrófono.';
    case 'audio-capture': return 'No encontramos un micrófono en este dispositivo.';
    case 'network': return 'El dictado necesita conexión a internet. Inténtalo de nuevo.';
    case 'no-speech': return 'No te escuchamos. Pulsa el micrófono y vuelve a intentarlo.';
    case 'language-not-supported': return 'Este navegador no dicta en español.';
    default: return 'No pudimos dictar. Inténtalo de nuevo.';
  }
}
