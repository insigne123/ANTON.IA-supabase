import { useCallback, useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, Database, Send, AlertCircle, RefreshCw, Briefcase, ShieldAlert, CheckCircle2 } from 'lucide-react';
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
    const [readyLeads, setReadyLeads] = useState<MissionLead[]>([]);
    const [noEmailLeads, setNoEmailLeads] = useState<MissionLead[]>([]);
    const [contactedLeads, setContactedLeads] = useState<MissionLead[]>([]);
    const [blockedLeads, setBlockedLeads] = useState<MissionLead[]>([]);
    const [loading, setLoading] = useState(true);
    const supabase = createClientComponentClient();

    const fetchLeads = useCallback(async () => {
        setLoading(true);
        try {
            // Fetch Reserve (Saved)
            const { data: savedData } = await supabase
                .from('leads')
                .select('id, name, title, company, status, email, created_at')
                .eq('mission_id', missionId)
                .eq('status', 'saved')
                .order('created_at', { ascending: false });

            // Leads enriched + email available (ready for investigate/contact)
            const { data: enrichedReady } = await supabase
                .from('leads')
                .select('id, name, title, company, status, email, created_at')
                .eq('mission_id', missionId)
                .eq('status', 'enriched')
                .not('email', 'is', null)
                .order('created_at', { ascending: false });

            // Leads enriched but without email (not contactable)
            const { data: enrichedNoEmail } = await supabase
                .from('leads')
                .select('id, name, title, company, status, email, created_at')
                .eq('mission_id', missionId)
                .eq('status', 'enriched')
                .is('email', null)
                .order('created_at', { ascending: false });

            // Leads already contacted
            const { data: contactedData } = await supabase
                .from('leads')
                .select('id, name, title, company, status, email, created_at')
                .eq('mission_id', missionId)
                .eq('status', 'contacted')
                .order('created_at', { ascending: false })
                .limit(200);

            // Do-not-contact / blocked leads
            const { data: blockedData } = await supabase
                .from('leads')
                .select('id, name, title, company, status, email, created_at')
                .eq('mission_id', missionId)
                .eq('status', 'do_not_contact')
                .order('created_at', { ascending: false })
                .limit(200);

            if (savedData) setReserveLeads(savedData);
            if (enrichedReady) setReadyLeads(enrichedReady);
            if (enrichedNoEmail) setNoEmailLeads(enrichedNoEmail);
            if (contactedData) setContactedLeads(contactedData);
            if (blockedData) setBlockedLeads(blockedData);

        } catch (error) {
            console.error('Error fetching mission queues:', error);
        } finally {
            setLoading(false);
        }
    }, [missionId, supabase]);

    useEffect(() => {
        fetchLeads();

        // Optional: Realtime subscription could go here
    }, [fetchLeads]);

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
                    <TabsList className="grid w-full grid-cols-5">
                        <TabsTrigger value="reserve" className="flex gap-2">
                            <Database className="w-4 h-4" />
                            Reserva ({reserveLeads.length})
                        </TabsTrigger>
                        <TabsTrigger value="ready" className="flex gap-2">
                            <Send className="w-4 h-4" />
                            Listos ({readyLeads.length})
                        </TabsTrigger>
                        <TabsTrigger value="noemail" className="flex gap-2">
                            <AlertCircle className="w-4 h-4" />
                            Sin Email ({noEmailLeads.length})
                        </TabsTrigger>
                        <TabsTrigger value="contacted" className="flex gap-2">
                            <CheckCircle2 className="w-4 h-4" />
                            Contactados ({contactedLeads.length})
                        </TabsTrigger>
                        <TabsTrigger value="blocked" className="flex gap-2">
                            <ShieldAlert className="w-4 h-4" />
                            Bloqueados ({blockedLeads.length})
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

                <TabsContent value="ready" className="flex-1 overflow-hidden p-0 m-0">
                    <QueueList
                        leads={readyLeads}
                        emptyMessage="No hay leads con email listos. Esperando enriquecimiento."
                        icon={<Send className="w-8 h-8 opacity-20" />}
                    />
                </TabsContent>

                <TabsContent value="noemail" className="flex-1 overflow-hidden p-0 m-0">
                    <QueueList
                        leads={noEmailLeads}
                        emptyMessage="No hay leads enriquecidos sin email."
                        icon={<AlertCircle className="w-8 h-8 opacity-20" />}
                    />
                </TabsContent>

                <TabsContent value="contacted" className="flex-1 overflow-hidden p-0 m-0">
                    <QueueList
                        leads={contactedLeads}
                        emptyMessage="Aun no hay leads contactados en esta mision."
                        icon={<CheckCircle2 className="w-8 h-8 opacity-20" />}
                    />
                </TabsContent>

                <TabsContent value="blocked" className="flex-1 overflow-hidden p-0 m-0">
                    <QueueList
                        leads={blockedLeads}
                        emptyMessage="No hay leads bloqueados (do-not-contact)."
                        icon={<ShieldAlert className="w-8 h-8 opacity-20" />}
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
