'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar, Legend } from 'recharts';
import { Users, Send, MailOpen, MessageSquare, MousePointerClick } from 'lucide-react';
import type { ContactedLead } from '@/lib/types';
import type { Campaign } from '@/lib/services/campaigns-service';

interface CampaignAnalyticsProps {
    campaign: Campaign;
    contactedLeads: ContactedLead[]; // All contacted leads to cross-ref
}

export function CampaignAnalytics({ campaign, contactedLeads }: CampaignAnalyticsProps) {
    const metrics = useMemo(() => {
        // 1. Identify leads involved in this campaign
        // sentRecords keys are leadIds
        const sentLeadIds = Object.keys(campaign.sentRecords || {});
        const totalSent = sentLeadIds.length;

        let opened = 0;
        let replied = 0;
        let clicked = 0;

        // 2. Cross-reference with ContactedLead to get status
        // Optimization: Create a map for faster lookup if needed, but array find is okay for small sets
        // For larger sets, we should optimize this lookup in the parent or here.
        const leadMap = new Map(contactedLeads.map(l => [l.leadId, l]));

        sentLeadIds.forEach(id => {
            const lead = leadMap.get(id);
            if (lead) {
                if (lead.openedAt) opened++;
                if (lead.repliedAt || lead.status === 'replied') replied++;
                if (lead.clickedAt) clicked++;
            }
        });

        return {
            totalSent,
            opened,
            replied,
            clicked,
            openRate: totalSent > 0 ? ((opened / totalSent) * 100).toFixed(1) : 0,
            replyRate: totalSent > 0 ? ((replied / totalSent) * 100).toFixed(1) : 0,
            clickRate: totalSent > 0 ? ((clicked / totalSent) * 100).toFixed(1) : 0,
        };
    }, [campaign, contactedLeads]);

    // Simulated Time-Series Data (since we don't strictly store daily snapshots yet)
    // In a real app, we would aggregate 'sentRecords.lastSentAt' by day.
    const timeSeriesData = useMemo(() => {
        const data: Record<string, { date: string; sent: number; opened: number; replied: number }> = {};

        // Aggregate Sent
        Object.values(campaign.sentRecords || {}).forEach(rec => {
            const date = rec.lastSentAt.split('T')[0];
            if (!data[date]) data[date] = { date, sent: 0, opened: 0, replied: 0 };
            data[date].sent++;
        });

        // We don't have 'openedAt' per campaign easily without looking at leadMap again
        // Let's do a quick pass if we want more accuracy, or just return 'sent' curve for now.
        // For V1, the aggregate cards are most important.

        // Sort by date
        return Object.values(data).sort((a, b) => a.date.localeCompare(b.date));
    }, [campaign]);

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Top Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Enviados</CardTitle>
                        <Send className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{metrics.totalSent}</div>
                        <p className="text-xs text-muted-foreground">Leads contactados</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Aperturas</CardTitle>
                        <MailOpen className="h-4 w-4 text-blue-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{metrics.opened}</div>
                        <p className="text-xs text-muted-foreground">{metrics.openRate}% tasa de apertura</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Respuestas</CardTitle>
                        <MessageSquare className="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{metrics.replied}</div>
                        <p className="text-xs text-muted-foreground">{metrics.replyRate}% tasa de respuesta</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Clics</CardTitle>
                        <MousePointerClick className="h-4 w-4 text-purple-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{metrics.clicked}</div>
                        <p className="text-xs text-muted-foreground">{metrics.clickRate}% CTR</p>
                    </CardContent>
                </Card>
            </div>

            {/* Charts Area */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                <Card className="col-span-4">
                    <CardHeader>
                        <CardTitle>Actividad Reciente</CardTitle>
                        <CardDescription>Volumen de correos enviados por día.</CardDescription>
                    </CardHeader>
                    <CardContent className="pl-2">
                        <div className="h-[300px] w-full">
                            {timeSeriesData.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={timeSeriesData}>
                                        <defs>
                                            <linearGradient id="colorSent" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#2563eb" stopOpacity={0.8} />
                                                <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <XAxis dataKey="date" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                                        <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}`} />
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: 'hsl(var(--background))', borderColor: 'hsl(var(--border))' }}
                                            labelStyle={{ color: 'hsl(var(--foreground))' }}
                                        />
                                        <Area type="monotone" dataKey="sent" stroke="#2563eb" fillOpacity={1} fill="url(#colorSent)" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="flex h-full items-center justify-center text-muted-foreground">
                                    Sin datos de actividad suficiente.
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                <Card className="col-span-3">
                    <CardHeader>
                        <CardTitle>Rendimiento del Embudo</CardTitle>
                        <CardDescription>Conversión relativa por etapa.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[300px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart layout="vertical" data={[
                                    { name: 'Enviados', value: metrics.totalSent, fill: '#64748b' },
                                    { name: 'Abiertos', value: metrics.opened, fill: '#3b82f6' },
                                    { name: 'Clics', value: metrics.clicked, fill: '#8b5cf6' },
                                    { name: 'Respuestas', value: metrics.replied, fill: '#22c55e' },
                                ]} margin={{ left: 40 }}>
                                    <XAxis type="number" hide />
                                    <YAxis dataKey="name" type="category" width={80} stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                                    <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ backgroundColor: 'hsl(var(--background))', borderColor: 'hsl(var(--border))' }} />
                                    <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={32} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
