// Synthetic data only; writes previews to the explicitly supplied existing directory.
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createResearchPdf } from '../chrome-extension/ui/research-pdf';
const directory = process.argv[2];
if (!directory) throw new Error('Provide a preview output directory');
const profile = { fullName: 'María Fernández', companyName: 'Empresa de demostración', linkedinUrl: 'https://www.linkedin.com/in/demo' };
for (const insufficient of [false, true]) {
  const pdf = createResearchPdf(profile, { researchSnapshotId: 'demostracion-sin-datos-reales', reportDocumentV2: {
    synthesis: { status: insufficient ? 'partial' : 'completed', generatedAt: '2026-09-13T12:00:00Z' },
    sections: ['Resumen y decisión', 'Vista de la cuenta', 'Contacto', 'Comité de compra', 'Empresa', 'Volumen', 'Marco regulatorio', 'Señales', 'Encaje', 'Ángulo comercial', 'Descubrimiento', 'Objeciones', 'Riesgos', 'Datos por validar', 'Fuentes'].map(title => ({ title, paragraphs: [{ text: insufficient ? 'La evidencia disponible no permite concluir este punto. Validar con la persona antes de utilizarlo comercialmente.' : 'Análisis comercial sintético para revisar el diseño del informe final. Describe el contexto de la cuenta, las implicaciones comerciales y el siguiente paso de la conversación. No representa una investigación real.', basis: 'analysis' }], blocks: [] })),
    evidenceGraph: { claims: [], sources: [{ title: 'Fuente de demostración', url: 'https://example.com' }], gaps: [], deliverables: [] },
  }, status: insufficient ? 'insufficient_data' : 'completed', updatedAt: '2026-09-13T12:00:00Z', result: {
    angle: insufficient ? '' : 'Explorar cómo acompaña el equipo de Personas el crecimiento de la empresa.',
    promptPack: { context: insufficient ? '' : 'Ejemplo de presentación del informe. Los siguientes hallazgos son ficticios y solo permiten revisar el diseño, la legibilidad y la paginación.', doNotClaim: ['No afirmar que existe una necesidad de contratación sin validarla con la persona.'] },
    evidence: insufficient ? [] : Array.from({ length: 9 }, (_, i) => ({ statement: `Hallazgo de demostración ${i + 1}. El contexto debe ser concreto, permitir una decisión comercial y mantener una referencia consultable. Este texto sirve exclusivamente para revisar el documento.`, kind: i === 2 ? 'hypothesis' : 'fact', sourceUrl: `https://example.com/fuente-${i + 1}` })),
    sources: insufficient ? [] : [{ title: 'Sitio de demostración · fuente ficticia', url: 'https://example.com' }],
    warnings: insufficient ? ['official_site_fetch_failed', 'person_public_evidence_missing', 'company_context_missing'] : [],
  } });
  await writeFile(resolve(directory, `investigacion-${insufficient ? 'insuficiente' : 'completa'}.pdf`), Buffer.from(pdf.output('arraybuffer')));
  console.log(`PDF ${insufficient ? 'insuficiente' : 'completo'}: ${pdf.getNumberOfPages()} páginas`);
}
