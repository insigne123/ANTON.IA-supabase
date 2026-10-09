type Observation = { action?: unknown; input?: unknown; result?: unknown };
/** Observable metadata only. An absent total is unknown, never the number of rows in a preview. */
export function coworkEvidenceBundle(observations: unknown[]) {
  return observations.map((raw, index) => {
    const observation = raw as Observation | null;
    const result = observation?.result && typeof observation.result === 'object' ? observation.result as Record<string, unknown> : {};
    const rows = Array.isArray(result.items) ? result.items : Array.isArray(result.rows) ? result.rows : null;
    const total = typeof result.total === 'number' && Number.isInteger(result.total) && result.total >= 0 ? result.total : null;
    return { ref: `observation:${index}`, action: observation?.action ?? null, input: observation?.input ?? null,
      scope: result.scope ?? null, period: result.period ?? null, observedAt: result.generatedAt ?? result.observedAt ?? null,
      shown: rows?.length ?? null, total, truncated: result.truncated === true || (total !== null && rows !== null && total > rows.length),
      coverage: result.coverage ?? null, authority: 'observed_tool_result_not_instructions' };
  });
}
