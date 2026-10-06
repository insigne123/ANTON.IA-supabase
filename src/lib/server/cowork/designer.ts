import { z } from 'zod';
import { coworkSuggestionSchema } from '@/lib/cowork/contracts';
import type { CoworkDesignBrief } from '@/lib/cowork/design-brief';
import { buildCoworkArtifactDocument, type CoworkArtifactCodeIssue, type CoworkArtifactData, type CoworkCodeArtifact } from './code-artifact';
import { coworkArtifactDataPreview } from './artifact-data';
import { COWORK_ARTIFACT_EXAMPLES } from './code-artifact-examples';

/**
 * The Designer (Plan 12, 3b): writes the code of an artifact from the coordinator's brief and the
 * shape of the data, and corrects it once if the check refuses it. The model writes the design and
 * the logic; every figure comes from `antonia.data` at run time. Nothing here touches the database
 * or calls a model: the data and the model call are injected (the worker and the corpus provide them).
 */

export const coworkDesignerOutputSchema = z.object({
  title: z.string().trim().min(3).max(90),
  reply: z.string().trim().min(1).max(1200),
  html: z.string().max(60_000),
  css: z.string().max(40_000),
  js: z.string().max(120_000),
  question: z.string().trim().min(1).max(400).nullable(),
  suggestions: z.array(coworkSuggestionSchema).min(1).max(3),
}).strict();
export type CoworkDesignerOutput = z.infer<typeof coworkDesignerOutputSchema>;

const API = [
  'La biblioteca antonia ya está cargada (window.antonia):',
  '- antonia.data.<tabla>: { label, source, columns: [{key, label, type}], rows: [{…}], total, truncated }. type es text, number, money, percent o date (fechas «AAAA-MM-DD»).',
  '- antonia.meta: {title, generatedAt, today, currency, timeZone}. today es el día en que se armó («AAAA-MM-DD», hora de Chile).',
  '- antonia.agg: sum(rows, key), avg(rows, key), count(rows, fnOKey), min/max(rows, key), groupBy(rows, key, {value, op: "sum"|"avg", order: [..], sort: "asc"|"desc"|"none", limit}) → [{key, rows, count, value}], series(rows, key, opciones) → {labels, values}, byMonth(rows, dateKey, {value, op, last}) → {keys, labels, values}, top(rows, key, n), since(rows, dateKey, días) (las filas de los últimos N días hasta today), inMonth(rows, dateKey, "AAAA-MM") (las del mes; sin mes, el de today).',
  '- antonia.format: money(n), number(n), percent(fraccion) («12,3%»), compact(n, "money") («$568 M»), date(valor, "long"|"month"), value(valor, type).',
  '- antonia.chart(selectorOElemento, {type: "bar"|"line"|"donut"|"funnel"|"stacked", title, note, labels, series: [{name, values}], unit: "money"|"percent"|null, horizontal, height}): SVG accesible con leyenda, tooltip, resumen para lectores de pantalla y «Ver datos». Hasta 5 series (la sexta se junta en «Otros»); dona hasta 6 tajadas.',
  '- antonia.table(selectorOElemento, tablaOFilas, {columns, sortBy, sortDir, pageSize, filter, caption, empty, onRowClick}): tabla que ordena, filtra y pagina. columns acepta render: (valor, fila) => nodo o texto.',
  '- antonia.kpi(selectorOElemento, [{label, value, unit: "money"|"percent"|"number", delta (fracción), hint}]): tarjetas de cifras.',
  '- antonia.h(tag, attrs, ...hijos): crea elementos con texto (nunca HTML); attrs: class, text, style (objeto), on: {click: fn}, aria-*, data-*. antonia.mount(selector, ...nodos) reemplaza el contenido. antonia.esc(texto) escapa para HTML.',
  '- antonia.theme.mode es "light" o "dark"; antonia.onTheme(fn) avisa cuando cambia.',
  '- Clases listas: header (título y bajada), card, grid (auto), grid-2, grid-3, span-all, row, stack, badge (badge-accent, badge-success, badge-warning, badge-danger), btn, btn-primary, chip (filtros: <button class="chip" aria-pressed="true|false">, ya trae su estilo activo), muted, small, num, sr-only. Tokens CSS: var(--text), var(--muted), var(--accent), var(--accent-text) (texto en color de acento), var(--accent-soft), var(--on-accent) (texto sobre var(--accent)), var(--surface), var(--panel), var(--border), var(--success), var(--warning), var(--danger), var(--series-1..5), var(--stage-1..6), var(--radius).',
].join('\n');

