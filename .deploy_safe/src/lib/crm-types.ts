export type PipelineStage =
    | 'inbox'       // Recién llegado / Enriquecido
    | 'qualified'   // Cumple criterios
    | 'contacted'   // Email enviado / Llamada realizada
    | 'engaged'     // Respondió / Interesado
    | 'meeting'     // Reunión agendada
    | 'negotiation' // En negociación
    | 'closed_won'  // Ganado
    | 'closed_lost'; // Perdido

export const PIPELINE_STAGES: { id: PipelineStage; label: string; color: string }[] = [
    { id: 'inbox', label: 'Inbox', color: 'bg-slate-100 text-slate-700' },
    { id: 'qualified', label: 'Calificado', color: 'bg-blue-100 text-blue-700' },
    { id: 'contacted', label: 'Contactado', color: 'bg-indigo-100 text-indigo-700' },
    { id: 'engaged', label: 'Interesado', color: 'bg-purple-100 text-purple-700' },
    { id: 'meeting', label: 'Reunión', color: 'bg-pink-100 text-pink-700' },
    { id: 'negotiation', label: 'Negociación', color: 'bg-orange-100 text-orange-700' },
    { id: 'closed_won', label: 'Ganado', color: 'bg-green-100 text-green-700' },
    { id: 'closed_lost', label: 'Perdido', color: 'bg-red-100 text-red-700' },
];

export type ActivityType = 'email' | 'call' | 'note' | 'meeting' | 'enrichment';

export interface Activity {
    id: string;
    leadId: string | null;
    unifiedGid?: string; // Para vincular con UnifiedRow
    type: ActivityType;
    title: string;
    description?: string;
    metadata?: Record<string, any>; // Para almacenar datos específicos (duración, grabaciones, headers)
    createdAt: string;
    createdBy?: string;
}
