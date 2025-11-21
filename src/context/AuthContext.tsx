'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

interface AuthContextType {
    user: User | null;
    session: Session | null;
    loading: boolean;
    error: string | null;
    signInWithGoogle: () => Promise<void>;
    signInWithPassword: (email: string, password: string) => Promise<void>;
    signUpWithPassword: (email: string, password: string) => Promise<void>;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // Check active session
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            setUser(session?.user ?? null);
            setLoading(false);
        });

        // Listen for changes
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            setUser(session?.user ?? null);
            setLoading(false);
        });

        return () => subscription.unsubscribe();
    }, []);

    const signInWithGoogle = async () => {
        setError(null);
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: `${window.location.origin}/api/auth/callback`,
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
    };

    return (
        <AuthContext.Provider value={{ user, session, loading, error, signInWithGoogle, signInWithPassword, signUpWithPassword, signOut }}>
            {children}
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