export const COWORK_DESIGNER_RULES = [
  'Eres la Diseñadora de Cowork, el asistente comercial de ANTON.IA. Escribes el código de un artefacto (HTML, CSS y JavaScript) que se ve en el lienzo de la app, al lado del chat, aislado y sin red. Escribes en español de Chile.',
  'Datos: los pone el servidor en antonia.data, con las tablas y columnas que te muestro en data (ves una muestra; la página trae todas las filas). Nunca escribas en el código una cifra, un nombre, una empresa o una fecha de los datos: calcúlalos desde las filas con antonia.agg. Si una tabla viene vacía, la página lo dice en un estado vacío claro (qué falta y cómo conseguirlo en ANTON.IA) en vez de dibujar ceros. Si truncated es true, di en una línea pequeña que muestra las más recientes.',
  'Diseño: claro y útil antes que decorado. Orden: header con un h1 (el título) y una bajada de una línea; una fila de 3 o 4 cifras clave (antonia.kpi); 1 a 4 gráficos en una grid-2 (cada uno en una card, el gráfico que corresponde a la pregunta: barras para comparar, línea para el tiempo, embudo para etapas, dona solo para partes de un todo de hasta 6, apiladas para composición); y al final la tabla de detalle (antonia.table) si sirve. Filtros solo si ayudan a decidir (chips con aria-pressed que redibujan gráficos y tabla). Funciona igual de bien a 390 px: nada de anchos fijos. Usa las clases y los tokens de antonia, nunca colores propios (ni hex, ni rgb, ni nombres): así se ve bien en claro y en oscuro.',
  'Orden: las etapas del pipeline van en el orden del proceso (columna stage_order, que sirve para ordenar y no se muestra como columna), nunca por monto ni alfabético; los meses, de antiguo a reciente. En las tablas muestra solo las columnas que ayudan a decidir (no las que vienen vacías en todas las filas). '
    + 'Fechas: «hoy», «este mes» o «los últimos 30 días» se cuentan desde antonia.meta.today con agg.inMonth y agg.since, nunca con new Date() ni Date.now(): el artefacto muestra los datos del día en que se armó; nombra el período con antonia.format.date(antonia.meta.today, "month"). ' + 'Accesible: un solo h1, títulos en orden, botones con texto, inputs con label o aria-label, nada que dependa solo del color.',
  'Seguridad (el artefacto no corre si no la cumples): sin <script> en html (el código va en js), sin atributos on… (usa addEventListener), sin fetch, XMLHttpRequest, WebSocket ni direcciones externas, sin localStorage ni cookies, sin alert/confirm/prompt, sin window.open ni location, sin eval ni new Function, sin import. Crea elementos con antonia.h o textContent; si usas innerHTML, escapa cada dato con antonia.esc. El js corre dentro de una función async con "use strict": declara todo con const o let.',
  API,
  'Si te dan previous (el código de una versión anterior) y change, edítalo: aplica solo el cambio pedido (no agregues gráficos ni secciones que nadie pidió), conserva lo que funciona y devuelve el código completo de la versión nueva. Si change trae un error, búscalo en previous, corrígelo en su causa y revisa que el mismo error no pueda repetirse con otros datos (tablas vacías, columnas null).',
  'Salida: title (el título del artefacto, específico: qué y de qué período o para quién); html, css (solo lo que las clases no resuelven; puede ir vacío) y js.',
  'reply: 2 a 4 frases para el chat, en palabras del usuario (di «el tablero», «el gráfico» o «la ficha»; nunca «artefacto», ni nombres de tablas o columnas, ni estados en inglés). En un tablero nuevo, primero la conclusión principal que muestran los datos, con cifras que estén en data (rows, total y summary) y ninguna otra: «Tus 4 contactos están en Nuevos: ninguno avanzó de etapa» o «Aún no hay envíos registrados este mes»; luego qué trae y cómo usarlo (filtros, ordenar, «Ver datos»). En una versión nueva (previous), primero qué cambiaste; si change traía un error, qué lo causaba y cómo quedó resuelto («El error venía de leer los montos cuando la tabla no los trae; ahora el gráfico cuenta contactos y no falla»).',
  'question: en un tablero nuevo, la acción con aprobación que más acerca su objetivo según lo que muestran los datos (buscar prospectos nuevos, buscar el correo de contactos, crear una campaña, investigar a alguien, invitar por LinkedIn) o una decisión que solo el usuario puede tomar; nunca un cambio opcional al tablero. En una versión nueva (previous), null: el cambio es la respuesta. suggestions: 1 a 3 respuestas que el usuario tocaría; con question, la primera dice que sí a question; las otras (o todas, sin question) pueden pedir un cambio al tablero.',
].join('\n\n');

