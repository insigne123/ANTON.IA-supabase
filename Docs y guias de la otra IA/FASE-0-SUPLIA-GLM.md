# Fase 0 de SUPL.IA — cambios listos (100% GLM)

> Cuatro cambios quirúrgicos, sin tocar arquitectura, que suben el "coeficiente de marketing" de SUPL.IA. **No agregan Anthropic: todo sigue corriendo en GLM.** La "expertise tipo Claude" viene de los prompts, el método y las señales reales — no del proveedor.
>
> Rama base: `suplia/github-upload`. Todo está referenciado al código real.

## Resumen de cambios

| # | Archivo | Qué cambia | Impacto |
|---|---|---|---|
| 1 | `src/ai/model-router.ts` | GLM como proveedor **único** por defecto | Garantiza que nada caiga a OpenAI |
| 2 | `src/lib/server/suplia-agent-registry.ts` | Prompt del `icp-strategist` → **experto** | Mejor segmentación/criterios |
| 3 | `src/lib/server/suplia-tools.ts` | `personalizeForLead`: de **plantilla fija** → **copy con GLM** | 🔥 El mayor salto: correos reales y personalizados |
| 4 | `src/lib/server/suplia-tools.ts` | Registrar tools `research.similarweb` + `research.whois` (sin key, sin costo) | Investigación con señales reales |

> El hallazgo clave: hoy el correo de contacto (`personalizeForLead`) **no usa IA**, es un texto fijo (`asunto = "{empresa} y automatizacion comercial"`). El cambio #3 es el que más mueve la aguja.

---

## Cambio 1 — GLM como proveedor único (`src/ai/model-router.ts`)

**Buscar:**
```ts
export function getAiModelProvider(): AiModelProvider {
  const provider = (env('SUPLIA_AI_PROVIDER') || env('AI_PROVIDER')).toLowerCase();
  if (provider === 'glm' || provider === 'zhipu' || provider === 'bigmodel' || provider === 'zai' || provider === 'z.ai') {
    return 'glm';
  }
  return 'openai';
}
```

**Reemplazar por:**
```ts
export function getAiModelProvider(): AiModelProvider {
  const provider = (env('SUPLIA_AI_PROVIDER') || env('AI_PROVIDER')).toLowerCase();
  // GLM es el proveedor unico por defecto. OpenAI queda solo como opt-in explicito.
  if (provider === 'openai') return 'openai';
  return 'glm';
}
```

Y en tu `.env` deja explícito (opcional pero recomendado):
```
SUPLIA_AI_PROVIDER=glm
# Modelos GLM por tier (ajusta a los que uses):
SUPLIA_GLM_MODEL=glm-5.2
# + las credenciales GLM que ya consume src/ai/openai-json.ts (API key / base URL).
```
Resultado: todos los tiers (`fast/balanced/orchestrator/reasoning/critical`) resuelven a modelos GLM. Cero dependencia de OpenAI.

---

## Cambio 2 — Prompt experto del `icp-strategist` (`suplia-agent-registry.ts`)

Dentro de `runIcpStrategist`, **busca** el bloque de instrucciones actual:
```
Eres el subagente icp-strategist de SUPL.IA. Define el ICP y un search plan antes de consumir creditos.

Reglas:
- No ejecutes busquedas externas.
- Propón segmentos, roles y criterios concretos.
- Si faltan datos, usa supuestos explicitamente conservadores.
- Excluye contactos riesgosos: unsubscribes, dominios bloqueados y contactados recientes.
- Devuelve JSON estricto.
```

