'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Loader2,
    CheckCircle2,
    XCircle,
    Search,
    Sparkles,
    Brain,
    Mail,
    FileText,
    AlertTriangle,
    Terminal,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

interface TaskResult {
    // Campaign Spec
    subjectPreview?: string;
    bodyPreview?: string;
    campaignName?: string;

    // Search Spec
    searchCriteria?: {
        jobTitle?: string;
        location?: string;
        industry?: string;
        keywords?: string;
    };
    sampleLeads?: { name: string; company: string; title: string }[];
    leadsFound?: number;

    // Enrich Spec
    enrichedLeadsSummary?: { name: string; company: string; emailFound: boolean }[];
    enrichedCount?: number;

    // Investigate Spec
    investigations?: { name: string; company: string; summarySnippet: string }[];
    investigatedCount?: number;

    // Contact Spec
    contactedList?: { name: string; email: string; company: string; status: string; error?: string }[];
    contactedCount?: number;

    // Generic
    skipped?: boolean;
    reason?: string;
    error?: string;
    [key: string]: any; // Catch-all for other props
}

interface AntoniaTask {
    id: string;
    type: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    result: TaskResult;
    payload: any;
    error_message?: string;
    progress_current?: number | null;
    progress_total?: number | null;
    progress_label?: string | null;
    heartbeat_at?: string | null;
    worker_source?: string | null;
    created_at: string;
    updated_at: string;
}

