'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { navGroupDefs, viewMetaMap, isViewKey } from '@/lib/designData';
import type { ViewKey } from '@/lib/designData';
import { FONT } from '@/lib/format';
import AuthScreens from '@/components/AuthScreens';
import { authClient, useSession } from '@/lib/authClient';
import { useToast } from '@/components/Toast';

const RANGE_OPTIONS: Array<[string, string]> = [
  ['fytd', 'FY2026 to date'],
  ['month', 'This month'],
  ['quarter', 'This quarter'],
  ['12m', 'Last 12 months'],
  ['year', 'Full year FY2026'],
];

const groupLabelStyle: CSSProperties = {
  fontFamily: FONT,
  fontSize: 9,
  letterSpacing: '.14em',
  textTransform: 'uppercase',
  color: '#A8A196',
  fontWeight: 500,
  padding: '0 10px 8px',
};

export default function Shell({ view, children }: { view: ViewKey; children: ReactNode }) {
  const toast = useToast();
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [rangeKey, setRangeKey] = useState('fytd');
  const [rangeLabel, setRangeLabel] = useState('FY2026 to date');
  const [rangeOpen, setRangeOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t && t.closest && !t.closest('[data-range]')) setRangeOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // Views (e.g. Overview's "Jump to a dashboard" rows) request navigation by
  // dispatching a 'cc:navigate' CustomEvent whose detail is the target ViewKey.
  useEffect(() => {
    const onNavigate = (e: Event) => {
      const id = (e as CustomEvent).detail;
      if (typeof id === 'string' && isViewKey(id)) router.push(`/${id}`);
    };
    window.addEventListener('cc:navigate', onNavigate);
    return () => window.removeEventListener('cc:navigate', onNavigate);
  }, [router]);

  const userRole = (session?.user as { role?: string | null } | undefined)?.role;
  const isAdmin = userRole === 'admin';

  // The admin route is role-gated: send non-admins back to the overview. The
  // page content is hidden below until the redirect lands.
  const blockAdmin = !isPending && !!session && view === 'admin' && !isAdmin;
  useEffect(() => {
    if (blockAdmin) router.replace('/overview');
  }, [blockAdmin, router]);

  // New page, fresh scroll position — mirror normal browser navigation.
  useEffect(() => {
    document.getElementById('cc-scroll')?.scrollTo({ top: 0 });
  }, [view]);

  if (isPending) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#FAFAF8',
          fontFamily: FONT,
          color: '#9AA0A8',
          fontSize: 13,
        }}
      >
        Loading…
      </div>
    );
  }

  if (!session) {
    // useSession refetches automatically after sign-in; the prop is kept for
    // interface stability.
    return <AuthScreens onAuthed={() => {}} />;
  }

  const userName = session.user.name || session.user.email || '';
  const initials =
    userName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => (w[0] || '').toUpperCase())
      .join('') || '?';
  const roleLabel = isAdmin ? 'Administrator' : 'Chief Financial Officer';

  // While the /admin → /overview redirect for non-admins is in flight, present
  // the overview chrome and suppress the admin page content.
  const effectiveView: ViewKey = blockAdmin ? 'overview' : view;

  const viewMeta = viewMetaMap[effectiveView] || viewMetaMap.overview;

  const pickRange = (key: string, label: string) => {
    setRangeKey(key);
    setRangeLabel(label);
    setRangeOpen(false);
  };

  const applyCustom = () => {
    if (!customFrom || !customTo) return;
    const f = new Date(customFrom);
    const t = new Date(customTo);
    const opt: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
    const label = f.toLocaleDateString('en-AU', opt) + ' – ' + t.toLocaleDateString('en-AU', opt);
    setRangeKey('custom');
    setRangeLabel(label);
    setRangeOpen(false);
  };

  const logout = async () => {
    await authClient.signOut();
    setRangeOpen(false);
    toast.info('Signed out.');
  };

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        fontFamily: FONT,
        color: '#1B2430',
        WebkitFontSmoothing: 'antialiased',
        background: '#FAFAF8',
      }}
    >
      <aside
        style={{
          width: 250,
          flex: 'none',
          background: '#F5F4EF',
          borderRight: '1px solid #E7E5DF',
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
        }}
      >
        <div
          style={{
            padding: '22px 20px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            borderBottom: '1px solid #E7E5DF',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/sda-logo.png"
            alt="SDA"
            style={{ width: 34, height: 34, borderRadius: 8, display: 'block', flex: 'none' }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#1B2430', lineHeight: 1.1 }}>
              CFO Command Centre
            </div>
            <div
              style={{
                fontFamily: FONT,
                fontSize: 9.5,
                letterSpacing: '.1em',
                textTransform: 'uppercase',
                color: '#9AA0A8',
              }}
            >
              South NSW Conference
            </div>
          </div>
        </div>
        <nav style={{ flex: 1, overflowY: 'auto', padding: '16px 12px' }}>
          {navGroupDefs.map((group) => (
            <div key={group.label} style={{ marginBottom: 18 }}>
              <div style={groupLabelStyle}>{group.label}</div>
              {group.items.map(([id, label]) => {
                const active = effectiveView === id;
                return (
                  <button
                    key={id}
                    className="navbtn"
                    onClick={() => router.push(`/${id}`)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      width: '100%',
                      textAlign: 'left',
                      border: 0,
                      background: active ? '#1B2430' : 'transparent',
                      borderRadius: 8,
                      padding: '9px 10px',
                      marginBottom: 2,
                      cursor: 'pointer',
                      fontFamily: FONT,
                      fontSize: 13.5,
                      color: active ? '#FBFBF9' : '#4A5260',
                      fontWeight: active ? 500 : 400,
                    }}
                  >
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: '50%',
                        background: active ? '#C9A24B' : 'transparent',
                        flex: 'none',
                      }}
                    />
                    {label}
                  </button>
                );
              })}
            </div>
          ))}
          {isAdmin && (
            <div style={{ marginBottom: 18 }}>
              <div style={groupLabelStyle}>Administration</div>
              {([['admin', 'User management']] as Array<[ViewKey, string]>).map(([id, label]) => {
                const active = effectiveView === id;
                return (
                  <button
                    key={id}
                    className="navbtn"
                    onClick={() => router.push(`/${id}`)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      width: '100%',
                      textAlign: 'left',
                      border: 0,
                      background: active ? '#1B2430' : 'transparent',
                      borderRadius: 8,
                      padding: '9px 10px',
                      marginBottom: 2,
                      cursor: 'pointer',
                      fontFamily: FONT,
                      fontSize: 13.5,
                      color: active ? '#FBFBF9' : '#4A5260',
                      fontWeight: active ? 500 : 400,
                    }}
                  >
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: '50%',
                        background: active ? '#C9A24B' : 'transparent',
                        flex: 'none',
                      }}
                    />
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </nav>
        <div
          style={{
            padding: '14px 20px',
            borderTop: '1px solid #E7E5DF',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              background: '#1B2430',
              color: '#F5F4EF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 500,
              flex: 'none',
            }}
          >
            {initials}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12.5, color: '#1B2430', fontWeight: 500, lineHeight: 1.1 }}>
              {userName}
            </div>
            <div style={{ fontSize: 11, color: '#9AA0A8' }}>{roleLabel}</div>
          </div>
          <button
            className="navbtn"
            onClick={logout}
            title="Log out"
            style={{
              border: 0,
              background: 'transparent',
              cursor: 'pointer',
              padding: 7,
              borderRadius: 8,
              flex: 'none',
              lineHeight: 0,
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#757C86"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
          </button>
        </div>
      </aside>

      <main
        style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100vh', minWidth: 0 }}
      >
        <header
          style={{
            flex: 'none',
            background: 'rgba(250,250,248,.92)',
            backdropFilter: 'blur(8px)',
            borderBottom: '1px solid #E7E5DF',
          }}
        >
          <div
            style={{
              maxWidth: 1240,
              margin: '0 auto',
              padding: '18px 40px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 24,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: FONT,
                  fontSize: 10,
                  letterSpacing: '.14em',
                  textTransform: 'uppercase',
                  color: '#A0885E',
                  fontWeight: 500,
                  marginBottom: 5,
                }}
              >
                {viewMeta.eyebrow}
              </div>
              <h1
                style={{
                  fontFamily: FONT,
                  fontWeight: 300,
                  fontSize: 27,
                  lineHeight: 1,
                  letterSpacing: '-.01em',
                  color: '#1B2430',
                  margin: 0,
                }}
              >
                {viewMeta.title}
              </h1>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
              <div data-range="" style={{ position: 'relative' }}>
                <button
                  onClick={() => setRangeOpen((o) => !o)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 9,
                    fontFamily: FONT,
                    fontSize: 11.5,
                    color: '#39424F',
                    border: '1px solid #E7E5DF',
                    background: '#FFFFFF',
                    borderRadius: 999,
                    padding: '7px 13px',
                    cursor: 'pointer',
                  }}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#8A6A2A"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  >
                    <rect x="3" y="4" width="18" height="18" rx="2"></rect>
                    <line x1="3" y1="9" x2="21" y2="9"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                  </svg>
                  {rangeLabel}
                  <span style={{ color: '#B7BAC0', fontSize: 9 }}>▾</span>
                </button>
                {rangeOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      right: 0,
                      top: 'calc(100% + 8px)',
                      width: 272,
                      background: '#FFFFFF',
                      border: '1px solid #E7E5DF',
                      borderRadius: 12,
                      boxShadow: '0 22px 48px rgba(27,36,48,.16)',
                      padding: 8,
                      zIndex: 80,
                    }}
                  >
                    {RANGE_OPTIONS.map(([key, label]) => (
                      <button
                        key={key}
                        className="navbtn"
                        onClick={() => pickRange(key, label)}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          width: '100%',
                          textAlign: 'left',
                          border: 0,
                          background: 'transparent',
                          borderRadius: 8,
                          padding: '9px 11px',
                          cursor: 'pointer',
                          fontFamily: FONT,
                          fontSize: 13,
                          color: '#1B2430',
                        }}
                      >
                        {label}
                        {rangeKey === key && (
                          <span style={{ color: '#8A6A2A', fontSize: 12 }}>✓</span>
                        )}
                      </button>
                    ))}
                    <div style={{ borderTop: '1px solid #EFEDE7', margin: '8px 4px 0', paddingTop: 10 }}>
                      <div
                        style={{
                          fontFamily: FONT,
                          fontSize: 9,
                          letterSpacing: '.12em',
                          textTransform: 'uppercase',
                          color: '#9AA0A8',
                          fontWeight: 500,
                          padding: '0 7px 9px',
                        }}
                      >
                        Custom range
                      </div>
                      <div style={{ display: 'flex', gap: 8, padding: '0 7px' }}>
                        <input
                          type="date"
                          className="fld"
                          value={customFrom}
                          onChange={(e) => setCustomFrom(e.target.value)}
                          style={{ padding: '8px 9px', fontSize: 12.5 }}
                        />
                        <input
                          type="date"
                          className="fld"
                          value={customTo}
                          onChange={(e) => setCustomTo(e.target.value)}
                          style={{ padding: '8px 9px', fontSize: 12.5 }}
                        />
                      </div>
                      <div style={{ padding: '10px 7px 4px' }}>
                        <button
                          onClick={applyCustom}
                          style={{
                            width: '100%',
                            border: 0,
                            borderRadius: 8,
                            background: '#1B2430',
                            color: '#FBFBF9',
                            padding: 9,
                            fontFamily: FONT,
                            fontSize: 12.5,
                            fontWeight: 500,
                            cursor: 'pointer',
                          }}
                        >
                          Apply range
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  border: '1px solid #E7E5DF',
                  borderRadius: 999,
                  padding: '7px 12px',
                  background: '#FFFFFF',
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: '#8A6A2A',
                    display: 'block',
                  }}
                />
                <span
                  style={{
                    fontFamily: FONT,
                    fontSize: 10,
                    letterSpacing: '.08em',
                    textTransform: 'uppercase',
                    color: '#39424F',
                  }}
                >
                  Illustrative
                </span>
              </span>
            </div>
          </div>
        </header>

        <div id="cc-scroll" style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ padding: '34px 40px 72px', maxWidth: 1240, margin: '0 auto' }}>
            <div
              style={{
                marginBottom: 30,
                borderLeft: '2px solid #C9A24B',
                background: '#FAF6EC',
                borderRadius: '0 8px 8px 0',
                padding: '12px 18px',
                display: 'flex',
                gap: 10,
                alignItems: 'baseline',
              }}
            >
              <span
                style={{
                  fontFamily: FONT,
                  fontSize: 10,
                  letterSpacing: '.12em',
                  textTransform: 'uppercase',
                  color: '#8A6A2A',
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                }}
              >
                Illustrative
              </span>
              <span style={{ fontSize: 13, lineHeight: 1.5, color: '#6B5B3A' }}>
                Board-approved FY2026 budget totals shown with elapsed-year pace standing in for
                spend. No live, confidential, or MYOB-sourced figures appear in this preview.
              </span>
            </div>

            {blockAdmin ? null : children}
          </div>
        </div>
      </main>
    </div>
  );
}