**Reemplázalo por** (deja intactas las líneas `Objetivo del usuario:`, `Plan previo:` y `Contexto de app:` con sus `${...}`):
```
Eres un estratega de demanda B2B senior. Defines el Perfil de Cliente Ideal (ICP) y un plan de busqueda accionable ANTES de gastar creditos.

Metodo (aplicalo, no lo enumeres):
- Parte del Job-to-be-Done del cliente y del dolor que resuelve la oferta.
- Define 1 a 3 segmentos concretos (industria, tamano/dotacion, geografia) y por que califican.
- Lista senales de compra OBSERVABLES (gatillos): licitaciones, vacantes, crecimiento de dotacion, fiscalizaciones, cambios de stack.
- Define los roles/decisores objetivo y su motivacion real.
- Propon criterios de exclusion: unsubscribes, dominios bloqueados, contactados recientes y mala calza.
- Se especifico y conservador. Si faltan datos, declara supuestos explicitos. No inventes cifras ni nombres.

Cada segmento y cada criterio debe traer una razon verificable. No ejecutes busquedas externas. Devuelve JSON estricto segun el schema.
```

> La temperatura puede quedar en `0.2` (la salida es JSON estructurado; la calidad viene del método). Si quieres un poco más de variedad en segmentos, súbela a `0.4`.

---

## Cambio 3 — Copy con GLM en `personalizeForLead` (`suplia-tools.ts`)  🔥

### 3a. Imports (arriba del archivo, si no están ya)
```ts
import { z } from 'genkit';
import { generateStructuredWithTelemetry } from '@/ai/openai-json';
import { getOpenAiModelsForTier } from '@/ai/model-router';
```

### 3b. Reemplaza la función `personalizeForLead` completa por:
```ts
async function personalizeForLead(input: Record<string, unknown>, context: SupliaToolContext) {
  const lead = input.lead && typeof input.lead === 'object' ? (input.lead as any) : input;
  const profile = (await buildSupliaContext(context.auth)).profile || {};
  const fullName = getLeadName(lead) || 'ahi';
  const openingName = fullName.split(' ')[0] || fullName;
  const companyName = asText(lead.companyName || lead.company) || 'tu equipo';
  const role = asText(lead.title || lead.role);
  const offer = asText(
    input.offerSummary || input.offer ||
    (profile as any).company_profile || (profile as any).companyName || (profile as any).company || 'ANTON.IA',
  );
  const cta = asText(input.cta) || 'te parece si lo revisamos 15 minutos esta semana?';
  // Senal real para personalizar (si viene de enrichment / research.* o del scoring)
  const signal = asText((lead as any).signal || (lead as any).buyingSignal || (lead as any).reason);

  // Fallback estatico (se usa solo si el modelo falla)
  const fallbackSubject = `${companyName} y automatizacion comercial`;
  const fallbackBody = [
    `Hola ${openingName},`,
    `Vi que ${companyName}${role ? ` tiene perfiles como ${role}` : ''} y pense que podria ser buen momento para mostrarte ${offer}.`,
    'La idea es ayudar a priorizar oportunidades, preparar mensajes y mantener control humano antes de acciones sensibles.',
    cta.charAt(0).toUpperCase() + cta.slice(1),
  ].join('\n\n');

  let subject = fallbackSubject;
  let textBody = fallbackBody;

  try {
    const prompt = `
Eres un copywriter B2B senior experto en correo en frio que convierte. Escribe UN correo corto, personalizado y humano (no una plantilla).

Reglas:
- Asunto de 4 a 7 palabras, especifico, con curiosidad o beneficio. Nada de clickbait ni mayusculas gritonas.
- Abre con una senal real del prospecto si existe; si no, con su contexto (empresa/rol). Nunca generico.
- Una sola idea y un solo CTA. Maximo ~90 palabras. Tono cercano y profesional, espanol de Chile.
- No prometas resultados que no puedas respaldar. No inventes datos del prospecto.
- Devuelve JSON: { "subject": string, "textBody": string }.

Prospecto:
- Nombre: ${fullName}
- Rol: ${role || 'desconocido'}
- Empresa: ${companyName}
- Senal o contexto: ${signal || 'sin senal especifica'}

