'use client';

import type React from 'react';
import { Building2, Sparkles, Target, type LucideIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PROFILE_COMPANY_SIZES } from '@/lib/profile/profile-mappings';
import type { CompanyProfileField, CompanyProfileFields } from '@/lib/profile/company-profile';

export const FIELD_CLASS = 'rounded-xl bg-background/70';
export const TEXTAREA_CLASS = `min-h-24 resize-y ${FIELD_CLASS} leading-6`;

/** A part of «Perfil» (or of «Ficha de la empresa»): its title and why it matters on the left, its fields on the right. */
export function Section({ id, icon: Icon, title, description, children, ...anchor }: {
  id: string;
  icon: LucideIcon;
  title: string;
  description: string;
  children: React.ReactNode;
  /** The screen guide's anchor (src/lib/onboarding/product-tour.ts). */
  'data-tour'?: string;
}) {
  return (
    <section {...anchor} className="grid gap-5 p-5 sm:p-7 lg:grid-cols-[200px_minmax(0,1fr)]" aria-labelledby={`${id}-heading`}>
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h2 id={`${id}-heading`} className="scroll-mt-28">{title}</h2>
        </div>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p>
      </div>
      <div className="grid min-w-0 gap-4">{children}</div>
    </section>
  );
}

export function Field({ id, label, hint, optional, children }: { id: string; label: string; hint?: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}{optional ? <span className="font-normal text-muted-foreground"> (opcional)</span> : null}</Label>
      {children}
      {hint ? <p id={`${id}-help`} className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * «Tu empresa», «Tu oferta» and «Tu cliente ideal»: the same fields in «Perfil» and in «Ficha de la empresa», with the ids
 * «Perfil» focuses and the screen guide points at. `copy` names them for whoever fills them: «tu» in «Perfil», «la» in the ficha.
 */
export function CompanySections({ values, onChange, onWebsiteBlur, websiteError, icpNote, icpExtra, copy = 'person' }: {
  values: CompanyProfileFields;
  onChange: (field: CompanyProfileField, value: string) => void;
  onWebsiteBlur?: () => void;
  websiteError?: string;
  /** Above the ideal customer's fields, when ANTON.IA filled them for the person. */
  icpNote?: React.ReactNode;
  /** Below them: the industries of the saved contacts, in «Perfil». */
  icpExtra?: React.ReactNode;
  copy?: 'person' | 'company';
}) {
  const change = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.id as CompanyProfileField, event.target.value);
  const company = copy === 'company';
  return <>
    <Section id="company" icon={Building2} title={company ? 'La empresa' : 'Tu empresa'} description={company ? 'A quién representa el equipo cuando escribe.' : 'A quién representas cuando escribes.'}
      {...(company ? {} : { 'data-tour': 'profile-company' })}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="companyName" label="Nombre de la empresa">
          <Input id="companyName" autoComplete="organization" value={values.companyName} onChange={change} placeholder="Ej. Acme" className={`h-11 ${FIELD_CLASS}`} />
        </Field>
        <div className="space-y-2">
          <Label htmlFor="website">Sitio web</Label>
          <Input id="website" inputMode="url" autoComplete="url" value={values.website} onChange={change} onBlur={onWebsiteBlur}
            placeholder="empresa.com" aria-invalid={Boolean(websiteError)} aria-describedby={websiteError ? 'website-error' : undefined} className={`h-11 ${FIELD_CLASS}`} />
          {websiteError ? <p id="website-error" className="text-xs text-destructive">{websiteError}</p> : null}
        </div>
      </div>
      <Field id="sector" label="Sector o industria">
        <Input id="sector" value={values.sector} onChange={change} placeholder="Ej. Outsourcing de recursos humanos" className={`h-11 ${FIELD_CLASS}`} />
      </Field>
      <Field id="description" label="Descripción de la empresa" hint="Una o dos oraciones: qué hace y para quién.">
        <Textarea id="description" value={values.description} onChange={change} aria-describedby="description-help" placeholder="Qué hace la empresa y para quién" className={TEXTAREA_CLASS} />
      </Field>
    </Section>

    <Section id="offer" icon={Sparkles} title={company ? 'La oferta' : 'Tu oferta'}
      description={company ? 'Lo que la IA puede afirmar en los correos de todo el equipo. Solo usa lo que esté escrito aquí.' : 'Lo que la IA puede afirmar en tus correos. Solo usa lo que escribas aquí.'}
      {...(company ? {} : { 'data-tour': 'profile-offer' })}>
      <Field id="services" label="Productos y servicios" hint="Uno por línea, con una frase de qué resuelve. Ej. «Servicios transitorios: personal temporal para peaks de temporada».">
        <Textarea id="services" value={values.services} onChange={change} aria-describedby="services-help" placeholder={'Ej. Servicio: qué resuelve\nEj. Otro servicio: qué resuelve'} className={`min-h-28 ${TEXTAREA_CLASS}`} />
      </Field>
      <Field id="valueProposition" label="Propuesta de valor" hint="El resultado que consigue tu cliente y cómo. Ej. «Ayudamos a centros de distribución a cubrir peaks sin sobrecostos de contratación».">
        <Textarea id="valueProposition" value={values.valueProposition} onChange={change} aria-describedby="valueProposition-help" placeholder="Qué resultado ayudas a conseguir y por qué elegirte" className={TEXTAREA_CLASS} />
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field id="painPoints" label="Problemas que resuelves" optional hint="Uno por línea, como los diría tu cliente.">
          <Textarea id="painPoints" value={values.painPoints} onChange={change} aria-describedby="painPoints-help" placeholder={'Ej. Rotación alta en temporada\nEj. Procesos de selección lentos'} className={TEXTAREA_CLASS} />
        </Field>
        <Field id="differentiators" label="Por qué elegirte" optional hint="Uno por línea: cobertura, trayectoria, garantías, tecnología.">
          <Textarea id="differentiators" value={values.differentiators} onChange={change} aria-describedby="differentiators-help" placeholder={'Ej. Cobertura nacional\nEj. Reemplazo garantizado en 48 horas'} className={TEXTAREA_CLASS} />
        </Field>
      </div>
      <Field id="proofPoints" label="Pruebas y resultados" optional hint="Un dato verificable por línea. La IA puede citarlos tal cual.">
        <Textarea id="proofPoints" rows={4} value={values.proofPoints} onChange={change} aria-describedby="proofPoints-help" placeholder={'Ej. Reducimos un 25 % el tiempo de gestión\nEj. Más de 40 equipos implementados'} className={`min-h-28 ${TEXTAREA_CLASS}`} />
      </Field>
      <Field id="referenceClients" label="Clientes que puedes nombrar" optional hint="Separados por coma. Solo los que te autorizan a mencionar.">
        <Input id="referenceClients" value={values.referenceClients} onChange={change} aria-describedby="referenceClients-help" placeholder="Ej. Empresa A, Empresa B" className={`h-11 ${FIELD_CLASS}`} />
      </Field>
    </Section>

    <Section id="icp" icon={Target} title={company ? 'El cliente ideal' : 'Tu cliente ideal'}
      description={company ? 'A quién le vende el equipo. «Buscar prospectos» parte de aquí.' : 'A quién le vendes. «Buscar prospectos» parte de aquí.'}
      {...(company ? {} : { 'data-tour': 'profile-icp' })}>
      {icpNote}
      <div className="grid gap-4 md:grid-cols-2">
        <Field id="targetRoles" label="Cargos que buscas" hint="Separados por coma, como aparecen en LinkedIn.">
          <Input id="targetRoles" value={values.targetRoles} onChange={change} aria-describedby="targetRoles-help" placeholder="Ej. Gerente de Personas, Jefe de Operaciones" className={`h-11 ${FIELD_CLASS}`} />
        </Field>
        <Field id="targetIndustries" label="Industrias de tus clientes" hint="Separadas por coma.">
          <Input id="targetIndustries" value={values.targetIndustries} onChange={change} aria-describedby="targetIndustries-help" placeholder="Ej. Retail, logística, minería" className={`h-11 ${FIELD_CLASS}`} />
        </Field>
        <div className="space-y-2">
          <Label htmlFor="targetCompanySize">Tamaño de empresa</Label>
          <Select value={values.targetCompanySize || 'any'} onValueChange={(value) => onChange('targetCompanySize', value === 'any' ? '' : value)}>
            <SelectTrigger id="targetCompanySize" className={`h-11 ${FIELD_CLASS}`}><SelectValue placeholder="Cualquier tamaño" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Cualquier tamaño</SelectItem>
              {PROFILE_COMPANY_SIZES.map((size) => <SelectItem key={size} value={size}>{size.replace('+', ' o más')} personas</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Field id="targetLocations" label="Países o regiones" hint="Separados por coma.">
          <Input id="targetLocations" value={values.targetLocations} onChange={change} aria-describedby="targetLocations-help" placeholder="Ej. Chile, Perú" className={`h-11 ${FIELD_CLASS}`} />
        </Field>
      </div>
      {icpExtra}
    </Section>
  </>;
}
