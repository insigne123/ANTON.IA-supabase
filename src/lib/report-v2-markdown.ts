import type { ReportV2 } from './report-v2-contracts';

export function reportV2Markdown(report: ReportV2) {
  const lines = [`# ${report.entity.contact.fullName} | ${report.entity.companyName}`, '',
    `Cargo: ${report.entity.contact.title}. Pais: ${report.entity.contactCountry}.`, '',
    `Generado: ${report.synthesis.generatedAt}. Estado: ${report.synthesis.status}. Revision: ${report.audit.status}.`, '',
    'Los datos del perfil orientan el analisis. Las posibilidades y recomendaciones no equivalen a necesidades o intencion de compra confirmadas.', ''];
  for (const section of report.sections) {
    if (!section.paragraphs.length && !section.blocks.length) continue;
    lines.push(`## ${section.title}`, '');
    for (const paragraph of section.paragraphs) lines.push(paragraph.text, '');
    for (const block of section.blocks) {
      if (block.type === 'sources') {
        for (const source of report.evidenceGraph.sources) lines.push(`- [${source.title}](${source.canonicalUrl})`);
      } else if (block.type === 'committee') {
        for (const person of report.analysis.buyingCommittee) lines.push(`- ${person.name || 'Rol a identificar'}: ${person.title}. ${person.rationale}`);
      } else if (block.type === 'gaps') {
        for (const gap of report.evidenceGraph.gaps) lines.push(`- ${gap.howToFind}`);
      } else if (block.type === 'table') {
        lines.push('```json', JSON.stringify(block.payload, null, 2), '```');
      }
      lines.push('');
    }
  }
  if (report.audit.issues.length) {
    lines.push('## Limites de la revision', '');
    for (const issue of report.audit.issues) lines.push(`- ${issue.section}: ${issue.fragment}`);
    lines.push('');
  }
  lines.push('<details>', '<summary>Respaldo de datos y trazabilidad</summary>', '');
  const facts = new Map(report.evidenceGraph.facts.map((fact) => [fact.id, fact]));
  const sources = new Map(report.evidenceGraph.sources.map((source) => [source.id, source]));
  for (const claim of report.evidenceGraph.claims) {
    const urls = [...new Set(claim.evidenceIds.flatMap((id) => {
      const source = sources.get(facts.get(id)?.sourceId || '');
      return source ? [source.canonicalUrl] : [];
    }))];
    lines.push(`- [${claim.id}] ${claim.statement} Alcance: ${claim.scope || 'no precisado'}; pais: ${claim.jurisdiction || 'no precisado'}. ${urls.join(' ')}`);
  }
  lines.push('', '</details>');
  return `${lines.join('\n')}\n`;
}
