import * as functions from 'firebase-functions/v2';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Hardcoded URLs for Cloud Functions
const APP_URL = 'https://studio--leadflowai-3yjcy.us-central1.hosted.app';
const LEAD_SEARCH_URL = "https://studio--studio-6624658482-61b7b.us-central1.hosted.app/api/lead-search";

// Helper functions
async function getDailyUsage(supabase: SupabaseClient, organizationId: string) {
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase
        .from('antonia_daily_usage')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('date', today)
        .single();

    return data || { leads_searched: 0, leads_enriched: 0, leads_investigated: 0, search_runs: 0 };
}

async function incrementUsage(supabase: SupabaseClient, organizationId: string, type: 'search' | 'enrich' | 'investigate' | 'search_run', count: number) {
    const today = new Date().toISOString().split('T')[0];

    let col = '';
    if (type === 'search') col = 'leads_searched';
    else if (type === 'search_run') col = 'search_runs';
    else if (type === 'enrich') col = 'leads_enriched';
    else col = 'leads_investigated';

    const current = await getDailyUsage(supabase, organizationId);
    const newCount = (current[col] || 0) + count;

    await supabase
        .from('antonia_daily_usage')
        .upsert({
            organization_id: organizationId,
            date: today,
            [col]: newCount,
            updated_at: new Date().toISOString()
        }, { onConflict: 'organization_id,date' });
}

// Task execution functions
async function executeCampaignGeneration(task: any, supabase: SupabaseClient, taskConfig: any) {
    const { jobTitle, industry, campaignContext, userId, missionTitle } = task.payload;
    const generatedName = `Misión: ${missionTitle || 'Campaña Inteligente'}`;

    console.log('[GENERATE] Generating campaign...', generatedName);

    const { data: existing } = await supabase
        .from('campaigns')
        .select('id, name, subject, body')
        .eq('organization_id', task.organization_id)
        .eq('name', generatedName)
        .maybeSingle();

    let subject = existing?.subject || '';
    let body = existing?.body || '';

    if (!existing) {
        subject = `Oportunidad para innovar en ${industry}`;
        body = `Hola {{firstName}},\n\nEspero que estés muy bien.\n\nVi que estás liderando iniciativas de ${jobTitle} y me pareció muy relevante contactarte.\n${campaignContext ? `\nContexto específico: ${campaignContext}\n` : ''}\nMe gustaría conversar sobre cómo podemos potenciar sus resultados.\n\n¿Tienes 5 minutos esta semana?\n\nSaludos,`;

        await supabase.from('campaigns').insert({
            organization_id: task.organization_id,
            user_id: userId,
            name: generatedName,
            subject: subject,
            body: body,
            status: 'draft',
            created_at: new Date().toISOString()
        });
    }

    // Chain to SEARCH task
    await supabase.from('antonia_tasks').insert({
        mission_id: task.mission_id,
        organization_id: task.organization_id,
        type: 'SEARCH',
        status: 'pending',
        payload: {
            ...task.payload,
            campaignName: generatedName
        },
        created_at: new Date().toISOString()
    });

    return {
        campaignGenerated: true,
        campaignName: generatedName,
        subjectPreview: subject,
        bodyPreview: body.substring(0, 150) + '...'
    };
}

