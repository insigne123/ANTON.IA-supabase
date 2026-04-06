'use client';

import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { usePathname } from 'next/navigation';
import { organizationService } from '@/lib/services/organization-service';

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
    const { user } = useAuth();
    const pathname = usePathname();
    const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);
    const [orgId, setOrgId] = useState<string | null>(null);
    const pathnameRef = useRef(pathname);

    useEffect(() => {
        pathnameRef.current = pathname;
    }, [pathname]);

    // Fetch Org ID once
    useEffect(() => {
        if (user) {
            organizationService.getCurrentOrganizationId().then(setOrgId);
        }
    }, [user]);

    useEffect(() => {
        if (!user || !orgId) return;

        const channel = supabase.channel(`presence:${orgId}`, {
            config: {
                presence: {
                    key: user.id,
                },
            },
        });

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
            supabase.removeChannel(channel);
        };
    }, [user, orgId]);

    // Update presence when pathname changes
    useEffect(() => {
        if (!user || !orgId) return;

        // We need to re-track with new path
        // Note: 'track' updates the state for this key
        const channel = supabase.channel(`presence:${orgId}`);
        channel.track({
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
