import { generateStructured, generateStructuredWithTelemetry } from '@/ai/openai-json';
import { reportGenerationOptions } from '@/ai/report-models';
import {
  AnalysisV2Schema,
  type AnalysisV2,
  type ClaimV2,
  type CommitteeMemberV2,
  type EntityResolutionV2,
  type GapV2,
  type QualificationV2,
  type SignalV2,
} from '@/lib/report-v2-contracts';
import { serializeReportV2Context } from './write-report-v2-section';
import { buildReportV2VolumeModel, type VolumeAssumptionsV2 } from './build-report-v2-volume';
import { briefReportV2Specialists } from './report-v2-specialists';

export const REASON_REPORT_V2_PROMPT_VERSION = 'report-v2/p5-analysis/6';

export type SellerProductContextV2 = {
  key: string;
  name?: string | null;
  description?: string | null;
  jurisdictions?: string[] | null;
  regulatoryContext?: string | null;
  capabilities?: string[] | null;
  positioning?: string | null;
  volumeAssumptions?: VolumeAssumptionsV2 | null;
};

export type SellerProfileContextV2 = {
  companyName?: string | null;
  products: SellerProductContextV2[];
};

export const REASON_REPORT_V2_SYSTEM_PROMPT = `Eres el analista senior que prepara a un vendedor antes de que contacte a una cuenta. Tu trabajo es
RAZONAR sobre la evidencia y producir un analisis accionable. No redactas prosa final: produces estructura.`;