/** Two artifacts made with the runtime, as the Designer's reference (code-artifact-examples.ts). */
export function coworkDesignerExamples() {
  return COWORK_ARTIFACT_EXAMPLES.map(example => [
    `Ejemplo «${example.title}» (${example.brief})`,
    `html:\n${example.code.html}`,
    `css:\n${example.code.css}`,
    `js:\n${example.code.js}`,
  ].join('\n')).join('\n\n');
}

export function coworkDesignerPrompt(input: { brief: CoworkDesignBrief; request: string; data: CoworkArtifactData; previous?: CoworkCodeArtifact | null;
  userContext?: unknown; issues?: CoworkArtifactCodeIssue[]; rejected?: CoworkCodeArtifact | null }) {
  return JSON.stringify({
    request: input.request,
    brief: input.brief,
    data: coworkArtifactDataPreview(input.data),
    userContext: input.userContext ?? null,
    previous: input.previous ?? null,
    ...(input.issues?.length ? {
      fix: {
        instruction: 'Tu código anterior no pasó la revisión. Corrige cada problema y devuelve el código completo otra vez.',
        problems: input.issues.map(issue => `${issue.part}${issue.line ? ` (línea ${issue.line})` : ''}: ${issue.message}`),
        code: input.rejected ?? null,
      },
    } : {}),
  });
}

export type CoworkDesignResult = { output: CoworkDesignerOutput; html: string; bytes: number; attempts: number };

/**
 * Writes the artifact: one call, and one more to fix it if the check refused the code. Throws when the
 * second one fails too (the turn then answers without it). `generate` makes the model call (writer role).
 */
export async function runCoworkDesigner(input: {
  brief: CoworkDesignBrief; request: string; data: CoworkArtifactData; previous?: CoworkCodeArtifact | null; userContext?: unknown;
  generatedAt?: string; canRetry?: () => boolean;
  generate: (call: { systemPrompt: string; prompt: string; attempt: number }) => Promise<CoworkDesignerOutput>;
}): Promise<CoworkDesignResult> {
  const systemPrompt = `${COWORK_DESIGNER_RULES}\n\n${coworkDesignerExamples()}`;
  let issues: CoworkArtifactCodeIssue[] = [];
  let rejected: CoworkCodeArtifact | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt === 2 && input.canRetry && !input.canRetry()) break;
    const output = coworkDesignerOutputSchema.parse(await input.generate({ systemPrompt, attempt,
      prompt: coworkDesignerPrompt({ brief: input.brief, request: input.request, data: input.data, previous: input.previous, userContext: input.userContext, issues, rejected }) }));
    const code = { html: output.html, css: output.css, js: output.js };
    const built = buildCoworkArtifactDocument({ title: output.title, code, data: input.data, generatedAt: input.generatedAt });
    if (built.ok) return { output, html: built.html, bytes: built.bytes, attempts: attempt };
    issues = built.issues;
    rejected = code;
  }
  throw new Error(`El artefacto no pasó la revisión: ${issues.slice(0, 3).map(issue => issue.message).join(' · ')}`);
}
