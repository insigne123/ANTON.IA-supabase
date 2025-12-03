import { NextRequest, NextResponse } from 'next/server';
import { getTemplateById } from '@/lib/email-studio/storage';
import { buildTemplateContext, renderTemplateString } from '@/lib/email-studio/template-engine';
import type { RenderRequest, RenderResult } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as RenderRequest;

    const tpl = getTemplateById(body.templateId);
    if (!tpl) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

    const aiIntensity = body.aiIntensity ?? tpl.aiIntensity;
    const tone = body.tone ?? tpl.tone;
    const length = body.length ?? tpl.length;

    const ctx = buildTemplateContext(body.data);
    const subj = renderTemplateString(tpl.subject, ctx);
    const bod = renderTemplateString(tpl.body, ctx);

    let result: RenderResult = { subject: subj.text, body: bod.text, warnings: [...subj.warnings, ...bod.warnings] };

    if (aiIntensity !== 'none') {
      const { renderEmailTemplate } = await import('@/ai/flows/render-email-template');
      const out = await renderEmailTemplate({
        mode: body.mode,
        aiIntensity,
        tone,
        length,
        baseSubject: result.subject,
        baseBody: result.body,
        data: body.data,
      });
      result = { subject: out.subject || result.subject, body: out.body || result.body, warnings: result.warnings };
    }

    // validaciones rápidas
    const warns: string[] = [];
    if (result.subject.length > 120) warns.push('Asunto demasiado largo (>120)');
    const wordCount = result.body.trim().split(/\s+/).length;
    if (wordCount < 60 || wordCount > 200) warns.push('Longitud fuera de rango recomendado (60–200 palabras)');
    // Tokens sin resolver (evitar enviar con [Nombre] o {{lead.firstName}})
    const unresolved = /(\{\{[^}]+}}|\[[^\]]+]|{[^}]+})/.test(result.subject) || /(\{\{[^}]+}}|\[[^\]]+]|{[^}]+})/.test(result.body);
    if (unresolved) warns.push('Se detectaron variables sin resolver en el asunto o el cuerpo.');
    result.warnings = [...(result.warnings || []), ...warns];

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Render error' }, { status: 500 });
  }
}
