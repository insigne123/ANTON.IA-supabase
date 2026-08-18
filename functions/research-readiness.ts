function record(value: any): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function array(value: any): any[] {
    return Array.isArray(value) ? value : [];
}

function statement(value: any): string {
    if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
    const item = record(value);
    return String(item.statement || item.detail || item.summary || item.title || item.text || item.value || '').trim();
}

function marker(value: any): string {
    const normalized = String(value || '').trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[\s-]+/g, '_');
    if (normalized.includes('invalid_response') || normalized.startsWith('error_parsing.')) return 'invalid_response';
    if (normalized.includes('http_error') || normalized.includes('provider_http_error')) return 'http_error';
    if (normalized.includes('fallback') || normalized.startsWith('no_se_pudo_completar_la_investigacion_automatica')) return 'fallback';
    return '';
}

function httpUrl(value: any): boolean {
    try {
        const protocol = new URL(String(value || '')).protocol;
        return protocol === 'http:' || protocol === 'https:';
    } catch {
        return false;
    }
}

function substantive(value: any): boolean {
    if (record(value).kind === 'company_identity') return false;
    const text = statement(value).replace(/\s+/g, ' ').trim();
    if (!text || httpUrl(text) || marker(text)) return false;
    if (['n/a', 'none', 'null', 'undefined', 'unknown', 'sin datos', 'no disponible'].includes(text.toLowerCase())) return false;
    const terms = text.match(/[\p{L}\p{N}]+/gu) || [];
    return text.length >= 12 && terms.length >= 3;
}

function refs(value: any): string[] {
    const item = record(value);
    return [item.source_ids, item.sourceIds, item.source_id, item.sourceId]
        .flatMap((entry) => Array.isArray(entry) ? entry : entry == null ? [] : [entry])
        .map((entry) => String(entry || '').trim())
        .filter(Boolean);
}

function payloads(raw: any): Record<string, any>[] {
    const root = record(raw);
    const nested = record(root.raw);
    return Object.keys(nested).length > 0 ? [nested, root] : [root];
}

function sourceMap(items: Record<string, any>[]) {
    const byId = new Map<string, string>();
    const urls = new Set<string>();
    let count = 0;
    const add = (source: any) => {
        const item = record(source);
        const url = typeof source === 'string' ? source : item.url;
        if (!httpUrl(url)) return;
        count++;
        urls.add(String(url).trim());
        const id = String(item.id || item.source_id || item.sourceId || '').trim();
        if (id) byId.set(id, String(url).trim());
    };
    items.forEach((item) => {
        const cross = record(record(item.existing_compat).cross || item.cross);
        const website = record(item.websiteSummary || item.website_summary);
        array(item.sources).forEach(add);
        array(cross.sources).forEach(add);
        array(website.sources).forEach(add);
        array(item.signals).forEach(add);
    });
    return { byId, urls, count };
}

export function hasMeaningfulResearchEvidence(raw: any): boolean {
    return payloads(raw).some((item) => {
        const cross = record(record(item.existing_compat).cross || item.cross);
        const company = record(item.company_context);
        const website = record(item.websiteSummary || item.website_summary);
        return [
            item.overview, cross.overview, company.overview, website.overview,
            ...array(item.claims), ...array(item.signals), ...array(item.pains), ...array(cross.pains),
            ...array(company.pain_hypotheses), ...array(item.opportunities), ...array(cross.opportunities),
            ...array(company.opportunity_hypotheses), ...array(website.services),
        ].some(substantive);
    });
}

export function getResearchReadinessBlockReason(raw: any): string | null {
    const items = payloads(raw);
    if (items.every((item) => Object.keys(item).length === 0)) return 'missing_research';
    const status = String(record(items[0].lifecycle).status || items[0].status || '').trim().toLowerCase();
    if (status !== 'completed') return status || 'missing_research_status';
    for (const item of items) {
        const failureCandidates = [item.source, record(item.raw).source, item.overview, record(item.company_context).overview, record(item.website_summary).overview, record(item.cross).overview];
        for (const candidate of failureCandidates) {
            const failure = marker(statement(candidate));
            if (failure) return failure;
        }
        for (const warning of [...array(item.warnings), ...array(item.provider_warnings)]) {
            const failure = marker(statement(warning));
            if (failure) return failure;
        }
        for (const error of array(record(item.lifecycle).errors)) {
            const failure = marker(record(error).code || record(error).message);
            if (failure) return failure;
        }
    }
    if (!hasMeaningfulResearchEvidence(raw)) return 'insufficient_research';
    const sources = sourceMap(items);
    if (sources.count === 0) return 'missing_research_sources';

    const linked = items.some((item) => {
        const evidence = new Map(array(item.evidence)
            .map(record)
            .filter((entry) => sources.byId.has(String(entry.sourceId || entry.source_id || '').trim()))
            .map((entry) => [String(entry.id || '').trim(), entry]));
        if (array(item.claims).some((claim) => substantive(claim) && array(record(claim).supportingEvidenceIds || record(claim).supporting_evidence_ids)
            .some((id) => evidence.has(String(id || '').trim())))) return true;

        const cross = record(record(item.existing_compat).cross || item.cross);
        const company = record(item.company_context);
        const website = record(item.websiteSummary || item.website_summary);
        const candidates: Array<[any, string[]]> = [
            [item.overview, refs(item)], [cross.overview, refs(cross)], [company.overview, refs(company)], [website.overview, refs(website)],
            ...array(website.services).map((value) => [value, refs(website)] as [any, string[]]),
            ...array(item.signals).map((value) => [value, []] as [any, string[]]),
            ...array(item.pains).map((value) => [value, []] as [any, string[]]),
            ...array(cross.pains).map((value) => [value, []] as [any, string[]]),
            ...array(company.pain_hypotheses).map((value) => [value, []] as [any, string[]]),
            ...array(item.opportunities).map((value) => [value, []] as [any, string[]]),
            ...array(cross.opportunities).map((value) => [value, []] as [any, string[]]),
            ...array(company.opportunity_hypotheses).map((value) => [value, []] as [any, string[]]),
        ];
        return candidates.some(([value, inherited]) => {
            if (!substantive(value)) return false;
            const itemRecord = record(value);
            const directUrl = itemRecord.url || itemRecord.source_url || itemRecord.sourceUrl;
            if (httpUrl(directUrl) && sources.urls.has(String(directUrl).trim())) return true;
            return [...refs(value), ...inherited].some((reference) => sources.byId.has(reference));
        });
    });
    return linked ? null : 'missing_evidence_links';
}
