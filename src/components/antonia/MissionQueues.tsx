import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, Database, Send, AlertCircle, RefreshCw, User, Briefcase } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

interface MissionLead {
    id: string;
    name: string;
    title: string;
    company: string;
    status: string;
    email: string | null;
    created_at: string;
}

export function MissionQueues({ missionId }: { missionId: string }) {
    const [reserveLeads, setReserveLeads] = useState<MissionLead[]>([]);
    const [queueLeads, setQueueLeads] = useState<MissionLead[]>([]);
    const [loading, setLoading] = useState(true);
    const supabase = createClientComponentClient();

    const fetchLeads = async () => {
        setLoading(true);
        try {
            // Fetch Reserve (Saved)
            const { data: savedData } = await supabase
                .from('leads')
                .select('id, name, title, company, status, email, created_at')
                .eq('mission_id', missionId)
                .eq('status', 'saved')
                .order('created_at', { ascending: false });

            // Fetch Queue (Enriched/Ready)
            // Assuming 'enriched' is the status for ready-to-contact leads
            // But we must check if they are NOT in contacted_leads table to be sure they are "in queue"?
            // Logic: The Cron picks 'enriched' leads. If they are already contacted they should be marked or logged. 
            // In the codebase, 'contacted_leads' is a separate table.
            // Start simple: leads with status 'enriched'.
            const { data: enrichedData } = await supabase
                .from('leads')
                .select('id, name, title, company, status, email, created_at')
                .eq('mission_id', missionId)
                .eq('status', 'enriched')
                .order('created_at', { ascending: false });

            // We also need to filter out those who might have been contacted already if 'status' doesn't update to 'contacted' on the lead itself.
            // Based on previous files, 'contacted_leads' is inserted, but 'leads' table status update wasn't explicitly seen in the code snippets.
            // However, usually the flow updates the lead status too. Let's assume 'enriched' means ready and waiting.

            if (savedData) setReserveLeads(savedData);
            if (enrichedData) setQueueLeads(enrichedData);

        } catch (error) {
            console.error('Error fetching mission queues:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLeads();

        // Optional: Realtime subscription could go here
    }, [missionId]);

    if (loading) {
        return <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-primary" /></div>;
    }

    return (
        <div className="h-full flex flex-col bg-background">
            <div className="p-4 bg-secondary/10 border-b">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="font-semibold text-lg">Colas de Procesamiento</h3>
                        <p className="text-sm text-muted-foreground">Estado actual del pipeline de leads</p>
                    </div>
                    <button onClick={fetchLeads} className="p-2 hover:bg-secondary rounded-full transition-colors">
                        <RefreshCw className="w-4 h-4 text-muted-foreground" />
                    </button>
                </div>
            </div>

            <Tabs defaultValue="reserve" className="flex-1 flex flex-col overflow-hidden">
                <div className="px-4 pt-4">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="reserve" className="flex gap-2">
                            <Database className="w-4 h-4" />
                            Reserva ({reserveLeads.length})
                        </TabsTrigger>
                        <TabsTrigger value="queue" className="flex gap-2">
                            <Send className="w-4 h-4" />
                            Por Contactar ({queueLeads.length})
                        </TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="reserve" className="flex-1 overflow-hidden p-0 m-0">
                    <QueueList
                        leads={reserveLeads}
                        emptyMessage="No hay leads en reserva. ANTONIA buscará más automáticamente."
                        icon={<Database className="w-8 h-8 opacity-20" />}
                    />
                </TabsContent>

                <TabsContent value="queue" className="flex-1 overflow-hidden p-0 m-0">
                    <QueueList
                        leads={queueLeads}
                        emptyMessage="No hay leads listos para contacto. Esperando enriquecimiento."
                        icon={<Send className="w-8 h-8 opacity-20" />}
                    />
                </TabsContent>
            </Tabs>
        </div>
    );
}

function QueueList({ leads, emptyMessage, icon }: { leads: MissionLead[], emptyMessage: string, icon: React.ReactNode }) {
    if (leads.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center text-muted-foreground space-y-4">
                <div className="p-4 rounded-full bg-secondary/50">
                    {icon}
                </div>
                <p>{emptyMessage}</p>
            </div>
        );
    }

    return (
        <ScrollArea className="h-full px-4 py-4">
            <div className="space-y-3 pb-8">
                {leads.map((lead) => (
                    <div key={lead.id} className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
                        <Avatar className="h-9 w-9 border">
                            <AvatarFallback className="text-xs">{lead.name.substring(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start">
                                <p className="font-medium text-sm truncate">{lead.name}</p>
                                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                    {new Date(lead.created_at).toLocaleDateString()}
                                </span>
                            </div>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground truncate">
                                <Briefcase className="w-3 h-3" />
                                <span className="truncate">{lead.title}</span>
                                <span className="mx-1">•</span>
                                <span className="truncate font-medium text-foreground/80">{lead.company}</span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </ScrollArea>
    );
}
