
// src/components/dashboard/ActivityFeed.tsx
'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { contactedLeadsStorage } from '@/lib/services/contacted-leads-service';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { AlertCircle } from 'lucide-react';

type ActivityItem = {
  type: 'contact' | 'reply';
  title: string;
  description: string;
  date: Date;
};

export default function ActivityFeed() {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setHasError(false);
      try {
        // Simulación de carga de datos desde diferentes storages.
        const contactedPromise = contactedLeadsStorage.get();
        const contacted = await contactedPromise.catch(() => []);

        const feed: ActivityItem[] = [];

        (contacted || []).forEach(c => {
          if (!c) return;
          if (c.sentAt) {
            feed.push({
              type: 'contact',
              title: `Correo enviado a ${c.name}`,
              description: `Empresa: ${c.company || 'N/A'}`,
              date: new Date(c.sentAt),
            });
          }
          if (c.status === 'replied' && c.repliedAt) {
            feed.push({
              type: 'reply',
              title: `Respuesta recibida de ${c.name}`,
              description: `Asunto original: ${c.subject}`,
              date: new Date(c.repliedAt),
            });
          }
        });

        // Ordenar por fecha descendente y tomar las últimas 15
        const sortedFeed = feed
          .sort((a, b) => b.date.getTime() - a.date.getTime())
          .slice(0, 15);

        setActivities(sortedFeed);
      } catch (error) {
        console.error("Error loading activity feed:", error);
        setHasError(true);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <Card className="overflow-hidden rounded-[24px] border-border/60 bg-card/85 shadow-[0_10px_28px_-24px_rgba(15,23,42,0.16)] dark:bg-card/70">
      <CardHeader>
        <CardTitle>Actividad reciente</CardTitle>
        <CardDescription>Tus movimientos más recientes y las señales que vale la pena revisar.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex items-start gap-4">
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="grid flex-1 gap-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))
        ) : hasError ? (
          <Alert className="rounded-2xl border-amber-200 bg-amber-50/80 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
            <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-300" />
            <AlertTitle>Actividad no disponible</AlertTitle>
            <AlertDescription className="text-amber-800 dark:text-amber-100/80">No pudimos actualizar los movimientos recientes ahora.</AlertDescription>
          </Alert>
        ) : activities.length > 0 ? (
          activities.map((item, index) => (
            <div key={index} className="flex items-start gap-4">
              <Avatar className="h-9 w-9">
                <AvatarFallback>{item.title.charAt(0)}</AvatarFallback>
              </Avatar>
              <div className="grid gap-1">
                <p className="text-sm font-medium leading-none">{item.title}</p>
                <p className="text-sm text-muted-foreground">{item.description}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDistanceToNow(item.date, { addSuffix: true, locale: es })}
                </p>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-border/60 bg-muted/20 px-4 py-8 text-center">
            <p className="font-medium">Todavia no hay actividad reciente</p>
            <p className="mt-1 text-sm text-muted-foreground">Cuando contactes leads o recibas respuestas, lo verás aquí.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
