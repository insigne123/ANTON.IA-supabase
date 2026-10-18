'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { CompanyDocuments } from './CompanyDocuments';
import { CERTIFICATIONS, CHILE_REGIONS, COMPANY_SIZES, EMPTY_TENDER_PROFILE, PROVIDER_REGISTRY, normalizeRut, tenderProfileProgress,
  type TenderProfile, type TenderProfileField, type TenderProfileSuggestion } from '@/lib/commercial-opportunities/tender-profile';

type View = { available: boolean; profile: TenderProfile; revision: number; updatedAt: string | null; progress: { answered: number; total: number }; reconsiderable: number };
const NUMBERS = ['employees', 'yearsOperating', 'staffCapacity', 'contractMin', 'contractMax', 'guaranteeMax'] as const;
type NumberField = typeof NUMBERS[number];
/** The form as typed: numbers as text («5.000.000»), everything else as the profile keeps it. */
export type TenderProfileForm = Omit<TenderProfile, NumberField> & Record<NumberField, string>;

const digits = (value: string) => value.replace(/\D/g, '');
const grouped = (value: number | null) => (value === null ? '' : new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(value));
export function formFromProfile(profile: TenderProfile): TenderProfileForm {
  return { ...profile, ...Object.fromEntries(NUMBERS.map(key => [key, grouped(profile[key])])) } as unknown as TenderProfileForm;
}
export function profileFromForm(form: TenderProfileForm): TenderProfile {
  const blank = (value: string | null) => (value && value.trim() ? value.trim() : null);
  return {
    ...form,
    ...Object.fromEntries(NUMBERS.map(key => [key, digits(form[key]) ? Number(digits(form[key])) : null])),
    legalName: blank(form.legalName), rut: blank(form.rut), publicContracts: blank(form.publicContracts), privateClients: blank(form.privateClients),
    otherCertifications: blank(form.otherCertifications), assets: blank(form.assets), limits: blank(form.limits),
    regions: form.regions && form.regions.length ? form.regions : null,
  } as unknown as TenderProfile;
}
async function json(response: Response) { const value = await response.json(); if (!response.ok) throw new Error(value.error || 'No se pudo completar la acción.'); return value; }
const post = (body: unknown) => fetch('/api/commercial-opportunities/tender-profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json);

function Field({ id, label, hint, suggested, children }: { id: string; label: string; hint?: string; suggested?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {suggested ? <p className="flex items-center gap-1 text-xs text-primary"><Sparkles className="h-3 w-3" aria-hidden="true" />Sugerido por la IA · {suggested}</p>
        : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
function Choice<T extends string>({ legend, name, value, options, onChange }: { legend: string; name: string; value: T | null; options: Array<[T, string]>; onChange: (value: T | null) => void }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {[...options, ['', 'No sé'] as [string, string]].map(([key, label]) => (
          <label key={key || 'unknown'} className="flex items-center gap-2 text-sm">
            <input type="radio" name={name} checked={(value ?? '') === key} onChange={() => onChange((key || null) as T | null)} className="h-4 w-4 accent-primary" />{label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The questions, in the groups of tender-profile.ts. Rendered on its own so it can be tested without the sheet. */
export function TenderProfileFields({ form, sources, onChange }: { form: TenderProfileForm; sources: Partial<Record<TenderProfileField, string>>;
  onChange: (next: TenderProfileForm) => void }) {
  const set = <K extends keyof TenderProfileForm>(key: K, value: TenderProfileForm[K]) => onChange({ ...form, [key]: value });
  const rutInvalid = Boolean(form.rut && form.rut.trim() && !normalizeRut(form.rut));
  const regions = form.regions || [];
  const toggle = (list: string[], item: string) => (list.includes(item) ? list.filter(entry => entry !== item) : [...list, item]);
  const textarea = (key: 'publicContracts' | 'privateClients' | 'assets' | 'limits', label: string, placeholder: string, hint?: string) => (
    <Field id={`tp-${key}`} label={label} hint={hint} suggested={sources[key]}>
      <Textarea id={`tp-${key}`} rows={3} maxLength={2000} value={form[key] || ''} placeholder={placeholder} onChange={event => set(key, event.target.value)} />
    </Field>
  );
  const amount = (key: NumberField, label: string, placeholder: string, hint?: string) => (
    <Field id={`tp-${key}`} label={label} hint={hint} suggested={sources[key]}>
      <Input id={`tp-${key}`} inputMode="numeric" value={form[key]} placeholder={placeholder} onChange={event => set(key, event.target.value.replace(/[^\d.]/g, ''))}
        onBlur={() => set(key, digits(form[key]) ? grouped(Number(digits(form[key]))) : '')} />
    </Field>
  );
  return (
    <div className="space-y-8">
      <section aria-labelledby="tp-company" className="space-y-4">
        <h3 id="tp-company" className="text-sm font-semibold">Tu empresa</h3>
        <Field id="tp-legalName" label="Razón social" suggested={sources.legalName}>
          <Input id="tp-legalName" maxLength={200} value={form.legalName || ''} placeholder="Ej.: Servicios Integrales del Sur SpA" onChange={event => set('legalName', event.target.value)} />
        </Field>
        <Field id="tp-rut" label="RUT de la empresa" suggested={sources.rut} hint={rutInvalid ? undefined : 'Va en la carta y los anexos del borrador de oferta.'}>
          <Input id="tp-rut" maxLength={20} value={form.rut || ''} placeholder="76.123.456-0" aria-invalid={rutInvalid} aria-describedby={rutInvalid ? 'tp-rut-error' : undefined}
            onChange={event => set('rut', event.target.value)} onBlur={() => { const rut = form.rut ? normalizeRut(form.rut) : null; if (rut) set('rut', rut); }} />
          {rutInvalid ? <p id="tp-rut-error" role="alert" className="text-xs text-destructive">Revisa el RUT: el dígito verificador no calza.</p> : null}
        </Field>
        <Field id="tp-size" label="Tamaño según ventas anuales" suggested={sources.size}>
          <select id="tp-size" value={form.size || ''} onChange={event => set('size', (event.target.value || null) as TenderProfile['size'])} className="block h-10 w-full rounded-md border bg-background px-3 text-sm">
            <option value="">No sé</option>
            {Object.entries(COMPANY_SIZES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {amount('employees', 'Personas en la empresa', 'Ej.: 45')}
          {amount('yearsOperating', 'Años en el rubro', 'Ej.: 12')}
        </div>
      </section>

      <section aria-labelledby="tp-where" className="space-y-4">
        <h3 id="tp-where" className="text-sm font-semibold">Dónde y cuánto</h3>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Regiones donde puedes prestar el servicio</legend>
          {sources.regions ? <p className="flex items-center gap-1 text-xs text-primary"><Sparkles className="h-3 w-3" aria-hidden="true" />Sugerido por la IA · {sources.regions}</p> : null}
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={regions.length === CHILE_REGIONS.length}
              onChange={event => set('regions', event.target.checked ? [...CHILE_REGIONS] : null)} />Todo Chile
          </label>
          <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
            {CHILE_REGIONS.map(region => (
              <label key={region} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={regions.includes(region)}
                  onChange={() => { const next = toggle(regions, region) as TenderProfile['regions']; set('regions', next && next.length ? next : null); }} />{region}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Sin marcar, la IA no sabe dónde operas y no descarta por región.</p>
        </fieldset>
        {amount('staffCapacity', 'Personas que podrías asignar a un contrato nuevo', 'Ej.: 20', 'Para comparar con la dotación que piden las bases.')}
        <div className="grid gap-4 sm:grid-cols-2">
          {amount('contractMin', 'Contrato desde (CLP)', 'Ej.: 5.000.000')}
          {amount('contractMax', 'Contrato hasta (CLP)', 'Ej.: 300.000.000')}
        </div>
      </section>

      <section aria-labelledby="tp-experience" className="space-y-4">
        <h3 id="tp-experience" className="text-sm font-semibold">Experiencia</h3>
        <Choice legend="¿Le has vendido al Estado?" name="tp-public" value={form.publicExperience} options={[['si', 'Sí'], ['no', 'No']]} onChange={value => set('publicExperience', value)} />
        {textarea('publicContracts', 'Contratos con organismos públicos', 'Ej.: Aseo Hospital de Castro, 2023-2025, $480 millones; Municipalidad de Ancud, 2024', 'Quién, qué, cuándo y por cuánto. Es la experiencia que suelen puntuar.')}
        {textarea('privateClients', 'Clientes y contratos similares en privados', 'Ej.: Salmones Austral, aseo de plantas desde 2021')}
      </section>

      <section aria-labelledby="tp-asks" className="space-y-4">
        <h3 id="tp-asks" className="text-sm font-semibold">Lo que suelen pedir las bases</h3>
        <Field id="tp-registry" label="Registro de Proveedores del Estado" hint="Casi todas las licitaciones piden estar hábil para firmar el contrato.">
          <select id="tp-registry" value={form.providerRegistry || ''} onChange={event => set('providerRegistry', (event.target.value || null) as TenderProfile['providerRegistry'])} className="block h-10 w-full rounded-md border bg-background px-3 text-sm">
            <option value="">No sé</option>
            {Object.entries(PROVIDER_REGISTRY).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </Field>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Certificaciones vigentes</legend>
          {sources.certifications ? <p className="flex items-center gap-1 text-xs text-primary"><Sparkles className="h-3 w-3" aria-hidden="true" />Sugerido por la IA · {sources.certifications}</p> : null}
          <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
            {CERTIFICATIONS.map(cert => (
              <label key={cert} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={(form.certifications || []).includes(cert)}
                  onChange={() => set('certifications', toggle(form.certifications || [], cert) as TenderProfile['certifications'])} />{cert}
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={Array.isArray(form.certifications) && !form.certifications.length}
                onChange={event => set('certifications', event.target.checked ? [] : null)} />No tenemos certificaciones
            </label>
          </div>
        </fieldset>
        <Field id="tp-otherCertifications" label="Otras certificaciones o acreditaciones" suggested={sources.otherCertifications}>
          <Input id="tp-otherCertifications" maxLength={500} value={form.otherCertifications || ''} placeholder="Ej.: Acreditación SEC clase A" onChange={event => set('otherCertifications', event.target.value)} />
        </Field>
        {amount('guaranteeMax', 'Garantía máxima que puedes entregar (CLP)', 'Ej.: 10.000.000', 'Boleta, póliza o certificado de fianza: lo que tu banco o aseguradora te da hoy.')}
        <Choice legend="¿Tienes seguro de responsabilidad civil vigente?" name="tp-insurance" value={form.insurance} options={[['si', 'Sí'], ['no', 'No']]} onChange={value => set('insurance', value)} />
      </section>

      <section aria-labelledby="tp-means" className="space-y-4">
        <h3 id="tp-means" className="text-sm font-semibold">Medios y límites</h3>
        {textarea('assets', 'Equipos, flota, instalaciones o licencias', 'Ej.: 6 camionetas 4x4, bodega en Puerto Montt, licencia de manipulación de alimentos')}
        {textarea('limits', 'Lo que no haces o no te interesa', 'Ej.: No hacemos obras civiles ni turnos nocturnos')}
      </section>

      {form.notes.length ? (
        <section aria-labelledby="tp-notes" className="space-y-3">
          <div>
            <h3 id="tp-notes" className="text-sm font-semibold">Respuestas a la IA</h3>
            <p className="text-xs text-muted-foreground">Lo que el equipo respondió en los requisitos de una licitación. La IA lo usa en las siguientes.</p>
          </div>
          <ul className="divide-y rounded-xl border">
            {form.notes.map(note => (
              <li key={note.question} className="flex items-start justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0 text-sm"><p className="text-muted-foreground">{note.question}</p><p className="font-medium">{note.answer}</p></div>
                <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs" aria-label={`Quitar la respuesta a «${note.question}»`}
                  onClick={() => set('notes', form.notes.filter(entry => entry.question !== note.question))}>Quitar</Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/**
 * «Ficha para licitaciones»: a side panel with the questions, «Completar con IA» for what is blank, and, once saved, the
 * offer to read again the tenders discarded for a requirement or their size.
 */
export function TenderProfileSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [view, setView] = useState<View | null>(null);
  const [form, setForm] = useState<TenderProfileForm>(formFromProfile(EMPTY_TENDER_PROFILE));
  const [sources, setSources] = useState<Partial<Record<TenderProfileField, string>>>({});
  const [busy, setBusy] = useState<'save' | 'suggest' | 'reconsider' | null>(null);
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setProblem(''); setNotice(''); setSources({}); setSaved(false);
    fetch('/api/commercial-opportunities/tender-profile', { cache: 'no-store' }).then(json)
      .then((value: View) => { if (alive) { setView(value); setForm(formFromProfile(value.profile)); } })
      .catch(e => { if (alive) setProblem(e instanceof Error ? e.message : 'No se pudo abrir la ficha.'); });
    return () => { alive = false; };
  }, [open]);

  const suggest = async () => {
    setBusy('suggest'); setProblem(''); setNotice('');
    try {
      const result = await post({ action: 'suggest', requestId: crypto.randomUUID() }) as { state: string; error: string | null; suggestion: (TenderProfileSuggestion & { website: boolean }) | null };
      if (!result.suggestion) { setProblem(result.error || 'La IA aún está leyendo. Intenta de nuevo en un momento.'); return; }
      const filled = Object.keys(result.suggestion.values).length;
      setForm(current => formFromProfile({ ...profileFromForm(current), ...result.suggestion!.values }));
      setSources(result.suggestion.sources);
      setNotice(filled ? `La IA completó ${filled === 1 ? '1 respuesta' : `${filled} respuestas`}${result.suggestion.website ? ', también con tu sitio web' : ''}. Revísalas y guarda.`
        : 'La IA no encontró datos nuevos en tu Perfil ni en tu sitio. Completa lo que sepas.');
    } catch (e) { setProblem(e instanceof Error ? e.message : 'La IA no pudo leer tus datos.'); }
    finally { setBusy(null); }
  };
  const save = async () => {
    if (!view) return;
    setBusy('save'); setProblem(''); setNotice('');
    try {
      const result = await post({ action: 'save', profile: profileFromForm(form), expectedRevision: view.revision });
      setView({ ...view, revision: result.revision, profile: result.profile, progress: result.progress });
      setForm(formFromProfile(result.profile)); setSources({}); setSaved(true);
      setNotice('Ficha guardada. La IA la usa desde la próxima evaluación, informe y conversación.');
    } catch (e) { setProblem(e instanceof Error ? e.message : 'No se pudo guardar la ficha.'); }
    finally { setBusy(null); }
  };
  const reconsider = async () => {
    setBusy('reconsider'); setProblem('');
    try {
      const result = await post({ action: 'reconsider' });
      setNotice(result.queued ? `La IA está revisando ${result.queued === 1 ? '1 licitación' : `${result.queued} licitaciones`} con tu ficha. Las que calcen volverán a la lista.` : 'No hay descartadas para revisar.');
      if (view) setView({ ...view, reconsiderable: 0 });
    } catch (e) { setProblem(e instanceof Error ? e.message : 'No se pudo pedir la revisión.'); }
    finally { setBusy(null); }
  };
  const progress = tenderProfileProgress(profileFromForm(form));

  return (
    <Sheet open={open} onOpenChange={next => { if (!busy) onOpenChange(next); }}>
      <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Ficha para licitaciones</SheetTitle>
          <SheetDescription>Con esto la IA no descarta una licitación por algo que sí tienes, y te pregunta lo que no sabe. Deja en blanco lo que no sepas.</SheetDescription>
        </SheetHeader>
        {!view && !problem ? <div role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Abriendo la ficha…</div> : null}
        {view && !view.available ? <p className="py-6 text-sm text-muted-foreground">La ficha se está preparando. Vuelve en unos minutos.</p> : null}
        {view?.available ? <>
          <div className="space-y-2 rounded-xl bg-muted/40 p-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium">{progress.answered} de {progress.total} respuestas</span>
              <Button type="button" variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => void suggest()}>
                {busy === 'suggest' ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="mr-2 h-3.5 w-3.5" aria-hidden="true" />}
                {busy === 'suggest' ? 'Leyendo tus datos…' : 'Completar con IA'}
              </Button>
            </div>
            <Progress value={(progress.answered / progress.total) * 100} aria-label={`Ficha: ${progress.answered} de ${progress.total} respuestas`} />
            <p className="text-xs text-muted-foreground">La IA lee tu Perfil, tu sitio web y la oferta del workspace, y solo llena lo que está en blanco.</p>
          </div>
          {problem ? <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">{problem}</p> : null}
          {notice ? <p role="status" className="rounded-lg border bg-muted/30 p-3 text-sm">{notice}</p> : null}
          {saved && view.reconsiderable > 0 ? (
            <div className="space-y-2 rounded-xl border p-4">
              <p className="text-sm">Hay {view.reconsiderable === 1 ? '1 licitación descartada' : `${view.reconsiderable} licitaciones descartadas`} por un requisito o por su tamaño. ¿Las revisamos de nuevo con tu ficha?</p>
              <Button type="button" size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void reconsider()}>
                {busy === 'reconsider' ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}Revisar de nuevo
              </Button>
            </div>
          ) : null}
          <form id="tender-profile-form" className="py-2" onSubmit={event => { event.preventDefault(); void save(); }}>
            <TenderProfileFields form={form} sources={sources} onChange={next => { setForm(next); setSaved(false); }} />
          </form>
          <div className="border-t pt-6"><CompanyDocuments /></div>
          <SheetFooter className="sticky bottom-0 mt-auto gap-2 border-t bg-background py-3">
            <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => onOpenChange(false)}>Cerrar</Button>
            <Button type="submit" form="tender-profile-form" disabled={Boolean(busy) || Boolean(form.rut && form.rut.trim() && !normalizeRut(form.rut))}>
              {busy === 'save' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}Guardar ficha
            </Button>
          </SheetFooter>
        </> : problem ? <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">{problem}</p> : null}
      </SheetContent>
    </Sheet>
  );
}
