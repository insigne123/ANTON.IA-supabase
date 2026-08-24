'use client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { LeadResearchReport } from '@/lib/types';

export default function CrossReportDialog({
  open,
  onOpenChange,
  report,
  titlePrefix = 'Reporte',
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  report: LeadResearchReport | null;
  titlePrefix?: string;
}) {
  const cross = report?.cross;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl" onEscapeKeyDown={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>
            {titlePrefix} · {cross?.company?.name || '—'}
          </DialogTitle>
        </DialogHeader>

        {cross && (
          <div className="space-y-4 text-sm leading-relaxed max-h-[70vh] overflow-y-auto pr-4">
            <div className="text-lg font-semibold">{cross.company.name}</div>

            {cross.overview && <p>{cross.overview}</p>}

            {cross.pains?.length > 0 && (
              <section>
                <h4 className="text-xs font-semibold uppercase text-muted-foreground">Pains</h4>
                <ul className="list-disc pl-5">{cross.pains.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </section>
            )}

            {cross.opportunities?.length > 0 && (
              <section>
                <h4 className="text-xs font-semibold uppercase text-muted-foreground">Oportunidades</h4>
                <ul className="list-disc pl-5">{cross.opportunities.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </section>
            )}

            {cross.risks?.length > 0 && (
              <section>
                <h4 className="text-xs font-semibold uppercase text-muted-foreground">Riesgos</h4>
                <ul className="list-disc pl-5">{cross.risks.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </section>
            )}

            {cross.valueProps?.length > 0 && (
              <section>
                <h4 className="text-xs font-semibold uppercase text-muted-foreground">Cómo ayudamos</h4>
                <ul className="list-disc pl-5">{cross.valueProps.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </section>
            )}

            {cross.useCases?.length > 0 && (
              <section>
                <h4 className="text-xs font-semibold uppercase text-muted-foreground">Casos de uso</h4>
                <ul className="list-disc pl-5">{cross.useCases.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </section>
            )}

            {cross.talkTracks?.length > 0 && (
              <section>
                <h4 className="text-xs font-semibold uppercase text-muted-foreground">Talk tracks</h4>
                <ul className="list-disc pl-5">{cross.talkTracks.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </section>
            )}

            {cross.subjectLines?.length > 0 && (
              <section>
                <h4 className="text-xs font-semibold uppercase text-muted-foreground">Asuntos sugeridos</h4>
                <ul className="list-disc pl-5">{cross.subjectLines.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </section>
            )}

            {cross.emailDraft && (
              <section className="border rounded p-3 bg-muted/50">
                <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Borrador de correo</div>
                <div><strong>Asunto:</strong> {cross.emailDraft.subject}</div>
                <pre className="whitespace-pre-wrap mt-2 font-mono text-xs">{cross.emailDraft.body}</pre>
              </section>
            )}

            {cross.nextSteps?.length ? (
              <section>
                <h4 className="text-xs font-semibold uppercase text-muted-foreground">Siguientes pasos</h4>
                <ul className="space-y-2">
                  {cross.nextSteps.map((step, i) => (
                    <li key={i} className="rounded-md border bg-muted/40 p-3">
                      <div className="font-medium">{step.action}</div>
                      {step.why ? <div className="mt-1 text-xs text-muted-foreground">{step.why}</div> : null}
                      {step.priority ? <div className="mt-2 text-[11px] uppercase tracking-wide text-muted-foreground">Prioridad: {step.priority}</div> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {cross.sources?.length ? (
              <section>
                <h4 className="text-xs font-semibold uppercase text-muted-foreground">Fuentes</h4>
                <ul className="space-y-1">
                  {cross.sources.map((s, i) => (
                    <li key={i}>• <a className="underline" href={s.url} target="_blank">{s.title || s.url}</a></li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
