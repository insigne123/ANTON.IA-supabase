import React, { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AntoniaMission } from '@/lib/types';
import { BarChart, Activity, Mail, MessageSquare, TrendingUp, Zap } from 'lucide-react';

interface MetricsDashboardProps {
    organizationId: string;
    activeMissionId?: string;
}

interface MissionMetrics {
    missionId: string;
    missionTitle: string;
    totalSent: number;
    totalOpened: number;
    totalClicked: number;
    totalReplied: number;
}

export const MetricsDashboard: React.FC<MetricsDashboardProps> = ({ organizationId, activeMissionId }) => {
    const [metrics, setMetrics] = useState<MissionMetrics[]>([]);
    const [loading, setLoading] = useState(true);
    const supabase = createClientComponentClient();

    useEffect(() => {
        loadMetrics();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [organizationId, activeMissionId, supabase]);

    const loadMetrics = async () => {
        setLoading(true);
        try {
            let missionQuery = supabase
                .from('antonia_missions')
                .select('id, title')
                .eq('organization_id', organizationId)
                .eq('status', 'active'); // Solo misiones activas

            if (activeMissionId) {
                missionQuery = missionQuery.eq('id', activeMissionId);
            }

            const { data: missions, error: missionError } = await missionQuery;

            if (missionError) throw missionError;
            if (!missions || missions.length === 0) {
                setMetrics([]);
                setLoading(false);
                return;
            }

            const missionIds = missions.map(m => m.id);

            const { data: leads, error: leadsError } = await supabase
                .from('contacted_leads')
                .select('mission_id, status, opened_at, clicked_at, replied_at')
                .in('mission_id', missionIds);

            if (leadsError) throw leadsError;

            const aggregated = missions.map(mission => {
                const missionLeads = leads?.filter(l => l.mission_id === mission.id) || [];
                return {
                    missionId: mission.id,
                    missionTitle: mission.title,
                    totalSent: missionLeads.length,
                    totalOpened: missionLeads.filter(l => l.opened_at).length,
                    totalClicked: missionLeads.filter(l => l.clicked_at).length,
                    totalReplied: missionLeads.filter(l => l.replied_at).length
                };
            });

            setMetrics(aggregated);

        } catch (error) {
            console.error('[METRICS] Failed to load:', error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="flex flex-col items-center gap-3">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                    <p className="text-sm text-muted-foreground">Cargando métricas...</p>
                </div>
            </div>
        );
    }

    if (metrics.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-12 text-center">
                <BarChart className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">No hay datos disponibles</h3>
                <p className="text-sm text-muted-foreground max-w-md">
                    Aún no se han enviado correos en ninguna misión. Las métricas aparecerán aquí una vez que comiences a contactar leads.
                </p>
            </div>
        );
    }

    const grandTotalSent = metrics.reduce((acc, curr) => acc + curr.totalSent, 0);
    const grandTotalOpened = metrics.reduce((acc, curr) => acc + curr.totalOpened, 0);
    const grandTotalReplied = metrics.reduce((acc, curr) => acc + curr.totalReplied, 0);

    const openRate = grandTotalSent > 0 ? Math.round((grandTotalOpened / grandTotalSent) * 100) : 0;
    const replyRate = grandTotalSent > 0 ? Math.round((grandTotalReplied / grandTotalSent) * 100) : 0;

    return (
        <div className="space-y-8">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Emails Sent */}
                <Card className="relative overflow-hidden border-border/50 bg-card hover:shadow-lg transition-all duration-300">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-blue-500/10 to-transparent rounded-full -mr-16 -mt-16" />
                    <CardHeader className="flex flex-row items-center justify-between pb-2 relative">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Emails Enviados</CardTitle>
                        <div className="p-2 bg-blue-500/10 rounded-lg">
                            <Mail className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                        </div>
                    </CardHeader>
                    <CardContent className="relative">
                        <div className="text-3xl font-bold text-foreground">{grandTotalSent}</div>
                        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                            <Zap className="h-3 w-3" />
                            Total de correos enviados
                        </p>
                    </CardContent>
                </Card>

                {/* Open Rate */}
                <Card className="relative overflow-hidden border-border/50 bg-card hover:shadow-lg transition-all duration-300">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-emerald-500/10 to-transparent rounded-full -mr-16 -mt-16" />
                    <CardHeader className="flex flex-row items-center justify-between pb-2 relative">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Tasa de Apertura</CardTitle>
                        <div className="p-2 bg-emerald-500/10 rounded-lg">
                            <Activity className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                        </div>
                    </CardHeader>
                    <CardContent className="relative">
                        <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-bold text-foreground">{openRate}%</span>
                            {openRate > 20 && (
                                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5">
                                    <TrendingUp className="h-3 w-3" />
                                    Excelente
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                            <span className="font-semibold text-foreground">{grandTotalOpened}</span> de {grandTotalSent} abiertos
                        </p>
                    </CardContent>
                </Card>

                {/* Reply Rate */}
                <Card className="relative overflow-hidden border-border/50 bg-card hover:shadow-lg transition-all duration-300">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-violet-500/10 to-transparent rounded-full -mr-16 -mt-16" />
                    <CardHeader className="flex flex-row items-center justify-between pb-2 relative">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Tasa de Respuesta</CardTitle>
                        <div className="p-2 bg-violet-500/10 rounded-lg">
                            <MessageSquare className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                        </div>
                    </CardHeader>
                    <CardContent className="relative">
                        <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-bold text-foreground">{replyRate}%</span>
                            {replyRate > 5 && (
                                <span className="text-xs font-medium text-violet-600 dark:text-violet-400 flex items-center gap-0.5">
                                    <TrendingUp className="h-3 w-3" />
                                    Muy bueno
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                            <span className="font-semibold text-foreground">{grandTotalReplied}</span> respuestas recibidas
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* Mission Breakdown */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                        <BarChart className="h-5 w-5 text-primary" />
                        Rendimiento por Misión
                    </h3>
                    <span className="text-xs text-muted-foreground">
                        {metrics.length} {metrics.length === 1 ? 'misión activa' : 'misiones activas'}
                    </span>
                </div>

                <div className="space-y-3">
                    {metrics.map((m) => {
                        const mOpenRate = m.totalSent > 0 ? (m.totalOpened / m.totalSent) * 100 : 0;
                        const mReplyRate = m.totalSent > 0 ? (m.totalReplied / m.totalSent) * 100 : 0;

                        return (
                            <Card key={m.missionId} className="border-border/50 hover:border-primary/50 transition-all duration-200">
                                <CardContent className="p-5">
                                    {/* Header */}
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="flex-1">
                                            <h4 className="font-semibold text-foreground text-base mb-1">{m.missionTitle}</h4>
                                            <p className="text-xs text-muted-foreground">
                                                {m.totalSent} {m.totalSent === 1 ? 'correo enviado' : 'correos enviados'}
                                            </p>
                                        </div>
                                        <div className="flex gap-2">
                                            <div className="text-right">
                                                <div className="text-xs text-muted-foreground">Apertura</div>
                                                <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                                                    {Math.round(mOpenRate)}%
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-xs text-muted-foreground">Respuesta</div>
                                                <div className="text-sm font-bold text-violet-600 dark:text-violet-400">
                                                    {Math.round(mReplyRate)}%
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Progress Bars */}
                                    <div className="space-y-3">
                                        {/* Open Rate Bar */}
                                        <div>
                                            <div className="flex justify-between items-center text-xs mb-1.5">
                                                <span className="text-muted-foreground flex items-center gap-1.5">
                                                    <Activity className="h-3.5 w-3.5 text-emerald-500" />
                                                    Aperturas
                                                </span>
                                                <span className="font-mono font-medium text-foreground">
                                                    {m.totalOpened} / {m.totalSent}
                                                </span>
                                            </div>
                                            <div className="w-full bg-secondary/50 rounded-full h-2 overflow-hidden">
                                                <div
                                                    className="bg-gradient-to-r from-emerald-500 to-emerald-400 h-2 rounded-full transition-all duration-700 ease-out"
                                                    style={{ width: `${Math.min(mOpenRate, 100)}%` }}
                                                />
                                            </div>
                                        </div>

                                        {/* Reply Rate Bar */}
                                        <div>
                                            <div className="flex justify-between items-center text-xs mb-1.5">
                                                <span className="text-muted-foreground flex items-center gap-1.5">
                                                    <MessageSquare className="h-3.5 w-3.5 text-violet-500" />
                                                    Respuestas
                                                </span>
                                                <span className="font-mono font-medium text-foreground">
                                                    {m.totalReplied} / {m.totalSent}
                                                </span>
                                            </div>
                                            <div className="w-full bg-secondary/50 rounded-full h-2 overflow-hidden">
                                                <div
                                                    className="bg-gradient-to-r from-violet-500 to-violet-400 h-2 rounded-full transition-all duration-700 ease-out"
                                                    style={{ width: `${Math.min(mReplyRate, 100)}%` }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
