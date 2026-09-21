// Collected excerpts are not the audited commercial report.
export function researchFindings(research: any) {
  const evidence = Array.isArray(research?.result?.evidence) ? research.result.evidence : [];
  return evidence.flatMap((item: any) => {
    if (typeof item?.statement !== 'string' || !item.statement.trim()) return [];
    let url: string | null = null;
    try { const parsed = new URL(item.sourceUrl); if (['https:', 'http:'].includes(parsed.protocol)) url = parsed.href; } catch {}
    return [{ text: item.statement, url }];
  });
}
