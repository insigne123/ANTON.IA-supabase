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

  // Metadatos
  status: UnifiedStatus;
  kind: UnifiedKind;
  createdAt?: string | number | null;
  updatedAt?: string | number | null;
  source?: 'search' | 'opportunity' | 'contacted' | 'manual';

  // Flags
  hasEmail?: boolean;     // <-- NUEVO: bandera útil para filtros/orden

  // Campos custom persistidos por usuario (Stage, Owner, Notas, etc.)
  stage?: import('./crm-types').PipelineStage | string | null;
  owner?: string | null;
  notes?: string | null;
}

export type ColumnKey =
  | 'name' | 'email' | 'company' | 'title' | 'status'
  | 'kind' | 'source' | 'createdAt'
  | 'updatedAt' | 'linkedinUrl'
  | 'stage' | 'owner' | 'notes';

export type ColumnDef = {
  key: ColumnKey;
  label: string;
  visible: boolean;
  width?: number;        // px (simple)
  editable?: boolean;    // solo columnas custom
  align?: 'left' | 'right' | 'center';
};
