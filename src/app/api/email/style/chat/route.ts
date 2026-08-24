import { NextResponse } from 'next/server';
import { qualityChecks } from '@/lib/email-quality';
import type { ChatMessage, StyleProfile } from '@/lib/types';
import { defaultStyle } from '@/lib/style-profiles-storage';
import { updateStyleProfile } from '@/ai/flows/update-style-profile';
import { requestAuthErrorResponse, requireSessionRequestAuth } from '@/lib/server/request-auth';
import { getTemplateById } from '@/lib/email-studio/storage';
import { buildTemplateContext, renderTemplateString } from '@/lib/email-studio/template-engine';

// Render: llama a tu endpoint existente de render (servidor a servidor)
function renderEmail(style: StyleProfile, mode: 'leads' | 'opportunities', sampleData: any) {
  const templateId = mode === 'opportunities' ? 'seed-opps-1' : 'seed-leads-1';
  const template = getTemplateById(templateId);
  if (template) {
    const context = buildTemplateContext(sampleData);
    return {
      subject: renderTemplateString(template.subject, context).text,
      body: renderTemplateString(template.body, context).text,
    };
  }

  const subj = `[${style.tone}] {{company.name}} · ${style.cta?.label || 'Conversación breve'}`;
  const body =
    `Hola {{lead.firstName}},

Soy de Innovatech. Vi {{company.name}} y creo que podemos aportar valor con X.
¿${style.cta?.duration || '15'} min esta semana?

Saludos,
—`;
  return { subject: subj, body };
}

/**
 * Carga un ejemplo para vista previa.
 * Si quieres, trae de enrichedLeadsStorage/opportunities. Aquí aceptamos sampleData directo.
 */
function loadSampleFromClient(data: any) {
  return data || {
    companyProfile: {},
    report: {},
    lead: { name: 'María', title: 'Directora de Marketing' },
    job: undefined,
  };
}

export async function POST(req: Request) {
  try {
    await requireSessionRequestAuth();
    const { messages, styleProfile, mode = 'leads', sampleData } = await req.json();

    const base: StyleProfile = styleProfile || { ...defaultStyle, scope: mode };
    const lastMessage = (messages as ChatMessage[]).slice().reverse().find(m => m.role === 'user')?.content || '';

    // (1) Actualizar estilo con IA Real (Genkit + Gemini)
    let updated = { ...base };
    let explanation = '';

    if (lastMessage) {
      const aiResult = await updateStyleProfile({
        currentStyle: base,
        userInstruction: lastMessage,
        sampleLead: sampleData
      });
      // Mezclamos el resultado de la IA con el estilo base
      updated = {
        ...base,
        ...aiResult.updatedStyle,
        updatedAt: new Date().toISOString()
      };
      explanation = aiResult.explanation;
    }

    // (2) Render seguro
    const sample = loadSampleFromClient(sampleData);
    const preview = renderEmail(updated, mode, sample);

    // (3) Calidad
    const qc = qualityChecks(preview.subject, preview.body, updated);

    return NextResponse.json({
      styleProfile: updated,
      // Si la IA dio una explicación, la devolvemos como mensaje del asistente
      explanation,
      preview,
      warnings: qc.warnings,
    });
  } catch (e: any) {
    const authResponse = requestAuthErrorResponse(e);
    if (authResponse) return authResponse;
    console.error('Error in chat style API:', e);
    return NextResponse.json({ error: e?.message || 'Unexpected error' }, { status: 500 });
  }
}
