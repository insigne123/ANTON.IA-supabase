import { renderCampaignMessage, type AudiencePerson, type CampaignInput, type CampaignMessage } from '@/lib/bulk-campaigns';
import { displayLeadName, firstNameOf } from '@/lib/lead-name';

/**
 * A Cowork campaign, person by person (Plan 5, PR-6): the first email each recipient gets, written for them or the
 * template with their data, and why it cannot be built when a datum is missing. Pure: the staging of the proposal,
 * the preview route and their tests share it (docs/cowork-campanas-personalizadas.md).
 */

/** The email a recipient gets at a step: the one written for them when there is one, else the template. */
export function coworkCampaignMessageFor(definition: CampaignInput, email: string, index: number): CampaignMessage {
  const template = definition.messages[index];
  const own = definition.overrides.find(item => item.email === email && item.messageIndex === index);
  return own ? { ...template, subject: own.subject, body: own.body } : template;
}

const MISSING = /^Falta (nombre|empresa|cargo) para /;
const DATUM: Record<string, string> = { nombre: 'su nombre de pila', empresa: 'su empresa', cargo: 'su cargo' };

/** The first email of one person that cannot be built, with the variable that is missing (if that is why). */
function firstFailure(definition: CampaignInput, person: AudiencePerson): { index: number; variable: string | null; reason: string } | null {
  for (let index = 0; index < definition.messages.length; index++) {
    try {
      renderCampaignMessage(coworkCampaignMessageFor(definition, person.email, index), person);
    } catch (error) {
      const reason = error instanceof Error ? error.message : '';
      return { index, variable: MISSING.exec(reason)?.[1] ?? null, reason };
    }
  }
  return null;
}

const which = (index: number) => index === 0 ? 'su primer correo' : `el correo ${index + 1}`;
const fold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Whether the greeting (the first line) carries the person's first name. */
function greetsByName(body: string, name: string): boolean {
  const first = firstNameOf(name);
  if (!first) return false;
  const line = fold(body.trim().split('\n')[0] || '');
  return line.split(/[^\p{L}\p{N}]+/u).includes(fold(first));
}

export type CoworkCampaignPerson = {
  email: string;
  /** As a screen shows it: «Rafael D.» while the surname is hidden. */
  name: string;
  company: string;
  title: string;
  /** Still a recipient of this audience: saved, with this email and nothing that blocks writing to them. */
  available: boolean;
  /** Their first email was written for them; otherwise it is the template with their data. */
  personal: boolean;
  /** Their first email as they will receive it; null when it cannot be built. */
  first: { subject: string; body: string } | null;
  /** The first line of that email names them (every email greets by the first name); null without an email. */
  greetsByName: boolean | null;
  /** Why their emails cannot be built or sent, in a sentence for the person; null when they can. */
  problem: string | null;
};

/** Each recipient, in the campaign's order, with the first email they will receive. */
export function coworkCampaignPeople(definition: CampaignInput, audience: AudiencePerson[]): CoworkCampaignPerson[] {
  const byEmail = new Map(audience.map(person => [person.email.toLowerCase(), person]));
  return definition.emails.map((email): CoworkCampaignPerson => {
    const personal = definition.overrides.some(item => item.email === email && item.messageIndex === 0);
    const person = byEmail.get(email.toLowerCase());
    if (!person) {
      return { email, name: '', company: '', title: '', available: false, personal, first: null, greetsByName: null,
        problem: 'Ya no está en tus contactos con este correo, o dejó de calzar con la audiencia.' };
    }
    const base = { email, name: displayLeadName(person.name).text, company: person.company, title: person.title, available: !person.blockedReason, personal };
    const failure = firstFailure(definition, person);
    if (failure) {
      return { ...base, first: null, greetsByName: null, problem: failure.variable
        ? `Falta ${DATUM[failure.variable]} para ${which(failure.index)}: complétalo en Contactos o quítalo de la campaña.`
        : `No se puede armar ${which(failure.index)}: ${failure.reason || 'revisa el texto'}` };
    }
    const first = renderCampaignMessage(coworkCampaignMessageFor(definition, email, 0), person);
    return { ...base, first: { subject: first.subject, body: first.body }, greetsByName: greetsByName(first.body, person.name),
      problem: person.blockedReason ? 'Ya no se le puede escribir: pidió no recibir correos o su correo rebotó.' : null };
  });
}

/**
 * Before the card exists: the first recipient whose emails cannot be built, in words for the model, or null. Every
 * email greets by the first name, so someone without one leaves the campaign instead of losing the greeting.
 */
export function coworkCampaignRenderProblem(definition: CampaignInput, audience: AudiencePerson[]): string | null {
  const byEmail = new Map(audience.map(person => [person.email.toLowerCase(), person]));
  for (const email of definition.emails) {
    const person = byEmail.get(email.toLowerCase());
    if (!person) continue; // Availability is checked, and said, on its own.
    const failure = firstFailure(definition, person);
    if (!failure) continue;
    if (failure.variable === 'nombre') {
      return `${email} no tiene un nombre de pila guardado y cada correo saluda por el nombre: sácalo de esta campaña y dile al usuario que complete su nombre en Contactos para sumarlo después.`;
    }
    if (failure.variable) return `A ${email} le falta ${DATUM[failure.variable]} para ${which(failure.index)}: sácalo de la campaña o no uses {{${failure.variable}}}.`;
    return `No se puede armar ${which(failure.index)} de ${email}: ${failure.reason || 'revisa el texto'}`;
  }
  return null;
}