export function buildReasonReportV2Prompt(input: {
  entity: EntityResolutionV2;
  qualification: QualificationV2;
  claims: ClaimV2[];
  sellerProfile: SellerProfileContextV2;
  specialistBriefs?: unknown;
  companyContext?: string | null;
  signals?: SignalV2[];
  gaps?: GapV2[];
  committee?: CommitteeMemberV2[];
}) {
  return `Cuenta: ${serializeReportV2Context(input.entity)}
Calificacion ICP: ${serializeReportV2Context(input.qualification)}
Claims disponibles: ${serializeReportV2Context(input.claims)}
Perfil del vendedor y sus productos: ${serializeReportV2Context(input.sellerProfile)}
Contexto corporativo importado, utilizable como perfil: ${input.companyContext || 'No disponible'}
Especialistas (analisis, no evidencia nueva): ${serializeReportV2Context(input.specialistBriefs || [])}
Senales con sus IDs: ${serializeReportV2Context(input.signals || [])}
Preguntas pendientes: ${serializeReportV2Context(input.gaps || [])}
Contactos conocidos: ${serializeReportV2Context(input.committee || [])}

Produce el objeto Analysis completo. Estas son las reglas del razonamiento:

TIPADO DE LA CERTEZA. Cada afirmacion lleva un tipo:
  fact: viene de un claim citado.
  derived: calculado desde inputs, assumptions justificadas y formula.
  hypothesis: conjetura con la pregunta exacta que la valida.
  declared: contexto del vendedor; nunca evidencia sobre el objetivo.

Estas autorizado y obligado a calcular cuando existan hechos base y supuestos configurados. Un numero derivado con supuestos visibles es analisis; un numero sin origen es una alucinacion.

VEREDICTO:
- Si la calificacion ICP rechaza al contacto, dilo primero y redirige a quien si sirve.
- Si el producto no aplica a la jurisdiccion, ese es el titular.
- El veredicto debe bastar para decidir el siguiente paso.

COMITE DE COMPRA: investiga la cuenta, no solo la persona importada. Incluye perfiles relevantes y descartados con su razon.

ENCAJE: evalua cada producto por separado. Si el encaje es hipotetico, incluye su pregunta de validacion.

OBJECIONES: plantea objeciones posibles especificas del proceso y oferta, nunca como algo que el contacto ya dijo. Usa evidencia o razonamiento del rol.

HUECOS: cada hueco debe indicar como obtener la informacion.

UTILIDAD COMERCIAL:
- Conserva en verdict.headline, verdict.blockers, entryAngle.timing y fitByProduct.rationale la prioridad y el encaje separados para cuenta y contacto, tamano de oportunidad/ticket segun datos autorizados (o sin datos), timing y factores de respuesta/conversion cualitativos no calibrados, nunca porcentajes inventados. En ausencia de noticias, explicita que no hay detonante reciente ni iniciativa de compra confirmados, sin impedir una conversacion exploratoria.
- Analiza participantes, pasos manuales posibles, latencia, coste, errores y datos faltantes como hipotesis, no procesos instalados. Mapea por roles usuarios, dueno del dolor, evaluadores, presupuesto, firmante y bloqueadores dentro del razonamiento; no inventes nombres. Pregunta primero si existe friccion manual, no la presupongas. Mantiene todo el razonamiento en espanol si el contexto es espanol.
- El perfil importado permite identificar empresa, cargo, area y pais sin exigir otra fuente. Si no hay una contradiccion concreta, no llenes el reporte de dudas de identidad.
- Usa conocimiento general de sectores, tareas y roles para proponer oportunidades. Identificalas como hipotesis razonables, no como problemas internos confirmados.
- Recomienda hasta tres casos de uso concretos. En fitByProduct.rationale conserva PARA CADA caso: proceso, piloto acotado, metrica observable propia (unidad y que comparar con la linea base) y pregunta para validar. No basta una metrica general al final; no inventes valores actuales, porcentajes de ahorro ni resultados prometidos.
- Personaliza por cargo y oferta real: Finanzas/CFO debe explorar facturacion, cobranza, cierre o excepciones entre respaldos y datos financieros segun contexto disponible. No lo sustituyas por ingreso de personal o consultas de RRHH: esas areas pueden aportar datos al flujo financiero. Reclutamiento debe centrarse en candidatos, entrevistas y expedientes; TI en integraciones, permisos y soporte. Son hipotesis por validar, no problemas reales ni procesos instalados confirmados.
- Una pregunta de discovery puede validar un proceso o una hipotesis del rol sin claim: usa validatesClaimId=null. Una objecion hipotetica puede tener derivedFrom=[]. Nunca cites una cifra de empleados para justificar autoridad de compra.
- El conocimiento previo sobre una empresa es contexto provisional, no prueba de su situacion actual. No inventes cifras ni noticias por memoria.
- No necesitas noticias recientes, ROI ni un comite nominal para preparar una buena conversacion. Si no hay supuestos configurados, volumeModel=null.
- ICP ausente significa encaje aun no evaluado por reglas, no aprobacion comercial definitiva. Considera restricciones de los productos y justifica la recomendacion.
- Nunca traduzcas qualification=qualified a 'cuenta cualificada' si reasons incluye icp_rules_missing. Escribe 'encaje potencial para explorar'. El pais importado utilizable evita gastar la primera pregunta confirmando un dato ya disponible; solo pide aclararlo si hay informacion contradictoria concreta.

PROHIBIDO:
- Afirmar dolor, necesidad, presupuesto o intencion de compra sin evidencia.
- Inventar experiencia, traccion, clientes, conversaciones en curso o resultados del vendedor. Sus capacidades declaradas no prueban actividad comercial pasada o actual. En entryAngle.hooks usa una capacidad explicita y una pregunta exploratoria, no 'ya ayudamos a equipos', 'estamos conversando con empresas' ni casos de exito ausentes del perfil del vendedor.
- Presentar datos de proveedor como hechos investigados.
- Usar un claim de jurisdiccion distinta a ${input.entity.contactCountry} para construir encaje sin marcarlo como contexto de casa matriz.
- Producir prosa final; aqui solo produces estructura.`;
}

function volumeConfiguration(profile: SellerProfileContextV2, recommendedProduct: string) {
  return profile.products.find((product) => product.key === recommendedProduct)?.volumeAssumptions
    || profile.products.find((product) => product.volumeAssumptions)?.volumeAssumptions
    || null;
}

