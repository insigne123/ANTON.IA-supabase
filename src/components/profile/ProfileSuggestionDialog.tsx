'use client';

import { Check, ExternalLink, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { INFERRED_FIELDS, type AutofillSuggestion } from '@/lib/profile/autofill-suggestion';
import type { ProfileFormValues, ProfileSuggestionField, ProfileSuggestionSelection } from '@/lib/profile/profile-mappings';

export const PROFILE_FIELD_LABELS: Record<ProfileSuggestionField, string> = {
  companyName: 'Nombre de la empresa',
  sector: 'Sector',
  website: 'Sitio web',
  description: 'Descripción de la empresa',
  services: 'Productos y servicios',
  valueProposition: 'Propuesta de valor',
  painPoints: 'Problemas que resuelves',
  differentiators: 'Por qué elegirte',
  proofPoints: 'Pruebas y resultados',
  referenceClients: 'Clientes que puedes nombrar',
  targetRoles: 'Cargos que buscas',
  targetIndustries: 'Industrias de tus clientes',
  targetCompanySize: 'Tamaño de empresa',
  targetLocations: 'Países o regiones',
};

const GROUPS: Array<{ title: string; fields: ProfileSuggestionField[] }> = [
  { title: 'Empresa', fields: ['companyName', 'website', 'sector', 'description'] },
  { title: 'Oferta', fields: ['services', 'valueProposition', 'painPoints', 'differentiators', 'proofPoints', 'referenceClients'] },
  { title: 'Tu cliente ideal', fields: ['targetRoles', 'targetIndustries', 'targetCompanySize', 'targetLocations'] },
];

function shortUrl(url: string) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/$/, '');
    return `${parsed.hostname.replace(/^www\./, '')}${path.length > 32 ? `${path.slice(0, 30)}…` : path}`;
  } catch {
    return url;
  }
}

function ValuePreview({ field, value }: { field: ProfileSuggestionField; value: string }) {
  const lines = value.split('\n').filter(Boolean);
  if (lines.length > 1) {
    return (
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm leading-5 text-muted-foreground">
        {lines.map((line) => <li key={line}>{line}</li>)}
      </ul>
    );
  }
  return <span className="mt-1 block whitespace-pre-wrap text-sm leading-5 text-muted-foreground">{field === 'targetCompanySize' ? `${value.replace('+', ' o más')} personas` : value}</span>;
}

/** Each proposed field with where it came from: a page of the site, or a suggestion inferred from the offer. Empty fields are
 * checked; fields with content are replaced only if the person checks them. Nothing is saved until «Guardar cambios». */
export function ProfileSuggestionDialog({ suggestion, selection, profile, onSelectionChange, onApply, onClose }: {
  suggestion: AutofillSuggestion | null;
  selection: ProfileSuggestionSelection | null;
  profile: ProfileFormValues;
  onSelectionChange: (next: ProfileSuggestionSelection) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  const selected = selection ? Object.values(selection).filter(Boolean).length : 0;
  return (
    <Dialog open={Boolean(suggestion)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[88vh] w-[calc(100%-1.5rem)] max-w-2xl overflow-y-auto rounded-3xl border-border/70 p-0">
        <DialogHeader className="border-b border-border/60 px-5 py-5 pr-12 text-left sm:px-6">
          <DialogTitle>Revisa lo que encontramos</DialogTitle>
          <DialogDescription>
            Marcamos los campos vacíos. Los que ya tienen contenido solo se reemplazan si los marcas. Nada se guarda hasta que presiones «Guardar cambios».
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 px-5 py-4 sm:px-6">
          {suggestion && selection ? GROUPS.map((group) => {
            const fields = group.fields.filter((field) => String(suggestion.values[field] || '').trim());
            if (fields.length === 0) return null;
            return (
              <section key={group.title} aria-label={group.title} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</h3>
                {fields.map((field) => {
                  const value = String(suggestion.values[field] || '').trim();
                  const current = String(profile[field] || '').trim();
                  const sources = suggestion.sources[field] || [];
                  const inferred = sources.length === 0 && INFERRED_FIELDS.includes(field);
                  return (
                    <label key={field} htmlFor={`suggestion-${field}`} className="flex cursor-pointer gap-3 rounded-2xl border border-border/60 p-4 transition-colors hover:bg-muted/35 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                      <Checkbox
                        id={`suggestion-${field}`}
                        checked={Boolean(selection[field])}
                        onCheckedChange={(checked) => onSelectionChange({ ...selection, [field]: checked === true })}
                        aria-label={`Aplicar ${PROFILE_FIELD_LABELS[field]}`}
                        className="mt-0.5 rounded-md"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          {PROFILE_FIELD_LABELS[field]}
                          {current
                            ? <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">Reemplaza lo actual</span>
                            : <span className="inline-flex items-center gap-1 text-xs font-normal text-emerald-700 dark:text-emerald-300"><Check className="h-3 w-3" aria-hidden="true" />Campo vacío</span>}
                        </span>
                        <ValuePreview field={field} value={value} />
                        {sources.length > 0 ? (
                          <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            Fuente:
                            {sources.map((source) => (
                              <a key={source.url} href={source.url} target="_blank" rel="noreferrer noopener" onClick={(event) => event.stopPropagation()}
                                className="inline-flex items-center gap-0.5 rounded underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                {shortUrl(source.url)}<ExternalLink className="h-3 w-3" aria-hidden="true" /><span className="sr-only"> (se abre en otra pestaña)</span>
                              </a>
                            ))}
                          </span>
                        ) : inferred ? (
                          <span className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Lightbulb className="h-3 w-3" aria-hidden="true" />Sugerencia de la IA según tu oferta: ajústala a tu experiencia.
                          </span>
                        ) : null}
                        {current ? <span className="mt-2 block text-xs leading-5 text-muted-foreground"><strong className="font-medium text-foreground">Actual:</strong> {current}</span> : null}
                      </span>
                    </label>
                  );
                })}
              </section>
            );
          }) : null}
          {suggestion && suggestion.pagesRead.length > 0 ? (
            <details className="rounded-2xl border border-dashed border-border/70 px-4 py-3 text-xs text-muted-foreground">
              <summary className="cursor-pointer rounded font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Leímos {suggestion.pagesRead.length} {suggestion.pagesRead.length === 1 ? 'fuente' : 'fuentes'}
              </summary>
              <ul className="mt-2 space-y-1">
                {suggestion.pagesRead.map((page) => <li key={page.url} className="truncate">{page.title} · {shortUrl(page.url)}</li>)}
              </ul>
            </details>
          ) : null}
        </div>
        <DialogFooter className="border-t border-border/60 bg-muted/15 px-5 py-4 sm:px-6">
          <Button type="button" variant="ghost" onClick={onClose} className="rounded-xl">Cancelar</Button>
          <Button type="button" onClick={onApply} disabled={selected === 0} className="rounded-xl">
            Usar {selected || ''} {selected === 1 ? 'campo' : 'campos'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