export function AgentActivityFeed({ missionId }: { missionId: string }) {
    const [tasks, setTasks] = useState<AntoniaTask[]>([]);
    const [filter, setFilter] = useState<'all' | 'errors' | 'success' | 'processing'>('all');
    const supabase = createClientComponentClient();
    const scrollRef = useRef<HTMLDivElement>(null);

    const fetchRecentTasks = useCallback(async () => {
        const { data } = await supabase
            .from('antonia_tasks')
            .select('*')
            .eq('mission_id', missionId)
            .order('created_at', { ascending: false })
            .limit(100);

        if (data) setTasks(data);
    }, [missionId, supabase]);

    const handleRealtimeUpdate = useCallback((payload: any) => {
        if (payload.eventType === 'INSERT') {
            setTasks(prev => [payload.new, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
            setTasks(prev => prev.map(task =>
                task.id === payload.new.id ? payload.new : task
            ));
        }
    }, []);

    useEffect(() => {
        fetchRecentTasks();

        const channel = supabase
            .channel(`antonia_tasks_${missionId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'antonia_tasks',
                    filter: `mission_id=eq.${missionId}`
                },
                (payload) => {
                    handleRealtimeUpdate(payload);
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [fetchRecentTasks, handleRealtimeUpdate, missionId, supabase]);

    const getTaskIcon = (type: string) => {
        switch (type) {
            case 'GENERATE_CAMPAIGN': return <FileText className="h-4 w-4" />;
            case 'SEARCH': return <Search className="h-4 w-4" />;
            case 'ENRICH': return <Sparkles className="h-4 w-4" />;
            case 'INVESTIGATE': return <Brain className="h-4 w-4" />;
            case 'CONTACT':
            case 'CONTACT_INITIAL':
            case 'CONTACT_CAMPAIGN': return <Mail className="h-4 w-4" />;
            case 'GENERATE_REPORT': return <FileText className="h-4 w-4" />;
            default: return <CheckCircle2 className="h-4 w-4" />;
        }
    };

    const getTaskLabel = (type: string) => {
        switch (type) {
            case 'GENERATE_CAMPAIGN': return 'Estrategia';
            case 'SEARCH': return 'Búsqueda';
            case 'ENRICH': return 'Enriquecimiento';
            case 'INVESTIGATE': return 'Investigación';
            case 'CONTACT':
            case 'CONTACT_INITIAL': return 'Contacto';
            case 'CONTACT_CAMPAIGN': return 'Seguimiento';
            case 'GENERATE_REPORT': return 'Reporte';
            default: return type;
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'completed': return 'bg-green-500';
            case 'failed': return 'bg-red-500';
            case 'processing': return 'bg-blue-500';
            default: return 'bg-slate-300 dark:bg-slate-700';
        }
    };

    const filteredTasks = tasks.filter(task => {
        if (filter === 'all') return true;
        if (filter === 'errors') return task.status === 'failed' || task.error_message;
        if (filter === 'success') return task.status === 'completed';
        if (filter === 'processing') return task.status === 'processing' || task.status === 'pending';
        return true;
    });

    const renderTaskSummary = (task: AntoniaTask) => {
        const { result, type, status } = task;

        if (status === 'failed') {
            return <span className="text-red-500 font-medium line-clamp-1">{task.error_message || 'Falló la ejecución'}</span>;
        }

        if (status === 'pending') {
            return <span className="text-muted-foreground italic">En cola...</span>;
        }
        if (status === 'processing') {
            const cur = typeof task.progress_current === 'number' ? task.progress_current : null;
            const tot = typeof task.progress_total === 'number' ? task.progress_total : null;
            const label = task.progress_label ? String(task.progress_label) : 'Procesando...';
            return (
                <span className="text-blue-500 font-medium animate-pulse">
                    {label}{(cur != null && tot != null) ? ` (${cur}/${tot})` : ''}
                </span>
            );
        }

        if (!result) return <span className="text-muted-foreground">Completado</span>;

        if (result.skipped) {
            return <span className="text-yellow-600 dark:text-yellow-500 italic">Omitido: {result.reason}</span>;
        }

        switch (type) {
            case 'SEARCH':
                return <span>Encontrados {result.leadsFound || 0} prospectos</span>;
            case 'ENRICH':
                return <span>Enriquecidos {result.enrichedCount || 0} contactos</span>;
            case 'INVESTIGATE':
                return <span>Investigados {result.investigatedCount || 0} perfiles</span>;
            case 'CONTACT':
            case 'CONTACT_INITIAL':
            case 'CONTACT_CAMPAIGN':
                return <span>Enviados {result.contactedCount || 0} correos</span>;
            case 'GENERATE_CAMPAIGN':
                return <span className="italic">"{result.campaignName || 'Campaña'}" generada</span>;
            default:
                return <span className="text-muted-foreground">Tarea finalizada exitosamente</span>;
        }
    };

    const renderTaskDetails = (task: AntoniaTask) => {
        const { result, type } = task;

        return (
            <div className="space-y-4 pt-2">
                {/* Runtime details */}
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    {task.worker_source && (
                        <Badge variant="secondary" className="h-5">worker: {task.worker_source}</Badge>
                    )}
                    {task.heartbeat_at && (
                        <Badge variant="outline" className="h-5">
                            heartbeat {formatDistanceToNow(new Date(task.heartbeat_at), { addSuffix: true, locale: es })}
                        </Badge>
                    )}
                    {task.progress_label && (
                        <Badge variant="outline" className="h-5">{task.progress_label}</Badge>
                    )}
                </div>

                {/* Visual Summaries based on Type */}
                {result && !result.skipped && (
                    <div className="text-xs space-y-2">
                        {type === 'GENERATE_CAMPAIGN' && (
                            <div className="bg-secondary/30 p-2 rounded border">
                                <p className="font-semibold text-[10px] uppercase text-muted-foreground mb-1">Asunto</p>
                                <p className="mb-2 font-medium">{result.subjectPreview}</p>
                                <p className="font-semibold text-[10px] uppercase text-muted-foreground mb-1">Cuerpo</p>
                                <p className="italic text-muted-foreground">{result.bodyPreview}</p>
                            </div>
                        )}

                        {type === 'SEARCH' && result.sampleLeads && (
                            <div className="space-y-1">
                                <p className="font-semibold text-muted-foreground">Muestra de resultados:</p>
                                {result.sampleLeads.map((l, i) => (
                                    <div key={i} className="flex items-center gap-2 py-1 border-b border-border/50 last:border-0">
                                        <div className="w-1 h-1 rounded-full bg-slate-400" />
                                        <span className="font-medium">{l.name}</span>
                                        <span className="text-muted-foreground truncate max-w-[150px]"> - {l.company}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {type === 'ENRICH' && result.enrichedLeadsSummary && (
                            <div className="space-y-1">
                                {result.enrichedLeadsSummary.map((l, i) => (
                                    <div key={i} className="flex items-center justify-between py-1 border-b border-border/50 last:border-0">
                                        <div className="flex items-center gap-2">
                                            {l.emailFound ? <CheckCircle2 className="w-3 h-3 text-green-500" /> : <XCircle className="w-3 h-3 text-red-400" />}
                                            <span>{l.name}</span>
                                        </div>
                                        <span className="text-muted-foreground truncate max-w-[100px]">{l.company}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {(type.includes('CONTACT')) && result.contactedList && (
                            <div className="space-y-1">
                                {result.contactedList.map((c, i) => (
                                    <div key={i} className="flex items-center justify-between py-1 border-b border-border/50 last:border-0">
                                        <div className="flex items-center gap-2">
                                            {c.status === 'sent' ? <CheckCircle2 className="w-3 h-3 text-green-500" /> : <AlertTriangle className="w-3 h-3 text-red-500" />}
                                            <span>{c.name}</span>
                                        </div>
                                        {c.error ? (
                                            <span className="text-red-500 truncate max-w-[150px] ml-2" title={c.error}>{c.error}</span>
                                        ) : (
                                            <span className="text-xs bg-secondary px-1.5 py-0.5 rounded text-muted-foreground">Enviado</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Technical JSON Details */}
                <Accordion type="single" collapsible className="w-full border rounded-md">
                    <AccordionItem value="tech-details" className="border-0">
                        <AccordionTrigger className="px-3 py-2 text-xs hover:bg-secondary/50 hover:no-underline">
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <Terminal className="w-3 h-3" />
                                <span>Detalles Técnicos (JSON)</span>
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="p-0 border-t bg-slate-950">
                            <ScrollArea className="h-[200px] w-full">
                                <div className="p-3 text-xs font-mono">
                                    <p className="text-slate-500 mb-1">// Input Payload</p>
                                    <pre className="text-blue-300 mb-4 whitespace-pre-wrap word-break-break-all">
                                        {JSON.stringify(task.payload, null, 2)}
                                    </pre>
                                    <p className="text-slate-500 mb-1">// Output Result</p>
                                    <pre className="text-green-300 whitespace-pre-wrap word-break-break-all">
                                        {JSON.stringify(result, null, 2)}
                                    </pre>
                                    {task.error_message && (
                                        <>
                                            <p className="text-slate-500 mb-1 mt-4">// Error</p>
                                            <pre className="text-red-400 whitespace-pre-wrap word-break-break-all">
                                                {task.error_message}
                                            </pre>
                                        </>
                                    )}
                                </div>
                            </ScrollArea>
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            </div>
        );
    };

    return (
        <div className="h-full flex flex-col bg-background" ref={scrollRef}>
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b pb-4 px-1 pt-1">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                            <Badge variant="outline" className="h-6 w-6 rounded-full p-0 flex items-center justify-center border-2 border-primary">
                                <Sparkles className="h-3 w-3 text-primary animate-pulse" />
                            </Badge>
                            Monitor de Actividad
                        </h3>
                        <p className="text-sm text-muted-foreground ml-8">
                            {tasks.length} operaciones registradas
                        </p>
                    </div>
                </div>

                <Tabs defaultValue="all" value={filter} onValueChange={(v) => setFilter(v as any)} className="w-full">
                    <TabsList className="grid w-full grid-cols-4 h-9">
                        <TabsTrigger value="all" className="text-xs">Todo</TabsTrigger>
                        <TabsTrigger value="processing" className="text-xs flex gap-1">
                            <span className="w-2 h-2 rounded-full bg-blue-500" />
                            Procesando
                        </TabsTrigger>
                        <TabsTrigger value="success" className="text-xs flex gap-1">
                            <span className="w-2 h-2 rounded-full bg-green-500" />
                            Éxitos
                        </TabsTrigger>
                        <TabsTrigger value="errors" className="text-xs flex gap-1">
                            <span className="w-2 h-2 rounded-full bg-red-500" />
                            Errores
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>

            <ScrollArea className="flex-1 -mx-4 px-4 pt-4">
                <div className="space-y-6 pb-20">
                    {filteredTasks.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground space-y-4">
                            <div className="p-4 rounded-full bg-secondary/50">
                                <Search className="w-8 h-8 opacity-20" />
                            </div>
                            <p>No hay actividad registrada con este filtro.</p>
                        </div>
                    )}

                    {filteredTasks.map((task) => (
                        <div key={task.id} className="group relative pl-6 border-l-2 border-border/60 hover:border-primary/50 transition-colors pb-6 last:pb-0">
                            {/* Status Dot */}
                            <div className={`absolute -left-[9px] top-1.5 h-4 w-4 rounded-full border-4 border-background transition-colors duration-300 ${getStatusColor(task.status)} group-hover:scale-110`} />

                            <div className="flex flex-col gap-1.5">
                                {/* Header */}
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Badge variant="outline" className="font-mono text-[10px] tracking-wider uppercase h-5">
                                            {getTaskLabel(task.type)}
                                        </Badge>
                                        <span className="text-xs text-muted-foreground">
                                            {formatDistanceToNow(new Date(task.created_at), { addSuffix: true, locale: es })}
                                        </span>
                                    </div>
                                </div>

                                {/* Main Summary */}
                                <div className="text-sm border rounded-lg bg-card p-3 shadow-sm group-hover:shadow-md transition-shadow">
                                    <div className="flex items-center gap-2 mb-1">
                                        {getTaskIcon(task.type)}
                                        {renderTaskSummary(task)}
                                    </div>

                                    {/* Actionable Details & JSON */}
                                    {(task.status === 'completed' || task.status === 'failed') && (
                                        <Accordion type="single" collapsible className="w-full mt-2 border-t pt-2">
                                            <AccordionItem value="details" className="border-0">
                                                <AccordionTrigger className="py-1 text-xs text-muted-foreground hover:text-primary hover:no-underline justify-start gap-2">
                                                    <span>Ver detalles</span>
                                                    {task.error_message && <Badge variant="destructive" className="h-4 px-1 py-0 text-[10px]">Error</Badge>}
                                                </AccordionTrigger>
                                                <AccordionContent>
                                                    {renderTaskDetails(task)}
                                                </AccordionContent>
                                            </AccordionItem>
                                        </Accordion>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </ScrollArea>
        </div>
    );
}
