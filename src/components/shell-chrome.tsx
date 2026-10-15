'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * The app bar's controls (the menu, the help and the theme) for a full-height screen that hides that bar and shows them in its
 * own header instead: Cowork gets the height of one bar back and one line less above the conversation. Null everywhere else.
 */
export type ShellChrome = { start: ReactNode; end: ReactNode };
const ShellChromeContext = createContext<ShellChrome | null>(null);
export const ShellChromeProvider = ShellChromeContext.Provider;
export const useShellChrome = () => useContext(ShellChromeContext);

/** Screens that take the whole height under the app's own bar. */
export const isImmersiveScreen = (pathname: string | null | undefined) => pathname === '/cowork' || Boolean(pathname?.startsWith('/cowork/'));
