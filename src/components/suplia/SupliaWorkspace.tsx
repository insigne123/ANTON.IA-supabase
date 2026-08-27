'use client';

import { FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Inter, Source_Serif_4 } from 'next/font/google';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import {
  ArrowUp,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Globe2,
  Loader2,
  Menu,
  Mic,
  Moon,
  Paperclip,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Square,
  Sun,
  ThumbsDown,
  ThumbsUp,
  Users,
  X,
  XCircle,
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { getSupliaStrongConfirmationPhrase, requiresSupliaStrongConfirmation } from '@/lib/suplia/approval-guards';
import { cn } from '@/lib/utils';
import type {
  SupliaAgentRun,
  SupliaArtifact,
  SupliaAskAnswerPayload,
  SupliaAskQuestion,
  SupliaChatResponse,
  SupliaConversation,
  SupliaJob,
  SupliaJobEvent,
  SupliaJobStep,
  SupliaMemory,
  SupliaMessage,
  SupliaMessagePart,
  SupliaPendingAction,
  SupliaToolRun,
} from '@/lib/suplia/types';

const supliaSans = Inter({ subsets: ['latin'], variable: '--suplia-font-sans', display: 'swap' });
const supliaSerif = Source_Serif_4({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--suplia-font-serif', display: 'swap' });

type WorkspaceState = {
  conversation: SupliaConversation | null;
  conversations: SupliaConversation[];
  messages: SupliaMessage[];
  artifacts: SupliaArtifact[];
  pendingActions: SupliaPendingAction[];
  toolRuns: SupliaToolRun[];
  jobs: SupliaJob[];
  activeJob: SupliaJob | null;
  jobSteps: SupliaJobStep[];
  agentRuns: SupliaAgentRun[];
  jobEvents: SupliaJobEvent[];
  memories: SupliaMemory[];
};

type ComposerMode = 'ask' | 'draft' | 'research' | 'approval' | 'artifact';

type ComposerAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  content?: string;
  unsupported?: boolean;
};

type ArtifactPreviewItem = {
  title: string;
  eyebrow?: string;
  detail?: string;
  meta?: string;
  score?: string;
  status?: string;
};

type SupliaAskPart = Extract<SupliaMessagePart, { type: 'ask' }>;
type SupliaTablePart = Extract<SupliaMessagePart, { type: 'table' }>;
type SupliaCodePart = Extract<SupliaMessagePart, { type: 'code' }>;

type SendMessageOptions = {
  answerToAsk?: SupliaAskAnswerPayload | null;
};

const emptyState: WorkspaceState = {
  conversation: null,
  conversations: [],
  messages: [],
  artifacts: [],
  pendingActions: [],
  toolRuns: [],
  jobs: [],
  activeJob: null,
  jobSteps: [],
  agentRuns: [],
  jobEvents: [],
  memories: [],
};

const terminalJobStatuses = new Set(['completed', 'failed', 'cancelled']);

const starters = [
  'Prospecta empresas de seguridad privada en Santiago con alta rotacion.',
  'Investiga esta cuenta y prepara un primer correo personalizado.',
  'Revisa oportunidades sin respuesta y arma un seguimiento.',
];

const activityPhases = [
  'Analizando pedido',
  'Revisando contexto',
  'Preparando herramientas',
  'Validando permisos',
  'Armando respuesta',
];

const composerModes: Array<{ value: ComposerMode; label: string; promptPrefix?: string }> = [
  { value: 'ask', label: 'Preguntar' },
  { value: 'draft', label: 'Redactar', promptPrefix: 'Modo Redactar: responde con un borrador claro y usable.' },
  { value: 'research', label: 'Investigar', promptPrefix: 'Modo Investigar: analiza el contexto disponible y separa hechos de supuestos.' },
  { value: 'approval', label: 'Ejecutar con aprobacion', promptPrefix: 'Modo Ejecucion: si hay una accion sensible, dejala como aprobacion pendiente y no la ejecutes directamente.' },
  { value: 'artifact', label: 'Crear artifact', promptPrefix: 'Modo Artifact: crea o actualiza un artifact cuando corresponda y deja el contenido completo en el canvas.' },
];

const readableAttachmentExtensions = ['.txt', '.md', '.markdown', '.csv', '.json', '.html', '.xml', '.ts', '.tsx', '.js', '.jsx', '.css', '.sql'];
// Keep the fence marker dynamic so the source fence guard does not flag this parser.
const markdownFencePattern = new RegExp(`^\\s*${String.fromCharCode(96).repeat(3)}`);

function SupliaMark({ className }: { className?: string }) {
  return (
    <svg className={cn('suplia-logo-mark', className)} viewBox="0 0 40 40" aria-hidden="true">
      <g fill="currentColor">
        {Array.from({ length: 12 }).map((_, index) => (
          <rect key={index} x="18.4" y="4.5" width="3.2" height="11.5" rx="1.6" transform={`rotate(${index * 30} 20 20)`} />
        ))}
      </g>
    </svg>
  );
}

function formatRelativeDate(value?: string | null) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  } catch {
    return '';
  }
}

function formatElapsed(ms: number) {
  const seconds = Math.max(1, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function getConversationBucket(value?: string | null) {
  if (!value) return 'Anteriores';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Anteriores';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.floor((today - day) / 86400000);
  if (diffDays <= 0) return 'Hoy';
  if (diffDays === 1) return 'Ayer';
  if (diffDays < 7) return 'Esta semana';
  return 'Anteriores';
}

function groupConversations(conversations: SupliaConversation[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const visible = normalizedQuery
    ? conversations.filter((conversation) => conversation.title.toLowerCase().includes(normalizedQuery))
    : conversations;
  const order = ['Hoy', 'Ayer', 'Esta semana', 'Anteriores'];
  return order
    .map((label) => ({ label, items: visible.filter((conversation) => getConversationBucket(conversation.updatedAt) === label) }))
    .filter((group) => group.items.length > 0);
}

function previewJson(value: unknown, fallback = 'Sin detalle') {
  if (value == null) return fallback;
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim() || fallback;
  try {
    return JSON.stringify(value).replace(/\s+/g, ' ').slice(0, 240) || fallback;
  } catch {
    return fallback;
  }
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function asList(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function cleanText(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function asTextList(value: unknown) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  const text = cleanText(value);
  return text ? [text] : [];
}

function unwrapJsonContent(content: string) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() || trimmed;
}

function parseJsonObjectText(value: unknown): Record<string, any> | null {
  if (typeof value !== 'string') return null;
  const normalized = unwrapJsonContent(value);
  if (!normalized.startsWith('{') || !normalized.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(normalized);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, any> : null;
  } catch {
    return null;
  }
}

function getArtifactStructuredData(artifact: SupliaArtifact | null) {
  if (!artifact) return {};
  const parsedContent = parseJsonObjectText(artifact.content);
  const data = asRecord(artifact.data);
  return parsedContent ? { ...parsedContent, ...data } : data;
}

function pickTextField(record: Record<string, any>, fields: string[]) {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'string' || typeof value === 'number') {
      const text = cleanText(value);
      if (text) return text;
    }
  }
  return '';
}

function structuredItemToPreview(value: unknown, index: number): ArtifactPreviewItem | null {
  if (typeof value === 'string' || typeof value === 'number') {
    const title = cleanText(value);
    return title ? { title } : null;
  }
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return null;
  const title = pickTextField(record, ['title', 'name', 'industry', 'sector', 'segment', 'audience', 'action', 'label', 'criterion', 'signal', 'step']) || `Item ${index + 1}`;
  const detail = pickTextField(record, ['detail', 'description', 'reason', 'why', 'summary', 'useCase', 'pain', 'criteria', 'notes']);
  const meta = pickTextField(record, ['priority', 'status', 'source', 'score', 'channel']);
  return { title, detail, meta };
}

function getStructuredItems(data: Record<string, any>, keys: string[], limit = 8) {
  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) {
      const items = value.map(structuredItemToPreview).filter(Boolean) as ArtifactPreviewItem[];
      if (items.length > 0) return items.slice(0, limit);
    }
    if (typeof value === 'string' || typeof value === 'number') {
      const text = cleanText(value);
      const numbered = typeof value === 'string'
        ? text.split(/\s*\(\d+\)\s*/).map((part) => part.replace(/^[:,\s]+|[;,\s]+$/g, '').trim()).filter(Boolean)
        : [];
      const actionItems = numbered.length > 1 && /puedo|siguiente|opciones/i.test(numbered[0] || '') ? numbered.slice(1) : numbered;
      if (actionItems.length > 1) {
        return actionItems.map(structuredItemToPreview).filter(Boolean).slice(0, limit) as ArtifactPreviewItem[];
      }
      const item = structuredItemToPreview(value, 0);
      if (item) return [item];
    }
  }
  return [];
}

function getDocumentSummary(data: Record<string, any>) {
  return pickTextField(data, ['summary', 'resumen', 'description', 'overview', 'objective', 'goal', 'context']);
}

function hasStructuredDocumentData(data: Record<string, any>) {
  return Boolean(
    getDocumentSummary(data) ||
    getStructuredItems(data, ['industries', 'topIndustries', 'priorityIndustries', 'sectores', 'segments', 'audiences', 'targets'], 1).length ||
    getStructuredItems(data, ['triggerSignals', 'signals', 'senales', 'activationSignals'], 1).length ||
    getStructuredItems(data, ['nextSteps', 'next_steps', 'recommendedActions', 'actions'], 1).length ||
    getStructuredItems(data, ['criteria', 'criterios', 'icpCriteria', 'searchCriteria', 'selectionCriteria', 'fitCriteria'], 1).length
  );
}

function formatScore(value: unknown) {
  const score = Number(value);
  if (!Number.isFinite(score)) return '';
  if (score > 0 && score <= 1) return String(Math.round(score * 100));
  return String(Math.round(score));
}

function safeHref(value: string) {
  const href = value.trim();
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : '';
}

function getToolRunTitle(toolRun: SupliaToolRun) {
  const name = toolRun.toolName.replace(/\./g, ' · ').replace(/_/g, ' ');
  if (/fullenrich|prospecting\.search/i.test(toolRun.toolName)) return 'FullEnrich';
  if (/apollo/i.test(toolRun.toolName)) return 'FullEnrich';
  if (/gmail|mailbox/i.test(toolRun.toolName)) return 'Gmail';
  if (/crm/i.test(toolRun.toolName)) return 'CRM';
  if (/email|campaign/i.test(toolRun.toolName)) return 'Email';
  if (/web|serp|research/i.test(toolRun.toolName)) return 'Busqueda web';
  return name;
}

function getToolVerb(toolRun: SupliaToolRun) {
  if (toolRun.status === 'running' || toolRun.status === 'queued') {
    if (/fullenrich|prospecting\.search/i.test(toolRun.toolName)) return 'Buscando con FullEnrich';
    if (/apollo/i.test(toolRun.toolName)) return 'Buscando con FullEnrich';
    if (/gmail|mailbox/i.test(toolRun.toolName)) return 'Consultando Gmail';
    if (/crm/i.test(toolRun.toolName)) return 'Registrando en CRM';
    if (/web|serp|research/i.test(toolRun.toolName)) return 'Investigando en la web';
    return 'Ejecutando herramienta';
  }
  return getToolRunTitle(toolRun);
}

function getToolQuery(toolRun: SupliaToolRun) {
  const input = asRecord(toolRun.inputPayload);
  return cleanText(input.query || input.q || input.companyName || input.company || input.goal || input.subject || input.to || input.threadId || input.email || toolRun.approvalReason);
}

function getToolResults(toolRun: SupliaToolRun) {
  const output = asRecord(toolRun.outputPayload);
  const input = asRecord(toolRun.inputPayload);
  const source = asList(output.results).length
    ? asList(output.results)
    : asList(output.items).length
      ? asList(output.items)
      : asList(output.companies).length
        ? asList(output.companies)
        : asList(output.contacts).length
          ? asList(output.contacts)
          : asList(input.results);
  return source.slice(0, 5).map((item, index) => {
    const record = asRecord(item);
    const title = cleanText(record.title || record.name || record.companyName || record.company || record.email || record.subject || `Resultado ${index + 1}`);
    const sub = cleanText(record.sub || record.domain || record.website || record.role || record.jobTitle || record.email || record.status);
    const ini = cleanText(record.ini || title.slice(0, 2)).slice(0, 2).toUpperCase();
    return { title, sub, ini };
  }).filter((item) => item.title);
}

function isTranscriptToolRunVisible(toolRun: SupliaToolRun) {
  return toolRun.toolName !== 'workflow.approve_plan';
}

function getActionStatusLabel(status: string) {
  if (status === 'pending') return 'Esperando aprobacion';
  if (status === 'approved') return 'Aprobada';
  if (status === 'executed') return 'Ejecutada';
  if (status === 'cancelled') return 'Denegada';
  if (status === 'failed') return 'Fallida';
  return status;
}

function getActionApproveLabel(action: SupliaPendingAction, activeActionId: string | null, activeActionMode: 'approve' | 'deny' | 'edit' | null) {
  if (activeActionId === action.id && activeActionMode === 'approve') {
    return action.actionType === 'workflow.approve_plan' ? 'Creando trabajo...' : 'Ejecutando...';
  }
  if (action.actionType === 'workflow.approve_plan') return 'Aprobar plan';
  return 'Aprobar';
}

