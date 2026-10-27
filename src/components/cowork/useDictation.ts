'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { dictatedValue, dictationLanguage, dictationProblem, joinDictated } from '@/lib/cowork/dictation';

type Heard = ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: { results: Heard }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void;
};
type RecognitionConstructor = new () => Recognition;

const recognitionConstructor = (): RecognitionConstructor | null => {
  if (typeof window === 'undefined') return null;
  const scope = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return scope.SpeechRecognition || scope.webkitSpeechRecognition || null;
};

export type DictationState = 'idle' | 'listening' | 'stopping';

/**
 * The composer's microphone (COW-13). `start` keeps what the box says and writes what is heard after it; `stop` lets the browser
 * deliver its last words; `cancel` drops whatever comes after it (sending the message, or the person typing over it).
 */
export function useDictation(write: (value: string) => void) {
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<DictationState>('idle');
  const [problem, setProblem] = useState<string | null>(null);
  const session = useRef<{ recognition: Recognition; ignore: boolean } | null>(null);
  const writer = useRef(write);
  useEffect(() => { writer.current = write; }, [write]);
  // Known only in the browser: offered after mounting, so the server's page and the first render agree.
  useEffect(() => { setSupported(Boolean(recognitionConstructor())); }, []);
  useEffect(() => () => { if (session.current) { session.current.ignore = true; session.current.recognition.abort(); } }, []);

  const start = useCallback((before: string) => {
    const Recognition = recognitionConstructor();
    if (!Recognition || session.current) return;
    const recognition = new Recognition();
    recognition.lang = dictationLanguage(navigator.languages?.length ? navigator.languages : [navigator.language]);
    recognition.continuous = true;
    recognition.interimResults = true;
    const mine = { recognition, ignore: false };
    recognition.onresult = event => {
      if (mine.ignore) return;
      const finals: string[] = [];
      const interim: string[] = [];
      for (let index = 0; index < event.results.length; index++) {
        const result = event.results[index];
        (result.isFinal ? finals : interim).push(result[0].transcript);
      }
      writer.current(dictatedValue(before, [joinDictated(finals), interim.join(' ').trim()].filter(Boolean).join(' ')));
    };
    recognition.onerror = event => { if (!mine.ignore) setProblem(dictationProblem(event.error)); };
    recognition.onend = () => {
      if (session.current === mine) session.current = null;
      if (!mine.ignore) setState('idle');
    };
    session.current = mine;
    setProblem(null);
    try {
      recognition.start();
      setState('listening');
    } catch {
      session.current = null;
      setProblem(dictationProblem(null));
    }
  }, []);

  const stop = useCallback(() => {
    if (!session.current) return;
    setState('stopping');
    session.current.recognition.stop();
  }, []);

  const cancel = useCallback(() => {
    const mine = session.current;
    if (!mine) return;
    mine.ignore = true;
    session.current = null;
    setState('idle');
    mine.recognition.abort();
  }, []);

  const clearProblem = useCallback(() => setProblem(null), []);

  return { supported, state, problem, start, stop, cancel, clearProblem };
}
