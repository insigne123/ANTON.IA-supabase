'use client';

import { useEffect, useState, useRef } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Loader2, CheckCircle2, XCircle, Search, Sparkles, Brain, Mail, FileText, ChevronRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

interface TaskResult {
    // Campaign Spec
    subjectPreview?: string;
    bodyPreview?: string;

    // Search Spec
    searchCriteria?: {
        jobTitle?: string;
        location?: string;
        industry?: string;
        keywords?: string;
    };
    sampleLeads?: { name: string; company: string; title: string }[];

    // Enrich Spec
    enrichedLeadsSummary?: { name: string; company: string; emailFound: boolean }[];

    // Investigate Spec
    investigations?: { name: string; company: string; summarySnippet: string }[];

    // Contact Spec
    contactedList?: { name: string; email: string; company: string; status: string }[];

    // Fallback counts
    leadsFound?: number;
    enrichedCount?: number;
    investigatedCount?: number;
    contactedCount?: number;
    campaignGenerated?: boolean;
}

interface AntoniaTask {
    id: string;
    type: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    result: TaskResult;
    error_message?: string;
    created_at: string;
    updated_at: string;
}

export function AgentActivityFeed() {
    const [tasks, setTasks] = useState<AntoniaTask[]>([]);
    const supabase = createClientComponentClient();
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        fetchRecentTasks();

        const channel = supabase
            .channel('antonia_tasks_feed')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'antonia_tasks',
                },
                (payload) => {
                    handleRealtimeUpdate(payload);
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    const fetchRecentTasks = async () => {
        const { data } = await supabase
            .from('antonia_tasks')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(20);

        if (data) setTasks(data);
    };

    const handleRealtimeUpdate = (payload: any) => {
        if (payload.eventType === 'INSERT') {
            setTasks(prev => [payload.new, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
            setTasks(prev => prev.map(task =>
                task.id === payload.new.id ? payload.new : task
            ));
        }
    };

    const getTaskIcon = (type: string) => {
        switch (type) {
            case 'GENERATE_CAMPAIGN': return <FileText className="h-4 w-4" />;
            case 'SEARCH': return <Search className="h-4 w-4" />;
            case 'ENRICH': return <Sparkles className="h-4 w-4" />;
            case 'INVESTIGATE': return <Brain className="h-4 w-4" />;
            case 'CONTACT':
            case 'CONTACT_INITIAL': return <Mail className="h-4 w-4" />;
            default: return <CheckCircle2 className="h-4 w-4" />;
        }
    };

    const getTaskLabel = (type: string) => {
        switch (type) {
            case 'GENERATE_CAMPAIGN': return 'Generando Estrategia';
            case 'SEARCH': return 'Buscando Leads';
            case 'ENRICH': return 'Enriqueciendo Datos';
            case 'INVESTIGATE': return 'Investigando Perfiles';
            case 'CONTACT': return 'Contactando Leads';
            case 'CONTACT_INITIAL': return 'Contacto Inicial';
            default: return type;
        }
    };

    const renderTaskDetails = (task: AntoniaTask) => {
        const { result, type } = task;
        if (!result) return null;

        switch (type) {
            case 'GENERATE_CAMPAIGN':
                return (
                    <div className="space-y-2 mt-2">
                        {result.subjectPreview && (
                            <div className="text-sm bg-muted p-2 rounded-md">
                                <p className="font-semibold text-xs text-muted-foreground uppercase">Asunto Generado</p>
                                <p>{result.subjectPreview}</p>
                            </div>
                        )}
                        {result.bodyPreview && (
                            <p className="text-xs text-muted-foreground italic">"{result.bodyPreview}"</p>
                        )}
                    </div>
                );

            case 'SEARCH':
                return (
                    <div className="space-y-2 mt-2">
                        <div className="flex gap-2 flex-wrap">
                            {result.searchCriteria && Object.entries(result.searchCriteria).map(([key, val]) => (
                                val && <Badge key={key} variant="secondary" className="text-xs">{val}</Badge>
                            ))}
                        </div>
                        {result.sampleLeads && result.sampleLeads.length > 0 && (
                            <div className="text-xs text-muted-foreground">
                                <p className="mb-1">Encontrados recientemente:</p>
                                <ul className="list-disc list-inside">
                                    {result.sampleLeads.map((l, i) => (
                                        <li key={i}>{l.name} @ {l.company}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                );

            case 'ENRICH':
                return (
                    <div className="mt-2 text-xs">
                        {result.enrichedLeadsSummary && (
                            <ul className="space-y-1">
                                {result.enrichedLeadsSummary.map((l, i) => (
                                    <li key={i} className="flex items-center gap-2">
                                        {l.emailFound ? <CheckCircle2 className="h-3 w-3 text-green-500" /> : <XCircle className="h-3 w-3 text-red-300" />}
                                        <span>{l.name} ({l.company})</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                );

            case 'INVESTIGATE':
                return (
                    <div className="mt-2 space-y-2">
                        {result.investigations?.map((inv, i) => (
                            <div key={i} className="text-xs bg-muted/50 p-2 rounded">
                                <p className="font-medium">{inv.name} - {inv.company}</p>
                                <p className="text-muted-foreground mt-1 line-clamp-2">{inv.summarySnippet}</p>
                            </div>
                        ))}
                    </div>
                );

            case 'CONTACT':
            case 'CONTACT_INITIAL':
                return (
                    <div className="mt-2 text-xs">
                        {result.contactedList?.map((c, i) => (
                            <div key={i} className="flex items-center justify-between py-1 border-b last:border-0">
                                <span>{c.name}</span>
                                <Badge variant="outline" className="text-[10px] h-4">Enviado</Badge>
                            </div>
                        ))}
                    </div>
                );

            default:
                return null;
        }
    };

    return (
        <Card className="h-[600px] flex flex-col">
            <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-indigo-500" />
                    Actividad del Agente
                </CardTitle>
                <CardDescription>
                    Monitoreo en tiempo real de las acciones de ANTONIA
                </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 p-0">
                <ScrollArea className="h-full px-6 pb-6">
                    <div className="space-y-6">
                        {tasks.length === 0 && (
                            <div className="text-center text-muted-foreground py-10">
                                Esperando actividad...
                            </div>
                        )}
                        {tasks.map((task, index) => (
                            <div key={task.id} className="relative pl-6 border-l-2 border-muted last:border-l-0 pb-6 last:pb-0">
                                {/* Status Dot */}
                                <div className={`absolute -left-[9px] top-0 h-4 w-4 rounded-full border-2 border-background 
                            ${task.status === 'completed' ? 'bg-green-500' :
                                        task.status === 'failed' ? 'bg-red-500' :
                                            task.status === 'processing' ? 'bg-blue-500 animate-pulse' : 'bg-gray-300'}`}
                                />

                                <div className="flex flex-col gap-1">
                                    <div className="flex items-center justify-between">
                                        <span className="font-semibold text-sm flex items-center gap-2">
                                            {getTaskIcon(task.type)}
                                            {getTaskLabel(task.type)}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                            {formatDistanceToNow(new Date(task.created_at), { addSuffix: true, locale: es })}
                                        </span>
                                    </div>

                                    {task.error_message && (
                                        <div className="text-xs text-red-500 bg-red-50 p-2 rounded mt-1">
                                            Error: {task.error_message}
                                        </div>
                                    )}

                                    {/* Collapsible Details */}
                                    {task.status === 'completed' && task.result && (
                                        <Accordion type="single" collapsible className="w-full">
                                            <AccordionItem value="details" className="border-b-0">
                                                <AccordionTrigger className="py-1 text-xs text-muted-foreground hover:no-underline">
                                                    Ver detalles
                                                </AccordionTrigger>
                                                <AccordionContent>
                                                    {renderTaskDetails(task)}
                                                </AccordionContent>
                                            </AccordionItem>
                                        </Accordion>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </ScrollArea>
            </CardContent>
        </Card>
    );
}