Oferta (lo que vendemos): ${offer}
CTA deseado: ${cta}
`.trim();

    const { data } = await generateStructuredWithTelemetry({
      prompt,
      schema: z.object({ subject: z.string(), textBody: z.string() }),
      temperature: 0.7,
      openAiModels: getOpenAiModelsForTier('balanced'),
    });
    if (data?.subject) subject = data.subject.trim();
    if (data?.textBody) textBody = data.textBody.trim();
  } catch (error) {
    console.warn('[SUPLIA/personalizeForLead] fallback copy:', error);
  }

  return {
    to: getLeadEmail(lead),
    recipientName: fullName,
    company: companyName,
    role,
    subject,
    textBody,
    htmlBody: textBody.split('\n\n').map((paragraph) => `<p>${paragraph}</p>`).join(''),
    sourceLead: lead,
    note: 'Borrador personalizado con IA (GLM). No fue enviado.',
  };
}
```

Notas:
- `bulkVariantPreview` ya llama a `personalizeForLead` en loop → **se beneficia automáticamente**, sin tocarlo.
- Mantiene el **mismo objeto de retorno** (no rompe a quien lo consume) y un **fallback** seguro.
- `getOpenAiModelsForTier('balanced')` resuelve a **GLM** por el Cambio 1. Tier `balanced` = barato y rápido para copy a volumen.

---

## Cambio 4 — Tools de investigación sin costo (`suplia-tools.ts`)

Usa el archivo **`suplia-research-tools.ts`** (incluido): copia las dos funciones `researchSimilarweb` y `researchWhois` dentro de `suplia-tools.ts` (o impórtalas), y agrega al objeto `SUPLIA_TOOLS`:

```ts
  'research.similarweb': {
    name: 'research.similarweb',
    description: 'Trafico estimado de un dominio (SimilarWeb publico). Sin costo ni creditos. Solo lectura.',
    inputSchema: '{ "domain": string }',
    handler: researchSimilarweb,
  },
  'research.whois': {
    name: 'research.whois',
    description: 'WHOIS de un dominio: registrar, antiguedad y disponibilidad. Sin costo. Solo lectura.',
    inputSchema: '{ "domain": string }',
    handler: researchWhois,
  },
```

Como **no consumen créditos ni envían nada**, pueden correr **sin aprobación**. Conéctalas en `company-scorer` (madurez digital = tráfico + antigüedad de dominio) y en `personalizeForLead` (pásale la `signal`). Si los agentes tienen allow-list de tools, agrégalas a `company-scorer`, `icp-strategist` y `enricher`.

---

## Cómo aplicar y validar

1. Aplica los 4 cambios en una rama nueva sobre `suplia/github-upload` (ej. `suplia/fase-0-marketing`).
2. `npm run typecheck` y `npm test` (hay tests en `src/lib/suplia/*`).
3. Prueba `research.similarweb` con un dominio real (ej. `andina-seg.cl`) — debe responder sin key.
4. Genera un borrador con `email.personalize_for_lead` para un lead con `signal` y compara contra el viejo template: el asunto y el cuerpo deben ser claramente mejores.
5. Confirma en la telemetría que el `modelName` es GLM.

> No puedo pushear por ti (no actúo como tu cuenta de GitHub). Esto queda listo para que tú o OpenCode lo apliquen y abran el PR.

---

## Qué sigue (Fase 1, cuando quieras)

- Misma técnica de copy experto para `campaign.generate_sequence` y `prospecting.score_*` (rúbrica de scoring explícita).
- **Context brief** curado en `buildSupliaContext`: sumar oferta/propuesta de valor e histórico de campañas (hoy solo trae perfil + conteos).
- **Intent híbrido**: dejar el regex como prefiltro y resolver lo ambiguo con un clasificador GLM `fast` que extraiga slots (sector, ciudad, tamaño) → menos idas y vueltas.
- `research.brand` / `research.brand_mentions` / `research.serp_*` (con key) como tools de enrichment.
- Playbooks de marketing (técnica de las skills OpenClaudia) cargados por agente.
