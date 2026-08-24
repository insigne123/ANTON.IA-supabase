'use client';
/* =====================================================================
   SupliaChat.tsx — Fase 4: SUPL.IA con la fidelidad visual de Claude.
   - Tokens exactos (terracota #da7756, crema, serif Tiempos≈Source Serif, sans Styrene≈Inter)
   - Streaming de letras (reveal palabra por palabra + caret)
   - Bloque de pensamiento construido desde las fases del SSE ("Pensó durante Xs")
   - Panel de artifacts estilo Claude: iframe + HTML inline, pestañas, navegación de versiones
   - Micro-animaciones: rise, shimmer, pulse, slide-in
   Contrato real: GET/POST /api/suplia/chat (SSE).  Va en: src/components/suplia/SupliaChat.tsx
   Requiere: src/lib/suplia/suplia-artifact-doc.ts  (incluido)
   (Opcional) carga las fuentes: Inter + Source Serif 4 desde Google Fonts.
   ===================================================================== */
import { useCallback, useEffect, useRef, useState } from 'react';
import { buildArtifactDoc } from '@/lib/suplia/suplia-artifact-doc';

const ACCENT = '#da7756';

type Part =
  | { type: 'text'; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'code'; language?: string | null; content: string }
  | { type: 'ask'; askId: string; header?: string | null; question?: string | null; options?: { label: string; description?: string | null }[]; multi?: boolean | null; allowOther?: boolean | null; submitLabel?: string | null }
  | { type: 'artifact-card'; artifactId?: string | null; artifactType: string; title: string }
  | { type: 'job-progress'; jobId: string; status?: string | null; label?: string | null }
  | { type: 'approval-request'; actionId: string; title: string; approvalKind?: string | null }
  | { type: 'tool-call'; toolRunId?: string | null; toolName: string; status?: string | null };

type Msg = { id: string; role: string; content: string; metadata?: { parts?: Part[] } | null };
type Artifact = { id: string; type: string; title: string; content?: string | null; data?: unknown };
type State = { conversation?: { id: string } | null; messages: Msg[]; artifacts: Artifact[] };
type Thought = { seconds: number; phases: string[] };

