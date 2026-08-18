'use client';

import { Fragment, createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { setLeadResearchStorageScope } from '@/lib/lead-research-storage';
import { setEmailDraftStorageScope } from '@/lib/email-drafts-storage';
import { setResearchedLeadsStorageScope } from '@/lib/researched-leads-storage';
import { organizationService } from '@/lib/services/organization-service';

interface AuthContextType {
    user: User | null;
    session: Session | null;
    organizationId: string | null;
    loading: boolean;
    error: string | null;
    signInWithGoogle: (nextPath?: string) => Promise<void>;
    signInWithPassword: (email: string, password: string) => Promise<void>;
    signUpWithPassword: (email: string, password: string) => Promise<void>;
    signOut: () => Promise<void>;
    refreshOrganization: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [organizationId, setOrganizationId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const sessionRef = useRef<Session | null>(null);
    const scopeRequestRef = useRef(0);

    const applySessionScope = useCallback(async (nextSession: Session | null, forceScopeRefresh = false) => {
        const requestId = ++scopeRequestRef.current;
        const previousUserId = sessionRef.current?.user?.id || null;
        sessionRef.current = nextSession;
        const userId = nextSession?.user?.id || null;

        if (forceScopeRefresh || previousUserId !== userId) {
            setLeadResearchStorageScope(null, null);
        }
        setEmailDraftStorageScope(userId);
        setResearchedLeadsStorageScope(userId);
        setLoading(true);

        const nextOrganizationId = userId
            ? await organizationService.getCurrentOrganizationId(userId)
            : null;
        if (requestId !== scopeRequestRef.current) return;

        setLeadResearchStorageScope(userId, nextOrganizationId);
        setSession(nextSession);
        setUser(nextSession?.user ?? null);
        setOrganizationId(nextOrganizationId);
        setLoading(false);
    }, []);

    const refreshOrganization = useCallback(async () => {
        await applySessionScope(sessionRef.current, true);
    }, [applySessionScope]);

    useEffect(() => {
        // Check active session
        supabase.auth.getSession().then(({ data: { session } }) => {
            void applySessionScope(session);
        });

        // Listen for changes
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            window.setTimeout(() => void applySessionScope(session), 0);
        });
        const unsubscribeOrganization = organizationService.subscribeToCurrentOrganizationChanges(() => {
            window.setTimeout(() => void applySessionScope(sessionRef.current, true), 0);
        });

        return () => {
            subscription.unsubscribe();
            unsubscribeOrganization();
        };
    }, [applySessionScope]);

    const signInWithGoogle = async (nextPath?: string) => {
        setError(null);

        const safeNext = typeof nextPath === 'string' && nextPath.startsWith('/') ? nextPath : '';
        const redirectTo = safeNext
            ? `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(safeNext)}`
            : `${window.location.origin}/api/auth/callback`;

        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo,
            },
        });
        if (error) setError(error.message);
    };

    const signInWithPassword = async (email: string, password: string) => {
        setError(null);
        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        if (error) {
            setError(error.message);
            throw error;
        }
    };

    const signUpWithPassword = async (email: string, password: string) => {
        setError(null);
        const { error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                emailRedirectTo: `${window.location.origin}/api/auth/callback`,
            },
        });
        if (error) {
            setError(error.message);
            throw error;
        }
    };

    const signOut = async () => {
        await supabase.auth.signOut();
        window.location.href = '/login'; // Force full reload/redirect to clear state
    };

    return (
        <AuthContext.Provider value={{ user, session, organizationId, loading, error, signInWithGoogle, signInWithPassword, signUpWithPassword, signOut, refreshOrganization }}>
            <Fragment key={`${user?.id || 'anonymous'}:${organizationId || 'personal'}`}>
                {children}
            </Fragment>
        </AuthContext.Provider>
    );
}

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
