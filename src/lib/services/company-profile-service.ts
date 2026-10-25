import { companyProfileFields, companyProfileHasOffer, withCompanyProfile, type CompanyProfile } from '@/lib/profile/company-profile';
import { profileService, type Profile } from '@/lib/services/profile-service';

export type CompanyProfileRead = { profile: CompanyProfile | null; canEdit: boolean };

/**
 * «Ficha de la empresa» (APP-06) in the browser, for the active organization. It never fails: when it cannot be read the
 * screens work as they did before there was one.
 */
export const companyProfileService = {
    async read(): Promise<CompanyProfileRead | null> {
        try {
            const response = await fetch('/api/company-profile', { cache: 'no-store' });
            if (!response.ok) return null;
            const data = await response.json() as CompanyProfileRead;
            return { profile: data.profile ? { ...data.profile, fields: companyProfileFields(data.profile.fields) } : null, canEdit: data.canEdit === true };
        } catch {
            return null;
        }
    },

    /**
     * The person's profile as the AI reads it (withCompanyProfile): their name and role, and the company part from the
     * ficha when there is one. What «Buscar prospectos», «Empresas» and «Campañas» start from.
     */
    async getSellingProfile(): Promise<Profile | null> {
        const [profile, company] = await Promise.all([profileService.getProfile(), this.read()]);
        const fields = company?.profile?.fields;
        return fields && companyProfileHasOffer(fields) ? withCompanyProfile(profile, fields) : profile;
    },
};
