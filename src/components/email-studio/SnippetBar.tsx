
'use client';
import { Button } from '@/components/ui/button';

type SnippetBarProps = {
  onInsert: (text: string) => void;
  scope: 'leads'|'opportunities';
};

export function SnippetBar({ onInsert, scope }: SnippetBarProps) {
  const SNIPPETS = [
    {
      label: 'Pain bullet',
      text: `{{#if report.pains}}Vemos como prioridad: {{report.pains.0}}.{{/if}}`,
    },
    {
      label: 'Caso de uso',
      text: `{{#if report.useCases}}Un caso de uso relevante: {{report.useCases.0}}.{{/if}}`,
    },
    {
      label: 'CTA breve',
      text: `¿Te parece una llamada de 15 min esta semana para explorar opciones?`,
    },
    ...(scope === 'opportunities' ? [{
      label: 'Vacante + aporte',
      text: `Vimos la vacante {{job.title}}. Podemos aportar con {{report.valueProps.0}}.`,
    }] : []),
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {SNIPPETS.map(s => (
        <Button key={s.label} size="sm" variant="secondary" onClick={() => onInsert(s.text)}>
          {s.label}
        </Button>
      ))}
    </div>
  );
}
