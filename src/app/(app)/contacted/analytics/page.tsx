'use client';

import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { contactedLeadsStorage } from '@/lib/services/contacted-leads-service';
import type { ContactedLead } from '@/lib/types';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { Loader2, TrendingUp, TrendingDown, Users, Mail, MousePointerClick, MessageSquare } from 'lucide-react';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658'];

function classifyLevel(role?: string) {
    if (!role) return 'Desconocido';
    const r = role.toLowerCase();
    if (r.match(/founder|owner|socio|fundador|dueño|ceo|cto|cfo|cmo|coo|president|presidente|director general/)) return 'C-Level / Founder';
    if (r.match(/vp|vice president|vicepresidente/)) return 'VP';
    if (r.match(/director|head|jefe|gerente|manager|lead/)) return 'Manager / Director';
    if (r.match(/senior|sr|principal/)) return 'Senior IC';
    return 'Individual Contributor';
}

function classifyArea(role?: string) {
    if (!role) return 'Otro';
    const r = role.toLowerCase();
    if (r.match(/sales|venta|comercial|account|revenue|business development/)) return 'Ventas';
    if (r.match(/marketing|brand|growth|cmo|mkt/)) return 'Marketing';
    if (r.match(/hr|human|resources|talent|people|rrhh|recursos humanos/)) return 'RRHH';
    if (r.match(/tech|engineer|developer|software|cto|it|sistemas|desarrollo/)) return 'Tecnología';
    if (r.match(/finance|financial|cfo|finanzas|contabilidad/)) return 'Finanzas';
    if (r.match(/operations|coo|operaciones|logistica/)) return 'Operaciones';
    if (r.match(/legal|abogado/)) return 'Legal';
    if (r.match(/ceo|founder|owner|bussines/)) return 'Dirección General';
    return 'Otro';
}

