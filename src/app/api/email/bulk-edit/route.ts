// src/app/api/email/bulk-edit/route.ts
import { NextResponse } from 'next/server';
import { renderTemplate } from '@/lib/template';
import { buildSenderInfo, applySignaturePlaceholders } from '@/lib/signature-placeholders';
import { ensureSubjectPrefix } from '@/lib/outreach-templates';

type Lead = {
  id?: string; fullName?: string; email?: string; title?: string;
  companyName?: string; companyDomain?: string; linkedinUrl?: string;
};
type Draft = { subject: string; body: string; lead: Lead };

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function insertBeforeSignature(body: string, insertion: string): string {
  const markers = [/^\s*—/m, /^\s*Saludos/m, /^\s*Best/m, /^\s*Atte/m];
  for (const rx of markers) {
    const m = body.match(rx);
    if (m && m.index !== undefined) {
      return body.slice(0, m.index) + insertion + '\n' + body.slice(m.index);
    }
  }
  return body.trimEnd() + '\n\n' + insertion;
}

export async function POST(req: Request) {
  try {
    const { instruction, drafts } = await req.json() as { instruction: string; drafts: Draft[] };
    if (!instruction || !Array.isArray(drafts)) {
      return NextResponse.json({ error: 'instruction y drafts requeridos' }, { status: 400 });
    }
    const sender = buildSenderInfo();

    const edited = drafts.map(({ subject, body, lead }) => {
      const firstName = (lead.fullName || '').split(' ')[0] || '';
      const ctx = {
        lead: {
          firstName, name: lead.fullName || '', email: lead.email || '',
          title: lead.title || '', company: lead.companyName || '',
        },
        company: { name: lead.companyName || '', domain: lead.companyDomain || '' },
        sender,
      };
      const quoted = instruction.match(/["“”](.+?)["“”]/)?.[1];
      const rawLine = quoted
        ? quoted
        : instruction
            .replace(/^agrega(r)?/i, '')
            .replace(/^añade(r)?/i, '')
            .replace(/^inserta(r)?/i, '')
            .trim() || 'Hemos colaborado con empresas del sector.';
      let line = renderTemplate(rawLine, ctx);
      if (line && line[0] === line[0].toLowerCase()) line = line[0].toUpperCase() + line.slice(1);
      const insertion = `${line.endsWith('.') ? line : line + '.'}`;

      let newBody = insertBeforeSignature(body, insertion);
      newBody = applySignaturePlaceholders(newBody, sender);

      let newSubject = subject;
      if (/asunto/i.test(instruction)) {
        const subjectQuoted = instruction.match(/asunto.*?["“”](.+?)["“”]/i)?.[1];
        if (subjectQuoted) newSubject = `${subjectQuoted} ${subject}`.trim();
        else newSubject = `[Nota] ${subject}`;
        newSubject = ensureSubjectPrefix(newSubject, firstName);
      }
      return { subject: newSubject, body: newBody };
    });

    return NextResponse.json({ drafts: edited });
  } catch (e:any) {
    return NextResponse.json({ error: e?.message || 'Unexpected error' }, { status: 500 });
  }
}