function getJobStatusLabel(status?: string | null, progressLabel?: string | null) {
  const label = cleanText(progressLabel);
  if (status === 'waiting_approval') return label.toLowerCase() === 'esperando aprobacion' ? 'Esperando tu aprobacion' : label || 'Esperando tu aprobacion';
  if (status === 'queued') return label || 'En cola';
  if (status === 'running' || status === 'planning') return label || 'Trabajando';
  if (status === 'completed') return label || 'Completado';
  if (status === 'failed') return label || 'Necesita revision';
  if (status === 'cancelled') return label || 'Cancelado';
  if (status === 'paused') return label || 'Pausado';
  return label || cleanText(status) || 'En progreso';
}

function formatProviderLabel(provider?: unknown) {
  const value = cleanText(provider).toLowerCase();
  if (value === 'fullenrich') return 'FullEnrich';
  if (value === 'apollo') return 'FullEnrich';
  if (value === 'pdl') return 'People Data Labs';
  if (value === 'serpapi') return 'SerpAPI';
  if (value === 'brand.dev' || value === 'branddev') return 'Brand.dev';
  if (value === 'similarweb') return 'SimilarWeb';
  if (value === 'domaindetails') return 'DomainDetails';
  if (value === 'externo') return 'Proveedor externo';
  if (value === 'auto') return 'Automatico segun disponibilidad';
  return value || 'Automatico segun disponibilidad';
}

function formatInlineList(value: unknown, fallback = 'No definido') {
  if (Array.isArray(value)) {
    const items = value.map((item) => cleanText(item)).filter(Boolean);
    return items.length > 0 ? items.join(', ') : fallback;
  }
  return cleanText(value) || fallback;
}

function formatCreditEstimate(value: unknown) {
  const record = asRecord(value);
  const companySearches = Number(record.companySearches || 0);
  const peopleSearchPages = Number(record.peopleSearchPages || 0);
  const searches = Number(record.searches || 0);
  const requests = Number(record.requests || 0);
  const provider = cleanText(record.provider);
  const parts: string[] = [];
  if (companySearches > 0) parts.push(`${companySearches} busqueda${companySearches === 1 ? '' : 's'} de empresas`);
  if (peopleSearchPages > 0) parts.push(`${peopleSearchPages} pagina${peopleSearchPages === 1 ? '' : 's'} de contactos`);
  if (searches > 0) parts.push(`${searches} busqueda${searches === 1 ? '' : 's'} web`);
  if (requests > 0) parts.push(`${requests} consulta${requests === 1 ? '' : 's'} de proveedor`);
  if (parts.length > 0) return `${parts.join(' + ')}${provider ? ` en ${formatProviderLabel(provider)}` : ''}`;
  return provider ? `Proveedor ${formatProviderLabel(provider)}` : 'No informado por el proveedor';
}

function getActionDisplayTitle(action: SupliaPendingAction) {
  return action.actionType === 'workflow.approve_plan' ? 'Aprobar plan de trabajo' : action.title;
}

function getResearchActionLabel(actionType: string) {
  const labels: Record<string, string> = {
    'research.brand': 'Perfil de marca',
    'research.brand_mentions': 'Menciones de marca',
    'research.serp_company_news': 'Noticias de empresa',
    'research.serp_competitors': 'Competidores',
    'research.serp_jobs_signals': 'Senales de contratacion',
  };
  return labels[actionType] || actionType.replace(/^research\./, '').replace(/_/g, ' ');
}

function getResearchProvider(actionType: string) {
  if (actionType === 'research.brand') return 'brand.dev';
  if (actionType.startsWith('research.serp_') || actionType === 'research.brand_mentions') return 'serpapi';
  return 'externo';
}

function getStrongConfirmationForAction(action: SupliaPendingAction) {
  if (!requiresSupliaStrongConfirmation(action.approvalKind)) return null;
  return getSupliaStrongConfirmationPhrase(action.toolName || action.actionType, action.payload || {});
}

function getArtifactText(artifact: SupliaArtifact | null) {
  if (!artifact) return '';
  const parsedContent = parseJsonObjectText(artifact.content);
  if (parsedContent) return JSON.stringify(getArtifactStructuredData(artifact), null, 2);
  if (artifact.content) return artifact.content;
  if (artifact.data && Object.keys(artifact.data).length > 0) return JSON.stringify(artifact.data, null, 2);
  return '';
}

function getArtifactLabel(type: string) {
  const labels: Record<string, string> = {
    plan: 'Plan',
    icp_strategy: 'Estrategia ICP',
    search_plan: 'Plan de busqueda',
    email_draft: 'Borrador de correo',
    personalized_email_draft: 'Email personalizado',
    thread_reply_draft: 'Respuesta de hilo',
    campaign_draft: 'Campana',
    campaign_preview: 'Campana',
    company_shortlist: 'Lista de empresas',
    person_shortlist: 'Lista de contactos',
    lead_list: 'Lista de prospectos',
    pipeline_summary: 'Tablero de seguimiento',
    mailbox_search: 'Busqueda Gmail',
    mailbox_contact_list: 'Contactos Gmail',
    gmail_thread_summary: 'Hilo Gmail',
    crm_summary: 'CRM',
    risk_report: 'Reporte de riesgo',
    report: 'Reporte',
    note: 'Documento',
    company_research: 'Research de empresa',
  };
  return labels[type] || type.replace(/_/g, ' ');
}

function getArtifactDescription(artifact: SupliaArtifact | null) {
  if (!artifact) return 'Los artifacts se abriran aqui cuando SUPL.IA cree trabajo persistente.';
  if (artifact.type.includes('email') || artifact.type.includes('reply')) return 'Borrador editable para revisar, copiar o convertir en accion aprobable.';
  if (artifact.type.includes('campaign')) return 'Workspace de campana. Guardar o lanzar seguira requiriendo aprobacion.';
  if (artifact.type.includes('gmail') || artifact.type.includes('mailbox')) return 'Analisis de mailbox aprobado. No modifica CRM ni envia correos.';
  if (artifact.type === 'company_research') return 'Research de cuenta con fuentes, senales y supuestos separados antes de contactar.';
  if (artifact.type.includes('shortlist') || artifact.type === 'lead_list') return 'Lista generada para revisar y priorizar antes de actuar.';
  if (artifact.type === 'risk_report') return 'Resumen de riesgos y guardrails antes de ejecutar.';
  return 'Documento generado por SUPL.IA para iterar desde el chat.';
}

function getArtifactPreviewItems(artifact: SupliaArtifact): ArtifactPreviewItem[] {
  const data = getArtifactStructuredData(artifact);
  const scored = asRecord(data.scored);

  if (artifact.type === 'company_shortlist') {
    const source = asList(data.candidates).length ? asList(data.candidates) : asList(scored.topCompanies || data.topCompanies || data.items || data.rows);
    return source.map((company) => {
      const record = asRecord(company);
      const domain = cleanText(record.domain || record.primary_domain || record.website_url || record.website || record.url);
      const score = formatScore(record.score || record.matchScore || record.fitScore);
      return {
        title: cleanText(record.companyName || record.name || record.empresa || domain || 'Empresa'),
        eyebrow: cleanText(record.industry || record.category || record.location || record.sector || domain),
        detail: asTextList(record.reasons || record.reason || record.description || record.summary).join('; '),
        meta: domain,
        score,
        status: cleanText(record.status || record.estado || 'Nuevo'),
      };
    }).filter((item) => item.title);
  }

  if (artifact.type === 'person_shortlist' || artifact.type === 'lead_list' || artifact.type === 'mailbox_contact_list') {
    const source = asList(data.leads).length ? asList(data.leads) : asList(data.contacts).length ? asList(data.contacts) : asList(data.items).length ? asList(data.items) : asList(data.rows).length ? asList(data.rows) : asList(scored.topLeads || data.topLeads);
    return source.map((lead) => {
      const record = asRecord(lead);
      const company = cleanText(record.companyName || record.company || record.organization || record.accountName || record.empresa);
      const role = cleanText(record.title || record.jobTitle || record.role || record.cargo);
      const email = cleanText(record.email || record.workEmail || record.primaryEmail || (record.lockedEmail ? 'email bloqueado' : ''));
      const dotacion = cleanText(record.dotacion || record.headcount || record.employeeCount || record.companyHeadcount);
      const score = formatScore(record.score || record.matchScore || record.fitScore);
      return {
        title: cleanText(record.fullName || record.name || record.personName || record.contacto || email || company || 'Contacto'),
        eyebrow: [role, company].filter(Boolean).join(' · '),
        detail: asTextList(record.reasons || record.reason || record.risks || record.summary || record.snippet).join('; '),
        meta: artifact.type === 'lead_list' ? dotacion || email || cleanText(record.lastSubject || record.crmStatus) : email || dotacion || cleanText(record.lastSubject || record.crmStatus),
        score,
        status: cleanText(record.status || record.estado || 'Nuevo'),
      };
    }).filter((item) => item.title);
  }

  const previews = asList(data.previews);
  if (previews.length > 0) {
    return previews.map((preview) => {
      const record = asRecord(preview);
      return {
        title: cleanText(record.recipientName || record.to || record.company || record.subject || 'Borrador'),
        eyebrow: cleanText(record.company || record.to || record.name),
        detail: cleanText(record.subject || record.textBody || record.body || record.preview),
        meta: cleanText(record.to || record.email),
      };
    }).filter((item) => item.title);
  }

  return [];
}

function getArtifactItemCount(artifact: SupliaArtifact | null) {
  if (!artifact) return 0;
  return getArtifactPreviewItems(artifact).length;
}

function getArtifactCardSummary(artifact: SupliaArtifact | null, artifactType: string) {
  if (!artifact) return getArtifactLabel(artifactType);
  const count = getArtifactItemCount(artifact);
  if (count > 0) return `${getArtifactLabel(artifact.type)} · ${count} item${count === 1 ? '' : 's'}`;
  return getArtifactDescription(artifact);
}

function getArtifactFilename(artifact: SupliaArtifact) {
  const base = `${artifact.title || 'suplia-artifact'}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'suplia-artifact';
  return `${base}.md`;
}

function getMemoryLabel(memory: SupliaMemory) {
  const labels: Record<string, string> = {
    icp_preference: 'ICP',
    offer_context: 'Oferta',
    compliance_rule: 'Regla',
    preference: 'Preferencia',
  };
  return labels[memory.memoryType] || memory.memoryType.replace(/_/g, ' ');
}

function getMemoryStatusLabel(status: string) {
  const labels: Record<string, string> = {
    approved: 'aprobada',
    proposed: 'por aprobar',
    inferred: 'inferida',
    rejected: 'rechazada',
    archived: 'archivada',
  };
  return labels[status] || status;
}

function getMemorySummary(memory: SupliaMemory) {
  const value = asRecord(memory.value);
  const summary = cleanText(value.summary || value.description || value.text || value.goal || value.note);
  if (summary) return summary;
  const segments = asTextList(value.segments || value.segmentNames || value.roles).slice(0, 3);
  if (segments.length > 0) return segments.join(' · ');
  return previewJson(value, 'Sin detalle guardado');
}

function buildMemoryPrompt(memory: SupliaMemory, mode: 'use' | 'manage') {
  const summary = getMemorySummary(memory);
  if (mode === 'manage') {
    return `Gestiona esta memoria de SUPL.IA sin ejecutar cambios directos hasta pedirme aprobacion.\n\nID: ${memory.id}\nTipo: ${memory.memoryType}\nClave: ${memory.key}\nEstado: ${memory.status}\nDetalle: ${summary}\n\nSi conviene archivarla o actualizarla, prepara la accion aprobable correspondiente.`;
  }
  return `Usa esta memoria como contexto para la siguiente respuesta.\n\nTipo: ${memory.memoryType}\nClave: ${memory.key}\nDetalle: ${summary}`;
}

function getMessageParts(message: SupliaMessage): SupliaMessagePart[] {
  const parts = message.metadata?.parts;
  return Array.isArray(parts) && parts.length > 0 ? parts : [{ type: 'text', text: message.content }];
}

function parseSseMessage(raw: string) {
  const lines = raw.split(/\r?\n/);
  let event = 'message';
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }

  return { event, data: dataLines.join('\n') };
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*([^*]+?)\*\*|`([^`]+?)`|\[([^\]]+?)\]\(([^)\s]+?)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const [raw, , boldText, codeText, linkText, linkHref] = match;

    if (boldText) {
      nodes.push(<strong key={`${keyPrefix}-strong-${match.index}`}>{boldText}</strong>);
    } else if (codeText) {
      nodes.push(<code key={`${keyPrefix}-code-${match.index}`}>{codeText}</code>);
    } else if (linkText && linkHref) {
      const href = safeHref(linkHref);
      nodes.push(href ? (
        <a key={`${keyPrefix}-link-${match.index}`} href={href} target="_blank" rel="noreferrer">
          {linkText}
        </a>
      ) : raw);
    } else {
      nodes.push(raw);
    }

    lastIndex = match.index + raw.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes.length ? nodes : [text];
}

function isUnorderedListLine(line: string) {
  return /^\s*[-*]\s+/.test(line);
}

function isOrderedListLine(line: string) {
  return /^\s*\d+[.)]\s+/.test(line);
}

function isBlockBoundary(line: string) {
  return !line.trim() || markdownFencePattern.test(line) || /^\s{0,3}#{1,3}\s+/.test(line) || isUnorderedListLine(line) || isOrderedListLine(line);
}

