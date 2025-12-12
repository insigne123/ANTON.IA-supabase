import { useState } from 'react';
import {
    startOfWeek, endOfWeek, eachDayOfInterval, format, isSameDay, addWeeks, subWeeks,
    isToday, parseISO
} from 'date-fns';
import { es } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Linkedin, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Task {
    id: string;
    leadName: string;
    company: string;
    scheduledAt: string;
    provider: 'linkedin' | 'gmail' | 'outlook';
    status: string;
}

interface WeeklyCalendarProps {
    tasks: Task[];
    currentDate: Date;
    onDateChange: (date: Date) => void;
}

export function WeeklyCalendar({ tasks, currentDate, onDateChange }: WeeklyCalendarProps) {
    const start = startOfWeek(currentDate, { weekStartsOn: 1 }); // Monday start
    const end = endOfWeek(currentDate, { weekStartsOn: 1 });
    const days = eachDayOfInterval({ start, end });

    // Helper to get tasks for a day
    const getTasksForDay = (day: Date) => {
        return tasks.filter(t => isSameDay(parseISO(t.scheduledAt), day));
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="icon" onClick={() => onDateChange(subWeeks(currentDate, 1))}>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <h2 className="text-lg font-semibold capitalize">
                        {format(start, 'MMMM yyyy', { locale: es })}
                    </h2>
                    <Button variant="outline" size="icon" onClick={() => onDateChange(addWeeks(currentDate, 1))}>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => onDateChange(new Date())}>Hoy</Button>
                </div>
            </div>

            <div className="grid grid-cols-7 gap-4 min-h-[600px]">
                {days.map((day) => {
                    const dayTasks = getTasksForDay(day);
                    const isDayToday = isToday(day);

                    return (
                        <div key={day.toISOString()} className={`border rounded-lg flex flex-col ${isDayToday ? 'bg-muted/50 border-primary' : 'bg-card'}`}>
                            <div className={`p-2 text-center border-b ${isDayToday ? 'bg-primary/10 font-bold' : ''}`}>
                                <div className="text-xs uppercase text-muted-foreground">
                                    {format(day, 'EEE', { locale: es })}
                                </div>
                                <div className="text-lg">
                                    {format(day, 'd')}
                                </div>
                            </div>

                            <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[500px]">
                                {dayTasks.length === 0 && (
                                    <div className="text-xs text-center text-muted-foreground mt-10">
                                        Sin tareas
                                    </div>
                                )}
                                {dayTasks.map(task => (
                                    <Card key={task.id} className="p-2 text-xs shadow-sm cursor-grab active:cursor-grabbing hover:border-primary transition-colors">
                                        <div className="flex items-center gap-1 font-medium mb-1 truncate">
                                            {task.provider === 'linkedin' ?
                                                <Linkedin className="h-3 w-3 text-blue-600 shrink-0" /> :
                                                <Mail className="h-3 w-3 text-orange-600 shrink-0" />
                                            }
                                            <span className="truncate" title={task.leadName}>{task.leadName}</span>
                                        </div>
                                        <div className="truncate text-muted-foreground mb-1" title={task.company}>
                                            {task.company}
                                        </div>
                                        <Badge variant="outline" className="text-[10px] h-4 px-1">
                                            {format(parseISO(task.scheduledAt), 'HH:mm')}
                                        </Badge>
                                    </Card>
                                ))}
                            </div>

                            <div className="p-2 border-t bg-muted/20 text-xs text-center text-muted-foreground">
                                {dayTasks.length} envíos
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
