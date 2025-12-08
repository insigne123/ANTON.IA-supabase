
// src/components/dashboard/ActivityFeed.tsx
'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { contactedLeadsStorage } from '@/lib/services/contacted-leads-service';
import { savedOpportunitiesStorage } from '@/lib/services/opportunities-service';
import { supabaseService } from '@/lib/supabase-service';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

type ActivityItem = {
  type: 'contact' | 'reply' | 'new_lead' | 'new_opp';
  title: string;
  description: string;
  date: Date;
};

export default function ActivityFeed() {
  const [activities, setActivities] = useState<ActivityItem[]>([]);

  useEffect(() => {
    async function load() {
      try {
        // Simulación de carga de datos desde diferentes storages.
        const contactedPromise = contactedLeadsStorage.get();
        const oppsPromise = savedOpportunitiesStorage.get();
        const savedLeadsPromise = supabaseService.getLeads();

        const [contacted, opps, savedLeads] = await Promise.all([
          contactedPromise.catch(() => []),
          oppsPromise.catch(() => []),
          savedLeadsPromise.catch(() => [])
        ]);

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

        (opps || []).forEach(o => {
          if (!o) return;
          const publishedDate = o.publishedAt ? new Date(o.publishedAt) : new Date(); // Fallback date
          feed.push({
            type: 'new_opp',
            title: `Nueva oportunidad guardada: ${o.title}`,
            description: `Empresa: ${o.companyName}`,
            date: publishedDate,
          });
        });

        // Ordenar por fecha descendente y tomar las últimas 15
        const sortedFeed = feed
          .sort((a, b) => b.date.getTime() - a.date.getTime())
          .slice(0, 15);

        setActivities(sortedFeed);
      } catch (error) {
        console.error("Error loading activity feed:", error);
      }
    }
    load();
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Actividad Reciente</CardTitle>
        <CardDescription>Un vistazo a tus últimas acciones y las respuestas de tus leads.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {activities.length > 0 ? (
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
          <p className="text-center text-sm text-muted-foreground py-8">No hay actividad reciente para mostrar.</p>
        )}
      </CardContent>
    </Card>
  );
}
