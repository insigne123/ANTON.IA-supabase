// src/lib/unified-sheet-types.ts
export type UnifiedKind =
  | 'lead_saved'
  | 'lead_enriched'
  | 'opportunity'
  | 'contacted';

export type UnifiedStatus = 'saved' | 'enriched' | 'sent' | 'read' | 'replied' | 'opened' | 'clicked' | 'archived';

export interface UnifiedRow {
  /** id global único: <kind>|<id o conversationId> */
  gid: string;
  sourceId: string;       // id original de la entidad

  // Campos comunes
  name?: string | null;
  email?: string | null;  // <-- NUEVO: email normalizado para mostrar en Sheet
  company?: string | null;
  title?: string | null;
  linkedinUrl?: string | null;
  industry?: string | null;

  // Metadatos
  status: UnifiedStatus;
  kind: UnifiedKind;
  createdAt?: string | number | null;
  updatedAt?: string | number | null;
  /** Conversations only: when the first email went out and when the person replied (the Pipeline panel counts by them). */
  sentAt?: string | null;
  repliedAt?: string | null;
  source?: 'search' | 'opportunity' | 'contacted' | 'manual';

  // Flags
  hasEmail?: boolean;     // <-- NUEVO: bandera útil para filtros/orden

  // Campos custom persistidos por usuario (Stage, Owner, Notas, etc.)
  stage?: import('./crm-types').PipelineStage | string | null;
  owner?: string | null;
  notes?: string | null;
  nextAction?: string | null;
  nextActionType?: string | null;
  nextActionDueAt?: string | null;
  autopilotStatus?: string | null;
  lastAutopilotEvent?: string | null;
  meetingLink?: string | null;
  /** The value of the deal and its currency, and when it changed stage or was won or lost (Plan 11, PR 4c, behind
   *  CRM_DEAL_VALUES_ENABLED: read only once the migration that adds them is applied). */
  dealValue?: number | null;
  dealCurrency?: string | null;
  stageChangedAt?: string | null;
  wonAt?: string | null;
  lostAt?: string | null;
}

export type ColumnKey =
  | 'name' | 'email' | 'company' | 'title' | 'status'
  | 'kind' | 'source' | 'createdAt'
  | 'updatedAt' | 'linkedinUrl' | 'industry'
  | 'stage' | 'owner' | 'notes'
  | 'nextAction' | 'nextActionType' | 'nextActionDueAt'
  | 'autopilotStatus' | 'lastAutopilotEvent' | 'meetingLink';

export type ColumnDef = {
  key: ColumnKey;
  label: string;
  visible: boolean;
  width?: number;        // px (simple)
  editable?: boolean;    // solo columnas custom
  align?: 'left' | 'right' | 'center';
};
