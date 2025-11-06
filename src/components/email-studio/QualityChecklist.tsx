'use client';
import { Badge } from '@/components/ui/badge';

export function QualityChecklist({ subject, body }: { subject: string; body: string; }) {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  const hasCTA = /llamada|agenda|conver(?:s|z)ar|(?:10|15)\s*min/i.test(body);

  // Busca tokens sin resolver (p.ej. {{lead.name}}, {{job.title}}, {{report.pains.0}})
  const personalizationTokenRegex = /\{\{(?:lead\.|job\.|report\.)/;
  const hasPersonalization = personalizationTokenRegex.test(`${subject} ${body}`);

  const spamWords = /(gratis|urgente|oferta|gana dinero)/i.test(body);
  const okLen = words >= 60 && words <= 200;
  const okSubject = subject.length <= 120;

  const Item = ({ ok, text }: { ok: boolean; text: string }) => (
    <div className="flex items-center gap-2 text-sm">
      <Badge variant={ok ? 'default' : 'destructive'}>{ok ? 'OK' : 'Revisar'}</Badge>
      <span>{text}</span>
    </div>
  );

  return (
    <div className="space-y-2">
      <Item ok={okSubject} text={`Asunto ≤ 120 caracteres (${subject.length})`} />
      <Item ok={okLen} text={`Longitud recomendada 60–200 palabras (${words})`} />
      <Item ok={hasCTA} text={`CTA a breve llamada`} />
      <Item ok={hasPersonalization} text={`Personalización / tokens presentes`} />
      <Item ok={!spamWords} text={`Sin palabras gatillo de spam`} />
    </div>
  );
}
