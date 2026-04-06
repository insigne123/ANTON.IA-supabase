import { EnrichedLead, LeadResearchReport } from '@/lib/types';
import { getFirstNameSafe } from '@/lib/template';

export function generateLinkedinDraft(lead: EnrichedLead, report?: LeadResearchReport | null): string {
    const firstName = getFirstNameSafe(lead.fullName);
    const company = lead.companyName || 'su empresa';

    // 1. Si no hay reporte, fallback genérico
    if (!report || !report.cross) {
        return `Hola ${firstName}, vi tu perfil y me pareció interesante lo que hacen en ${company}. Me gustaría conectar para compartir experiencias. Saludos.`;
    }

    // 2. Si hay reporte, intentamos usar 'Pains' o 'ValueProps' o 'UseCases'
    const cross = report.cross;
    const pain = cross.pains?.[0]; // Tomamos el primer pain point si existe
    const valueProp = cross.valueProps?.[0]; // Tomamos el primer value prop

    if (pain) {
        // "Vi que empresas como [Company] suelen tener problemas con [Pain]..."
        // Hard to conjugate 'Pain' grammatically, so we keep it somewhat generic or quote it.
        // "Me gustaría conectar, estamos ayudando a empresas a resolver: ${pain}..."
        return `Hola ${firstName}, vi tu perfil en ${company}. Estamos viendo que en el sector es un reto "${pain.toLowerCase()}". Me gustaría conectar y contarte cómo lo abordamos. Saludos.`;
    }

    if (valueProp) {
        return `Hola ${firstName}, vi tu trabajo en ${company}. Ayudamos a equipos como el tuyo a ${valueProp.toLowerCase()}. Me gustaría conectar para ver si hay sinergias. Saludos.`;
    }

    // Fallback con Contexto del reporte (Overview muy largo, mejor no usarlo en DM)
    return `Hola ${firstName}, leí sobre ${company} y me pareció super interesante su enfoque. Me gustaría conectar. Saludos.`;
}
