'use client';

import { useEffect, useState } from 'react';
import { WeeklyCalendar } from '@/components/planner/WeeklyCalendar';
import { contactedLeadsStorage } from '@/lib/services/contacted-leads-service';
import { ContactedLead } from '@/lib/types';
import { Loader2 } from 'lucide-react';
import { addDays, subDays } from 'date-fns';

export default function PlannerPage() {
    const [tasks, setTasks] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [currentDate, setCurrentDate] = useState(new Date());

    useEffect(() => {
        loadTasks();
    }, [currentDate]); // Reload if we want to fetch range-based (optimization), currently fetches all

    async function loadTasks() {
        setLoading(true);
        // Optimization: In real app, filter by date range query. 
        // For now, fetch all and memory filter is fine for <1000 items.
        const all = await contactedLeadsStorage.get();

        const scheduled = all
            .filter(t => t.status === 'scheduled' && t.scheduledAt)
            .map(t => ({
                id: t.id,
                leadName: t.name,
                company: t.company || '',
                scheduledAt: t.scheduledAt!,
                provider: t.provider,
                status: t.status
            }));

        setTasks(scheduled);
        setLoading(false);
    }

    return (
        <div className="h-full flex flex-col p-6 space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Planificador</h1>
                    <p className="text-muted-foreground">
                        Visualiza y gestiona tus campañas programadas.
                    </p>
                </div>
            </div>

            {loading && tasks.length === 0 ? (
                <div className="flex justify-center items-center h-64">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            ) : (
                <WeeklyCalendar
                    tasks={tasks}
                    currentDate={currentDate}
                    onDateChange={setCurrentDate}
                />
            )}
        </div>
    );
}
