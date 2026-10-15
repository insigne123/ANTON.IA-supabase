// The same person saved twice was the same person twice in «Por escribir»: a contact without an email was keyed by the id it
// came with (a search id), which never matches the id it is stored under. Any of these keys now identifies a person.
type ContactLike = { email?: string | null; linkedinUrl?: string | null; fullName?: string | null; companyName?: string | null; companyDomain?: string | null };

const clean = (value?: string | null) => String(value || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** «https://www.LinkedIn.com/in/luis-durand-1/?x=1» → «linkedin.com/in/luis-durand-1». */
export function linkedinKey(url?: string | null) {
  const value = clean(url).replace(/^https?:\/\//, '').replace(/^([a-z]{2,3}\.)?www\./, '').replace(/^[a-z]{2}\.linkedin\.com/, 'linkedin.com')
    .split(/[?#]/)[0].replace(/\/+$/, '');
  return /^linkedin\.com\/in\/[^/]+$/.test(value) ? value : null;
}

/** Every key that identifies this person: their email, their LinkedIn profile, and their name at their company. */
export function contactKeys(contact: ContactLike) {
  const email = clean(contact.email);
  const name = clean(contact.fullName).replace(/\s+/g, ' ');
  const company = clean(contact.companyDomain || contact.companyName).replace(/^www\./, '');
  return [
    email.includes('@') ? `email:${email}` : null,
    linkedinKey(contact.linkedinUrl) ? `in:${linkedinKey(contact.linkedinUrl)}` : null,
    name && company ? `person:${name}|${company}` : null,
  ].filter((key): key is string => Boolean(key));
}

/** Who among `incoming` is not already in `existing` (or earlier in `incoming`). */
export function newContacts<T extends ContactLike>(existing: ContactLike[], incoming: T[]) {
  const seen = new Set(existing.flatMap(contactKeys));
  const fresh: T[] = []; const repeated: T[] = [];
  for (const contact of incoming) {
    const keys = contactKeys(contact);
    if (keys.some(key => seen.has(key))) { repeated.push(contact); continue; }
    keys.forEach(key => seen.add(key));
    fresh.push(contact);
  }
  return { fresh, repeated };
}
