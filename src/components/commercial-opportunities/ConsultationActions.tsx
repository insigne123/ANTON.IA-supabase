'use client';
import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { asksInForum, buyerQuestions, consultationDraft, consultationEmail } from '@/lib/commercial-opportunities/report-view';
import type { OpportunityReport } from '@/lib/commercial-opportunities/expedient';
import { composeUrl } from '@/lib/mail-compose';
import { MAIL_PROVIDER_LABEL, isMailProvider, type MailProvider } from '@/lib/mail-sender';

type Opportunity = { kind?: string; url?: string | null; title: string; buyer?: string | null };

/**
 * What to do with the questions for the buyer (OPP-22). In a public tender they are asked in its forum in Mercado Público: they are
 * copied numbered, to paste them there, and the tender opens. Anywhere else they go by e-mail: it opens already written in the person's
 * Gmail or Outlook (the one connected to ANTON.IA) or in the computer's mail program; «Copiar» stays for the rest.
 */
export function ConsultationActions({ report, opportunity }: { report: Pick<OpportunityReport, 'questions' | 'title' | 'milestones'> & { submission?: OpportunityReport['submission'] }; opportunity: Opportunity }) {
  const forum = asksInForum(opportunity.kind);
  const [provider, setProvider] = useState<MailProvider | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (forum) return;
    let alive = true;
    fetch('/api/integrations/default-sender', { cache: 'no-store' }).then(response => (response.ok ? response.json() : null)).then((value: { resolved?: unknown; connected?: Partial<Record<MailProvider, boolean>> } | null) => {
      // The mailbox that sends; with two connected and none chosen, Gmail.
      if (alive && value) setProvider(isMailProvider(value.resolved) ? value.resolved : value.connected?.google ? 'google' : value.connected?.outlook ? 'outlook' : null);
    }).catch(() => null);
    return () => { alive = false; };
  }, [forum]);
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { window.prompt('Copia las preguntas', text); }
  };
  const copyIcon = copied ? <Check className="mr-2 h-4 w-4" aria-hidden="true" /> : <Copy className="mr-2 h-4 w-4" aria-hidden="true" />;
  if (forum) return <div className="flex flex-wrap items-center gap-2">
    <Button variant="outline" size="sm" onClick={() => void copy(buyerQuestions(report).map((question, index) => `${index + 1}. ${question}`).join('\n'))}>{copyIcon}{copied ? 'Preguntas copiadas' : 'Copiar para el foro'}</Button>
    {opportunity.url ? <Button asChild variant="ghost" size="sm"><a href={opportunity.url} target="_blank" rel="noopener noreferrer">Abrir en Mercado Público<ExternalLink className="ml-2 h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only"> (se abre en otra pestaña)</span></a></Button> : null}
  </div>;
  const href = composeUrl(provider, consultationDraft(report, opportunity));
  return <div className="flex flex-wrap items-center gap-2">
    {href ? <Button asChild variant="outline" size="sm"><a href={href} {...(href.startsWith('mailto:') ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>
      <Mail className="mr-2 h-4 w-4" aria-hidden="true" />{provider ? `Abrir en ${MAIL_PROVIDER_LABEL[provider]}` : 'Abrir en mi correo'}</a></Button> : null}
    <Button variant={href ? 'ghost' : 'outline'} size="sm" onClick={() => void copy(consultationEmail(report, opportunity))}>{copyIcon}{copied ? 'Correo copiado' : href ? 'Copiar' : 'Copiar como correo de consultas'}</Button>
  </div>;
}
