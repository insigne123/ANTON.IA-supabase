
// Endpoint opcional para envío masivo con mail-merge.
// Requiere integrar tu auth MSAL y quota contact (TODO: wire con tu sistema).
import { NextRequest, NextResponse } from 'next/server';
import { renderEmailForLead } from '@/lib/mail-merge';
// TODO: ajusta imports reales:
import { sendEmail } from '@/lib/outlook-email-service'; // debe aceptar {to, subject, html?, text?}
import { findEnrichedLeadById } from '@/lib/saved-enriched-leads-storage'; // TODO: función real para obtener lead+company
import { getCompanyProfile } from '@/lib/data'; // TODO: función real
// import { rateLimitOrQuota } from '@/lib/quotas'; // TODO
// import { contactedLeadsStorage } from '@/lib/contacted-leads-storage'; // si expone API usable server-side

async function getLeadById(id: string) {
  return findEnrichedLeadById(id)
}

async function getCurrentUserSignature() {
  const profile = getCompanyProfile();
  return {
    name: profile.name,
    title: profile.role,
    company: profile.companyName,
  }
}

export async function POST(req: NextRequest) {
  try {
    const { leadIds, draft } = await req.json();
    if (!Array.isArray(leadIds) || !leadIds.length) {
      return NextResponse.json({ error: 'leadIds vacío' }, { status: 400 });
    }
    if (!draft?.subject || (!draft?.bodyHtml && !draft?.bodyText)) {
      return NextResponse.json({ error: 'draft inválido' }, { status: 400 });
    }

    // Quota global por lote (opcional) + por mensaje
    // TODO: implementar rateLimitOrQuota real
    // await rateLimitOrQuota('contact', leadIds.length);

    const signature = await getCurrentUserSignature(); // {name, title, phone, company}
    const results: Array<{ leadId: string; ok: boolean; error?: string; messageId?: string; conversationId?: string }> = [];

    for (const leadId of leadIds) {
      try {
        // Datos del lead para contexto:
        const lead = await getLeadById(leadId); // {firstName, lastName, email, company:{name, domain}, ...}
        if (!lead?.email) {
          results.push({ leadId, ok: false, error: 'Lead sin email' });
          continue;
        }

        const ctx = {
          lead: {
            id: leadId,
            firstName: lead.fullName?.split(' ')[0] ?? null,
            lastName: lead.fullName?.split(' ').slice(1).join(' ') ?? null,
            fullName: lead.fullName ?? null,
            title: lead.title ?? null,
            email: lead.email ?? null,
          },
          company: {
            name: lead.companyName ?? null,
            domain: lead.companyDomain ?? null,
          },
          user: { signature },
          extra: draft?.vars ?? {}, // variables adicionales que envíes desde UI/IA
        };

        const rendered = renderEmailForLead(
          {
            subject: draft.subject,
            bodyHtml: draft.bodyHtml,
            bodyText: draft.bodyText,
          },
          ctx
        );

        // Enviar por Outlook (token del usuario via cookie/session en tu servicio)
        const resp = await sendEmail({
          to: lead.email,
          subject: rendered.subject,
          htmlBody: rendered.bodyHtml || '',
        });

        // Guardar registro contactado (ajusta a tu API real)
        // contactedLeadsStorage probablemente sea client-side; aquí ilustro server-side:
        // TODO: reemplázalo por tu persistencia real (DB/endpoint).
        // await saveContacted({ leadId, messageId: resp.messageId, conversationId: resp.conversationId });

        results.push({
          leadId,
          ok: true,
          messageId: resp?.messageId,
          conversationId: resp?.conversationId,
        });
      } catch (e: any) {
        results.push({ leadId, ok: false, error: e?.message || 'Error desconocido' });
      }
    }

    return NextResponse.json({ results });
  } catch (e: any) {
    console.error('[bulk-send] error', e);
    return NextResponse.json({ error: e?.message || 'Error' }, { status: 500 });
  }
}
