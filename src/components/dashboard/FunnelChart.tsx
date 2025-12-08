'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, CartesianGrid } from 'recharts';
import { contactedLeadsStorage } from '@/lib/services/contacted-leads-service';

export default function FunnelChart() {
    const [data, setData] = useState<any[]>([]);

    useEffect(() => {
        async function load() {
            const contacts = await contactedLeadsStorage.get();

            // Calcular métricas
            const sent = contacts.length;
            const opened = contacts.filter(c => !!c.openedAt || c.clickCount > 0 || c.status === 'replied').length;
            // Si respondió o clicó, implícitamente abrió (a veces el pixel de apertura falla pero el click es certero)
            const clicked = contacts.filter(c => !!c.clickedAt || (c.clickCount && c.clickCount > 0)).length;
            const replied = contacts.filter(c => c.status === 'replied' || !!c.repliedAt).length;

            setData([
                { name: 'Enviados', value: sent, fill: '#3b82f6' },  // Blue
                { name: 'Abiertos', value: opened, fill: '#8b5cf6' }, // Violet
                { name: 'Clics', value: clicked, fill: '#14b8a6' },    // Teal
                { name: 'Respuestas', value: replied, fill: '#22c55e' } // Green
            ]);
        }
        load();
    }, []);

    if (data.length === 0 || data[0].value === 0) {
        return (
            <Card className="h-full">
                <CardHeader>
                    <CardTitle>Embudo de Conversión</CardTitle>
                    <CardDescription>Visualiza la efectividad de tus campañas.</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center justify-center p-10 h-[300px] text-muted-foreground">
                    No hay datos suficientes para mostrar el embudo.
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="h-full">
            <CardHeader>
                <CardTitle>Embudo de Conversión</CardTitle>
                <CardDescription>Rendimiento acumulado de tus contactos.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                            data={data}
                            layout="vertical"
                            margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
                        >
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                            <XAxis type="number" hide />
                            <YAxis
                                dataKey="name"
                                type="category"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fontSize: 12, fontWeight: 500 }}
                                width={80}
                            />
                            <Tooltip
                                cursor={{ fill: 'transparent' }}
                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                            />
                            <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={32}>
                                {data.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.fill} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Leyenda con tasas de conversión */}
                <div className="grid grid-cols-4 gap-2 mt-4 text-center text-xs">
                    <div>
                        <div className="font-bold text-lg">{data[0]?.value}</div>
                        <div className="text-muted-foreground">Enviados</div>
                    </div>
                    <div>
                        <div className="font-bold text-lg">{data[1]?.value}</div>
                        <div className="text-muted-foreground">Abiertos</div>
                        <div className="text-[10px] text-muted-foreground">
                            ({data[0]?.value ? Math.round((data[1]?.value / data[0]?.value) * 100) : 0}%)
                        </div>
                    </div>
                    <div>
                        <div className="font-bold text-lg">{data[2]?.value}</div>
                        <div className="text-muted-foreground">Clics</div>
                        <div className="text-[10px] text-muted-foreground">
                            ({data[1]?.value ? Math.round((data[2]?.value / data[1]?.value) * 100) : 0}%)
                        </div>
                    </div>
                    <div>
                        <div className="font-bold text-lg">{data[3]?.value}</div>
                        <div className="text-muted-foreground">Respuestas</div>
                        <div className="text-[10px] text-muted-foreground">
                            ({data[0]?.value ? Math.round((data[3]?.value / data[0]?.value) * 100) : 0}%)
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
