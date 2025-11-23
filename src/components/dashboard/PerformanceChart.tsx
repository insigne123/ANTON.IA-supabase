
// src/components/dashboard/PerformanceChart.tsx
'use client';

import { TrendingUp } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, XAxis, Tooltip } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ChartContainer, ChartTooltipContent } from '@/components/ui/chart';
import { useEffect, useState } from 'react';
import { contactedLeadsStorage } from '@/lib/services/contacted-leads-service';
import { subDays, format } from 'date-fns';
import { es } from 'date-fns/locale';

const chartConfig = {
  sent: { label: 'Enviados', color: 'hsl(var(--primary))' },
  replied: { label: 'Respondidos', color: 'hsl(var(--chart-2))' },
};

export default function PerformanceChart() {
  const [chartData, setChartData] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      const contacted = await contactedLeadsStorage.get();
      const today = new Date();
      const dataByDay: Record<string, { sent: number; replied: number }> = {};

      // Inicializar los últimos 7 días
      for (let i = 6; i >= 0; i--) {
        const day = subDays(today, i);
        const key = format(day, 'yyyy-MM-dd');
        dataByDay[key] = { sent: 0, replied: 0 };
      }

      // Llenar con datos reales
      contacted.forEach(c => {
        const sentKey = format(new Date(c.sentAt), 'yyyy-MM-dd');
        if (dataByDay[sentKey]) {
          dataByDay[sentKey].sent += 1;
        }

        if (c.status === 'replied' && c.repliedAt) {
          const repliedKey = format(new Date(c.repliedAt), 'yyyy-MM-dd');
          if (dataByDay[repliedKey]) {
            dataByDay[repliedKey].replied += 1;
          }
        }
      });

      const finalData = Object.entries(dataByDay).map(([date, values]) => ({
        date: format(new Date(date), 'EEE', { locale: es }), // ej. "lun"
        ...values,
      }));

      setChartData(finalData);
    }
    load();
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rendimiento de la Semana</CardTitle>
        <CardDescription>Correos enviados vs. respuestas obtenidas en los últimos 7 días.</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="min-h-[200px] w-full">
          <BarChart data={chartData} accessibilityLayer>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              tickMargin={10}
              axisLine={false}
              tickFormatter={(value) => value.slice(0, 3)}
            />
            <Tooltip
              content={<ChartTooltipContent indicator="dot" />}
              cursor={false}
            />
            <Bar dataKey="sent" fill="var(--color-sent)" radius={4} />
            <Bar dataKey="replied" fill="var(--color-replied)" radius={4} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