export function SupliaChat() {
  const [state, setState] = useState<State>({ messages: [], artifacts: [] });
  const [input, setInput] = useState('');
  const [phase, setPhase] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [thoughts, setThoughts] = useState<Record<string, Thought>>({});
  const [revealId, setRevealId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<'preview' | 'data'>('preview');
  const scrollRef = useRef<HTMLDivElement>(null);
  const convId = state.conversation?.id || null;
  const artifacts = state.artifacts || [];
  const openIdx = artifacts.findIndex((a) => a.id === openId);
  const openArtifact = openIdx >= 0 ? artifacts[openIdx] : null;

  const loadState = useCallback(async (id?: string | null) => {
    const res = await fetch(`/api/suplia/chat${id ? `?conversationId=${id}` : ''}`);
    if (res.ok) setState(await res.json());
  }, []);
  useEffect(() => { loadState(); }, [loadState]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 1e9, behavior: 'smooth' }); }, [state.messages, phase]);

  const send = useCallback(async (text: string, answerToAsk?: unknown) => {
    if ((!text.trim() && !answerToAsk) || busy) return;
    const started = Date.now();
    const collected: string[] = [];
    setBusy(true); setPhase('Analizando pedido'); setInput('');
    if (text.trim()) setState((s) => ({ ...s, messages: [...s.messages, { id: 'tmp' + started, role: 'user', content: text }] }));
    try {
      const res = await fetch('/api/suplia/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ conversationId: convId, message: text, answerToAsk, stream: true }),
      });
      if (!res.body) { await loadState(convId); return; }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const ev = /^event:\s*(.*)$/m.exec(chunk)?.[1]?.trim();
          const dataRaw = /^data:\s*([\s\S]*)$/m.exec(chunk)?.[1];
          if (!dataRaw) continue;
          let data: any = {}; try { data = JSON.parse(dataRaw); } catch { /* ignore */ }
          if (ev === 'start' || ev === 'status') { if (data.phase) { setPhase(data.phase); if (!collected.includes(data.phase)) collected.push(data.phase); } }
          else if (ev === 'final' && data.state) {
            const next: State = data.state;
            const lastAssistant = [...(next.messages || [])].reverse().find((m) => m.role === 'assistant');
            if (lastAssistant) {
              setThoughts((t) => ({ ...t, [lastAssistant.id]: { seconds: Math.max(1, Math.round((Date.now() - started) / 1000)), phases: collected.slice() } }));
              setRevealId(lastAssistant.id);
            }
            setState(next);
          } else if (ev === 'error') {
            setState((s) => ({ ...s, messages: [...s.messages, { id: 'err' + Date.now(), role: 'assistant', content: data.error || 'Hubo un error.' }] }));
          }
        }
      }
    } finally { setBusy(false); setPhase(null); }
  }, [busy, convId, loadState]);

  async function actOnApproval(actionId: string, action: 'approve' | 'cancel') {
    await fetch(`/api/suplia/actions/${actionId}/${action}`, { method: 'POST' });
    await loadState(convId);
  }
  function openArtifactById(id: string) { setOpenId(id); setTab('preview'); }

  return (
    <div className="sup-root flex h-full w-full" style={{ background: '#faf9f5', color: '#1f1e1d', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <section className={`flex flex-col min-w-0 ${openArtifact ? 'flex-[0_0_54%]' : 'flex-1'}`}>
        {/* top bar */}
        <header className="h-14 flex items-center gap-2 px-4 shrink-0">
          <Star size={22} />
          <span className="font-semibold text-[15px] tracking-tight">SUPL.IA</span>
          <span className="text-[12px] text-[#9b998f]">· GLM</span>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="max-w-[720px] mx-auto px-7 py-4 pb-44">
            {state.messages.map((m) => (
              <div key={m.id} className="sup-rise mb-7">
                {m.role === 'user' ? (
                  <div className="flex justify-end">
                    <div className="rounded-2xl px-4 py-2.5 text-[16px] leading-relaxed max-w-[80%]" style={{ background: '#f0eee6', border: '1px solid #e7e4d8' }}>{m.content}</div>
                  </div>
                ) : (
                  <>
                    {thoughts[m.id] && <ThoughtSummary thought={thoughts[m.id]} />}
                    <Assistant message={m} animate={revealId === m.id} artifacts={artifacts} onOpenArtifact={openArtifactById} onApprove={actOnApproval} onAnswer={(p) => send('', p)} onRevealed={() => setRevealId((r) => (r === m.id ? null : r))} />
                  </>
                )}
              </div>
            ))}
            {busy && <LiveThinking phase={phase} />}
          </div>
        </div>

        {/* composer */}
        <div className="px-7 pb-5" style={{ background: 'linear-gradient(to top,#faf9f5 62%,transparent)' }}>
          <div className="max-w-[720px] mx-auto rounded-[20px] p-1.5" style={{ background: '#fff', border: '1px solid #d9d6c8', boxShadow: '0 1px 2px rgba(0,0,0,.05),0 10px 30px rgba(0,0,0,.06)' }}>
            <textarea value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
              rows={1} placeholder="Pídeme prospectar, investigar, contactar o hacer seguimiento…"
              className="w-full resize-none outline-none bg-transparent text-[16px] leading-relaxed px-3 pt-2.5 pb-1 max-h-40" />
            <div className="flex items-center px-1.5 pb-1">
              <span className="text-[11px] text-[#9b998f]">SUPL.IA puede equivocarse. Verifica los datos.</span>
              <button onClick={() => send(input)} disabled={busy || !input.trim()}
                className="ml-auto w-9 h-9 rounded-[10px] flex items-center justify-center text-white transition active:scale-95"
                style={{ background: busy || !input.trim() ? '#d9d6c8' : ACCENT }} aria-label="Enviar">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* artifact panel (estilo Claude) */}
      {openArtifact && (
        <aside className="sup-slide flex-1 min-w-0 flex flex-col" style={{ background: '#fff', borderLeft: '1px solid #e7e4d8' }}>
          <div className="flex items-center gap-2.5 px-4 py-3" style={{ borderBottom: '1px solid #e7e4d8' }}>
            <button onClick={() => setOpenId(null)} className="text-[#6b6a64] hover:text-[#1f1e1d]" aria-label="Cerrar"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
            <div className="min-w-0 flex-1"><div className="text-sm font-semibold truncate">{openArtifact.title}</div><div className="text-[11px] text-[#9b998f]">{openArtifact.type}</div></div>
            <div className="flex rounded-[9px] p-[3px] gap-[2px]" style={{ background: '#f3f1ea' }}>
              {(['preview', 'data'] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)} className="px-3 py-[5px] rounded-[7px] text-[12.5px] font-medium" style={tab === t ? { background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.06)' } : { color: '#6b6a64' }}>{t === 'preview' ? 'Vista previa' : 'Datos'}</button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-auto" style={{ background: tab === 'data' ? '#2b2a27' : '#fff' }}>
            {tab === 'preview'
              ? <iframe title={openArtifact.title} className="w-full h-full border-0 block bg-white" srcDoc={buildArtifactDoc(openArtifact.type, (openArtifact as any).data, openArtifact.content)} />
              : <pre className="p-[18px] text-[13px] leading-relaxed" style={{ color: '#e8e6df', fontFamily: 'ui-monospace,Menlo,Consolas,monospace' }}>{prettyData(openArtifact)}</pre>}
          </div>
          <div className="flex items-center gap-2 px-4 py-2.5" style={{ borderTop: '1px solid #e7e4d8' }}>
            <button disabled={openIdx <= 0} onClick={() => setOpenId(artifacts[openIdx - 1]?.id || null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6b6a64] disabled:opacity-30" aria-label="Anterior"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg></button>
            <span className="text-[12.5px] text-[#6b6a64] min-w-[52px] text-center">{openIdx + 1} / {artifacts.length}</span>
            <button disabled={openIdx >= artifacts.length - 1} onClick={() => setOpenId(artifacts[openIdx + 1]?.id || null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6b6a64] disabled:opacity-30" aria-label="Siguiente"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg></button>
            <div className="flex-1" />
            <button onClick={() => navigator.clipboard?.writeText(prettyData(openArtifact)).catch(() => {})} className="text-[12.5px] font-medium text-[#6b6a64] px-3 py-1.5 rounded-lg hover:bg-[#f3f1ea]">Copiar</button>
            <button className="text-[12.5px] font-medium text-white px-3 py-1.5 rounded-lg" style={{ background: ACCENT }}>Guardar en CRM</button>
          </div>
        </aside>
      )}

      <style>{`
        .sup-root{ -webkit-font-smoothing:antialiased }
        .sup-serif{ font-family:'Source Serif 4', Georgia, serif }
        @keyframes sup-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
        .sup-rise{animation:sup-rise .4s ease both}
        @keyframes sup-slide{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:none}}
        .sup-slide{animation:sup-slide .3s ease}
        @keyframes sup-blink{0%,50%{opacity:1}51%,100%{opacity:0}}
        .sup-caret{display:inline-block;width:8px;height:18px;background:${ACCENT};margin-left:2px;vertical-align:-3px;border-radius:1px;animation:sup-blink 1s steps(2) infinite}
        @keyframes sup-shimmer{to{background-position:-200% 0}}
        .sup-shimmer{background:linear-gradient(90deg,#9b998f 25%,#1f1e1d 50%,#9b998f 75%);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:sup-shimmer 1.4s linear infinite}
        @keyframes sup-spin{to{transform:rotate(360deg)}}
        .sup-spin{animation:sup-spin .7s linear infinite}
        @keyframes sup-pulse{0%,100%{transform:scale(.9);opacity:.6}50%{transform:scale(1.12);opacity:1}}
        .sup-pulse{animation:sup-pulse 1.3s ease-in-out infinite}
      `}</style>
    </div>
  );
}

function prettyData(a: Artifact): string {
  const d = (a as any).data;
  if (d && typeof d === 'object') return JSON.stringify(d, null, 2);
  return a.content || '';
}

/* ---------- thinking ---------- */
function LiveThinking({ phase }: { phase: string | null }) {
  return (
    <div className="flex items-center gap-2.5 text-[#6b6a64] text-sm mb-7 sup-rise" style={{ fontFamily: 'Inter,sans-serif' }}>
      <span className="sup-pulse"><Star size={17} /></span>
      <span className="sup-shimmer font-medium">{phase || 'Pensando'}…</span>
    </div>
  );
}
function ThoughtSummary({ thought }: { thought: Thought }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl mb-3 overflow-hidden" style={{ border: '1px solid #e7e4d8', background: '#fff', fontFamily: 'Inter,sans-serif' }}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-3.5 py-2.5 text-[13.5px] font-medium text-[#6b6a64] hover:bg-[#f3f1ea]">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
        Pensó durante {thought.seconds} segundo{thought.seconds === 1 ? '' : 's'}
        <svg className="ml-auto transition" style={{ transform: open ? 'rotate(180deg)' : 'none' }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9b998f" strokeWidth="2" strokeLinecap="round"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && <div className="px-4 pb-3 pl-10 text-[13px] text-[#6b6a64] flex flex-col gap-1">{thought.phases.map((p, i) => <div key={i}>· {p}</div>)}</div>}
    </div>
  );
}

/* ---------- assistant message ---------- */
function Assistant({ message, animate, artifacts, onOpenArtifact, onApprove, onAnswer, onRevealed }: any) {
  const parts: Part[] | undefined = message.metadata?.parts;
  if (!parts || parts.length === 0) {
    return <div className="sup-serif text-[17px] leading-[1.72]"><RevealText text={message.content} animate={animate} onDone={onRevealed} /></div>;
  }
  return (
    <div className="sup-serif text-[17px] leading-[1.72] flex flex-col gap-3">
      {parts.map((p, i) => <PartView key={i} part={p} animate={animate && i === parts.findIndex((x) => x.type === 'text')} artifacts={artifacts} onOpenArtifact={onOpenArtifact} onApprove={onApprove} onAnswer={onAnswer} onRevealed={onRevealed} />)}
    </div>
  );
}

function PartView({ part, animate, onOpenArtifact, onApprove, onAnswer, onRevealed }: any) {
  switch (part.type) {
    case 'text': return <p className="m-0"><RevealText text={part.text} animate={animate} onDone={onRevealed} /></p>;
    case 'table': return (
      <div className="rounded-lg overflow-hidden text-[14px]" style={{ border: '1px solid #e7e4d8', fontFamily: 'Inter,sans-serif' }}>
        <table className="w-full border-collapse"><thead><tr>{(part.headers || []).map((h: string, i: number) => <th key={i} className="text-left px-3.5 py-2.5 font-semibold" style={{ background: '#f3f1ea', borderBottom: '1px solid #e7e4d8' }}>{h}</th>)}</tr></thead>
          <tbody>{(part.rows || []).map((r: string[], ri: number) => <tr key={ri}>{r.map((c, ci) => <td key={ci} className="px-3.5 py-2.5" style={{ borderBottom: '1px solid #f0eee6' }}>{c}</td>)}</tr>)}</tbody></table>
      </div>);
    case 'code': return <pre className="rounded-lg p-4 overflow-x-auto text-[13px] leading-relaxed" style={{ background: '#2b2a27', color: '#e8e6df', fontFamily: 'ui-monospace,Menlo,monospace' }}>{part.content}</pre>;
    case 'tool-call': return <Chip kind="tool" label={`${toolLabel(part.toolName)}${part.status ? ' · ' + part.status : ''}`} />;
    case 'job-progress': return <Chip kind="job" label={part.label || `Trabajo ${part.status || 'en curso'}`} />;
    case 'artifact-card': return (
      <button onClick={() => part.artifactId && onOpenArtifact(part.artifactId)} className="flex items-center gap-3 rounded-xl px-3.5 py-3 max-w-[440px] text-left transition hover:shadow-md" style={{ border: '1px solid #d9d6c8', background: '#fff', fontFamily: 'Inter,sans-serif' }}>
        <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#f4e4dc', color: ACCENT }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg></span>
        <span className="min-w-0"><span className="block text-sm font-semibold truncate">{part.title}</span><span className="block text-[12.5px] text-[#9b998f]">{part.artifactType} · abrir</span></span>
        <svg className="ml-auto text-[#9b998f]" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M9 7h8v8" /></svg>
      </button>);
    case 'approval-request': return (
      <div className="rounded-xl p-3.5 max-w-[460px]" style={{ border: '1px solid #d9d6c8', background: '#fff', fontFamily: 'Inter,sans-serif' }}>
        <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: '#c4623f' }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>Requiere tu aprobación</div>
        <p className="text-[14px] mt-1.5">{part.title}</p>
        <div className="flex gap-2 mt-3"><button onClick={() => onApprove(part.actionId, 'approve')} className="text-xs font-semibold text-white px-3.5 py-1.5 rounded-lg" style={{ background: ACCENT }}>Aprobar</button><button onClick={() => onApprove(part.actionId, 'cancel')} className="text-xs font-semibold px-3.5 py-1.5 rounded-lg" style={{ border: '1px solid #d9d6c8' }}>Cancelar</button></div>
      </div>);
    case 'ask': return <AskCard part={part} onAnswer={onAnswer} />;
    default: return null;
  }
}

function RevealText({ text, animate, onDone }: { text: string; animate: boolean; onDone?: () => void }) {
  const [shown, setShown] = useState(animate ? '' : text);
  useEffect(() => {
    if (!animate) { setShown(text); return; }
    const words = text.split(/(\s+)/); let i = 0; setShown('');
    const id = setInterval(() => {
      i += 1; setShown(words.slice(0, i).join(''));
      if (i >= words.length) { clearInterval(id); onDone?.(); }
    }, 16);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, animate]);
  const revealing = animate && shown.length < text.length;
  return <span>{shown}{revealing && <span className="sup-caret" />}</span>;
}

function AskCard({ part, onAnswer }: any) {
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [other, setOther] = useState('');
  const [done, setDone] = useState(false);
  const options: { label: string; description?: string }[] = part.options || [];
  function toggle(i: number) { setSel((prev) => { const next = new Set(part.multi ? prev : []); next.has(i) ? next.delete(i) : next.add(i); return next; }); }
  function submit() {
    const answers = [...sel].map((i) => options[i].label); if (other.trim()) answers.push(other.trim());
    if (!answers.length) return; setDone(true);
    onAnswer({ askId: part.askId, answers: [{ header: part.header || null, question: part.question || '', answers }] });
  }
  return (
    <div className="rounded-2xl p-4 max-w-[520px]" style={{ border: '1px solid #d9d6c8', background: '#fff', fontFamily: 'Inter,sans-serif' }}>
      {part.header && <span className="inline-block text-[11px] font-bold uppercase tracking-wide px-2.5 py-0.5 rounded-full mb-2" style={{ background: '#f4e4dc', color: ACCENT }}>{part.header}</span>}
      {part.question && <div className="text-[15px] font-semibold mb-2.5">{part.question}</div>}
      {!done ? (
        <>
          <div className="flex flex-col gap-2">
            {options.map((o, i) => (
              <button key={i} onClick={() => toggle(i)} className="flex text-left rounded-xl px-3 py-2.5 transition" style={sel.has(i) ? { border: `1px solid ${ACCENT}`, background: '#f4e4dc' } : { border: '1px solid #d9d6c8' }}>
                <span className="flex-1"><span className="block text-[13.5px] font-medium">{o.label}</span>{o.description && <span className="block text-[12px] text-[#9b998f]">{o.description}</span>}</span>
              </button>
            ))}
            {part.allowOther !== false && <input value={other} onChange={(e) => setOther(e.target.value)} placeholder="Otra respuesta…" className="rounded-xl px-3 py-2.5 text-[13.5px] outline-none" style={{ border: '1px solid #d9d6c8' }} />}
          </div>
          <button onClick={submit} className="mt-3 w-full text-white font-semibold text-[14px] py-2.5 rounded-xl" style={{ background: ACCENT }}>{part.submitLabel || 'Enviar'}</button>
        </>
      ) : <div className="text-[13px] text-[#6b6a64]">Respuesta enviada.</div>}
    </div>
  );
}

function Chip({ kind, label }: { kind: 'tool' | 'job'; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[12.5px] text-[#6b6a64] rounded-full px-2.5 py-1 w-fit" style={{ background: '#f3f1ea', border: '1px solid #e7e4d8', fontFamily: 'Inter,sans-serif' }}>
      {kind === 'tool'
        ? <svg className="sup-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2.5"><circle cx="12" cy="12" r="9" strokeDasharray="42" strokeLinecap="round" /></svg>
        : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>}
      {label}
    </span>
  );
}

function toolLabel(name: string) {
  const map: Record<string, string> = {
    'prospecting.search_companies': 'Buscando empresas', 'prospecting.search_people': 'Buscando contactos',
    'lead.enrich_batch': 'Enriqueciendo', 'research.similarweb': 'Tráfico web', 'research.brand': 'Marca',
    'research.brand_mentions': 'Menciones', 'research.serp_company_news': 'Noticias', 'research.serp_competitors': 'Competidores',
    'research.competitor_analysis': 'Analizando competencia', 'email.subject_variants': 'Generando asuntos',
    'crm.search': 'Buscando en CRM', 'gmail.search_messages': 'Revisando Gmail',
  };
  return map[name] || name;
}

function Star({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill={ACCENT} aria-hidden>
      {Array.from({ length: 12 }).map((_, i) => <rect key={i} x={18.4} y={4.5} width={3.2} height={11.5} rx={1.6} transform={`rotate(${i * 30} 20 20)`} />)}
    </svg>
  );
}
