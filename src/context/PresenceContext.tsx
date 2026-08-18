'use client';

import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { usePathname } from 'next/navigation';

type PresenceUser = {
    userId: string;
    email: string;
    fullName?: string;
    avatarUrl?: string;
    currentPath: string;
    onlineAt: string;
};

type PresenceContextType = {
    onlineUsers: PresenceUser[];
};

const PresenceContext = createContext<PresenceContextType>({ onlineUsers: [] });

export function PresenceProvider({ children }: { children: React.ReactNode }) {
    const { user, organizationId } = useAuth();
    const pathname = usePathname();
    const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);
    const orgId = organizationId;
    const pathnameRef = useRef(pathname);
    const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

    useEffect(() => {
        pathnameRef.current = pathname;
    }, [pathname]);

    useEffect(() => {
        if (!user || !orgId) return;

        const channel = supabase.channel(`presence:${orgId}`, {
            config: {
                presence: {
                    key: user.id,
                },
            },
        });
        channelRef.current = channel;

        channel
            .on('presence', { event: 'sync' }, () => {
                const state = channel.presenceState<PresenceUser>();
                const users: PresenceUser[] = [];

                for (const key in state) {
                    // Supabase presence state is an array of objects per key (device/tab)
                    // We just take the latest one for each user
                    const presences = state[key];
                    if (presences && presences.length > 0) {
                        users.push(presences[0]);
                    }
                }
                setOnlineUsers(users);
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    // Send initial presence
                    await channel.track({
                        userId: user.id,
                        email: user.email!,
                        fullName: user.user_metadata?.full_name,
                        avatarUrl: user.user_metadata?.avatar_url,
                        currentPath: pathnameRef.current,
                        onlineAt: new Date().toISOString(),
                    });
                }
            });

        return () => {
            channelRef.current = null;
            supabase.removeChannel(channel);
        };
    }, [user, orgId]);

    // Update presence when pathname changes
    useEffect(() => {
        if (!user || !orgId) return;

        // Re-track on the active subscribed channel so route changes update presence.
        channelRef.current?.track({
            userId: user.id,
            email: user.email!,
            fullName: user.user_metadata?.full_name,
            avatarUrl: user.user_metadata?.avatar_url,
            currentPath: pathname,
            onlineAt: new Date().toISOString(),
        });

    }, [pathname, user, orgId]);

    return (
        <PresenceContext.Provider value={{ onlineUsers }}>
            {children}
        </PresenceContext.Provider>
    );
}

export const usePresence = () => useContext(PresenceContext);
