// src/lib/email-personalizer.ts
// Asegura tono centrado en el LEAD (no en la empresa).
export function ensureLeadTone(input: {
  subject: string;
  body: string;
  leadFirstName: string;
  companyName?: string | null;
}) {
  const first = (input.leadFirstName || '').trim();
  const company = (input.companyName || '').trim();
  let subject = input.subject || '';
  let body = input.body || '';

  const normSubj = subject.trim();
  const startsWithName = first && new RegExp(`^${escapeReg(first)}\\b`, 'i').test(normSubj);
  if (first && !startsWithName) {
    subject = `${first}, ${normSubj || 'tengo una idea para ti'}`;
  }

  if (first) {
    const patrones = [
      /^(estimad[oa]s?\s+equipo\s+de\s+)(.+?)(,|\.)/i,
      /^(estimad[oa]s?\s+)(.+?)(,|\.)/i,
      company ? new RegExp(`^(estimad[oa]s?\\s+${escapeReg(company)})(,|\\.)`, 'i') : null,
      company ? new RegExp(`^(al\\s+equipo\\s+de\\s+${escapeReg(company)})(,|\\.)`, 'i') : null,
    ].filter(Boolean) as RegExp[];

    const lines = body.split(/\r?\n/);
    if (lines.length) {
      const l0 = lines[0].trim();
      const idx = patrones.findIndex((re) => re.test(l0));
      if (idx >= 0) {
        lines[0] = `Hola ${first},`;
        body = lines.join('\n');
      }
    }
  }

  return { subject: subject.trim(), body };
}

function escapeReg(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
