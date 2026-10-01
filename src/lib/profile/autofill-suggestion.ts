import type { GenerateCompanyProfileOutput, ProfileAutofillSource } from '@/ai/flows/generate-company-profile';
import { joinComma, joinLines } from '@/lib/profile/profile-lists';
import type { CompanyProfileSuggestion, ProfileSuggestionField } from '@/lib/profile/profile-mappings';

export type AutofillResponse = GenerateCompanyProfileOutput & { websiteFrom?: 'input' | 'email' | 'search' | null };

export type AutofillSuggestion = {
  values: CompanyProfileSuggestion;
  sources: Partial<Record<ProfileSuggestionField, ProfileAutofillSource[]>>;
  pagesRead: ProfileAutofillSource[];
};

/** Fields the AI proposes from the offer when the site does not state them: shown as «Sugerencia», not as a fact. */
export const INFERRED_FIELDS: ProfileSuggestionField[] = ['targetRoles', 'targetIndustries', 'targetCompanySize'];

/** The API answer as form text: lists one per line for offer fields, comma separated for names. */
export function suggestionFromAutofill(output: AutofillResponse): AutofillSuggestion {
  return {
    values: {
      companyName: output.companyName,
      sector: output.sector,
      website: output.website,
      description: output.description,
      services: joinLines(output.services || []),
      valueProposition: output.valueProposition,
      painPoints: joinLines(output.painPoints || []),
      differentiators: joinLines(output.differentiators || []),
      proofPoints: joinLines(output.proofPoints || []),
      referenceClients: joinComma(output.referenceClients || []),
      targetRoles: joinComma(output.targetRoles || []),
      targetIndustries: joinComma(output.targetIndustries || []),
      targetCompanySize: output.targetCompanySize,
      targetLocations: joinComma(output.targetLocations || []),
    },
    sources: output.sources || {},
    pagesRead: output.pagesRead || [],
  };
}

/** Why nothing came back, in words that say what to do next. */
export function autofillEmptyMessage(output: Pick<AutofillResponse, 'emptyReason' | 'domain' | 'pagesRead'>) {
  if (output.emptyReason === 'site_unreachable') {
    return {
      title: `No pudimos abrir ${output.domain || 'tu sitio'}`,
      description: 'Revisa la dirección, o borra el sitio y escribe el nombre de tu empresa para buscar referencias públicas.',
    };
  }
  if (output.emptyReason === 'not_identified') {
    const pages = output.pagesRead?.length || 0;
    return {
      title: 'No pudimos identificar tu oferta con seguridad',
      description: `Leímos ${pages} ${pages === 1 ? 'página' : 'páginas'}, pero no decían con claridad qué vendes. Completa los campos a mano: con servicios y propuesta de valor ya puedes redactar.`,
    };
  }
  return {
    title: 'No encontramos información pública suficiente',
    description: 'Agrega el sitio web de tu empresa, o completa los campos a mano: con servicios y propuesta de valor ya puedes redactar.',
  };
}
