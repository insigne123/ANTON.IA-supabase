'use client';

import { usePresence } from '@/context/PresenceContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export function PresenceAvatars() {
    const { onlineUsers } = usePresence();
    const pathname = usePathname();

    if (onlineUsers.length === 0) return null;

    // Sort: Current page users first, then others
    const sortedUsers = [...onlineUsers].sort((a, b) => {
        const aIsHere = a.currentPath === pathname;
        const bIsHere = b.currentPath === pathname;
        if (aIsHere && !bIsHere) return -1;
        if (!aIsHere && bIsHere) return 1;
        return 0;
    });

    return (
        <div className="flex items-center -space-x-2 overflow-hidden pl-2">
            <TooltipProvider delayDuration={300}>
                {sortedUsers.map((u) => {
                    const isHere = u.currentPath === pathname;
                    return (
                        <Tooltip key={u.userId}>
                            <TooltipTrigger asChild>
                                <div className={cn(
                                    "relative inline-block border-2 border-background rounded-full transition-transform hover:z-10 hover:scale-110",
                                    isHere ? "ring-2 ring-green-500 ring-offset-2 ring-offset-background" : "opacity-70 grayscale"
                                )}>
                                    <Avatar className="h-8 w-8">
                                        <AvatarImage src={u.avatarUrl} />
                                        <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                                            {u.fullName?.[0]?.toUpperCase() || u.email[0].toUpperCase()}
                                        </AvatarFallback>
                                    </Avatar>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p className="font-medium">{u.fullName || u.email}</p>
                                <p className="text-xs text-muted-foreground">
                                    {isHere ? 'Viendo esta página' : `En ${u.currentPath}`}
                                </p>
                            </TooltipContent>
                        </Tooltip>
                    );
                })}
            </TooltipProvider>
            {sortedUsers.length > 0 && (
                <span className="ml-4 text-xs text-muted-foreground">
                    {sortedUsers.length} online
                </span>
            )}
        </div>
    );
}