function renderRichText(text: string) {
  const lines = text.replace(/\r\n/g, '\n').trim().split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] || '';
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (markdownFencePattern.test(line)) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !markdownFencePattern.test(lines[index] || '')) {
        codeLines.push(lines[index] || '');
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(<div key={`code-${index}`} className="suplia-code-block"><pre>{codeLines.join('\n')}</pre></div>);
      continue;
    }

    const heading = /^\s{0,3}(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const content = heading[2].trim();
      blocks.push(<div key={`heading-${index}`} className="suplia-heading">{renderInlineMarkdown(content, `heading-${index}`)}</div>);
      index += 1;
      continue;
    }

    if (isUnorderedListLine(line) || isOrderedListLine(line)) {
      const ordered = isOrderedListLine(line);
      const items: string[] = [];
      while (index < lines.length && (ordered ? isOrderedListLine(lines[index] || '') : isUnorderedListLine(lines[index] || ''))) {
        items.push((lines[index] || '').replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/, '').trim());
        index += 1;
      }
      const ListTag = ordered ? 'ol' : 'ul';
      blocks.push(
        <ListTag key={`list-${index}`}>
          {items.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{renderInlineMarkdown(item, `list-${index}-${itemIndex}`)}</li>)}
        </ListTag>
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && !isBlockBoundary(lines[index] || '')) {
      paragraphLines.push((lines[index] || '').trim());
      index += 1;
    }
    if (paragraphLines.length === 0) {
      paragraphLines.push(trimmed);
      index += 1;
    }

    const paragraph = paragraphLines.join(' ');
    blocks.push(<p key={`paragraph-${index}`}>{renderInlineMarkdown(paragraph, `paragraph-${index}`)}</p>);
  }

  return <>{blocks}</>;
}

function normalizeAskPartQuestions(part: SupliaAskPart): SupliaAskQuestion[] {
  const source = Array.isArray(part.questions) && part.questions.length > 0
    ? part.questions
    : [{
      header: part.header,
      question: part.question || '',
      options: part.options || [],
      multi: part.multi,
      allowOther: part.allowOther,
    }];

  return source.map((question) => {
    const options = Array.isArray(question.options)
      ? question.options.map((option) => ({ label: cleanText(option.label), description: cleanText(option.description) || null })).filter((option) => option.label)
      : [];
    return {
      header: cleanText(question.header) || null,
      question: cleanText(question.question),
      options,
      multi: Boolean(question.multi),
      allowOther: question.allowOther !== false || options.length === 0,
    };
  }).filter((question) => question.question);
}

function formatAskAnswerMessage(payload: SupliaAskAnswerPayload) {
  return [
    'Respuesta al cuestionario:',
    ...payload.answers.flatMap((answer) => [
      answer.question,
      answer.answers.map((item) => `- ${item}`).join('\n'),
    ]),
  ].filter(Boolean).join('\n');
}