function normalizeAnalysis(input: {
  analysis: AnalysisV2;
  entity: EntityResolutionV2;
  qualification: QualificationV2;
  claims: ClaimV2[];
  signals: SignalV2[];
  gaps: GapV2[];
  committee: CommitteeMemberV2[];
  sellerProfile: SellerProfileContextV2;
}) {
  const claimsById = new Map(input.claims.map((claim) => [claim.id, claim]));
  const signalById = new Map(input.signals.map((signal) => [signal.id, signal]));
  const gapIds = new Set(input.gaps.map((gap) => gap.id));
  const productKeys = input.sellerProfile.products.map((product) => product.key);
  const recommendedProduct = productKeys.includes(input.analysis.verdict.recommendedProduct)
    ? input.analysis.verdict.recommendedProduct
    : 'NONE';
  const fits = input.analysis.fitByProduct.filter((fit) => productKeys.includes(fit.productKey)).map((fit) => {
    const headquarters = new Set(fit.headquartersContextClaimIds);
    return {
      ...fit,
      claimIds: fit.claimIds.filter((id) => {
        const claim = claimsById.get(id);
        return Boolean(claim) && (
          !claim?.jurisdiction
          || claim.jurisdiction === 'GLOBAL'
          || claim.jurisdiction === input.entity.contactCountry
          || headquarters.has(id)
        );
      }),
      headquartersContextClaimIds: fit.headquartersContextClaimIds.filter((id) => claimsById.has(id)),
    };
  });
  if (productKeys.some((key) => !fits.some((fit) => fit.productKey === key))) {
    throw new Error('REPORT_V2_PRODUCT_FIT_INCOMPLETE');
  }
  const volume = buildReportV2VolumeModel({
    claims: input.claims,
    entity: input.entity,
    assumptions: volumeConfiguration(input.sellerProfile, recommendedProduct),
  });
  const signalIds = input.analysis.signalIds.filter((id) => signalById.has(id)).sort((left, right) => {
    const leftFreshness = signalById.get(left)?.freshnessDays ?? Number.MAX_SAFE_INTEGER;
    const rightFreshness = signalById.get(right)?.freshnessDays ?? Number.MAX_SAFE_INTEGER;
    return leftFreshness - rightFreshness;
  });
  const analysis = AnalysisV2Schema.parse({
    ...input.analysis,
    verdict: {
      ...input.analysis.verdict,
      qualification: input.qualification.verdict,
      recommendedProduct,
    },
    buyingCommittee: input.committee,
    volumeModel: volume?.model || null,
    signalIds,
    fitByProduct: fits,
    discoveryQuestions: input.analysis.discoveryQuestions.filter((question) => question.validatesClaimId === null || claimsById.has(question.validatesClaimId)),
    objections: input.analysis.objections.flatMap((objection) => {
      const derivedFrom = objection.derivedFrom.filter((id) => claimsById.has(id));
      return [{ ...objection, derivedFrom }];
    }),
    riskClaimIds: input.analysis.riskClaimIds.filter((id) => claimsById.has(id)),
    gapIds: input.analysis.gapIds.filter((id) => gapIds.has(id)),
  });
  return {
    analysis,
    assumptions: volume?.assumptions || [],
    additionalGaps: volume?.gap ? [volume.gap] : [],
  };
}

export async function reasonAboutReportV2Account(input: {
  entity: EntityResolutionV2;
  qualification: QualificationV2;
  claims: ClaimV2[];
  signals: SignalV2[];
  gaps: GapV2[];
  committee: CommitteeMemberV2[];
  sellerProfile: SellerProfileContextV2;
  companyContext?: string | null;
  signal?: AbortSignal;
}, dependencies: {
  generate?: typeof generateStructured;
  generateWithTelemetry?: typeof generateStructuredWithTelemetry;
  specialists?: typeof briefReportV2Specialists;
} = {}) {
  const specialists = dependencies.generate ? [] : await (dependencies.specialists || briefReportV2Specialists)(input);
  const options = {
    ...reportGenerationOptions('reasoning'),
    signal: input.signal,
    systemPrompt: REASON_REPORT_V2_SYSTEM_PROMPT,
    prompt: buildReasonReportV2Prompt({ ...input, specialistBriefs: specialists.map(({ specialty, brief }) => ({ specialty, brief })) }),
    schema: AnalysisV2Schema,
    temperature: 0.1,
  } as const;
  if (dependencies.generate) {
    const generated = await dependencies.generate(options);
    return { ...normalizeAnalysis({ ...input, analysis: AnalysisV2Schema.parse(generated) }), telemetry: null, specialists };
  }
  const generated = await (dependencies.generateWithTelemetry || generateStructuredWithTelemetry)(options);
  return {
    ...normalizeAnalysis({ ...input, analysis: AnalysisV2Schema.parse(generated.data) }),
    telemetry: generated.telemetry,
    specialists,
  };
}
