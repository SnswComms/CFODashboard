'use client';

// Centralized toast notifications, reusable sitewide.
//
//   const toast = useToast();
//   toast.success('Signed in');
//   toast.error('Could not remove user', 'User management');
//
// ToastProvider is mounted once in app/layout.tsx, so any client component
// (auth screens, shell, views) can call useToast(). Toasts stack top-right,
// auto-dismiss (errors linger longer), and can be dismissed by click.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type Tone = 'good' | 'bad' | 'warn' | 'info';

type ToastItem = {
  id: number;
  tone: Tone;
  message: string;
  title?: string;
  leaving: boolean;
};

type ToastApi = {
  success: (message: string, title?: string) => void;
  error: (message: string, title?: string) => void;
  warn: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
};

const TONES: Record<Tone, { color: string; tint: string; glyph: string }> = {
  good: { color: '#3E7A55', tint: '#EEF3EF', glyph: '✓' },
  bad: { color: '#A8443B', tint: '#F7ECEA', glyph: '!' },
  warn: { color: '#8A6A2A', tint: '#F7F1E6', glyph: '!' },
  info: { color: '#1B2430', tint: '#F1EFEA', glyph: 'i' },
};

const AUTO_DISMISS_MS: Record<Tone, number> = {
  good: 4500,
  info: 4500,
  warn: 6000,
  bad: 6500,
};

const LEAVE_MS = 220;
const MAX_STACK = 4;

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const remove = useCallback((id: number) => {
    const pending = timers.current.get(id);
    if (pending) clearTimeout(pending);
    timers.current.delete(id);
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => {
      setToasts((list) => list.filter((t) => t.id !== id));
    }, LEAVE_MS);
  }, []);

  const push = useCallback(
    (tone: Tone, message: string, title?: string) => {
      const id = nextId.current++;
      setToasts((list) => {
        const next = [...list, { id, tone, message, title, leaving: false }];
        const active = next.filter((t) => !t.leaving);
        // Drop the oldest immediately when the stack overflows.
        if (active.length > MAX_STACK) {
          const oldest = active[0];
          const pending = timers.current.get(oldest.id);
          if (pending) clearTimeout(pending);
          timers.current.delete(oldest.id);
          return next.filter((t) => t.id !== oldest.id);
        }
        return next;
      });
      timers.current.set(
        id,
        setTimeout(() => remove(id), AUTO_DISMISS_MS[tone])
      );
    },
    [remove]
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message, title) => push('good', message, title),
      error: (message, title) => push('bad', message, title),
      warn: (message, title) => push('warn', message, title),
      info: (message, title) => push('info', message, title),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        style={{
          position: 'fixed',
          top: 18,
          right: 18,
          zIndex: 200,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          pointerEvents: 'none',
        }}
      >
        {toasts.map((t) => {
          const tone = TONES[t.tone];
          return (
            <div
              key={t.id}
              role="status"
              onClick={() => remove(t.id)}
              style={{
                pointerEvents: 'auto',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 11,
                width: 340,
                background: '#FFFFFF',
                border: '1px solid #E7E5DF',
                borderLeft: `3px solid ${tone.color}`,
                borderRadius: 10,
                boxShadow: '0 10px 30px rgba(27,36,48,.12)',
                padding: '12px 14px',
                animation: 'cc-toast-in .22s ease',
                opacity: t.leaving ? 0 : 1,
                transform: t.leaving ? 'translateX(12px)' : 'none',
                transition: `opacity ${LEAVE_MS}ms ease, transform ${LEAVE_MS}ms ease`,
              }}
            >
              <span
                aria-hidden
                style={{
                  flex: 'none',
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: tone.tint,
                  color: tone.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 600,
                  marginTop: 1,
                }}
              >
                {tone.glyph}
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                {t.title && (
                  <span
                    style={{
                      display: 'block',
                      fontSize: 13,
                      fontWeight: 500,
                      color: '#1B2430',
                      lineHeight: 1.35,
                    }}
                  >
                    {t.title}
                  </span>
                )}
                <span
                  style={{
                    display: 'block',
                    fontSize: 12.5,
                    color: t.title ? '#5B626C' : '#1B2430',
                    lineHeight: 1.45,
                    overflowWrap: 'break-word',
                  }}
                >
                  {t.message}
                </span>
              </span>
              <span
                aria-hidden
                style={{
                  flex: 'none',
                  color: '#9AA0A8',
                  fontSize: 14,
                  lineHeight: 1,
                  marginTop: 3,
                }}
              >
                ×
              </span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
