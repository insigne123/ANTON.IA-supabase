/** Only inspect the new reply, never the quoted campaign footer. */
export function newReplyText(raw: string): string {
  return String(raw || '')
    .replace(/<(?:blockquote)\b[\s\S]*$/i, '')
    .replace(/<(?:div|section)\b[^>]*(?:gmail_quote|yahoo_quoted|divRplyFwdMsg)[\s\S]*$/i, '')
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .split(/\n\s*(?:On .+wrote:|El .+escrib(?:iste|i[oó]):|De:\s|From:\s|[-_]{2,}\s*(?:Original Message|Mensaje original)|>)/i)[0]
    .split(/\n\s*-{2,}\s*\n/)[0]
    .trim();
}

export function isExplicitOptOut(raw: string): boolean {
  const text = newReplyText(raw).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  // Instructions in our own footer and negated requests are not an opt-out.
  if (/\bno (?:quiero|deseo) (?:darme de baja|cancelar)|\bdo not unsubscribe me\b/.test(text)) return false;
  const actionableText = text.replace(/\bno (?:quiero|deseo) darme de baja\b/g, '');
  return /\b(?:darme de baja|denme de baja|dame de baja|quiero la baja|solicito (?:la )?baja|remove me|unsubscribe me|do not contact|don't contact|stop emailing|stop sending|no me (?:contacten|contactes|escriban|escribas|manden|mandes|envien|envies)|no (?:quiero|deseo) recibir mas|no quiero que me (?:contacten|escriban|manden|envien) mas|no mas (?:correos|emails|mails)|dejen de (?:escribirme|contactarme|mandarme|enviarme)|elimin(?:a|en|eme|enme) de (?:su|la|tu) lista|sac(?:a|ame|arme|quenme) de (?:su|la|tu) lista)\b/.test(actionableText)
    || /^(?:baja|unsubscribe|stop)[.!\s]*$/.test(actionableText);
}