async function executeSearch(task: any, supabase: SupabaseClient, taskConfig: any) {
    const usage = await getDailyUsage(supabase, task.organization_id);
    const limit = taskConfig?.daily_search_limit || 3;

    if ((usage.search_runs || 0) >= limit) {
        console.log(`[SEARCH] Daily limit reached (${usage.search_runs}/${limit})`);
        return { skipped: true, reason: 'daily_limit_reached' };
    }

    const { jobTitle, location, industry, keywords, companySize, userId } = task.payload;
    console.log('[SEARCH] Searching leads:', { jobTitle, location, industry });

    // Payload structure matching exactly what external API expects (based on nextjs route.ts)
    const searchPayload = {
        user_id: userId,
        titles: jobTitle ? [jobTitle] : [],
        company_location: location ? [location] : [],
        industry_keywords: industry ? [industry] : [],
        employee_range: companySize ? [companySize] : [],
        max_results: 100
    };

    console.log('[SEARCH] Sending payload:', JSON.stringify(searchPayload));

    const response = await fetch(LEAD_SEARCH_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(searchPayload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('[SEARCH] API Error Response:', errorText);
        throw new Error(`Search API failed: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    const leads = data.results || data.leads || []; // Handle potentially different response structures

    if (leads.length > 0) {
        const leadsToInsert = leads.map((lead: any) => ({
            user_id: task.payload.userId,
            organization_id: task.organization_id,
            mission_id: task.mission_id,
            name: lead.full_name || lead.name || '',
            title: lead.title || '',
            company: lead.organization_name || lead.company_name || '',
            email: lead.email || null,
            linkedin_url: lead.linkedin_url || null,
            status: 'saved',
            created_at: new Date().toISOString()
        }));

        await supabase.from('leads').insert(leadsToInsert);
        await incrementUsage(supabase, task.organization_id, 'search', leads.length);
        await incrementUsage(supabase, task.organization_id, 'search_run', 1);

        // Chain to ENRICH if configured
        if (task.payload.enrichmentLevel && leads.length > 0) {
            await supabase.from('antonia_tasks').insert({
                mission_id: task.mission_id,
                organization_id: task.organization_id,
                type: 'ENRICH',
                status: 'pending',
                payload: {
                    userId: task.payload.userId,
                    leads: leads.slice(0, 10),
                    enrichmentLevel: task.payload.enrichmentLevel,
                    campaignName: task.payload.campaignName
                },
                created_at: new Date().toISOString()
            });
        }
    }

    return {
        leadsFound: leads.length,
        searchCriteria: { jobTitle, location, industry, keywords },
        sampleLeads: leads.slice(0, 5).map((l: any) => ({ name: l.full_name || l.name, company: l.organization_name || l.company_name, title: l.title }))
    };
}

async function executeEnrichment(task: any, supabase: SupabaseClient, taskConfig: any) {
    // Get mission limits
    const { data: mission } = await supabase
        .from('antonia_missions')
        .select('daily_enrich_limit')
        .eq('id', task.mission_id)
        .single();

    const usage = await getDailyUsage(supabase, task.organization_id);
    const limit = mission?.daily_enrich_limit || 10;

    if ((usage.leads_enriched || 0) >= limit) {
        console.log(`[ENRICH] Daily limit reached (${usage.leads_enriched}/${limit})`);
        return { skipped: true, reason: 'daily_limit_reached' };
    }

    const { leads, userId, enrichmentLevel, campaignName } = task.payload;

    console.log(`[ENRICH] Task payload:`, JSON.stringify({
        leadsCount: leads?.length || 0,
        userId,
        enrichmentLevel,
        campaignName
    }));

    if (!leads || leads.length === 0) {
        console.log('[ENRICH] No leads to enrich in payload');
        return { enrichedCount: 0, skipped: true, reason: 'no_leads' };
    }

    const leadsToEnrich = leads.slice(0, limit - (usage.leads_enriched || 0));

    console.log(`[ENRICH] Enriching ${leadsToEnrich.length} leads`);

    const appUrl = APP_URL;
    console.log(`[ENRICH] Using appUrl: ${appUrl}`);

    if (!appUrl) {
        console.error('[ENRICH] APP_URL not configured!');
        throw new Error('APP_URL environment variable not configured');
    }

    // Map leads to the format expected by the API
    const leadsFormatted = leadsToEnrich.map(lead => ({
        fullName: lead.name || lead.full_name,
        title: lead.title,
        companyName: lead.organization?.name || lead.organization_name || lead.company_name,
        linkedinUrl: lead.linkedin_url,
        sourceOpportunityId: lead.id
    }));

    console.log(`[ENRICH] Calling enrichment API with ${leadsFormatted.length} leads`);

    try {
        const response = await fetch(`${appUrl}/api/opportunities/enrich-apollo`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-user-id': userId
            },
            body: JSON.stringify({
                leads: leadsFormatted,
                revealEmail: true,
                revealPhone: enrichmentLevel === 'premium'
            })
        });

        console.log(`[ENRICH] API response status: ${response.status}`);

        if (response.ok) {
            const data = await response.json();
            console.log(`[ENRICH] Successfully enriched ${data.enriched?.length || 0} leads`);

            const enrichedLeads = data.enriched || [];
            await incrementUsage(supabase, task.organization_id, 'enrich', enrichedLeads.length);

            // Chain to INVESTIGATE if configured and we have enriched leads
            if (enrichedLeads.length > 0) {
                await supabase.from('antonia_tasks').insert({
                    mission_id: task.mission_id,
                    organization_id: task.organization_id,
                    type: 'INVESTIGATE',
                    status: 'pending',
                    payload: {
                        userId: userId,
                        leads: enrichedLeads,
                        campaignName: campaignName
                    },
                    created_at: new Date().toISOString()
                });
            }

            return {
                enrichedCount: enrichedLeads.length,
                enrichedLeadsSummary: enrichedLeads.map((l: any) => ({
                    name: l.fullName || l.name,
                    company: l.companyName || l.organization?.name,
                    emailFound: !!l.email,
                    linkedinFound: !!(l.linkedinUrl || l.linkedin_url)
                }))
            };
        } else {
            const errorText = await response.text();
            console.error(`[ENRICH] API error: ${response.status} - ${errorText}`);
            return { enrichedCount: 0, error: errorText };
        }
    } catch (e) {
        console.error('[ENRICH] Failed to enrich leads:', e);
        return { enrichedCount: 0, error: String(e) };
    }
}

async function executeInvestigate(task: any, supabase: SupabaseClient) {
    // Get mission limits
    const { data: mission } = await supabase
        .from('antonia_missions')
        .select('daily_investigate_limit')
        .eq('id', task.mission_id)
        .single();

    const usage = await getDailyUsage(supabase, task.organization_id);
    const limit = mission?.daily_investigate_limit || 5;

    if ((usage.leads_investigated || 0) >= limit) {
        console.log(`[INVESTIGATE] Daily limit reached (${usage.leads_investigated}/${limit})`);
        return { skipped: true, reason: 'daily_limit_reached' };
    }

    const { leads, userId, campaignName } = task.payload;
    const leadsToInvestigate = leads.slice(0, limit - (usage.leads_investigated || 0));

    console.log(`[INVESTIGATE] Investigating ${leadsToInvestigate.length} leads`);

    const appUrl = APP_URL;
    const investigatedLeads = [];

    for (const lead of leadsToInvestigate) {
        try {
            console.log(`[INVESTIGATE] Investigating lead:`, {
                name: lead.fullName || lead.full_name,
                company: lead.companyName || lead.company_name
            });

            const response = await fetch(`${appUrl}/api/research/n8n`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-user-id': userId
                },
                body: JSON.stringify({
                    id: lead.id,
                    fullName: lead.fullName || lead.full_name || lead.name,
                    title: lead.title,
                    email: lead.email,
                    linkedinUrl: lead.linkedinUrl || lead.linkedin_url,
                    companyName: lead.companyName || lead.company_name || lead.organization?.name,
                    companyDomain: lead.companyDomain || lead.company_domain
                })
            });

            console.log(`[INVESTIGATE] API response status: ${response.status}`);

            if (response.ok) {
                const data = await response.json();
                investigatedLeads.push({ ...lead, research: data });
                console.log(`[INVESTIGATE] Successfully investigated lead`);
            } else {
                const errorText = await response.text();
                console.error(`[INVESTIGATE] API error: ${response.status} - ${errorText}`);
            }
        } catch (e) {
            console.error('[INVESTIGATE] Failed to investigate lead:', e);
        }
    }

    await incrementUsage(supabase, task.organization_id, 'investigate', investigatedLeads.length);

    // Chain to CONTACT if we have investigated leads
    if (investigatedLeads.length > 0) {

        // --- TIMEZONE SCHEDULING LOGIC ---
        // Default target hour: 8 AM
        // Default Timezone: Chile (UTC-3 summer, UTC-4 winter) -> Let's use generic offset logic for simplicity or UTC
        // Since we don't have a lookup table yet, we'll use a simplified mapping.

        for (const lead of investigatedLeads) {
            let scheduledFor = new Date().toISOString(); // Default to NOW (immediate)

            try {
                // Heuristic for timezone offset based on location string
                // Map: Location -> Offset from UTC (approximate standard time)
                // Chile: -4 (or -3), Colombia: -5, Mexico: -6, Spain: +1

                const location = (lead.company_location?.[0] || lead.location || '').toLowerCase();
                let utcOffset = -3; // Default to Chile (UTC-3 for Summer)

                if (location.includes('colombia') || location.includes('peru') || location.includes('ecuador') || location.includes('panama')) {
                    utcOffset = -5;
                } else if (location.includes('mexico') || location.includes('costa rica') || location.includes('guatemala')) {
                    utcOffset = -6;
                } else if (location.includes('argentina') || location.includes('uruguay') || location.includes('chile') || location.includes('brasil')) {
                    // Chile/Argentina/Uruguay/Brazil -> UTC-3 (approx)
                    utcOffset = -3;
                } else if (location.includes('spain') || location.includes('espana') || location.includes('madrid') || location.includes('barcelona')) {
                    utcOffset = +1;
                }

                // Calculate target time (8 AM in target timezone)
                const now = new Date();
                const targetHour = 8; // 8 AM

                // Get current UTC time
                const currentUtcHour = now.getUTCHours();

                // Calculate what time it is physically in the target location
                // LocalHour = UTCHour + Offset
                const currentLocalHour = currentUtcHour + utcOffset;

                // Determine schedule date
                let scheduleDate = new Date(now);

                // If it's already past 8 AM locally, schedule for tomorrow
                if (currentLocalHour >= targetHour) {
                    scheduleDate.setDate(scheduleDate.getDate() + 1);
                }

                // Set the target time in UTC
                // UTCTarget = 8 AM - Offset
                // e.g. Colombia (UTC-5): 8 - (-5) = 13 UTC
                const targetUtcHour = targetHour - utcOffset;

                scheduleDate.setUTCHours(targetUtcHour, Math.floor(Math.random() * 30), 0, 0); // Random minute 0-30 for jitter

                scheduledFor = scheduleDate.toISOString();
                console.log(`[SCHEDULING] Scheduled contact for ${lead.email} in ${location} (Offset ${utcOffset}) at ${scheduledFor}`);

            } catch (err) {
                console.error('[SCHEDULING] Error calculating schedule, default to NOW:', err);
                // scheduledFor remains NOW
            }

            // Create individual CONTACT tasks per lead to allow individual scheduling
            // Note: Your schema/loop structure previously batched them.
            // If we want individual scheduling, we should insert tasks individually.
            // BUT currently the system processes a batch.
            // Compromise: Schedule the batch based on the FIRST lead's location or majority.
            // OR split insertion. Splitting is cleaner for scheduling.

            await supabase.from('antonia_tasks').insert({
                mission_id: task.mission_id,
                organization_id: task.organization_id,
                type: 'CONTACT',
                status: 'pending',
                payload: {
                    userId: userId,
                    leads: [lead], // Single lead per task for precise scheduling
                    campaignName: campaignName
                },
                scheduled_for: scheduledFor,
                created_at: new Date().toISOString()
            });
        }
    }

    return {
        investigatedCount: investigatedLeads.length,
        investigations: investigatedLeads.map((l: any) => ({
            name: l.fullName || l.name || l.full_name,
            company: l.companyName || l.company_name || l.organization?.name,
            summarySnippet: l.research?.summary ? l.research.summary.substring(0, 100) + '...' : 'No summary available'
        }))
    };
}

// --- 4. EXECUTE INITIAL CONTACT (Personalized) ---
async function executeInitialContact(task: any, supabase: SupabaseClient) {
    // Get mission limits
    const { data: mission } = await supabase
        .from('antonia_missions')
        .select('daily_contact_limit')
        .eq('id', task.mission_id)
        .single();

    const usage = await getDailyUsage(supabase, task.organization_id);
    const limit = mission?.daily_contact_limit || 3;

    // Count contacts sent today
    const today = new Date().toISOString().split('T')[0];
    const { count: contactsToday } = await supabase
        .from('contacted_leads')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', task.organization_id)
        .gte('created_at', `${today}T00:00:00Z`);

    if ((contactsToday || 0) >= limit) {
        console.log(`[CONTACT] Daily limit reached (${contactsToday}/${limit})`);
        return { skipped: true, reason: 'daily_limit_reached' };
    }

    const { leads, userId, campaignName } = task.payload;
    const leadsToContact = leads.slice(0, limit - (contactsToday || 0));

    console.log(`[CONTACT] Contacting ${leadsToContact.length} leads`);

    // Fetch user's email signature from profiles
    const { data: profile } = await supabase
        .from('profiles')
        .select('signatures')
        .eq('id', userId)
        .single();

    // Get the signature for the provider being used (google or outlook)
    // Signatures are stored as: { google: "...", outlook: "..." }
    let userSignature = '';
    if (profile?.signatures) {
        // Try to get signature for google first (most common), fallback to outlook
        userSignature = profile.signatures.google || profile.signatures.outlook || '';
    }

    // Use default introduction template with research variables
    // Note: Campaign is ignored here as this is the initial research-based outreach
    const subject = 'Oportunidad de colaboración - {{company}}';
    let body = `Hola {{name}},

Estuve leyendo sobre {{company}} y vi que {{research.summary}}

Me pareció muy interesante y me gustaría conectar contigo para explorar posibles oportunidades de colaboración.

¿Tendrías disponibilidad para una breve conversación?

Saludos,`;

    // Add user signature if available, otherwise use default
    if (userSignature) {
        body += `\n\n${userSignature}`;
    } else {
        body += `\n\nANTON.IA Agent\nEnviado automáticamente por ANTON.IA`;
    }

    // Get app URL for unsubscribe link
    const appUrl = APP_URL;

    // Add Unsubscribe Link
    const unsubscribeFooter = `\n\n-----------------------------------\nSi no deseas recibir más correos, haz clic aquí: ${appUrl}/unsubscribe?email={{email}}`;
    body += unsubscribeFooter;

    console.log(`[CONTACT_INITIAL] Using research-based template`);

    let contactedCount = 0;

    for (const lead of leadsToContact) {
        try {
            // Safe access to research summary
            const researchSummary = lead.research?.summary || lead.research_summary || 'tienen iniciativas interesantes en curso.';

            // Replace template variables
            const personalizedSubject = subject
                .replace(/\{\{name\}\}/g, lead.fullName || lead.full_name || 'there')
                .replace(/\{\{company\}\}/g, lead.companyName || lead.company_name || 'your company');

            const personalizedBody = body
                .replace(/\{\{name\}\}/g, lead.fullName || lead.full_name || 'there')
                .replace(/\{\{company\}\}/g, lead.companyName || lead.company_name || 'your company')
                .replace(/\{\{title\}\}/g, lead.title || 'your role')
                .replace(/\{\{research\.summary\}\}/g, researchSummary)
                .replace(/\{\{email\}\}/g, lead.email || '');

            console.log(`[CONTACT] Sending email to ${lead.email}`);

            const response = await fetch(`${appUrl}/api/contact/send`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-user-id': userId
                },
                body: JSON.stringify({
                    to: lead.email,
                    subject: personalizedSubject,
                    body: personalizedBody,
                    leadId: lead.id,
                    campaignId: null,
                    missionId: task.mission_id,
                    userId: userId
                })
            });

            console.log(`[CONTACT] API response status: ${response.status}`);

            if (response.ok) {
                contactedCount++;
                const resData = await response.json();
                console.log(`[CONTACT] Successfully contacted lead via ${resData.provider}`);

                await supabase.from('contacted_leads').insert({
                    user_id: userId,
                    organization_id: task.organization_id,
                    mission_id: task.mission_id,
                    lead_id: lead.id,
                    status: 'sent', // Initial status
                    subject: personalizedSubject,
                    provider: resData.provider || 'unknown',
                    sent_at: new Date().toISOString()
                });
            } else {
                const errorText = await response.text();
                console.error(`[CONTACT] API error: ${response.status} - ${errorText}`);

                // Track error for reporting
                lead.error = `API Error ${response.status}: ${errorText.substring(0, 100)}`;
            }
        } catch (e: any) {
            console.error('[CONTACT] Failed to contact lead:', e);
            lead.error = `Exception: ${e.message}`;
        }
    }

    // Do NOT mark mission as completed immediately. 
    // The mission continues with the evaluation phase.

    return {
        contactedCount,
        contactedList: leadsToContact.map((l: any) => ({
            name: l.fullName || l.full_name,
            email: l.email,
            company: l.companyName || l.company_name,
            status: l.error ? 'failed' : 'sent',
            error: l.error || null
        }))
    };
}
// --- 5. EXECUTE EVALUATION (AI Brain) ---
async function executeEvaluate(task: any, supabase: SupabaseClient) {
    // Determine which leads need evaluation
    // In a real scenario, this task would receive specific leads to evaluate
    // For now, let's assume the payload contains the leads to evaluate
    const { leads } = task.payload;
    let qualifiedCount = 0;

    for (const lead of leads) {
        // Fetch interaction history
        const { data: interactions } = await supabase
            .from('lead_responses')
            .select('*')
            .eq('lead_id', lead.id);

        const { data: contactedLead } = await supabase
            .from('contacted_leads')
            .select('engagement_score')
            .eq('lead_id', lead.id)
            .single();

        const score = contactedLead?.engagement_score || 0;
        const hasReplied = interactions?.some((i: any) => i.type === 'reply');

        console.log(`[EVALUATE] Leading ${lead.email} - Score: ${score}, Replied: ${hasReplied}`);

        // AI LOGIC PLACEHOLDER (To be replaced with actual LLM call)
        // Rule-based fallback for now:
        // 1. If replied -> Action Required (Manual)
        // 2. If Score > 3 (e.g. clicked or multiple opens) -> Qualified
        // 3. If Score <= 3 -> Disqualified (or wait)

        let newStatus = 'disqualified';

        if (hasReplied) {
            newStatus = 'action_required';
        } else if (score > 1) { // Low threshold for testing: > 1 open
            newStatus = 'qualified';
            qualifiedCount++;

            // Trigger Campaign Follow-up
            await supabase.from('antonia_tasks').insert({
                mission_id: task.mission_id,
                organization_id: task.organization_id,
                type: 'CONTACT_CAMPAIGN',
                status: 'pending',
                payload: {
                    leads: [lead],
                    userId: task.payload.userId,
                    campaignName: task.payload.campaignName
                },
                position: task.position + 1
            });
            console.log(`[EVALUATE] Lead qualified! Created CONTACT_CAMPAIGN task.`);
        }

        // Update status
        await supabase.from('contacted_leads').update({
            evaluation_status: newStatus
        }).eq('lead_id', lead.id);
    }

    return { evaluatedCount: leads.length, qualifiedCount };
}

// --- 6. EXECUTE CONTACT CAMPAIGN (Follow-up) ---
async function executeContactCampaign(task: any, supabase: SupabaseClient) {
    // This function sends the actual campaign sequence to QUALIFIED leads
    // Logic is similar to legacy executeContact but specific to campaigns

    // Reuse legacy logic for now, but ensure we mark as completed
    const result = await executeLegacyContact(task, supabase);

    // Complete the mission for this lead
    // Note: If we have multiple tasks per mission, we might need smarter completion logic
    // For single-flow missions, this is fine
    await supabase
        .from('antonia_missions')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', task.mission_id);

    return result;
}

// Reuse legacy contact logic helper
// --- 7. EXECUTE REPORT GENERATION ---
async function executeReportGeneration(task: any, supabase: SupabaseClient) {
    const { reportType, missionId, userId } = task.payload; // reportType: 'mission_historic' | 'daily'
    const organizationId = task.organization_id;

    console.log(`[REPORT] Generating ${reportType} report for Org ${organizationId}`);

    let htmlContent = '';
    let summaryData = {};
    let subject = '';

    if (reportType === 'mission_historic') {
        // Fetch Mission Details
        const { data: mission } = await supabase
            .from('antonia_missions')
            .select('*')
            .eq('id', missionId)
            .single();

        if (!mission) throw new Error('Mission not found');

        subject = `Reporte de Misión: ${mission.title}`;

        // Fetch Metrics
        const { count: leadsFound } = await supabase.from('leads').select('*', { count: 'exact', head: true }).eq('mission_id', missionId);
        const { count: leadsEnriched } = await supabase.from('enriched_leads').select('*', { count: 'exact', head: true }).eq('mission_id', missionId); // note: checked if enriched_leads has mission_id, added in migration
        // If enriched_leads table not used/updated, we might count from tasks/logs? 
        // fallback: query leads with email not null? No.
        // Let's assume migration worked or we query leads with status 'enriched' if that exists.
        // For now using leads table count as base.

        // Contacted
        const { count: leadsContacted } = await supabase.from('contacted_leads').select('*', { count: 'exact', head: true }).eq('mission_id', missionId);

        // Replies (Positive/Negative) via lead_responses or contacted_leads status
        const { count: replies } = await supabase.from('contacted_leads').select('*', { count: 'exact', head: true })
            .eq('mission_id', missionId)
            .neq('evaluation_status', 'pending');

        // Calculate conversion rates
        const enrichmentRate = leadsFound ? ((leadsEnriched || 0) / leadsFound * 100).toFixed(1) : '0';
        const contactRate = leadsFound ? ((leadsContacted || 0) / leadsFound * 100).toFixed(1) : '0';
        const responseRate = leadsContacted ? ((replies || 0) / leadsContacted * 100).toFixed(1) : '0';

        // HTML Template
        htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { 
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    padding: 20px;
                    line-height: 1.6;
                }
                .container { 
                    max-width: 800px; 
                    margin: 0 auto; 
                    background: #ffffff; 
                    border-radius: 16px; 
                    overflow: hidden; 
                    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                }
                .header { 
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: #ffffff; 
                    padding: 40px 30px; 
                    text-align: center;
                    position: relative;
                }
                .header::after {
                    content: '';
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    height: 4px;
                    background: linear-gradient(90deg, #fbbf24, #f59e0b, #fbbf24);
                }
                .header h1 { 
                    margin: 0 0 10px 0; 
                    font-size: 32px; 
                    font-weight: 700;
                    text-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                .header p { 
                    font-size: 18px; 
                    opacity: 0.95;
                    font-weight: 300;
                }
                .mission-info {
                    background: #f8fafc;
                    padding: 25px 30px;
                    border-bottom: 1px solid #e2e8f0;
                }
                .mission-info-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 20px;
                }
                .info-item {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                }
                .info-label {
                    font-size: 11px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    color: #64748b;
                    font-weight: 600;
                    line-height: 1.2;
                }
                .info-value {
                    font-size: 15px;
                    color: #1e293b;
                    font-weight: 600;
                    line-height: 1.3;
                }
                .stats-section {
                    padding: 30px;
                }
                .section-title {
                    font-size: 20px;
                    font-weight: 700;
                    color: #1e293b;
                    margin-bottom: 20px;
                    padding-bottom: 10px;
                    border-bottom: 2px solid #e2e8f0;
                }
                .stats-grid { 
                    display: grid; 
                    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); 
                    gap: 20px; 
                    margin-bottom: 30px;
                }
                .stat-card { 
                    background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
                    padding: 24px; 
                    border-radius: 12px; 
                    text-align: center; 
                    border: 1px solid #e2e8f0;
                    transition: transform 0.2s, box-shadow 0.2s;
                    position: relative;
                    overflow: hidden;
                }
                .stat-card::before {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    height: 3px;
                    background: linear-gradient(90deg, #667eea, #764ba2);
                }
                .stat-card:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 8px 16px rgba(0,0,0,0.1);
                }
                .stat-value { 
                    font-size: 36px; 
                    font-weight: 800; 
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    background-clip: text;
                    margin-bottom: 8px;
                }
                .stat-label { 
                    font-size: 13px; 
                    text-transform: uppercase; 
                    letter-spacing: 1px; 
                    color: #64748b; 
                    font-weight: 600;
                }
                .conversion-metrics {
                    background: #fefce8;
                    border: 1px solid #fde047;
                    border-radius: 12px;
                    padding: 20px;
                    margin-bottom: 30px;
                }
                .conversion-title {
                    font-size: 16px;
                    font-weight: 700;
                    color: #854d0e;
                    margin-bottom: 15px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .conversion-title::before {
                    content: '📊';
                    font-size: 20px;
                }
                .conversion-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                    gap: 15px;
                }
                .conversion-item {
                    text-align: center;
                }
                .conversion-value {
                    font-size: 28px;
                    font-weight: 800;
                    color: #ca8a04;
                }
                .conversion-label {
                    font-size: 12px;
                    color: #854d0e;
                    margin-top: 4px;
                }
                .progress-bar {
                    background: #e2e8f0;
                    height: 8px;
                    border-radius: 4px;
                    overflow: hidden;
                    margin-top: 8px;
                }
                .progress-fill {
                    height: 100%;
                    background: linear-gradient(90deg, #667eea, #764ba2);
                    border-radius: 4px;
                    transition: width 0.3s ease;
                }
                .summary-section {
                    background: #f8fafc;
                    padding: 25px;
                    border-radius: 12px;
                    margin-bottom: 20px;
                }
                .summary-section h3 {
                    font-size: 18px;
                    font-weight: 700;
                    color: #1e293b;
                    margin-bottom: 15px;
                }
                .summary-section p {
                    color: #475569;
                    line-height: 1.8;
                    margin-bottom: 12px;
                }
                .status-badge {
                    display: inline-block;
                    padding: 6px 16px;
                    border-radius: 20px;
                    font-size: 13px;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                .status-active {
                    background: #dcfce7;
                    color: #166534;
                }
                .status-paused {
                    background: #fef3c7;
                    color: #92400e;
                }
                .status-completed {
                    background: #dbeafe;
                    color: #1e40af;
                }
                .footer { 
                    background: #1e293b;
                    padding: 20px; 
                    text-align: center; 
                    font-size: 13px; 
                    color: #94a3b8;
                }
                .footer strong {
                    color: #e2e8f0;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>📊 Reporte de Misión</h1>
                    <p>${mission.title}</p>
                </div>
                
                <div class="mission-info">
                    <div class="mission-info-grid">
                        <div class="info-item">
                            <span class="info-label">Fecha de Inicio</span>
                            <span class="info-value">${new Date(mission.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Estado</span>
                            <span class="status-badge status-${mission.status}">${mission.status === 'active' ? 'ACTIVA' : mission.status === 'paused' ? 'PAUSADA' : 'COMPLETADA'}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Objetivo</span>
                            <span class="info-value">${mission.params?.jobTitle || 'N/A'}</span>
                        </div>
                    </div>
                </div>

                <div class="stats-section">
                    <h2 class="section-title">Métricas Principales</h2>
                    <div class="stats-grid">
                        <div class="stat-card">
                            <div class="stat-value">${leadsFound || 0}</div>
                            <div class="stat-label">Leads Encontrados</div>
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: 100%;"></div>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">${leadsEnriched || 0}</div>
                            <div class="stat-label">Enriquecidos</div>
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${enrichmentRate}%;"></div>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">${leadsContacted || 0}</div>
                            <div class="stat-label">Contactados</div>
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${contactRate}%;"></div>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">${replies || 0}</div>
                            <div class="stat-label">Respuestas</div>
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${responseRate}%;"></div>
                            </div>
                        </div>
                    </div>

                    <div class="conversion-metrics">
                        <div class="conversion-title">Tasas de Conversión</div>
                        <div class="conversion-grid">
                            <div class="conversion-item">
                                <div class="conversion-value">${enrichmentRate}%</div>
                                <div class="conversion-label">Enriquecimiento</div>
                            </div>
                            <div class="conversion-item">
                                <div class="conversion-value">${contactRate}%</div>
                                <div class="conversion-label">Contacto</div>
                            </div>
                            <div class="conversion-item">
                                <div class="conversion-value">${responseRate}%</div>
                                <div class="conversion-label">Respuesta</div>
                            </div>
                        </div>
                    </div>

                    <div class="summary-section">
                        <h3>📋 Resumen Ejecutivo</h3>
                        <p>La misión <strong>"${mission.title}"</strong> comenzó el <strong>${new Date(mission.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })}</strong> y ha estado procesando prospectos de forma automática según los criterios definidos.</p>
                        <p><strong>Progreso:</strong> De ${leadsFound || 0} leads encontrados, se han enriquecido ${leadsEnriched || 0} (${enrichmentRate}%) y contactado ${leadsContacted || 0} (${contactRate}%). Se han recibido ${replies || 0} respuestas, lo que representa una tasa de respuesta del ${responseRate}%.</p>
                        <p><strong>Estado actual:</strong> <span class="status-badge status-${mission.status}">${mission.status === 'active' ? 'ACTIVA' : mission.status === 'paused' ? 'PAUSADA' : 'COMPLETADA'}</span></p>
                    </div>
                </div>

                <div class="footer">
                    <strong>🤖 Generado automáticamente por Antonia AI</strong><br>
                    ${new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
            </div>
        </body>
        </html>
        `;
    }

    // Save to Database
    const { data: report, error } = await supabase.from('antonia_reports').insert({
        organization_id: organizationId,
        mission_id: missionId, // Nullable
        type: reportType,
        content: htmlContent,
        summary_data: summaryData,
        sent_to: [userId], // Placeholder, ideally fetch user email
        created_at: new Date().toISOString()
    }).select().single();

    if (error) {
        console.error('Failed to save report', error);
        throw error;
    }

    // Send Email (Reuse contact API for simplicity, or implement direct send)
    // We need to fetch the user's email first to send TO them.
    const { data: userProfile } = await supabase.rpc('get_user_email_by_id', { user_uuid: userId });
    // Usually we don't have access to auth.users email directly via client unless using service role admin auth.getUser(uid).
    // But we are in Cloud Function environment. We can use admin auth.
    const { data: { user: authUser }, error: authError } = await supabase.auth.admin.getUserById(userId);

    if (authUser && authUser.email) {
        console.log(`[REPORT] Sending email to ${authUser.email}`);
        // We can't use 'executeInitialContact' API call style because that uses user's connected GMAIL.
        // Reports should ideally come from "system@antonia.ai" (Resend/SendGrid).
        // BUT user configuration likely only has THEIR connected account.
        // So we send FROM them TO them? Or self-send.
        // Let's assume self-send for now using their connected account.

        const appUrl = APP_URL;
        await fetch(`${appUrl}/api/contact/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
            body: JSON.stringify({
                to: authUser.email,
                subject: subject,
                body: htmlContent,
                isHtml: true,
                userId: userId
            })
        });
    }

    return { reportId: report.id, generated: true };
}

async function executeLegacyContact(task: any, supabase: SupabaseClient) {
    const { leads, userId, campaignName } = task.payload;
    const appUrl = APP_URL;
    let contactedCount = 0;

    // Fetch Campaign
    const { data: campaign } = await supabase
        .from('campaigns')
        .select('*')
        .eq('organization_id', task.organization_id)
        .eq('name', campaignName)
        .maybeSingle();

    const subject = campaign?.settings?.subject || 'Follow up';
    const body = campaign?.settings?.body || 'Just checking in...';

    for (const lead of leads) {
        try {
            console.log(`[CONTACT_CAMPAIGN] Sending campaign email to ${lead.email}`);
            const response = await fetch(`${appUrl}/api/contact/send`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-user-id': userId
                },
                body: JSON.stringify({
                    to: lead.email,
                    subject: subject,
                    body: body,
                    leadId: lead.id,
                    campaignId: campaign?.id,
                    missionId: task.mission_id,
                    userId: userId,
                    metadata: { type: 'campaign_followup' }
                })
            });
            if (response.ok) {
                contactedCount++;
                // We don't read JSON here in legacy logic usually, but let's do it for consistency
                // Note: fetch body might have been consumed if we are not careful? No, it's fresh response.
                // However, let's keep it simple for legacy campaign_followup or just do same logic:
                try {
                    const resData = await response.json();
                    await supabase.from('contacted_leads').insert({
                        user_id: userId,
                        organization_id: task.organization_id,
                        mission_id: task.mission_id,
                        lead_id: lead.id,
                        status: 'sent',
                        subject: subject, // from campaign settings above
                        provider: resData.provider || 'unknown',
                        sent_at: new Date().toISOString(),
                        data: {
                            campaign_id: campaign?.id,
                            type: 'followup'
                        }
                    });
                } catch (err) { console.error('Error recording contact', err); }
            }
        } catch (e) { console.error(e); }
    }
    return { contactedCount };
}

async function processTask(task: any, supabase: SupabaseClient) {
    console.log(`[Worker] Processing task ${task.id} (${task.type})`);

    await supabase.from('antonia_tasks').update({
        status: 'processing',
        processing_started_at: new Date().toISOString()
    }).eq('id', task.id);

    try {
        const { data: taskConfig } = await supabase
            .from('antonia_config')
            .select('*')
            .eq('organization_id', task.organization_id)
            .single();

        let result = {};

        switch (task.type) {
            case 'GENERATE_CAMPAIGN':
                result = await executeCampaignGeneration(task, supabase, taskConfig);
                break;
            case 'SEARCH':
                result = await executeSearch(task, supabase, taskConfig);
                break;
            case 'ENRICH':
                result = await executeEnrichment(task, supabase, taskConfig);
                break;
            case 'INVESTIGATE':
                result = await executeInvestigate(task, supabase);
                break;
            case 'EVALUATE':
                result = await executeEvaluate(task, supabase);
                break;
            case 'CONTACT_CAMPAIGN':
                result = await executeContactCampaign(task, supabase);
                break;
            case 'CONTACT': // Legacy support
            case 'CONTACT_INITIAL':
                result = await executeInitialContact(task, supabase);
                break;
            case 'GENERATE_REPORT':
                result = await executeReportGeneration(task, supabase);
                break;
        }

        await supabase.from('antonia_tasks').update({
            status: 'completed',
            result: result,
            updated_at: new Date().toISOString()
        }).eq('id', task.id);

        await supabase.from('antonia_logs').insert({
            mission_id: task.mission_id,
            organization_id: task.organization_id,
            level: 'success',
            message: `Task ${task.type} completed successfully.`,
            details: result
        });

    } catch (e: any) {
        console.error(`[Worker] Task ${task.id} Failed`, e);
        await supabase.from('antonia_tasks').update({
            status: 'failed',
            error_message: e.message,
            updated_at: new Date().toISOString()
        }).eq('id', task.id);

        await supabase.from('antonia_logs').insert({
            mission_id: task.mission_id,
            organization_id: task.organization_id,
            level: 'error',
            message: `Task ${task.type} failed: ${e.message}`
        });
    }
}

// Main scheduler function
export const antoniaTick = functions.scheduler.onSchedule({
    schedule: 'every 1 minutes',
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
}, async (event) => {
    console.log('[AntoniaTick] waking up...');

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error('Missing Supabase credentials');
        return;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // --- 0. SCHEDULE DAILY TASKS FOR ACTIVE MISSIONS ---
    // This runs the SQL function that creates daily SEARCH tasks for active missions
    // The function uses date-based idempotency to ensure only one task per mission per day
    try {
        const { data: scheduledMissions, error: scheduleError } = await supabase
            .rpc('schedule_daily_mission_tasks');

        if (scheduleError) {
            console.error('[AntoniaTick] Error scheduling daily missions:', scheduleError);
        } else if (scheduledMissions && scheduledMissions.length > 0) {
            console.log(`[AntoniaTick] Scheduled tasks for ${scheduledMissions.length} active missions`);
        }
    } catch (e) {
        console.error('[AntoniaTick] Failed to schedule missions:', e);
        // Don't fail the entire tick if scheduling fails
    }

    // --- 1. PROCESS PENDING TASKS ---
    const { data: tasks, error } = await supabase
        .from('antonia_tasks')
        .select('*')
        .eq('status', 'pending')
        .or(`scheduled_for.is.null,scheduled_for.lte.${new Date().toISOString()}`)
        .limit(5);

    if (error) {
        console.error('Error fetching tasks', error);
    } else if (tasks && tasks.length > 0) {
        console.log(`[AntoniaTick] Processing ${tasks.length} tasks`);
        await Promise.all(tasks.map(t => processTask(t, supabase)));
    }

    // --- 2. SCAN FOR EVALUATION (The Heartbeat) ---
    // Find leads contacted > 2 days ago (or > 5 mins for testing) with status 'pending'
    // For testing purposes, we'll use 5 minutes delay
    const checkTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const { data: pendingLeads } = await supabase
        .from('contacted_leads')
        .select(`
                lead_id, 
                organization_id, 
                leads!inner ( id, email, organization_id )
            `)
        .eq('evaluation_status', 'pending')
        .lt('last_interaction_at', checkTime)
        .limit(10);

    if (pendingLeads && pendingLeads.length > 0) {
        console.log(`[AntoniaTick] Found ${pendingLeads.length} leads pending evaluation`);

        // Group by Organization to create tasks efficiently
        const orgGroups = groupBy(pendingLeads, 'organization_id');

        for (const orgId of Object.keys(orgGroups)) {
            // Find an active mission for this org (simplification: just find the latest active one)
            // ideally we should store mission_id in contacted_leads table
            const { data: mission } = await supabase
                .from('antonia_missions')
                .select('id, created_by')
                .eq('organization_id', orgId)
                .eq('status', 'active')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (mission) {
                const leadsForOrg = orgGroups[orgId].map((pl: any) => pl.leads);

                // Create EVALUATE task
                await supabase.from('antonia_tasks').insert({
                    mission_id: mission.id,
                    organization_id: orgId,
                    type: 'EVALUATE',
                    status: 'pending',
                    payload: {
                        leads: leadsForOrg,
                        userId: mission.created_by,
                        campaignName: 'Smart Campaign' // Placeholder
                    }
                });
                console.log(`[AntoniaTick] Created EVALUATE task for Org ${orgId}`);

                // Update status to 'evaluating' to avoid double processing
                const leadIds = leadsForOrg.map((l: any) => l.id);
                await supabase
                    .from('contacted_leads')
                    .update({ evaluation_status: 'evaluating' }) // Temporary status
                    .in('lead_id', leadIds);
            }
        }
    }
});

// Helper for grouping
function groupBy(xs: any[], key: string) {
    return xs.reduce(function (rv, x) {
        (rv[x[key]] = rv[x[key]] || []).push(x);
        return rv;
    }, {});
}


// Force rebuild Wed Dec 24 04:51:10 AM UTC 2025
