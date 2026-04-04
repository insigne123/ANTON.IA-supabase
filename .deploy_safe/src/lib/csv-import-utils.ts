import { z } from 'zod';
import { Lead } from '@/lib/types';

export const CsvLeadSchema = z.object({
    id: z.string().optional(),
    name: z.string().min(1, 'El nombre es obligatorio'),
    email: z.string().email('Email inválido'),
    title: z.string().optional(),
    company: z.string().optional(),
    linkedinUrl: z.string().url('URL inválida').optional().or(z.literal('')),
    location: z.string().optional(),
    phone: z.string().optional(),
});

export type CsvLeadInput = z.infer<typeof CsvLeadSchema>;

export type ColumnMapping = {
    csvHeader: string;
    leadField: keyof CsvLeadInput | 'ignore';
};

export const AVAILABLE_FIELDS: { value: keyof CsvLeadInput; label: string }[] = [
    { value: 'name', label: 'Nombre Completo' },
    { value: 'email', label: 'Email' },
    { value: 'title', label: 'Cargo / Título' },
    { value: 'company', label: 'Empresa' },
    { value: 'linkedinUrl', label: 'LinkedIn URL' },
    { value: 'location', label: 'Ubicación' },
    { value: 'phone', label: 'Teléfono' },
];

export function guessMapping(headers: string[]): ColumnMapping[] {
    return headers.map(header => {
        const lower = header.toLowerCase().trim();
        let field: keyof CsvLeadInput | 'ignore' = 'ignore';

        if (['email', 'correo', 'mail', 'e-mail'].some(s => lower.includes(s))) field = 'email';
        else if (['name', 'nombre', 'full name', 'persona'].some(s => lower.includes(s))) field = 'name';
        else if (['title', 'cargo', 'puesto', 'role'].some(s => lower.includes(s))) field = 'title';
        else if (['company', 'empresa', 'organización'].some(s => lower.includes(s))) field = 'company';
        else if (['linkedin', 'perfil'].some(s => lower.includes(s))) field = 'linkedinUrl';
        else if (['location', 'ubicación', 'ciudad', 'city', 'país'].some(s => lower.includes(s))) field = 'location';
        else if (['phone', 'teléfono', 'celular', 'mobile'].some(s => lower.includes(s))) field = 'phone';

        return { csvHeader: header, leadField: field };
    });
}