export default function ContactedAnalyticsPage() {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<ContactedLead[]>([]);
    const [period, setPeriod] = useState('all');

    useEffect(() => {
        async function load() {
            const items = await contactedLeadsStorage.get();
            setData(items);
            setLoading(false);
        }
        load();
    }, []);

    const filteredData = useMemo(() => {
        if (period === 'all') return data;
        const now = new Date();
        let cutoff = new Date();
        if (period === '7d') cutoff.setDate(now.getDate() - 7);
        if (period === '30d') cutoff.setDate(now.getDate() - 30);
        if (period === 'month') cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
        if (period === 'year') cutoff = new Date(now.getFullYear(), 0, 1);

        return data.filter(item => new Date(item.sentAt) >= cutoff);
    }, [data, period]);

    const stats = useMemo(() => {
        const total = filteredData.length;
        const opened = filteredData.filter(x => x.openedAt || x.readReceiptMessageId).length;
        const replied = filteredData.filter(x => x.status === 'replied').length;

        // Counting clicks: if clickCount > 0, it counts as 1 person who clicked
        const clicked = filteredData.filter(x => (x.clickCount || 0) > 0).length;

        return {
            total,
            opened,
            openRate: total ? (opened / total) * 100 : 0,
            replied,
            replyRate: total ? (replied / total) * 100 : 0,
            clicked,
            clickRate: total ? (clicked / total) * 100 : 0,
        };
    }, [filteredData]);

    // Distributions
    const byStructure = useMemo(() => {
        const groups: Record<string, number> = {};
        const areas: Record<string, number> = {};
        const levels: Record<string, number> = {};
        const industries: Record<string, number> = {};
        const providers: Record<string, number> = {};

        filteredData.forEach(item => {
            // Area
            const area = classifyArea(item.role);
            areas[area] = (areas[area] || 0) + 1;

            // Level
            const lvl = classifyLevel(item.role);
            levels[lvl] = (levels[lvl] || 0) + 1;

            // Industry
            const ind = item.industry || 'Desconocido';
            industries[ind] = (industries[ind] || 0) + 1;

            // Provider
            const prov = item.provider === 'linkedin' ? 'LinkedIn' : 'Email';
            providers[prov] = (providers[prov] || 0) + 1;
        });

        const formatForChart = (rec: Record<string, number>) =>
            Object.entries(rec)
                .sort((a, b) => b[1] - a[1]) // Sort desc
                .slice(0, 10) // Top 10
                .map(([name, value]) => ({ name, value }));

        return {
            areas: formatForChart(areas),
            levels: formatForChart(levels),
            industries: formatForChart(industries),
            providers: formatForChart(providers),
        };
    }, [filteredData]);

    if (loading) return <div className="flex h-96 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

    import { BackBar } from '@/components/back-bar';

    // ... existing imports ...

    export default function ContactedAnalyticsPage() {
        // ... stats ...

        return (
            <div className="space-y-6 pb-20">
                <BackBar href="/contacted" label="Volver a Leads Contactados" />
                <PageHeader
                    title="Analítica de Contactos"
                    description="Métricas de rendimiento e insights de tus campañas de outreach."
                />
                {/* ... */}

                <div className="flex justify-end">
                    <Select value={period} onValueChange={setPeriod}>
                        <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="Periodo" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todo el histórico</SelectItem>
                            <SelectItem value="7d">Últimos 7 días</SelectItem>
                            <SelectItem value="30d">Últimos 30 días</SelectItem>
                            <SelectItem value="month">Este mes</SelectItem>
                            <SelectItem value="year">Este año</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {/* KPI Cards */}
                <div className="grid gap-4 md:grid-cols-4">
                    <KPI title="Total Enviados" value={stats.total} icon={Mail} sub="Correos enviados" />
                    <KPI title="Tasa de Apertura" value={`${stats.openRate.toFixed(1)}%`} icon={Users} sub={`${stats.opened} aperturas`} />
                    <KPI title="Tasa de Respuesta" value={`${stats.replyRate.toFixed(1)}%`} icon={MessageSquare} sub={`${stats.replied} respuestas`} />
                    <KPI title="Tasa de Clicks" value={`${stats.clickRate.toFixed(1)}%`} icon={MousePointerClick} sub={`${stats.clicked} usuarios clickearon`} />
                </div>

                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                    <Card className="col-span-4">
                        <CardHeader>
                            <CardTitle>Por Áreas Empresariales</CardTitle>
                            <CardDescription>Departamentos donde estamos impactando más.</CardDescription>
                        </CardHeader>
                        <CardContent className="pl-2">
                            <ResponsiveContainer width="100%" height={350}>
                                <BarChart data={byStructure.areas} layout="vertical" margin={{ left: 20, right: 20, top: 20, bottom: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                                    <XAxis type="number" hide />
                                    <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 12 }} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: 'var(--radius)' }}
                                        itemStyle={{ color: 'hsl(var(--foreground))' }}
                                        cursor={{ fill: 'hsl(var(--muted)/0.2)' }}
                                    />
                                    <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} barSize={20} />
                                </BarChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>

                    <Card className="col-span-3">
                        <CardHeader>
                            <CardTitle>Canal de Contacto</CardTitle>
                            <CardDescription>Email vs LinkedIn</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={350}>
                                <PieChart>
                                    <Pie
                                        data={byStructure.providers}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={80}
                                        paddingAngle={5}
                                        dataKey="value"
                                    >
                                        {byStructure.providers.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={index === 0 ? '#0077b5' : '#ea4335'} />
                                        ))}
                                    </Pie>
                                    <Tooltip />
                                    <Legend />
                                </PieChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>
                </div>

                <div className="grid gap-4 md:grid-cols-2 mt-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Nivel de Seniority</CardTitle>
                            <CardDescription>¿A quién le estamos hablando?</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={300}>
                                <BarChart data={byStructure.levels} layout="vertical" margin={{ left: 20, right: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                                    <XAxis type="number" hide />
                                    <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 12 }} />
                                    <Tooltip />
                                    <Bar dataKey="value" fill="#8884d8" radius={[0, 4, 4, 0]} barSize={20} />
                                </BarChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Sectores / Industrias</CardTitle>
                            <CardDescription>Top 10 industrias contactadas.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={300}>
                                <BarChart data={byStructure.industries} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="name" tick={{ fontSize: 12 }} interval={0} angle={-15} textAnchor="end" height={60} />
                                    <YAxis />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: 'var(--radius)' }}
                                        itemStyle={{ color: 'hsl(var(--foreground))' }}
                                    />
                                    <Bar dataKey="value" fill="#82ca9d" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>

                </div>
            </div>
        );
    }

    function KPI({ title, value, icon: Icon, sub }: any) {
        return (
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">{title}</CardTitle>
                    <Icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{value}</div>
                    <p className="text-xs text-muted-foreground">{sub}</p>
                </CardContent>
            </Card>
        );
    }
