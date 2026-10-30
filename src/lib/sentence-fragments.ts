// Shared by the draft checks of the research path (human-tone-checks.ts) and of Cowork's writer (cowork/writer.ts).

// A verb, or what looks like one: a common short form or a conjugated ending, also the first and second person («cierro», «cargas»).
// Nouns with those endings («correo», «tiendas») only make a fragment pass unseen; the check is for the sentence with none at all.
// A clitic before a word is a verb too («Si se alarga, se posterga…»): the third person in -a/-e is left out because nouns end the same way.
const VERB_HINT = /(?<![\p{L}])(?:es|son|era|fue|fueron|está|están|estaba|hay|había|habrá|tiene|tienen|tenemos|tengo|hace|hacen|hacemos|hago|puede|pueden|podemos|puedo|vi|veo|vimos|sé|sabe|creo|cree|ayuda|ayudan|ayudamos|permite|permiten|ofrece|ofrecen|ofrecemos|trabajo|trabajan|trabajamos|cubre|cubren|cubrimos|pone|ponen|ponemos|va|van|vamos|voy|viene|vienen|queda|quedan|sirve|sirven|parece|acomoda|necesita|necesitan|llega|llegan|abre|abren|busca|buscan|cuesta|toma|toman|deja|dejan|da|dan|damos|doy|sale|salen|entra|entran|soy|estoy|escribo|cuento|comento|comparto|propongo|ofrezco|pregunto|llamo)(?![\p{L}])|\p{L}{2,}(?:amos|emos|imos|aron|ieron|aba|aban|ía|ían|ará|erá|irá|arán|erán|irán|ando|iendo|ado|ados|ada|adas|ido|idos|ida|idas|ar|er|ir)(?![\p{L}])|\p{L}{3,}(?:as|es|o)(?![\p{L}])|\p{L}{4,}(?:an|[^\Wmg]en)(?![\p{L}])|(?<![\p{L}])(?:se|me|nos)\s+\p{L}{2,}(?![\p{L}])/iu;
// A clause that opens like the first half of a sentence: «Para selección…», «Con la temporada…», «Cuando entran…».
const DEPENDENT_START = /^[¿¡]?(?:para|en|con|por|sobre|desde|hacia|y|pero|que|como|cuando|si|aunque|mientras)(?![\p{L}])/iu;

/** A sentence that opens like the first half of one and has no verb («Para selección en servicios transitorios.»): the
 * writer dropped what it meant to say. A short sentence without a verb of another kind («Un solo proveedor para todo.») is style. */
export function sentenceFragments(body: string) {
  const lines = String(body || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const content = lines.length > 1 && /^(?:hola|estimad[oa]s?|buen[oa]s)\b/i.test(lines[0]) ? lines.slice(1) : lines;
  return content.join(' ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => {
      const words = sentence.match(/[\p{L}\p{N}]+/gu) || [];
      return words.length >= 2 && words.length <= 10 && DEPENDENT_START.test(sentence) && !VERB_HINT.test(sentence);
    });
}
