'use client';

import Link from 'next/link';
import { Building2, Sparkles, Target } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Section } from '@/components/profile/ProfileSections';
import { commaItems, lineItems } from '@/lib/profile/profile-lists';
import { companyProfileReview, companyProfileServices, type CompanyProfile } from '@/lib/profile/company-profile';

const dateLabel = (at: string) => new Date(at).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Santiago' });

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1">
    <p className="text-xs font-medium text-muted-foreground">{label}</p>
    <div className="text-sm leading-6 text-foreground">{children}</div>
  </div>;
}

const lines = (text: string) => <ul className="space-y-1">{lineItems(text).map(item => <li key={item}>{item}</li>)}</ul>;

/**
 * «Tu empresa», «Tu oferta» and «Tu cliente ideal» in «Perfil» when the organization keeps a «Ficha de la empresa» (APP-06):
 * read from it, with who reviewed it and when, and the one choice that is the person's: which products and services they sell
 * (none ticked reads as all). The same section ids as the editable form, so the index and the guide still find them.
 */
export function CompanyProfileReadOnly({ profile, canEdit, picked, onPickedChange }: {
  profile: CompanyProfile;
  canEdit: boolean;
  picked: string[];
  onPickedChange: (next: string[]) => void;
}) {
  const { fields } = profile;
  const services = companyProfileServices(fields);
  const review = companyProfileReview(profile.reviewedAt);
  const toggle = (service: string, on: boolean) => onPickedChange(on ? [...picked.filter(item => item !== service), service] : picked.filter(item => item !== service));
  const icp = [
    ['Cargos que buscas', commaItems(fields.targetRoles).join(', ')],
    ['Industrias de tus clientes', commaItems(fields.targetIndustries).join(', ')],
    ['Tamaño de empresa', fields.targetCompanySize ? `${fields.targetCompanySize.replace('+', ' o más')} personas` : ''],
    ['Países o regiones', commaItems(fields.targetLocations).join(', ')],
  ].filter(([, value]) => value);
  return <>
    <Section id="company" icon={Building2} title="Tu empresa" description="A quién representas cuando escribes." data-tour="profile-company">
      <div className="rounded-xl bg-muted/40 px-4 py-3 text-sm leading-6 text-muted-foreground" role="note">
        <p>
          Viene de la ficha de la empresa, la misma para todo el equipo.{' '}
          {profile.reviewedAt ? <>La revisó {profile.reviewedBy || 'un administrador'} el {dateLabel(profile.reviewedAt)}.</> : null}
          {review.due && profile.reviewedAt ? ' Toca revisarla de nuevo.' : null}
        </p>
        {canEdit
          ? <Link href="/dashboard/admin/company" className="mt-1 inline-flex font-medium text-foreground underline underline-offset-2">Editar la ficha de la empresa</Link>
          : <p className="mt-1">La editan los dueños y administradores de tu organización.</p>}
      </div>
      {fields.companyName || fields.website ? <Fact label="Empresa">{[fields.companyName, fields.website].filter(Boolean).join(' · ')}</Fact> : null}
      {fields.sector ? <Fact label="Sector o industria">{fields.sector}</Fact> : null}
      {fields.description ? <Fact label="Descripción de la empresa">{fields.description}</Fact> : null}
    </Section>

    <Section id="offer" icon={Sparkles} title="Tu oferta" description="Lo que la IA puede afirmar en tus correos." data-tour="profile-offer">
      {services.length > 1 ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Lo que vendes</legend>
          <p className="text-xs leading-5 text-muted-foreground">Marca los productos y servicios que ofreces tú. Si no marcas ninguno, la IA escribe con todos.</p>
          <div className="space-y-2 pt-1">
            {services.map((service, index) => (
              <label key={service} htmlFor={`company-service-${index}`} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/60 px-3 py-2.5 text-sm leading-6 hover:bg-muted/40">
                <Checkbox id={`company-service-${index}`} checked={picked.includes(service)} onCheckedChange={(value) => toggle(service, value === true)} className="mt-1" />
                <span>{service}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : services.length === 1 ? <Fact label="Productos y servicios">{services[0]}</Fact> : null}
      {fields.valueProposition ? <Fact label="Propuesta de valor">{fields.valueProposition}</Fact> : null}
      {fields.painPoints ? <Fact label="Problemas que resuelves">{lines(fields.painPoints)}</Fact> : null}
      {fields.differentiators ? <Fact label="Por qué elegirte">{lines(fields.differentiators)}</Fact> : null}
      {fields.proofPoints ? <Fact label="Pruebas y resultados">{lines(fields.proofPoints)}</Fact> : null}
      {fields.referenceClients ? <Fact label="Clientes que puedes nombrar">{commaItems(fields.referenceClients).join(', ')}</Fact> : null}
    </Section>

    <Section id="icp" icon={Target} title="Tu cliente ideal" description="A quién le vendes. «Buscar prospectos» parte de aquí." data-tour="profile-icp">
      {icp.length
        ? <div className="grid gap-4 md:grid-cols-2">{icp.map(([label, value]) => <Fact key={label} label={label}>{value}</Fact>)}</div>
        : <p className="text-sm leading-6 text-muted-foreground">La ficha todavía no dice a quién le vende la empresa: «Buscar prospectos» usa lo que escribiste antes.</p>}
    </Section>
  </>;
}
