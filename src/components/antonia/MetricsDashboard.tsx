import React, { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AntoniaMission } from '@/lib/types'; // Adjust path
import { BarChart, Activity, Mail, MessageSquare, MousePointer2 } from 'lucide-react';

interface MetricsDashboardProps {
    organizationId: string;
    activeMissionId?: string; // Optional filtering
}

interface MissionMetrics {
    missionId: string;
    missionTitle: string;
    totalSent: number;
    totalOpened: number;
    totalclicked: number;
    totalReplied: number;
}

export const MetricsDashboard: React.FC<MetricsDashboardProps> = ({ organizationId, activeMissionId }) => {
    const [metrics, setMetrics] = useState<MissionMetrics[]>([]);
    const [loading, setLoading] = useState(true);
    const supabase = createClientComponentClient();

    useEffect(() => {
        loadMetrics();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [organizationId, activeMissionId]);

    const loadMetrics = async () => {
        setLoading(true);
        try {
            // 1. Fetch Missions
            let missionQuery = supabase
                .from('antonia_missions')
                .select('id, title')
                .eq('organization_id', organizationId);

            if (activeMissionId) {
                missionQuery = missionQuery.eq('id', activeMissionId);
            }

            const { data: missions, error: missionError } = await missionQuery;

            if (missionError) throw missionError;
            if (!missions || missions.length === 0) {
                setMetrics([]);
                return;
            }

            const missionIds = missions.map(m => m.id);

            // 2. Fetch Contacted Leads Stats
            // We'll fetch all relevant rows and aggregate in memory for simplicity 
            // (or use RPC if available, but raw query is fine for reasonable volume)
            const { data: leads, error: leadsError } = await supabase
                .from('contacted_leads')
                .select('mission_id, status, opened_at, clicked_at, replied_at')
                .in('mission_id', missionIds);

            if (leadsError) throw leadsError;

            // 3. Aggregate
            const aggregated = missions.map(mission => {
                const missionLeads = leads?.filter(l => l.mission_id === mission.id) || [];
                return {
                    missionId: mission.id,
                    missionTitle: mission.title,
                    totalSent: missionLeads.length, // Assume all in table were sent
                    totalOpened: missionLeads.filter(l => l.opened_at).length,
                    totalclicked: missionLeads.filter(l => l.clicked_at).length,
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
        return <div className="p-4 text-center text-gray-500">Cargando métricas...</div>;
    }

    if (metrics.length === 0) {
        return <div className="p-4 text-center text-gray-500">No hay datos de campaña aún.</div>;
    }

    // Calculate totals for Summary Cards
    const grandTotalSent = metrics.reduce((acc, curr) => acc + curr.totalSent, 0);
    const grandTotalOpened = metrics.reduce((acc, curr) => acc + curr.totalOpened, 0);
    const grandTotalReplied = metrics.reduce((acc, curr) => acc + curr.totalReplied, 0);

    const openRate = grandTotalSent > 0 ? Math.round((grandTotalOpened / grandTotalSent) * 100) : 0;
    const replyRate = grandTotalSent > 0 ? Math.round((grandTotalReplied / grandTotalSent) * 100) : 0;

    return (
        <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="bg-gradient-to-br from-blue-50 to-white border-blue-100">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-blue-600">Enviados</CardTitle>
                        <Mail className="h-4 w-4 text-blue-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{grandTotalSent}</div>
                        <p className="text-xs text-blue-400 mt-1">Correos totales</p>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-green-50 to-white border-green-100">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-green-600">Tasa de Apertura</CardTitle>
                        <Activity className="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{openRate}%</div>
                        <div className="flex items-center text-xs text-green-500 mt-1">
                            <span className="font-medium mr-1">{grandTotalOpened}</span> abiertos
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-purple-50 to-white border-purple-100">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-purple-600">Tasa de Respuesta</CardTitle>
                        <MessageSquare className="h-4 w-4 text-purple-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{replyRate}%</div>
                        <div className="flex items-center text-xs text-purple-500 mt-1">
                            <span className="font-medium mr-1">{grandTotalReplied}</span> respuestas
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Mission Breakdown Bars */}
            <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-700 flex items-center gap-2">
                    <BarChart className="h-5 w-5" />
                    Rendimiento por Misión
                </h3>

                {metrics.map((m) => {
                    const mOpenRate = m.totalSent > 0 ? (m.totalOpened / m.totalSent) * 100 : 0;
                    const mReplyRate = m.totalSent > 0 ? (m.totalReplied / m.totalSent) * 100 : 0;

                    return (
                        <Card key={m.missionId} className="p-4 hover:shadow-md transition-shadow">
                            <div className="flex justify-between items-center mb-3">
                                <span className="font-medium text-slate-800">{m.missionTitle}</span>
                                <span className="text-xs bg-slate-100 px-2 py-1 rounded text-slate-600">
                                    {m.totalSent} enviados
                                </span>
                            </div>

                            {/* Open Rate Bar */}
                            <div className="mb-3">
                                <div className="flex justify-between text-xs mb-1">
                                    <span className="text-gray-500 flex items-center gap-1">
                                        <Activity className="h-3 w-3" /> Aperturas
                                    </span>
                                    <span className="font-mono text-green-600">{m.totalOpened} ({Math.round(mOpenRate)}%)</span>
                                </div>
                                <div className="w-full bg-gray-100 rounded-full h-2">
                                    <div
                                        className="bg-green-500 h-2 rounded-full transition-all duration-500"
                                        style={{ width: `${mOpenRate}%` }}
                                    ></div>
                                </div>
                            </div>

                            {/* Reply Rate Bar */}
                            <div>
                                <div className="flex justify-between text-xs mb-1">
                                    <span className="text-gray-500 flex items-center gap-1">
                                        <MessageSquare className="h-3 w-3" /> Respuestas
                                    </span>
                                    <span className="font-mono text-purple-600">{m.totalReplied} ({Math.round(mReplyRate)}%)</span>
                                </div>
                                <div className="w-full bg-gray-100 rounded-full h-2">
                                    <div
                                        className="bg-purple-500 h-2 rounded-full transition-all duration-500"
                                        style={{ width: `${mReplyRate}%` }}
                                    ></div>
                                </div>
                            </div>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
};