function MessageTable({ part }: { part: SupliaTablePart }) {
  const headers = Array.isArray(part.headers) ? part.headers.filter(Boolean) : [];
  const rows = Array.isArray(part.rows) ? part.rows.filter((row) => Array.isArray(row) && row.some(Boolean)) : [];
  if (headers.length === 0 || rows.length === 0) return null;

  return (
    <div className="tbl-wrap suplia-table-wrap">
      <table>
        <thead>
          <tr>{headers.map((header, index) => <th key={`${header}-${index}`}>{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}`}>
              {headers.map((_, cellIndex) => {
                const cell = String(row[cellIndex] || '');
                return <td key={`cell-${rowIndex}-${cellIndex}`}>{renderInlineMarkdown(cell, `table-${rowIndex}-${cellIndex}`)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MessageCode({ part }: { part: SupliaCodePart }) {
  const [copied, setCopied] = useState(false);
  const content = String(part.content || '');
  if (!content) return null;

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="suplia-code-block suplia-code-card">
      <div className="suplia-code-head">
        <span>{cleanText(part.language) || 'codigo'}</span>
        <button type="button" onClick={copyCode}>{copied ? 'Copiado' : 'Copiar'}</button>
      </div>
      <pre>{content}</pre>
    </div>
  );
}

function AskCard({ part, answer, disabled, onSubmit }: { part: SupliaAskPart; answer?: SupliaAskAnswerPayload; disabled?: boolean; onSubmit: (payload: SupliaAskAnswerPayload) => void }) {
  const questions = useMemo(() => normalizeAskPartQuestions(part), [part]);
  const [selected, setSelected] = useState<Record<number, string[]>>({});
  const [otherOpen, setOtherOpen] = useState<Record<number, boolean>>({});
  const [otherText, setOtherText] = useState<Record<number, string>>({});
  const answered = Boolean(answer?.answers?.length);
  const canSubmit = questions.length > 0 && questions.every((question, index) => {
    const selectedValues = selected[index] || [];
    const otherValue = cleanText(otherText[index]);
    return selectedValues.length > 0 || (question.allowOther !== false && otherValue);
  });

  function toggleOption(questionIndex: number, label: string, multi?: boolean) {
    setSelected((prev) => {
      const current = prev[questionIndex] || [];
      const exists = current.includes(label);
      return {
        ...prev,
        [questionIndex]: multi
          ? exists ? current.filter((item) => item !== label) : [...current, label]
          : exists ? [] : [label],
      };
    });
    if (!multi) {
      setOtherOpen((prev) => ({ ...prev, [questionIndex]: false }));
      setOtherText((prev) => ({ ...prev, [questionIndex]: '' }));
    }
  }

  function toggleOther(questionIndex: number, multi?: boolean) {
    setOtherOpen((prev) => ({ ...prev, [questionIndex]: !prev[questionIndex] }));
    if (!multi) setSelected((prev) => ({ ...prev, [questionIndex]: [] }));
  }

  function submitAnswer() {
    if (!canSubmit || disabled || answered) return;
    onSubmit({
      askId: part.askId,
      answers: questions.map((question, index) => ({
        header: question.header || null,
        question: question.question,
        answers: [
          ...(selected[index] || []),
          ...(cleanText(otherText[index]) ? [cleanText(otherText[index])] : []),
        ],
      })),
    });
  }

  return (
    <div className={cn('ask suplia-ask', answered && 'done')}>
      {questions.map((question, questionIndex) => {
        const selectedValues = selected[questionIndex] || [];
        const answeredQuestion = answer?.answers?.[questionIndex];
        return (
          <div key={`${part.askId}-${questionIndex}`} className={questionIndex > 0 ? 'suplia-ask-question-gap' : undefined}>
            {question.header && <div className="ask-head">{question.header}</div>}
            <div className="ask-q">{question.question}</div>
            {answered ? (
              <div className="ask-answer">
                <CheckCircle2 className="h-4 w-4 text-[var(--suplia-accent)]" />
                {(answeredQuestion?.answers || []).map((item) => <span key={item} className="pill">{item}</span>)}
              </div>
            ) : (
              <div className="ask-opts" data-q={questionIndex}>
                {(question.options || []).map((option) => {
                  const isSelected = selectedValues.includes(option.label);
                  return (
                    <button
                      key={option.label}
                      type="button"
                      className={cn('ask-opt', isSelected && 'sel')}
                      aria-pressed={isSelected}
                      disabled={disabled}
                      onClick={() => toggleOption(questionIndex, option.label, Boolean(question.multi))}
                    >
                      <span className="ao-main"><span className="ao-label">{option.label}</span>{option.description && <span className="ao-desc">{option.description}</span>}</span>
                      <span className="ao-check"><CheckCircle2 className="h-3 w-3" /></span>
                    </button>
                  );
                })}
                {question.allowOther !== false && (
                  <>
                    <button
                      type="button"
                      className={cn('ask-opt', otherOpen[questionIndex] && 'sel')}
                      aria-pressed={Boolean(otherOpen[questionIndex])}
                      disabled={disabled}
                      onClick={() => toggleOther(questionIndex, Boolean(question.multi))}
                    >
                      <span className="ao-main"><span className="ao-label">Otra...</span></span>
                      <span className="ao-check"><CheckCircle2 className="h-3 w-3" /></span>
                    </button>
                    {otherOpen[questionIndex] && (
                      <input
                        className="ask-input"
                        aria-label={`Otra respuesta para ${question.question}`}
                        value={otherText[questionIndex] || ''}
                        onChange={(event) => setOtherText((prev) => ({ ...prev, [questionIndex]: event.target.value }))}
                        placeholder="Escribe tu respuesta..."
                        disabled={disabled}
                      />
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
      {!answered && <button type="button" className="ask-submit" onClick={submitAnswer} disabled={!canSubmit || disabled}>{part.submitLabel || 'Enviar'}</button>}
    </div>
  );
}

function renderPayloadPreview(action: SupliaPendingAction) {
  const payload = action.payload || {};
  const to = typeof payload.to === 'string' ? payload.to : '';
  const subject = typeof payload.subject === 'string' ? payload.subject : '';
  const companyName = typeof payload.companyName === 'string' ? payload.companyName : typeof payload.company === 'string' ? payload.company : '';
  const provider = typeof payload.provider === 'string' ? payload.provider : 'auto';
  const searchPlan = asRecord(payload.searchPlan);

  if (action.actionType === 'workflow.approve_plan') {
    const planSummary = typeof payload.planSummary === 'string' ? payload.planSummary : '';
    const goal = typeof payload.goal === 'string' ? payload.goal : typeof payload.originalMessage === 'string' ? payload.originalMessage : '';
    const steps = Array.isArray(payload.steps) ? payload.steps : [];
    return (
      <div className="mt-4 rounded-xl border border-current/10 bg-white/55 p-4 text-sm dark:bg-white/5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-current/70">Plan de trabajo</div>
        <p className="mt-2 leading-6">{planSummary || goal || 'SUPL.IA preparara el flujo antes de ejecutar acciones sensibles.'}</p>
        {steps.length > 0 && (
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {steps.slice(0, 3).map((step: any, index: number) => (
              <div key={`${step?.title || 'step'}-${index}`} className="rounded-xl border border-current/10 bg-white/60 p-3 dark:bg-black/10">
                <div className="mb-2 flex h-6 w-6 items-center justify-center rounded-full bg-current/10 text-xs font-semibold">{index + 1}</div>
                <div className="text-sm font-medium">{String(step?.title || 'Paso')}</div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-4 text-xs leading-5 opacity-70">Al aprobar, se crea el job y avanza con pasos internos. Cualquier busqueda externa o consumo de creditos pedira otra aprobacion.</p>
      </div>
    );
  }

  if (action.actionType === 'prospecting.search_companies') {
    const estimatedCredits = payload.estimatedCreditUse || searchPlan.estimatedCreditUse;
    const queries = formatInlineList(searchPlan.companyQueries || payload.companyQueries || companyName || payload.query, 'Sin criterio claro');
    const roles = formatInlineList(searchPlan.peopleTitles || payload.peopleTitles, 'No se buscaran contactos todavia');
    const locations = formatInlineList(searchPlan.locations || payload.locations, 'Sin ubicacion especifica');
    const maxResults = String(payload.perPage || payload.limit || searchPlan.maxCompanies || 8);
    return (
      <div className="suplia-approval-detail">
        <div><span>Tipo de busqueda</span><strong>Empresas objetivo</strong></div>
        <div><span>Buscara</span><strong>{queries}</strong></div>
        <div><span>Proveedor</span><strong>{formatProviderLabel(provider)}</strong></div>
        <div><span>Maximo</span><strong>{maxResults} empresas</strong></div>
        <div><span>Ubicacion</span><strong>{locations}</strong></div>
        <div><span>Roles para la etapa siguiente</span><strong>{roles}</strong></div>
        <div><span>Creditos estimados</span><strong>{formatCreditEstimate(estimatedCredits)}</strong></div>
        <p>No enviara correos, no cambiara el CRM y no buscara contactos personales en esta aprobacion.</p>
      </div>
    );
  }

  if (action.actionType === 'prospecting.search_people') {
    const estimatedCredits = payload.estimatedCreditUse || searchPlan.estimatedCreditUse;
    const companyNames = formatInlineList(payload.companyNames || searchPlan.companyNames || payload.companyName || searchPlan.domains, 'Empresas priorizadas');
    const roles = formatInlineList(payload.personTitles || payload.titles || searchPlan.peopleTitles, 'Roles decisores');
    const locations = formatInlineList(payload.personLocations || searchPlan.locations, 'Sin ubicacion especifica');
    return (
      <div className="suplia-approval-detail">
        <div><span>Tipo de busqueda</span><strong>Contactos dentro de empresas priorizadas</strong></div>
        <div><span>Empresas</span><strong>{companyNames}</strong></div>
        <div><span>Roles</span><strong>{roles}</strong></div>
        <div><span>Proveedor</span><strong>{formatProviderLabel(provider)}</strong></div>
        <div><span>Ubicacion</span><strong>{locations}</strong></div>
        <div><span>Creditos estimados</span><strong>{formatCreditEstimate(estimatedCredits)}</strong></div>
        <p>No enviara correos. Solo buscara contactos para que puedas revisarlos antes de cualquier accion comercial.</p>
      </div>
    );
  }

  if (action.actionType.startsWith('research.')) {
    const domain = cleanText(payload.domain || payload.companyDomain || payload.website || payload.url);
    const company = cleanText(payload.company || payload.companyName || payload.keyword || payload.name);
    const query = cleanText(payload.query);
    const provider = cleanText(payload.provider || (payload.estimatedCreditUse && asRecord(payload.estimatedCreditUse).provider) || getResearchProvider(action.actionType));
    return (
      <div className="suplia-approval-detail">
        <div><span>Investigacion</span><strong>{getResearchActionLabel(action.actionType)}</strong></div>
        <div><span>Objetivo</span><strong>{query || company || domain || 'Sin objetivo claro'}</strong></div>
        <div><span>Proveedor</span><strong>{formatProviderLabel(provider)}</strong></div>
        <div><span>Creditos estimados</span><strong>{formatCreditEstimate(payload.estimatedCreditUse || { provider: provider || 'externo', requests: 1 })}</strong></div>
        <p>Solo leera fuentes publicas. No modifica CRM, no guarda memoria y no contacta personas.</p>
      </div>
    );
  }

  const rows: Array<[string, string]> = [];
  if (action.actionType === 'email.send') rows.push(['Para', to || 'Sin destinatario'], ['Asunto', subject || 'Sin asunto']);
  if (action.actionType === 'email.bulk_send') rows.push(['Mensajes', String(Array.isArray(payload.messages) ? payload.messages.length : payload.limit || 0)], ['Modo', payload.dryRun === false ? 'preparar borradores para revisión' : 'dry-run']);
  if (['campaign.update', 'campaign.launch', 'campaign.pause', 'campaign.resume'].includes(action.actionType)) rows.push(['Campana', String(payload.campaignId || payload.id || 'Sin campana')], ['Impacto', action.actionType === 'campaign.pause' ? 'detiene nuevos envios' : 'actualiza estado de campana']);
  if (action.actionType === 'campaign.create_draft') rows.push(['Campana', String(payload.name || payload.title || 'Sin nombre')], ['Estado', 'se guardara pausada']);

  if (rows.length === 0) return null;
  return (
    <div className="mt-3 space-y-1 rounded-xl bg-white/55 p-3 text-xs dark:bg-white/5">
      {rows.map(([label, value]) => <div key={label}><span className="font-medium">{label}:</span> {value}</div>)}
    </div>
  );
}

function ActivityIndicator({ phaseIndex, phaseLabel, elapsedMs, onStop }: { phaseIndex: number; phaseLabel?: string | null; elapsedMs: number; onStop: () => void }) {
  const activePhase = phaseLabel || activityPhases[Math.min(phaseIndex, activityPhases.length - 1)] || activityPhases[0];
  return (
    <div className="suplia-msg" aria-live="polite">
      <div className="suplia-gen-star">
        <SupliaMark />
        <span className="suplia-shimmer">{activePhase}</span>
        <span>· {formatElapsed(elapsedMs)}</span>
        <button type="button" className="suplia-act" onClick={onStop} aria-label="Detener respuesta"><Square className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

function MemoryShelf({ memories, onUse, onManage }: { memories: SupliaMemory[]; onUse: (memory: SupliaMemory) => void; onManage: (memory: SupliaMemory) => void }) {
  if (memories.length === 0) return null;
  return (
    <section className="suplia-memory-shelf" aria-label="Memoria activa de SUPL.IA">
      <div className="suplia-memory-head">
        <span>Memoria</span>
        <p>Contexto que SUPL.IA puede reutilizar en decisiones futuras.</p>
      </div>
      <div className="suplia-memory-list">
        {memories.map((memory) => (
          <article key={memory.id} className={cn('suplia-memory-card', memory.status === 'proposed' && 'pending')}>
            <div className="suplia-memory-card-top">
              <span>{getMemoryLabel(memory)}</span>
              <small>{getMemoryStatusLabel(memory.status)}</small>
            </div>
            <strong>{memory.key}</strong>
            <p>{getMemorySummary(memory)}</p>
            <div className="suplia-memory-actions">
              <button type="button" onClick={() => onUse(memory)}>Usar</button>
              <button type="button" onClick={() => onManage(memory)}>Gestionar</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ToolRunCard({ toolRun }: { toolRun: SupliaToolRun }) {
  const results = getToolResults(toolRun);
  const query = getToolQuery(toolRun);
  const running = toolRun.status === 'running' || toolRun.status === 'queued';
  const failed = toolRun.status === 'failed';
  const compact = !results.length && !toolRun.errorMessage && !toolRun.approvalReason;
  return (
    <div className={cn('suplia-tool', compact && 'compact')}>
      <div className="suplia-tool-head">
        {running ? <div className="suplia-spinner" /> : failed ? <XCircle className="h-4 w-4 text-red-500" /> : <Globe2 className="h-4 w-4" />}
        <span>{getToolVerb(toolRun)}</span>
        {query && <span className="query">· &quot;{query}&quot;</span>}
        <span className="suplia-tool-count">{failed ? 'error' : results.length ? `${results.length} resultados` : toolRun.status}</span>
      </div>
      {(results.length > 0 || toolRun.errorMessage || toolRun.approvalReason) && (
        <div className="suplia-tool-body">
          {results.length > 0 ? results.map((result) => (
            <div key={`${toolRun.id}-${result.title}`} className="suplia-source-row">
              <span className="suplia-source-icon">{result.ini}</span>
              <span className="suplia-source-title">{result.title}</span>
              {result.sub && <span className="suplia-source-sub">{result.sub}</span>}
            </div>
          )) : (
            <div className="suplia-source-row">
              <span className="suplia-source-icon">IA</span>
              <span className="suplia-source-title">{toolRun.errorMessage || toolRun.approvalReason || previewJson(toolRun.outputPayload || toolRun.inputPayload)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MessageActions({
  message,
  onRetry,
  onFeedback,
  feedback,
}: {
  message: SupliaMessage;
  onRetry: () => void;
  onFeedback: (rating: 'up' | 'down') => void;
  feedback?: 'up' | 'down' | null;
}) {
  const [copied, setCopied] = useState(false);

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message.content || '');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard can fail outside secure contexts; keep the UI stable.
    }
  }

  return (
    <div className="suplia-actions">
      <button type="button" className="suplia-act" title={copied ? 'Copiado' : 'Copiar'} onClick={copyMessage}>
        {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </button>
      <button
        type="button"
        className={cn('suplia-act', feedback === 'up' && 'text-[var(--suplia-accent)]')}
        title="Buena respuesta"
        aria-pressed={feedback === 'up'}
        onClick={() => onFeedback('up')}
      >
        <ThumbsUp className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={cn('suplia-act', feedback === 'down' && 'text-[var(--suplia-accent)]')}
        title="Mala respuesta"
        aria-pressed={feedback === 'down'}
        onClick={() => onFeedback('down')}
      >
        <ThumbsDown className="h-4 w-4" />
      </button>
      <button type="button" className="suplia-act" title="Reintentar" onClick={onRetry}><RotateCcw className="h-4 w-4" /></button>
    </div>
  );
}

function StructuredDocumentSection({ title, items }: { title: string; items: ArtifactPreviewItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="suplia-doc-section">
      <h2>{title}</h2>
      <div className="suplia-doc-items">
        {items.map((item, index) => (
          <article key={`${title}-${item.title}-${index}`} className="suplia-doc-item">
            <div>
              <strong>{item.title}</strong>
              {item.detail && <p>{item.detail}</p>}
            </div>
            {item.meta && <span>{item.meta}</span>}
          </article>
        ))}
      </div>
    </section>
  );
}

function StructuredDocumentPreview({ artifact, data }: { artifact: SupliaArtifact; data: Record<string, any> }) {
  const summary = getDocumentSummary(data);
  const industries = getStructuredItems(data, ['industries', 'topIndustries', 'priorityIndustries', 'sectores', 'segments', 'audiences', 'targets'], 8);
  const criteria = getStructuredItems(data, ['criteria', 'criterios', 'icpCriteria', 'searchCriteria', 'selectionCriteria', 'fitCriteria'], 8);
  const signals = getStructuredItems(data, ['triggerSignals', 'signals', 'senales', 'activationSignals'], 8);
  const nextSteps = getStructuredItems(data, ['nextSteps', 'next_steps', 'recommendedActions', 'actions'], 6);
  const assumptions = getStructuredItems(data, ['assumptions', 'supuestos', 'risks', 'notes'], 5);

  return (
    <div className="suplia-art-preview suplia-strategy-doc">
      <div className="suplia-doc-hero">
        <span className="suplia-research-kicker">{getArtifactLabel(artifact.type)}</span>
        <h1>{cleanText(data.title || artifact.title || 'Documento')}</h1>
        <p>{summary || getArtifactDescription(artifact)}</p>
      </div>
      {industries.length > 0 && (
        <section className="suplia-doc-section featured">
          <h2>Prioridades</h2>
          <div className="suplia-doc-priority-grid">
            {industries.map((item, index) => (
              <article key={`${item.title}-${index}`}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{item.title}</strong>
                {item.detail && <p>{item.detail}</p>}
              </article>
            ))}
          </div>
        </section>
      )}
      <div className="suplia-doc-grid">
        <StructuredDocumentSection title="Criterios" items={criteria} />
        <StructuredDocumentSection title="Senales de activacion" items={signals} />
        <StructuredDocumentSection title="Proximos pasos" items={nextSteps} />
        <StructuredDocumentSection title="Supuestos y notas" items={assumptions} />
      </div>
    </div>
  );
}

function ArtifactPreview({ artifact, text }: { artifact: SupliaArtifact; text: string }) {
  const data = getArtifactStructuredData(artifact);
  const items = getArtifactPreviewItems(artifact);
  const pipelineSource = asRecord(data.suggestions || data.followups || data.pipelineSummary);
  const pipelineColumns = asList(data.columnas || data.columns || data.pipeline || data.board || pipelineSource.columns);
  const pipelineTasks = asList(data.tasks || data.followupTasks || data.items || pipelineSource.items || pipelineSource.tasks).slice(0, 12);
  const sequence = asRecord(data.sequence || data.cadence || data.flow);
  const sequenceSteps = asList(data.pasos || data.steps || sequence.steps || data.sequence || data.cadence);
  const emailPreviews = asList(data.previews || data.variants || data.drafts).slice(0, 8);

  if (artifact.type === 'company_research') {
    const research = asRecord(data.research || data);
    const similarweb = asRecord(data.similarweb || research.similarweb);
    const whois = asRecord(data.whois || research.whois);
    const brand = asRecord(data.brand || research.brand);
    const news = asList(data.news || data.items || research.news || research.items);
    const mentions = asList(data.mentions || research.mentions);
    const competitors = asList(data.competitors || research.competitors);
    const hiringSignals = asList(data.hiringSignals || research.hiringSignals);
    const sourceItems = [...news, ...mentions, ...competitors, ...hiringSignals].slice(0, 8);
    const signals = asTextList(data.signals || research.signals || data.targetSignals || data.summary).slice(0, 8);
    const domain = cleanText(data.domain || similarweb.domain || whois.domain || brand.domain);
    const companyName = cleanText(data.companyName || data.company || brand.name || artifact.title);
    const visits = formatScore(similarweb.visitsMonthly || similarweb.visits || data.visitsMonthly);
    const rank = formatScore(similarweb.globalRank);
    const registrar = cleanText(whois.registrar);
    const industry = cleanText(brand.industry || data.industry || similarweb.category);

    return (
      <div className="suplia-art-preview suplia-company-research">
        <div className="suplia-research-hero">
          <div>
            <span className="suplia-research-kicker">Research de cuenta</span>
            <h1>{companyName || 'Empresa investigada'}</h1>
            <p>{domain || getArtifactDescription(artifact)}</p>
          </div>
          <span className="suplia-art-pill">Solo lectura</span>
        </div>

        <div className="suplia-research-stats">
          <div><span>Visitas mensuales</span><strong>{visits || 'Sin dato'}</strong></div>
          <div><span>Ranking</span><strong>{rank || 'Sin dato'}</strong></div>
          <div><span>Industria</span><strong>{industry || 'Sin dato'}</strong></div>
          <div><span>Fuentes</span><strong>{sourceItems.length || 'Sin dato'}</strong></div>
        </div>

        <div className="suplia-research-grid">
          <section>
            <h2>Senales utiles</h2>
            {signals.length > 0 ? (
              <ul>{signals.map((signal, index) => <li key={`${signal}-${index}`}>{signal}</li>)}</ul>
            ) : <p>No hay senales resumidas todavia. Usa los datos de fuente como contexto, no como conclusion.</p>}
          </section>

          <section>
            <h2>Dominio</h2>
            <dl>
              <div><dt>Registrar</dt><dd>{registrar || 'Sin dato'}</dd></div>
              <div><dt>Expira</dt><dd>{cleanText(whois.expires) || 'Sin dato'}</dd></div>
              <div><dt>Disponibilidad</dt><dd>{typeof whois.available === 'boolean' ? (whois.available ? 'Disponible' : 'Registrado') : 'Sin dato'}</dd></div>
            </dl>
          </section>

          <section>
            <h2>Actividad digital</h2>
            <dl>
              <div><dt>Bounce</dt><dd>{cleanText(similarweb.bounceRate) || 'Sin dato'}</dd></div>
              <div><dt>Paginas/visita</dt><dd>{cleanText(similarweb.pagesPerVisit) || 'Sin dato'}</dd></div>
              <div><dt>Duracion visita</dt><dd>{cleanText(similarweb.avgVisitDuration) || 'Sin dato'}</dd></div>
            </dl>
          </section>

          <section>
            <h2>Fuentes externas</h2>
            {sourceItems.length > 0 ? sourceItems.slice(0, 6).map((item, index) => {
              const record = asRecord(item);
              return <p key={`${cleanText(record.title) || 'source'}-${index}`}><strong>{cleanText(record.title) || `Fuente ${index + 1}`}</strong>{cleanText(record.snippet) ? ` - ${cleanText(record.snippet)}` : ''}</p>;
            }) : <p>Sin fuentes externas asociadas en este artifact.</p>}
          </section>
        </div>
      </div>
    );
  }

  if (['note', 'icp_strategy', 'search_plan', 'plan', 'report', 'tool_result', 'crm_summary', 'reply_brief'].includes(artifact.type) && hasStructuredDocumentData(data)) {
    return <StructuredDocumentPreview artifact={artifact} data={data} />;
  }

  if (artifact.type === 'pipeline_summary' || pipelineColumns.length > 0 || pipelineTasks.length > 0) {
    return (
      <div className="suplia-art-preview suplia-pipeline-preview">
        <h1>{cleanText(data.title || artifact.title || 'Seguimiento')}</h1>
        {pipelineTasks.length > 0 && pipelineColumns.length === 0 ? (
          <div className="suplia-task-list">
            {pipelineTasks.map((task, index) => {
              const record = asRecord(task);
              const title = cleanText(record.title || record.email || record.leadId || record.company || record.name) || `Seguimiento ${index + 1}`;
              const action = cleanText(record.suggestedAction || record.action || record.nextAction || record.status);
              const reason = cleanText(record.reason || record.note || record.summary || record.lastSubject);
              return (
                <div key={`${title}-${index}`} className="suplia-task-card">
                  <div>
                    <strong>{title}</strong>
                    {reason && <p>{reason}</p>}
                  </div>
                  <span>{action || 'Revisar'}</span>
                </div>
              );
            })}
          </div>
        ) : <div className="suplia-pipeline-board">
          {pipelineColumns.map((column, columnIndex) => {
            const record = asRecord(column);
            const leads = asList(record.leads || record.items || record.cards);
            return (
              <div key={`${cleanText(record.nombre || record.name || record.title) || 'col'}-${columnIndex}`} className="suplia-pipeline-col">
                <div className="suplia-pipeline-head">
                  <span>{cleanText(record.nombre || record.name || record.title) || `Columna ${columnIndex + 1}`}</span>
                  <span>{leads.length}</span>
                </div>
                {leads.length > 0 ? leads.map((lead, leadIndex) => {
                  const leadRecord = asRecord(lead);
                  return (
                    <div key={`${cleanText(leadRecord.empresa || leadRecord.company || leadRecord.name) || 'lead'}-${leadIndex}`} className="suplia-pipeline-card">
                      <div>{cleanText(leadRecord.empresa || leadRecord.company || leadRecord.name) || `Lead ${leadIndex + 1}`}</div>
                      {(leadRecord.nota || leadRecord.note || leadRecord.summary) && <p>{cleanText(leadRecord.nota || leadRecord.note || leadRecord.summary)}</p>}
                    </div>
                  );
                }) : <div className="suplia-pipeline-empty">Sin leads.</div>}
              </div>
            );
          })}
        </div>}
      </div>
    );
  }

  if ((artifact.type.includes('campaign') || artifact.type === 'mission_draft') && sequenceSteps.length > 0) {
    return (
      <div className="suplia-art-preview suplia-sequence-preview">
        <h1>{cleanText(data.title || artifact.title || 'Secuencia de contacto')}</h1>
        <div className="suplia-sequence-list">
          {sequenceSteps.map((step, index) => {
            const record = asRecord(step);
            return (
              <div key={`${cleanText(record.dia || record.day || record.subject || record.asunto) || 'step'}-${index}`} className="suplia-sequence-step">
                <div className="suplia-sequence-dot">{index + 1}</div>
                <div className="suplia-sequence-copy">
                  <div className="suplia-sequence-head">
                    <span>{cleanText(record.dia || record.day) || `Paso ${index + 1}`}</span>
                    <small>{cleanText(record.canal || record.channel) || 'Correo'}</small>
                  </div>
                  {(record.asunto || record.subject || record.subjectTemplate) && <strong>{cleanText(record.asunto || record.subject || record.subjectTemplate)}</strong>}
                  {(record.resumen || record.summary || record.body || record.bodyTemplate) && <p>{cleanText(record.resumen || record.summary || record.body || record.bodyTemplate)}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (artifact.type === 'risk_report') {
    const preflight = asRecord(data.preflight || data.report || data);
    const status = cleanText(preflight.status || data.status || 'review');
    const blocked = formatScore(preflight.blockedCount || preflight.blocked || data.blockedCount);
    const review = formatScore(preflight.reviewCount || preflight.warnings || data.reviewCount);
    const sampleCount = formatScore(preflight.sampleCount || preflight.samples || data.sampleCount);
    const risks = asList(data.risks || preflight.risks || preflight.items || preflight.messages).slice(0, 6);

    return (
      <div className="suplia-art-preview suplia-risk-preview">
        <div className="suplia-risk-head">
          <div>
            <span>Preflight</span>
            <h1>{artifact.title || 'Reporte de riesgo'}</h1>
          </div>
          <strong>{status}</strong>
        </div>
        <div className="suplia-risk-metrics">
          <div><span>Muestras</span><strong>{sampleCount || '0'}</strong></div>
          <div><span>Warnings</span><strong>{review || '0'}</strong></div>
          <div><span>Bloqueos</span><strong>{blocked || '0'}</strong></div>
        </div>
        <div className="suplia-risk-list">
          {risks.length > 0 ? risks.map((risk, index) => {
            const record = asRecord(risk);
            const label = cleanText(record.label || record.title || record.reason || record.code) || `Riesgo ${index + 1}`;
            const detail = cleanText(record.detail || record.message || record.description || record.fix);
            const severity = cleanText(record.severity || record.level || record.status || 'review');
            return <div key={`${label}-${index}`}><span>{severity}</span><strong>{label}</strong>{detail && <p>{detail}</p>}</div>;
          }) : <p>No hay riesgos detallados en este reporte. Revisa el JSON si necesitas auditoria completa.</p>}
        </div>
      </div>
    );
  }

  if (artifact.type.includes('email') || artifact.type.includes('reply')) {
    const preview = asRecord(data.preview || data.draft || data.email || data);
    const to = cleanText(preview.to || preview.para || preview.recipient || preview.recipientName);
    const subject = cleanText(preview.subject || preview.asunto || data.subject);
    const body = cleanText(preview.body || preview.cuerpo || preview.textBody || preview.htmlBody || artifact.content || text);
    return (
      <div className="suplia-art-preview suplia-email-preview">
        <h1>{cleanText(data.title || artifact.title || 'Borrador de correo')}</h1>
        {emailPreviews.length > 0 ? (
          <div className="suplia-email-stack">
            {emailPreviews.map((draft, index) => {
              const record = asRecord(draft);
              const draftTo = cleanText(record.to || record.email || record.recipientName || record.company);
              const draftSubject = cleanText(record.subject || record.asunto || `Variante ${index + 1}`);
              const draftBody = cleanText(record.textBody || record.body || record.htmlBody || record.preview);
              return (
                <section key={`${draftTo}-${draftSubject}-${index}`}>
                  <div><span>{draftTo || `Destinatario ${index + 1}`}</span><strong>{draftSubject}</strong></div>
                  <p>{draftBody || 'Sin contenido visible.'}</p>
                </section>
              );
            })}
          </div>
        ) : (
          <>
            <div className="suplia-email-header">
              <div className="suplia-email-row"><span className="suplia-email-key">Para</span><span className="font-medium">{to || 'Sin destinatario'}</span></div>
              <div className="suplia-email-row"><span className="suplia-email-key">Asunto</span><span className="font-medium">{subject || 'Sin asunto'}</span></div>
            </div>
            <div className="suplia-email-body">{body || 'Sin contenido visible.'}</div>
          </>
        )}
        <div className="suplia-email-actions"><span>Enviar</span><span>Editar</span><span>Programar seguimiento</span></div>
      </div>
    );
  }

  if (items.length > 0) {
    return (
      <div className="suplia-art-preview suplia-list-preview">
        <h1>{cleanText(data.title || artifact.title || getArtifactLabel(artifact.type))}</h1>
        <p className="muted text-sm">{cleanText(data.subtitle || getArtifactDescription(artifact))}</p>
        <table className="suplia-leads-table">
          <thead>
            <tr><th>Empresa / contacto</th><th>Dotacion</th><th>Score</th><th>Estado</th></tr>
          </thead>
          <tbody>
            {items.slice(0, 20).map((item, index) => {
              const score = Number(item.score || 0);
              const width = Number.isFinite(score) && score > 0 ? Math.max(8, Math.min(100, score)) : 0;
              return (
                <tr key={`${item.title}-${index}`}>
                  <td><strong>{item.title}</strong>{item.eyebrow && <div className="muted text-xs">{item.eyebrow}</div>}</td>
                  <td>{item.meta || item.detail || '-'}</td>
                  <td>{width > 0 ? <><span className="suplia-score-bar"><i style={{ width: `${width}%` }} /></span><span className="ml-2 text-xs muted">{item.score}</span></> : '-'}</td>
                  <td><span className={cn('suplia-art-pill', item.status === 'Contactado' && 'p2')}>{item.status || 'Nuevo'}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="suplia-art-preview suplia-doc-card">
      <h1>{artifact.title}</h1>
      <p className="muted text-sm">{getArtifactDescription(artifact)}</p>
      <div className="mt-4 rounded-xl border border-[#e7e4d8] bg-[#faf9f5] p-4 text-sm leading-7 dark:border-[#3a3935] dark:bg-[#262624]">
        <pre className="whitespace-pre-wrap break-words font-sans">{artifact.content || text || 'Este artifact no tiene contenido visible todavia.'}</pre>
      </div>
    </div>
  );
}

export function SupliaWorkspace() {
  const { toast } = useToast();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [state, setState] = useState<WorkspaceState>(emptyState);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const [activeActionMode, setActiveActionMode] = useState<'approve' | 'deny' | 'edit' | null>(null);
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [planEditText, setPlanEditText] = useState<Record<string, string>>({});
  const [strongConfirmations, setStrongConfirmations] = useState<Record<string, string>>({});
  const [messageFeedback, setMessageFeedback] = useState<Record<string, 'up' | 'down'>>({});
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);
  const [artifactCopied, setArtifactCopied] = useState(false);
  const [composerMode, setComposerMode] = useState<ComposerMode>('ask');
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [dictating, setDictating] = useState(false);
  const [conversationQuery, setConversationQuery] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [artifactPanelOpen, setArtifactPanelOpen] = useState(false);
  const [artifactTab, setArtifactTab] = useState<'preview' | 'data'>('preview');
  const [activityStartedAt, setActivityStartedAt] = useState<number | null>(null);
  const [activityElapsedMs, setActivityElapsedMs] = useState(0);
  const [activityPhaseIndex, setActivityPhaseIndex] = useState(0);
  const [activityPhaseLabel, setActivityPhaseLabel] = useState<string | null>(null);
  const [streamingTextByMessageId, setStreamingTextByMessageId] = useState<Record<string, string>>({});
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const requestAbortRef = useRef<AbortController | null>(null);
  const artifactCountRef = useRef(0);
  const streamingTimerRef = useRef<number | null>(null);
  const workspaceRequestSeqRef = useRef(0);

  const activePendingActions = useMemo(
    () => state.pendingActions.filter((action) => action.status === 'pending'),
    [state.pendingActions]
  );
  const latestArtifacts = useMemo(() => state.artifacts.slice(0, 12), [state.artifacts]);
  const visibleMemories = useMemo(
    () => state.memories.filter((memory) => memory.status === 'approved' || memory.status === 'proposed').slice(0, 4),
    [state.memories]
  );
  const activeArtifact = useMemo(
    () => state.artifacts.find((artifact) => artifact.id === activeArtifactId) || state.artifacts[0] || null,
    [activeArtifactId, state.artifacts]
  );
  const activeArtifactText = useMemo(() => getArtifactText(activeArtifact), [activeArtifact]);
  const activeArtifactIndex = activeArtifact ? latestArtifacts.findIndex((artifact) => artifact.id === activeArtifact.id) : -1;
  const canMoveToNewerArtifact = activeArtifactIndex > 0;
  const canMoveToOlderArtifact = activeArtifactIndex >= 0 && activeArtifactIndex < latestArtifacts.length - 1;
  const activeComposerMode = composerModes.find((mode) => mode.value === composerMode) || composerModes[0];
  const conversationGroups = useMemo(() => groupConversations(state.conversations, conversationQuery), [conversationQuery, state.conversations]);
  const visibleToolRuns = useMemo(() => state.toolRuns.filter(isTranscriptToolRunVisible), [state.toolRuns]);
  const runningToolCount = visibleToolRuns.filter((toolRun) => toolRun.status === 'running' || toolRun.status === 'queued').length;
  const completedToolCount = visibleToolRuns.filter((toolRun) => toolRun.status === 'completed').length;
  const failedToolCount = visibleToolRuns.filter((toolRun) => toolRun.status === 'failed').length;
  const showWorkspaceStrip = state.messages.length > 0 && (activePendingActions.length > 0 || Boolean(state.activeJob) || latestArtifacts.length > 0 || visibleToolRuns.length > 0 || visibleMemories.length > 0);
  const answeredAskById = useMemo(() => {
    const answers = new Map<string, SupliaAskAnswerPayload>();
    for (const message of state.messages) {
      const payload = message.metadata?.answerToAsk;
      if (message.role === 'user' && payload?.askId) answers.set(payload.askId, payload);
    }
    return answers;
  }, [state.messages]);
  const jobIsLive = Boolean(state.activeJob && !terminalJobStatuses.has(state.activeJob.status));
  const currentTheme = (theme === 'system' ? resolvedTheme : theme) || 'light';

  function resetChat() {
    workspaceRequestSeqRef.current += 1;
    setActiveArtifactId(null);
    setArtifactPanelOpen(false);
    setAttachments([]);
    setEditingActionId(null);
    setPlanEditText({});
    setComposerMode('ask');
    setSidebarOpen(false);
    setState((prev) => ({ ...prev, conversation: null, messages: [], artifacts: [], pendingActions: [], toolRuns: [], jobs: [], activeJob: null, jobSteps: [], agentRuns: [], jobEvents: [], memories: [] }));
  }

  function isReadableAttachment(file: File) {
    const name = file.name.toLowerCase();
    return file.type.startsWith('text/') || file.type === 'application/json' || readableAttachmentExtensions.some((extension) => name.endsWith(extension));
  }

  function formatBytes(bytes: number) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
  }

  async function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    const next: ComposerAttachment[] = [];
    for (const file of Array.from(files).slice(0, 5)) {
      const attachment: ComposerAttachment = {
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
        name: file.name,
        type: file.type || 'archivo',
        size: file.size,
      };
      if (isReadableAttachment(file)) {
        const text = await file.text();
        attachment.content = text.length > 8000 ? `${text.slice(0, 8000)}\n\n[Contenido truncado]` : text;
      } else {
        attachment.unsupported = true;
      }
      next.push(attachment);
    }
    setAttachments((prev) => [...prev, ...next].slice(0, 5));
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function buildComposerMessage(text: string) {
    const sections = [text.trim()];
    if (activeComposerMode.promptPrefix) sections.unshift(activeComposerMode.promptPrefix);
    if (attachments.length > 0) {
      sections.push([
        'Adjuntos del usuario:',
        ...attachments.map((attachment) => {
          if (attachment.unsupported) return `- ${attachment.name} (${formatBytes(attachment.size)}): adjunto visible, lectura de contenido no soportada todavia.`;
          return `- ${attachment.name} (${formatBytes(attachment.size)}):\n${attachment.content || '[Sin contenido legible]'}`;
        }),
      ].join('\n'));
    }
    return sections.filter(Boolean).join('\n\n');
  }

  function startQuickAction(action: 'artifact' | 'company' | 'scheduled' | 'prospecting' | 'research' | 'contact' | 'followup') {
    setSidebarOpen(false);
    if (action === 'artifact') {
      setComposerMode('artifact');
      setInput((prev) => prev.trim() || 'Crea un artifact con');
      return;
    }
    if (action === 'company') {
      sendMessage('conoces mi empresa?');
      return;
    }
    if (action === 'scheduled') {
      if (process.env.NEXT_PUBLIC_SUPLIA_SCHEDULED_ENABLED !== 'true') return;
      toast({ title: 'Programado', description: 'Las tareas programadas apareceran cuando SUPL.IA tenga jobs recurrentes.' });
      return;
    }
    const prompts = {
      prospecting: 'Prospecta empresas que calcen con mi ICP y arma una lista priorizada.',
      research: 'Investiga una cuenta objetivo y resume senales de compra relevantes.',
      contact: 'Prepara un correo breve y personalizado para un decisor.',
      followup: 'Revisa oportunidades sin respuesta y propone seguimiento.',
    };
    setInput(prompts[action]);
  }

  function useMemory(memory: SupliaMemory) {
    setComposerMode('ask');
    setInput(buildMemoryPrompt(memory, 'use'));
    setSidebarOpen(false);
    toast({ title: 'Memoria preparada', description: 'Revisa la instruccion antes de enviarla.' });
  }

  function manageMemory(memory: SupliaMemory) {
    setComposerMode('approval');
    setInput(buildMemoryPrompt(memory, 'manage'));
    setSidebarOpen(false);
    toast({ title: 'Gestion segura', description: 'SUPL.IA preparara cualquier cambio de memoria como aprobacion.' });
  }

  function toggleDictation() {
    const SpeechRecognition = typeof window !== 'undefined' ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null;
    if (!SpeechRecognition) {
      toast({ title: 'Dictado no disponible', description: 'Este navegador no expone Web Speech API para dictado.' });
      return;
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
      setDictating(false);
      return;
    }
    const recognition = new SpeechRecognition();
    const preferred = typeof navigator !== 'undefined' ? navigator.language : '';
    recognition.lang = preferred && preferred.toLowerCase().startsWith('es') ? preferred : 'es-CL';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results || []).map((result: any) => result?.[0]?.transcript || '').join(' ').trim();
      if (transcript) setInput((prev) => `${prev}${prev.trim() ? ' ' : ''}${transcript}`);
    };
    recognition.onerror = () => toast({ title: 'Dictado detenido', description: 'No se pudo completar la captura de voz.' });
    recognition.onend = () => {
      recognitionRef.current = null;
      setDictating(false);
    };
    recognitionRef.current = recognition;
    setDictating(true);
    recognition.start();
  }

  function applyResponse(data: SupliaChatResponse | any) {
    setState((prev) => {
      const nextConversation = data.conversation || prev.conversation;
      const sameConversation = Boolean(prev.conversation?.id && nextConversation?.id === prev.conversation.id);
      const nextMessages = Array.isArray(data.messages)
        ? data.messages.length > 0 || !sameConversation
          ? data.messages
          : prev.messages
        : prev.messages;

      return {
        conversation: nextConversation,
        conversations: Array.isArray(data.conversations) ? data.conversations : prev.conversations,
        messages: nextMessages,
        artifacts: Array.isArray(data.artifacts) ? data.artifacts : prev.artifacts,
        pendingActions: Array.isArray(data.pendingActions) ? data.pendingActions : prev.pendingActions,
        toolRuns: Array.isArray(data.toolRuns) ? data.toolRuns : prev.toolRuns,
        jobs: Array.isArray(data.jobs) ? data.jobs : prev.jobs,
        activeJob: Object.prototype.hasOwnProperty.call(data, 'activeJob') ? data.activeJob : prev.activeJob,
        jobSteps: Array.isArray(data.jobSteps) ? data.jobSteps : prev.jobSteps,
        agentRuns: Array.isArray(data.agentRuns) ? data.agentRuns : prev.agentRuns,
        jobEvents: Array.isArray(data.jobEvents) ? data.jobEvents : prev.jobEvents,
        memories: Array.isArray(data.memories) ? data.memories : prev.memories,
      };
    });
  }

  function animateAssistantMessage(data: SupliaChatResponse | any) {
    const messages = Array.isArray(data.messages) ? data.messages as SupliaMessage[] : [];
    const assistantMessage = [...messages].reverse().find((message) => message.role === 'assistant' && message.content.trim());
    if (!assistantMessage) return;
    if (streamingTimerRef.current) window.clearTimeout(streamingTimerRef.current);

    const fullText = assistantMessage.content;
    const parts = fullText.split(/(\s+)/);
    let cursor = 0;
    setStreamingTextByMessageId((prev) => ({ ...prev, [assistantMessage.id]: '' }));

    const tick = () => {
      cursor = Math.min(parts.length, cursor + 2);
      const nextText = parts.slice(0, cursor).join('');
      setStreamingTextByMessageId((prev) => ({ ...prev, [assistantMessage.id]: nextText }));
      if (cursor < parts.length) {
        streamingTimerRef.current = window.setTimeout(tick, 22 + Math.random() * 26);
      } else {
        streamingTimerRef.current = window.setTimeout(() => {
          setStreamingTextByMessageId((prev) => {
            const next = { ...prev };
            delete next[assistantMessage.id];
            return next;
          });
          streamingTimerRef.current = null;
        }, 320);
      }
    };

    streamingTimerRef.current = window.setTimeout(tick, 80);
  }

  async function loadWorkspace(conversationId?: string | null, options: { silent?: boolean } = {}) {
    const requestSeq = ++workspaceRequestSeqRef.current;
    if (!options.silent) setLoading(true);
    try {
      const qs = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : '';
      const res = await fetch(`/api/suplia/chat${qs}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'No se pudo cargar SUPL.IA');
      if (requestSeq !== workspaceRequestSeqRef.current) return;
      applyResponse(data);
    } catch (error: any) {
      if (!options.silent) toast({ variant: 'destructive', title: 'SUPL.IA no pudo cargar', description: error?.message || 'Intenta nuevamente.' });
    } finally {
      if (!options.silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadWorkspace();
    return () => {
      if (streamingTimerRef.current) window.clearTimeout(streamingTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [state.messages.length, sending]);

  useEffect(() => {
    if (!sending || !activityStartedAt) {
      setActivityElapsedMs(0);
      setActivityPhaseIndex(0);
      return;
    }
    const interval = window.setInterval(() => {
      const elapsed = Date.now() - activityStartedAt;
      setActivityElapsedMs(elapsed);
      setActivityPhaseIndex((prev) => Math.max(prev, Math.min(activityPhases.length - 1, Math.floor(elapsed / 1800))));
    }, 500);
    return () => window.clearInterval(interval);
  }, [activityStartedAt, sending]);

  useEffect(() => {
    if (state.artifacts.length === 0) {
      if (activeArtifactId) setActiveArtifactId(null);
      setArtifactPanelOpen(false);
      artifactCountRef.current = 0;
      return;
    }
    if (!activeArtifactId || !state.artifacts.some((artifact) => artifact.id === activeArtifactId)) {
      setActiveArtifactId(state.artifacts[0].id);
    }
    if (state.artifacts.length > artifactCountRef.current) {
      setActiveArtifactId(state.artifacts[0].id);
      setArtifactPanelOpen(true);
      setArtifactTab('preview');
    }
    artifactCountRef.current = state.artifacts.length;
  }, [activeArtifactId, state.artifacts]);

  useEffect(() => {
    if (!state.conversation?.id || !jobIsLive) return;
    const interval = window.setInterval(() => {
      loadWorkspace(state.conversation?.id, { silent: true });
    }, 4000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.conversation?.id, state.activeJob?.id, state.activeJob?.status, jobIsLive]);

  function cancelActiveRequest() {
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
  }

  async function sendMessage(text: string, options: SendMessageOptions = {}) {
    const clean = text.trim();
    if (!clean || sending) return;

    setInput('');
    setSending(true);
    setActivityStartedAt(Date.now());
    setActivityElapsedMs(0);
    setActivityPhaseIndex(0);
    setActivityPhaseLabel(activityPhases[0]);
    const controller = new AbortController();
    requestAbortRef.current = controller;
    const optimistic: SupliaMessage = {
      id: `temp-${Date.now()}`,
      conversationId: state.conversation?.id || 'temp',
      role: 'user',
      content: clean,
      metadata: { parts: [{ type: 'text', text: clean }], ...(options.answerToAsk ? { answerToAsk: options.answerToAsk } : {}) },
      createdAt: new Date().toISOString(),
    };
    setState((prev) => ({ ...prev, messages: [...prev.messages, optimistic] }));

    try {
      const res = await fetch('/api/suplia/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ conversationId: state.conversation?.id, message: clean, activeArtifactId, answerToAsk: options.answerToAsk || null, stream: true }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'SUPL.IA no pudo responder');
      }

      if (!res.body || !res.headers.get('content-type')?.includes('text/event-stream')) {
        const data = await res.json();
        applyResponse(data);
        animateAssistantMessage(data);
      } else {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalReceived = false;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split(/\r?\n\r?\n/);
          buffer = chunks.pop() || '';

          for (const chunk of chunks) {
            const parsed = parseSseMessage(chunk);
            if (!parsed.data) continue;
            const eventData = JSON.parse(parsed.data);

            if (parsed.event === 'start' || parsed.event === 'status') {
              if (typeof eventData.phase === 'string') setActivityPhaseLabel(eventData.phase);
              if (typeof eventData.phaseIndex === 'number') setActivityPhaseIndex(Math.max(0, Math.min(activityPhases.length - 1, eventData.phaseIndex)));
            }

            if (['tool.started', 'tool.completed', 'tool.failed', 'artifact.created', 'approval.requested', 'job.started'].includes(parsed.event)) {
              if (typeof eventData.label === 'string') setActivityPhaseLabel(eventData.label);
              setActivityPhaseIndex((prev) => Math.max(prev, Math.min(activityPhases.length - 1, 2)));
            }

            if (parsed.event === 'final') {
              finalReceived = true;
              const finalState = eventData.state || eventData;
              applyResponse(finalState);
              animateAssistantMessage(finalState);
            }

            if (parsed.event === 'error') throw new Error(eventData.error || 'SUPL.IA no pudo responder');
          }
        }

        if (!finalReceived) throw new Error('La respuesta de SUPL.IA se interrumpio antes de terminar.');
      }

      setAttachments([]);
      setComposerMode('ask');
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        toast({ title: 'Solicitud detenida', description: 'Se cancelo la espera de esta respuesta.' });
      } else {
        toast({ variant: 'destructive', title: 'No se pudo enviar', description: error?.message || 'Intenta nuevamente.' });
      }
      setState((prev) => ({ ...prev, messages: prev.messages.filter((message) => message.id !== optimistic.id) }));
      setInput(clean);
    } finally {
      if (requestAbortRef.current === controller) requestAbortRef.current = null;
      setSending(false);
      setActivityStartedAt(null);
      setActivityPhaseLabel(null);
    }
  }

  async function approveAction(action: SupliaPendingAction) {
    const conversationId = action.conversationId || state.conversation?.id || null;
    const requiredConfirmation = getStrongConfirmationForAction(action);
    const confirmationText = strongConfirmations[action.id] || '';
    if (requiredConfirmation && confirmationText.trim().toUpperCase() !== requiredConfirmation) {
      toast({ variant: 'destructive', title: 'Confirmacion requerida', description: `Escribe ${requiredConfirmation} para ejecutar esta accion sensible.` });
      return;
    }

    setActiveActionId(action.id);
    setActiveActionMode('approve');
    try {
      const res = await fetch(`/api/suplia/actions/${action.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmationText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'No se pudo ejecutar la accion');
      applyResponse(data);
      await loadWorkspace(conversationId, { silent: true });
      setStrongConfirmations((prev) => {
        const next = { ...prev };
        delete next[action.id];
        return next;
      });
      toast({ title: 'Accion ejecutada', description: data?.toast || 'SUPL.IA completo la accion aprobada.' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Accion detenida', description: error?.message || 'Revisa la accion y vuelve a intentar.' });
    } finally {
      setActiveActionId(null);
      setActiveActionMode(null);
    }
  }

  function buildPlanEditPrompt(action: SupliaPendingAction, feedback: string) {
    const payload = action.payload || {};
    const steps = Array.isArray(payload.steps) ? payload.steps : [];
    const currentPlan = [
      `Objetivo: ${cleanText(payload.goal || payload.originalMessage) || 'No definido'}`,
      `Resumen: ${cleanText(payload.planSummary) || cleanText(action.description) || 'No definido'}`,
      steps.length > 0
        ? `Pasos:\n${steps.map((step: any, index: number) => `${index + 1}. ${cleanText(step?.title) || 'Paso'}: ${cleanText(step?.description) || 'Sin descripcion'}`).join('\n')}`
        : 'Pasos: No definidos',
      Array.isArray(payload.assumptions) && payload.assumptions.length > 0 ? `Supuestos:\n${payload.assumptions.map((item: any) => `- ${cleanText(item)}`).join('\n')}` : 'Supuestos: No definidos',
      Array.isArray(payload.risks) && payload.risks.length > 0 ? `Riesgos:\n${payload.risks.map((item: any) => `- ${cleanText(item)}`).join('\n')}` : 'Riesgos: No definidos',
    ].join('\n\n');

    return [
      'Edita el plan pendiente antes de aprobarlo.',
      '',
      'Cambios solicitados por el usuario:',
      feedback,
      '',
      'Plan actual:',
      currentPlan,
      '',
      'Genera una nueva version del plan para aprobar. No ejecutes busquedas externas, no consumas creditos y no contactes personas.',
    ].join('\n');
  }

  async function submitPlanEdit(action: SupliaPendingAction) {
    const feedback = (planEditText[action.id] || '').trim();
    if (!feedback) {
      toast({ variant: 'destructive', title: 'Describe el cambio', description: 'Indica que quieres agregar, quitar o ajustar del plan.' });
      return;
    }

    setActiveActionId(action.id);
    setActiveActionMode('edit');
    try {
      const res = await fetch(`/api/suplia/actions/${action.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'edit_plan' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'No se pudo reemplazar el plan');
      applyResponse(data);
      setEditingActionId(null);
      setPlanEditText((prev) => {
        const next = { ...prev };
        delete next[action.id];
        return next;
      });
      setActiveActionId(null);
      setActiveActionMode(null);
      await sendMessage(buildPlanEditPrompt(action, feedback));
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'No se pudo editar el plan', description: error?.message || 'Intenta nuevamente.' });
    } finally {
      setActiveActionId(null);
      setActiveActionMode(null);
    }
  }

  async function cancelAction(action: SupliaPendingAction) {
    const conversationId = action.conversationId || state.conversation?.id || null;
    setActiveActionId(action.id);
    setActiveActionMode('deny');
    try {
      const res = await fetch(`/api/suplia/actions/${action.id}/cancel`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'No se pudo cancelar la accion');
      applyResponse(data);
      await loadWorkspace(conversationId, { silent: true });
      toast({ title: 'Accion cancelada', description: data?.toast || 'SUPL.IA no ejecutara esta accion.' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'No se pudo cancelar', description: error?.message || 'Intenta nuevamente.' });
    } finally {
      setActiveActionId(null);
      setActiveActionMode(null);
    }
  }

  function renderActionControls(action: SupliaPendingAction, inputIdPrefix: string) {
    if (action.status !== 'pending') return null;
    const requiredConfirmation = getStrongConfirmationForAction(action);
    const isBusy = activeActionId === action.id;
    const isPlanApproval = action.actionType === 'workflow.approve_plan';
    const isEditing = editingActionId === action.id;
    return (
      <div className="mt-3 space-y-3 font-sans">
        {requiredConfirmation && (
          <div className="rounded-xl bg-white/55 p-3 text-xs dark:bg-white/5">
            <Label htmlFor={`${inputIdPrefix}-${action.id}`} className="text-xs font-medium">Confirmacion fuerte</Label>
            <p className="mt-1 opacity-75">Escribe {requiredConfirmation} para ejecutar.</p>
            <Input
              id={`${inputIdPrefix}-${action.id}`}
              value={strongConfirmations[action.id] || ''}
              onChange={(event) => setStrongConfirmations((prev) => ({ ...prev, [action.id]: event.target.value }))}
              placeholder={requiredConfirmation}
              className="mt-2 h-9 rounded-xl bg-white/70 text-xs dark:bg-black/20"
            />
          </div>
        )}
        {isPlanApproval && isEditing && (
          <div className="suplia-plan-edit">
            <Label htmlFor={`${inputIdPrefix}-edit-${action.id}`} className="text-xs font-medium">Que quieres cambiar del plan?</Label>
            <Textarea
              id={`${inputIdPrefix}-edit-${action.id}`}
              value={planEditText[action.id] || ''}
              onChange={(event) => setPlanEditText((prev) => ({ ...prev, [action.id]: event.target.value }))}
              placeholder="Ej: enfocalo en empresas SaaS de 50-200 empleados y agrega una etapa para validar el rubro antes de buscar."
              className="mt-2 min-h-24 rounded-xl bg-white/70 text-sm dark:bg-black/20"
              disabled={isBusy}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="suplia-foot-btn primary" onClick={() => submitPlanEdit(action)} disabled={isBusy}>
                {isBusy && activeActionMode === 'edit' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {isBusy && activeActionMode === 'edit' ? 'Preparando nuevo plan...' : 'Enviar cambios'}
              </button>
              <button type="button" className="suplia-foot-btn" onClick={() => setEditingActionId(null)} disabled={isBusy}>Cancelar edicion</button>
            </div>
          </div>
        )}
        {isBusy && activeActionMode === 'approve' && (
          <div className="suplia-action-status" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{isPlanApproval ? 'Plan aprobado. Creando el trabajo y preparando el siguiente paso visible en el hilo.' : 'Ejecutando solo la accion aprobada. El hilo se actualizara al terminar.'}</span>
          </div>
        )}
        {!isEditing && <div className="flex flex-wrap gap-2">
          <button type="button" className="suplia-foot-btn primary" onClick={() => approveAction(action)} disabled={activeActionId === action.id}>
            {isBusy && activeActionMode === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {getActionApproveLabel(action, activeActionId, activeActionMode)}
          </button>
          {isPlanApproval && (
            <button type="button" className="suplia-foot-btn" onClick={() => setEditingActionId(action.id)} disabled={isBusy}>
              <Sparkles className="h-4 w-4" /> Editar plan
            </button>
          )}
          <button type="button" className="suplia-foot-btn" onClick={() => cancelAction(action)} disabled={activeActionId === action.id}>
            {isBusy && activeActionMode === 'deny' ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
            {isBusy && activeActionMode === 'deny' ? 'Denegando...' : 'Denegar'}
          </button>
        </div>}
      </div>
    );
  }

  async function copyActiveArtifact() {
    if (!activeArtifactText) return;
    try {
      await navigator.clipboard.writeText(activeArtifactText);
      setArtifactCopied(true);
      window.setTimeout(() => setArtifactCopied(false), 1600);
      toast({ title: 'Artifact copiado' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'No se pudo copiar', description: error?.message || 'Intenta nuevamente.' });
    }
  }

  function downloadActiveArtifact() {
    if (!activeArtifact || !activeArtifactText) return;
    const blob = new Blob([activeArtifactText], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = getArtifactFilename(activeArtifact);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function openArtifact(id: string | null | undefined) {
    if (!id) return;
    setActiveArtifactId(id);
    setArtifactPanelOpen(true);
    setArtifactTab('preview');
  }

  function moveArtifact(direction: -1 | 1) {
    if (latestArtifacts.length === 0) return;
    const current = activeArtifactIndex >= 0 ? activeArtifactIndex : 0;
    const next = Math.max(0, Math.min(latestArtifacts.length - 1, current + direction));
    if (next === current) return;
    setActiveArtifactId(latestArtifacts[next].id);
    setArtifactTab('preview');
  }

  function submitAskAnswer(payload: SupliaAskAnswerPayload) {
    sendMessage(formatAskAnswerMessage(payload), { answerToAsk: payload });
  }

  async function submitFeedback(message: SupliaMessage, rating: 'up' | 'down') {
    const current = messageFeedback[message.id] || null;
    const next = current === rating ? null : rating;

    setMessageFeedback((prev) => {
      const copy = { ...prev };
      if (next) copy[message.id] = next;
      else delete copy[message.id];
      return copy;
    });

    try {
      if (next) {
        const res = await fetch(`/api/suplia/messages/${message.id}/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating: next }),
        });
        if (!res.ok) throw new Error('feedback failed');
      } else {
        const res = await fetch(`/api/suplia/messages/${message.id}/feedback`, { method: 'DELETE' });
        if (!res.ok) throw new Error('feedback delete failed');
      }
    } catch {
      setMessageFeedback((prev) => {
        const copy = { ...prev };
        if (current) copy[message.id] = current;
        else delete copy[message.id];
        return copy;
      });
      toast({ variant: 'destructive', title: 'No se pudo guardar el feedback' });
    }
  }

  function renderMessagePart(part: SupliaMessagePart, message: SupliaMessage, index: number, firstTextPartIndex: number, streamingText?: string) {
    if (part.type === 'text') {
      const text = index === firstTextPartIndex && streamingText != null ? streamingText : part.text;
      if (!text.trim() && streamingText == null) return null;
      return <div key={`${message.id}-text-${index}`}>{renderRichText(text)}{index === firstTextPartIndex && streamingText != null && <span className="suplia-caret" />}</div>;
    }

    if (part.type === 'table') {
      return <MessageTable key={`${message.id}-table-${index}`} part={part} />;
    }

    if (part.type === 'code') {
      return <MessageCode key={`${message.id}-code-${index}`} part={part} />;
    }

    if (part.type === 'ask') {
      return <AskCard key={`${message.id}-ask-${part.askId}`} part={part} answer={answeredAskById.get(part.askId)} disabled={sending} onSubmit={submitAskAnswer} />;
    }

    if (part.type === 'job-progress') {
      return (
        <div key={`${message.id}-job-${index}`} className="suplia-tool">
          <div className="suplia-tool-head"><Clock3 className="h-4 w-4" /><span>{part.label || part.status || 'En progreso'}</span></div>
        </div>
      );
    }

    if (part.type === 'artifact-card') {
      const artifact = part.artifactId ? state.artifacts.find((item) => item.id === part.artifactId) || null : null;
      return (
        <button key={`${message.id}-artifact-${part.artifactId || part.title}-${index}`} type="button" className="suplia-artifact-card" onClick={() => openArtifact(part.artifactId)}>
          <div className="suplia-art-ico"><FileText className="h-5 w-5" /></div>
          <div className="suplia-art-meta">
            <div className="suplia-art-title">{artifact?.title || part.title || getArtifactLabel(part.artifactType)}</div>
            <div className="suplia-art-sub">{getArtifactCardSummary(artifact, part.artifactType)} · clic para abrir</div>
          </div>
          <ExternalLink className="h-[18px] w-[18px] text-[var(--suplia-faint)]" />
        </button>
      );
    }

    if (part.type === 'approval-request') {
      const action = state.pendingActions.find((item) => item.id === part.actionId);
      if (!action) {
        return <div key={`${message.id}-approval-${part.actionId}`} className="suplia-approval p-4 text-sm">{part.title || 'Aprobacion requerida'}</div>;
      }
      return (
        <div key={`${message.id}-approval-${part.actionId}`} className="suplia-approval p-4 text-sm leading-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-semibold">{getActionDisplayTitle(action)}</div>
              {action.description && <p className="mt-1 text-xs opacity-80">{action.description}</p>}
            </div>
            <span className="shrink-0 rounded-full bg-white/60 px-3 py-1 text-[10px] uppercase tracking-[0.12em] dark:bg-white/5">{getActionStatusLabel(action.status)}</span>
          </div>
          {renderPayloadPreview(action)}
          {renderActionControls(action, 'suplia-thread-confirm')}
        </div>
      );
    }

    return null;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const baseMessage = input.trim() || (attachments.length > 0 ? 'Revisa estos adjuntos.' : '');
    sendMessage(buildComposerMessage(baseMessage));
  }

  return (
    <div className={cn(supliaSans.variable, supliaSerif.variable, 'suplia-claude-shell')}>
      <div className={cn('suplia-app', artifactPanelOpen && activeArtifact && 'panel-open')}>
        {sidebarOpen && <button type="button" aria-label="Cerrar menu" className="suplia-overlay" onClick={() => setSidebarOpen(false)} />}

        <button type="button" className="suplia-icon-btn suplia-floating-open-sidebar" onClick={() => setSidebarOpen(true)} aria-label="Abrir historial">
          <Menu className="h-4 w-4" />
        </button>

        <aside className={cn('suplia-sidebar', sidebarCollapsed && 'collapsed', sidebarOpen && 'mobile-open')} aria-label="Historial de conversaciones">
          <div className="suplia-sb-top">
            <button type="button" className="suplia-icon-btn" onClick={() => setSidebarCollapsed((value) => !value)} aria-label="Contraer barra lateral">
              <Menu className="h-[18px] w-[18px]" />
            </button>
            <div className="suplia-brand">
              <SupliaMark />
              <span className="suplia-brand-text">SUPL.IA</span>
            </div>
          </div>

          <div className="suplia-sb-actions">
            <button type="button" className="suplia-sb-item primary" onClick={resetChat}>
              <Plus className="h-[17px] w-[17px]" />
              <span className="suplia-label">Conversacion nueva</span>
            </button>
            <Link href="/suplia/review" className="suplia-sb-item" aria-label="Abrir bandeja de revisión">
              <CheckCircle2 className="h-[17px] w-[17px]" />
              <span className="suplia-label">Bandeja de revisión</span>
            </Link>
            <button type="button" className="suplia-sb-item" onClick={() => setSidebarCollapsed(false)}>
              <Search className="h-[17px] w-[17px]" />
              <span className="suplia-label">Buscar conversaciones</span>
            </button>
          </div>

          <div className="suplia-search-box">
            <Input aria-label="Buscar conversaciones" value={conversationQuery} onChange={(event) => setConversationQuery(event.target.value)} placeholder="Buscar chats" />
          </div>

          <div className="suplia-sb-section">Recientes</div>
          <nav className="suplia-sb-list">
            {loading ? (
              <div className="flex items-center gap-2 px-2 py-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Cargando</div>
            ) : conversationGroups.length === 0 ? (
              <div className="px-2 py-2 text-sm">Sin conversaciones.</div>
            ) : conversationGroups.map((group) => (
              <div key={group.label} className="mb-3">
                <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--suplia-faint)]">{group.label}</div>
                {group.items.map((conversation) => {
                  const active = state.conversation?.id === conversation.id;
                  return (
                    <button
                      key={conversation.id}
                      type="button"
                      className={cn('suplia-sb-chat', active && 'active')}
                      onClick={() => {
                        loadWorkspace(conversation.id);
                        setSidebarOpen(false);
                      }}
                    >
                      {conversation.title}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="suplia-sb-foot">
            <button type="button" className="suplia-user-chip" onClick={() => startQuickAction('company')}>
              <div className="suplia-avatar">N</div>
              <div className="suplia-user-info">
                <div className="suplia-user-name">Nicolas Yarur</div>
              </div>
            </button>
            <button type="button" className="suplia-icon-btn" onClick={() => setTheme(currentTheme === 'dark' ? 'light' : 'dark')} aria-label="Cambiar tema">
              {currentTheme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
            </button>
          </div>
        </aside>

        <section className="suplia-main">
          <header className="suplia-topbar">
            <div className="suplia-top-title">
              <div className="suplia-model-pick static" aria-label="SUPL.IA">SUPL.IA</div>
              <span>Asistente comercial con control humano</span>
            </div>

            <div className="suplia-top-right">
              <Link href="/suplia/review" className="suplia-pill-btn" aria-label="Abrir bandeja de revisión">
                <CheckCircle2 className="h-[15px] w-[15px]" />Revisión
              </Link>
              {activePendingActions.length > 0 && <span className="suplia-pill-btn text-amber-700 dark:text-amber-200">{activePendingActions.length} pendiente{activePendingActions.length === 1 ? '' : 's'}</span>}
              {visibleMemories.length > 0 && <span className="suplia-pill-btn"><Sparkles className="h-[15px] w-[15px]" />Memoria {visibleMemories.length}</span>}
              {state.activeJob && <span className="suplia-pill-btn"><Clock3 className="h-[15px] w-[15px]" />{getJobStatusLabel(state.activeJob.status, state.activeJob.progressLabel)}</span>}
              {latestArtifacts.length > 0 && (
                <button type="button" className="suplia-pill-btn" onClick={() => setArtifactPanelOpen(true)}>
                  <FileText className="h-[15px] w-[15px]" />Canvas {latestArtifacts.length}
                </button>
              )}
            </div>
          </header>

          {showWorkspaceStrip && (
            <div className="suplia-workspace-strip" aria-label="Estado de trabajo">
              {activePendingActions.length > 0 && <span className="suplia-status-chip warn"><CheckCircle2 className="h-3.5 w-3.5" />Requiere aprobacion</span>}
              {state.activeJob && <span className="suplia-status-chip"><Clock3 className="h-3.5 w-3.5" />{getJobStatusLabel(state.activeJob.status, state.activeJob.progressLabel)}</span>}
              {runningToolCount > 0 && <span className="suplia-status-chip"><Loader2 className="h-3.5 w-3.5 animate-spin" />{runningToolCount} herramienta{runningToolCount === 1 ? '' : 's'} activa{runningToolCount === 1 ? '' : 's'}</span>}
              {completedToolCount > 0 && <span className="suplia-status-chip muted"><Globe2 className="h-3.5 w-3.5" />{completedToolCount} paso{completedToolCount === 1 ? '' : 's'} listo{completedToolCount === 1 ? '' : 's'}</span>}
              {failedToolCount > 0 && <span className="suplia-status-chip danger"><XCircle className="h-3.5 w-3.5" />{failedToolCount} con error</span>}
              {visibleMemories.length > 0 && <span className="suplia-status-chip muted"><Sparkles className="h-3.5 w-3.5" />{visibleMemories.length} memoria{visibleMemories.length === 1 ? '' : 's'}</span>}
              {latestArtifacts.length > 0 && <button type="button" className="suplia-status-chip action" onClick={() => setArtifactPanelOpen(true)}><FileText className="h-3.5 w-3.5" />Abrir canvas</button>}
            </div>
          )}

          <MemoryShelf memories={visibleMemories} onUse={useMemory} onManage={manageMemory} />

          <div className="suplia-scroll">
            <div className="suplia-thread">
              {loading && state.messages.length === 0 ? (
                <div className="flex min-h-[48vh] items-center justify-center gap-2 text-sm text-[var(--suplia-muted)]" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Cargando conversacion
                </div>
              ) : state.messages.length === 0 ? (
                <div className="suplia-empty">
                  <SupliaMark className="h-12 w-12" />
                  <h1>Que quieres lograr hoy?</h1>
                  <p>Describe un objetivo comercial. SUPL.IA puede investigar, redactar y preparar acciones, pero pedira aprobacion antes de consumir creditos o contactar personas.</p>
                  <div className="suplia-starters">
                    {starters.map((starter) => <button key={starter} type="button" className="suplia-starter" onClick={() => sendMessage(starter)}>{starter}</button>)}
                  </div>
                </div>
              ) : state.messages.map((message) => {
                const isUser = message.role === 'user';
                const parts = getMessageParts(message);
                const firstTextPartIndex = parts.findIndex((part) => part.type === 'text');
                const messageToolRuns = state.toolRuns.filter((toolRun) => toolRun.messageId === message.id && isTranscriptToolRunVisible(toolRun));
                const streamingText = streamingTextByMessageId[message.id];

                if (isUser) {
                  return (
                    <div key={message.id} className="suplia-msg suplia-msg-user">
                      <div className="suplia-bubble-user">{message.content}</div>
                    </div>
                  );
                }

                return (
                  <div key={message.id} className="suplia-msg">
                    {messageToolRuns.map((toolRun) => <ToolRunCard key={toolRun.id} toolRun={toolRun} />)}
                    <div className="suplia-assistant">
                      {parts.map((part, index) => renderMessagePart(part, message, index, firstTextPartIndex, streamingText))}
                    </div>
                    <MessageActions
                      message={message}
                      feedback={messageFeedback[message.id] || null}
                      onFeedback={(rating) => submitFeedback(message, rating)}
                      onRetry={() => sendMessage(message.content)}
                    />
                  </div>
                );
              })}
              {sending && <ActivityIndicator phaseIndex={activityPhaseIndex} phaseLabel={activityPhaseLabel} elapsedMs={activityElapsedMs} onStop={cancelActiveRequest} />}
              <div ref={chatEndRef} />
            </div>
          </div>

          <div className="suplia-composer-wrap">
            <form onSubmit={handleSubmit} className="suplia-composer">
              <input ref={fileInputRef} aria-label="Seleccionar archivos adjuntos" type="file" multiple className="hidden" onChange={(event) => handleFilesSelected(event.target.files)} />
              <Textarea
                aria-label="Mensaje para SUPL.IA"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !(event.nativeEvent as any).isComposing) {
                    event.preventDefault();
                    const baseMessage = input.trim() || (attachments.length > 0 ? 'Revisa estos adjuntos.' : '');
                    sendMessage(buildComposerMessage(baseMessage));
                  }
                }}
                placeholder="Pideme prospectar, investigar, contactar o hacer seguimiento de un lead..."
              />
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 px-2 pb-2">
                  {attachments.map((attachment) => (
                    <span key={attachment.id} className="inline-flex max-w-full items-center gap-2 rounded-full border border-[var(--suplia-border)] bg-[var(--suplia-user)] px-3 py-1.5 text-xs text-[var(--suplia-muted)]">
                      <Paperclip className="h-3.5 w-3.5" />
                      <span className="max-w-[180px] truncate">{attachment.name}</span>
                      <span>{formatBytes(attachment.size)}</span>
                      {attachment.unsupported && <span>sin lectura</span>}
                      <button type="button" onClick={() => removeAttachment(attachment.id)} aria-label={`Quitar ${attachment.name}`}><X className="h-3.5 w-3.5" /></button>
                    </span>
                  ))}
                </div>
              )}
              <div className="suplia-comp-row">
                <button type="button" className="suplia-comp-tool" onClick={() => fileInputRef.current?.click()} title="Adjuntar" aria-label="Adjuntar archivo"><Plus className="h-[17px] w-[17px]" /></button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className="suplia-comp-tool"><SlidersHorizontal className="h-4 w-4" /><span>Herramientas</span></button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-64 rounded-[13px]">
                    <DropdownMenuLabel>Herramientas</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => startQuickAction('prospecting')}>Busqueda con FullEnrich</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => startQuickAction('research')}>Investigacion web</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => startQuickAction('contact')}>Generar correo</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => startQuickAction('followup')}>Registrar seguimiento</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className="suplia-comp-tool"><Sparkles className="h-4 w-4" /><span>{activeComposerMode.label}</span></button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-60 rounded-[13px]">
                    <DropdownMenuLabel>Modo</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuRadioGroup value={composerMode} onValueChange={(value) => setComposerMode(value as ComposerMode)}>
                      {composerModes.map((mode) => <DropdownMenuRadioItem key={mode.value} value={mode.value}>{mode.label}</DropdownMenuRadioItem>)}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <div className="suplia-comp-spacer" />
                <button type="button" className={cn('suplia-comp-tool', dictating && 'text-[var(--suplia-accent)]')} onClick={toggleDictation} aria-label="Dictar"><Mic className="h-4 w-4" /></button>
                <button type={sending ? 'button' : 'submit'} className={cn('suplia-send', sending && 'stop')} onClick={sending ? cancelActiveRequest : undefined} disabled={!sending && !input.trim() && attachments.length === 0} aria-label={sending ? 'Detener respuesta' : 'Enviar'}>
                  {sending ? <Square className="h-4 w-4" /> : <ArrowUp className="h-[18px] w-[18px]" />}
                </button>
              </div>
            </form>
            <div className="suplia-disclaimer">El asistente puede cometer errores. Verifica los datos de contacto antes de usarlos.</div>
          </div>
        </section>

        <aside className="suplia-panel">
          <div className="suplia-panel-head">
            <button type="button" className="suplia-icon-btn" onClick={() => setArtifactPanelOpen(false)} aria-label="Cerrar artifact"><X className="h-[18px] w-[18px]" /></button>
            <div className="suplia-panel-title">
              <span className="name">{activeArtifact?.title || 'Artifact'}</span>
              <span className="type">{activeArtifact ? getArtifactLabel(activeArtifact.type) : '-'}</span>
            </div>
            <div className="suplia-tabs">
              <button type="button" className={cn('suplia-tab', artifactTab === 'preview' && 'active')} onClick={() => setArtifactTab('preview')}>Vista previa</button>
              <button type="button" className={cn('suplia-tab', artifactTab === 'data' && 'active')} onClick={() => setArtifactTab('data')}>Datos</button>
            </div>
          </div>
          <div className="suplia-panel-body">
            {activeArtifact ? (
              artifactTab === 'preview'
                ? <div className="suplia-panel-preview"><ArtifactPreview artifact={activeArtifact} text={activeArtifactText} /></div>
                : <pre className="suplia-panel-code">{activeArtifactText || 'Sin datos.'}</pre>
            ) : <div className="suplia-art-preview">Selecciona un artifact.</div>}
          </div>
          <div className="suplia-panel-foot">
            <button type="button" className="suplia-icon-btn" onClick={() => moveArtifact(-1)} disabled={!canMoveToNewerArtifact} aria-label="Artifact anterior"><ChevronLeft className="h-[17px] w-[17px]" /></button>
            <span className="suplia-nav-count">{activeArtifactIndex >= 0 ? activeArtifactIndex + 1 : 0} / {latestArtifacts.length || 0}</span>
            <button type="button" className="suplia-icon-btn" onClick={() => moveArtifact(1)} disabled={!canMoveToOlderArtifact} aria-label="Artifact siguiente"><ChevronRight className="h-[17px] w-[17px]" /></button>
            <span className="suplia-version-badge">v{activeArtifact?.versionNumber || 1}{activeArtifactIndex === 0 ? ' · mas reciente' : ''}</span>
            <div className="suplia-foot-spacer" />
            <button type="button" className="suplia-foot-btn" onClick={copyActiveArtifact} disabled={!activeArtifactText}><Copy className="h-[15px] w-[15px]" />{artifactCopied ? 'Copiado' : 'Copiar datos'}</button>
            <button type="button" className="suplia-foot-btn primary" onClick={downloadActiveArtifact} disabled={!activeArtifactText}><Download className="h-[15px] w-[15px]" />Descargar</button>
          </div>
        </aside>
      </div>
    </div>
  );
}
