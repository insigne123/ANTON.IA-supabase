import { generateStructured, generateStructuredWithTelemetry } from '@/ai/openai-json';
import { getOpenAiModelsForTier } from '@/ai/model-router';
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
import { stripInternalIdsForReportPrompt } from './write-report-v2-section';
import { buildReportV2VolumeModel, type VolumeAssumptionsV2 } from './build-report-v2-volume';

export const REASON_REPORT_V2_PROMPT_VERSION = 'report-v2/p5-analysis/1';

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
}) {
  return `Cuenta: ${JSON.stringify(stripInternalIdsForReportPrompt(input.entity))}
Calificacion ICP: ${JSON.stringify(input.qualification)}
Claims disponibles: ${JSON.stringify(stripInternalIdsForReportPrompt(input.claims))}
Perfil del vendedor y sus productos: ${JSON.stringify(input.sellerProfile)}

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

OBJECIONES: derivalas de evidencia concreta. Evita objeciones genericas.

HUECOS: cada hueco debe indicar como obtener la informacion.

PROHIBIDO:
- Afirmar dolor, necesidad, presupuesto o intencion de compra sin evidencia.
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
    discoveryQuestions: input.analysis.discoveryQuestions.filter((question) => claimsById.has(question.validatesClaimId)),
    objections: input.analysis.objections.flatMap((objection) => {
      const derivedFrom = objection.derivedFrom.filter((id) => claimsById.has(id));
      return derivedFrom.length > 0 ? [{ ...objection, derivedFrom }] : [];
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
}, dependencies: {
  generate?: typeof generateStructured;
  generateWithTelemetry?: typeof generateStructuredWithTelemetry;
} = {}) {
  const options = {
    provider: 'openai',
    openAiModels: getOpenAiModelsForTier('critical'),
    systemPrompt: REASON_REPORT_V2_SYSTEM_PROMPT,
    prompt: buildReasonReportV2Prompt(input),
    schema: AnalysisV2Schema,
    temperature: 0.1,
  } as const;
  if (dependencies.generate) {
    const generated = await dependencies.generate(options);
    return { ...normalizeAnalysis({ ...input, analysis: AnalysisV2Schema.parse(generated) }), telemetry: null };
  }
  const generated = await (dependencies.generateWithTelemetry || generateStructuredWithTelemetry)(options);
  return {
    ...normalizeAnalysis({ ...input, analysis: AnalysisV2Schema.parse(generated.data) }),
    telemetry: generated.telemetry,
  };
}
