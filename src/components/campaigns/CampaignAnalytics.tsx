'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar } from 'recharts';
import { Send, MailOpen, MessageSquare, MousePointerClick, AlertTriangle, Ban } from 'lucide-react';
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
        let actionRequired = 0;
        let stopped = 0;

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

                if (lead.replyIntent === 'meeting_request' || lead.replyIntent === 'positive') {
                    actionRequired++;
                }
                if (lead.replyIntent === 'negative' || lead.replyIntent === 'unsubscribe' || lead.replyIntent === 'delivery_failure') {
                    stopped++;
                }
            }
        });

        return {
            totalSent,
            opened,
            replied,
            clicked,
            actionRequired,
            stopped,
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
        <div className="space-y-6 animate-in fade-in duration-300 motion-reduce:animate-none">
            <Card className="overflow-hidden border-border/60 shadow-sm">
                <CardHeader className="border-b border-border/60 bg-muted/15">
                    <CardTitle className="text-lg">Resumen de rendimiento</CardTitle>
                    <CardDescription>Resultados acumulados de esta campaña.</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="grid grid-cols-2 divide-x divide-y divide-border/60 sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
                        {[
                            { label: 'Enviados', value: metrics.totalSent, detail: 'contactos', icon: Send },
                            { label: 'Aperturas', value: metrics.opened, detail: `${metrics.openRate}%`, icon: MailOpen },
                            { label: 'Respuestas', value: metrics.replied, detail: `${metrics.replyRate}%`, icon: MessageSquare },
                            { label: 'Clics', value: metrics.clicked, detail: `${metrics.clickRate}%`, icon: MousePointerClick },
                            { label: 'Por atender', value: metrics.actionRequired, detail: 'interesados', icon: AlertTriangle },
                            { label: 'Detenidos', value: metrics.stopped, detail: 'no continuar', icon: Ban },
                        ].map(({ label, value, detail, icon: Icon }) => (
                            <div key={label} className="min-w-0 p-4 sm:p-5">
                                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                                    <Icon className="size-3.5" aria-hidden="true" />
                                    {label}
                                </div>
                                <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
                                <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {metrics.totalSent === 0 ? (
                <Card className="border-dashed border-border/70 bg-muted/10">
                    <CardContent className="flex min-h-48 flex-col items-center justify-center px-6 py-10 text-center">
                        <Send className="mb-3 size-5 text-muted-foreground" aria-hidden="true" />
                        <h3 className="text-sm font-semibold">Todavía no hay actividad</h3>
                        <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
                            Cuando revises destinatarios y comiences los envíos, aquí verás aperturas, clics y respuestas.
                        </p>
                    </CardContent>
                </Card>
            ) : (
            <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Actividad reciente</CardTitle>
                        <CardDescription>Correos enviados por día.</CardDescription>
                    </CardHeader>
                    <CardContent className="pl-2">
                        <div className="h-[280px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={timeSeriesData}>
                                    <defs>
                                        <linearGradient id="colorSent" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                                            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: 'hsl(var(--popover))', borderColor: 'hsl(var(--border))', borderRadius: 12 }}
                                        labelStyle={{ color: 'hsl(var(--foreground))' }}
                                    />
                                    <Area type="monotone" dataKey="sent" stroke="hsl(var(--primary))" fillOpacity={1} fill="url(#colorSent)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Conversión</CardTitle>
                        <CardDescription>Resultados por etapa.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[280px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart layout="vertical" data={[
                                    { name: 'Enviados', value: metrics.totalSent },
                                    { name: 'Abiertos', value: metrics.opened },
                                    { name: 'Clics', value: metrics.clicked },
                                    { name: 'Respuestas', value: metrics.replied },
                                ]} margin={{ left: 24 }}>
                                    <XAxis type="number" hide />
                                    <YAxis dataKey="name" type="category" width={82} stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                                    <Tooltip cursor={{ fill: 'hsl(var(--muted) / 0.25)' }} contentStyle={{ backgroundColor: 'hsl(var(--popover))', borderColor: 'hsl(var(--border))', borderRadius: 12 }} />
                                    <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]} barSize={28} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>
            </div>
            )}
        </div>
    );
}
