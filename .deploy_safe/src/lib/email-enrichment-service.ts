import type { SavedLead } from './types';

async function enrichLead(lead: SavedLead) {
    const response = await fetch('/api/leads/enrich-email', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          leadId: lead.id,
          name: lead.name,
          company: lead.company,
          linkedinUrl: lead.linkedinUrl,
          domain: lead.companyWebsite ? new URL(lead.companyWebsite).hostname : undefined
        }),
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to enrich email');
    }

    const data = await response.json();

    if (data.success && data.email) {
        return {
            status: 'found',
            email: data.email,
            enrichmentData: {
                enriched: true,
                enrichedAt: new Date().toISOString(),
                source: 'anymail_finder',
                confidence: data.confidence,
                creditsUsed: data.credits_used
            }
        };
    } else {
        return {
            status: 'not_found',
            error: data.error || "No se pudo encontrar un email para este lead.",
        };
    }
}

async function enrichLeads(leads: SavedLead[]) {
    let found = 0;
    let notFound = 0;
    let alreadyHadEmail = 0;
    const enriched: any[] = [];

    for (const lead of leads) {
        if (lead.email) {
            alreadyHadEmail++;
            enriched.push(lead); // Incluirlo para la actualización de estado
            continue;
        }

        try {
            const result = await enrichLead(lead);
            if (result.status === 'found' && result.email) {
                found++;
                enriched.push({ ...lead, email: result.email });
            } else {
                notFound++;
            }
        } catch (error) {
            console.error(`Error enriqueciendo a ${lead.name}:`, error);
            notFound++;
        }
    }
    return { enriched, stats: { found, notFound, alreadyHadEmail } };
}

export const emailEnrichmentService = {
    enrichLead,
    enrichLeads
};
