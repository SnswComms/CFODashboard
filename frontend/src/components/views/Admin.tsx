'use client';

// "User management" view — admin-only user administration per AUTH-CONTRACT §5.
// Data: Better Auth admin client (authClient.admin.*) for list/role/ban/sessions/remove,
// authClient.requestPasswordReset for reset links, and the dedicated backend endpoint
// POST /api/admin/users (requireRole('admin')) for the create-user invitation flow.
// Visual idiom matches the existing views: white cards on #FAFAF8, border #E7E5DF,
// radius 12, Poppins via FONT, status pills, Departments-style modal.

import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { authClient } from '@/lib/authClient';
import { FONT } from '@/lib/format';
import { useToast } from '@/components/Toast';

// Shape of a row as returned by authClient.admin.listUsers (admin plugin user).
interface AdminUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role?: string | null;
  banned?: boolean | null;
  banReason?: string | null;
  createdAt: Date | string;
}


type Modal =
  | { kind: 'create' }
  | { kind: 'ban'; user: AdminUser }
  | { kind: 'remove'; user: AdminUser }
  | null;

const LIST_LIMIT = 100;

// ---- shared style fragments (design tokens) ----

const cardStyle: CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E7E5DF',
  borderRadius: 12,
  // NOTE: overflow must stay 'visible' so the row-action dropdown menu
  // (position: absolute inside a td) is not clipped at the card edge.
  overflow: 'visible',
};

const thStyle: CSSProperties = {
  textAlign: 'left',
  fontFamily: FONT,
  fontSize: 9.5,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: '#9AA0A8',
  fontWeight: 500,
  padding: '14px 12px',
  borderBottom: '1px solid #E7E5DF',
  whiteSpace: 'nowrap',
};

const tdStyle: CSSProperties = {
  padding: '13px 12px',
  borderBottom: '1px solid #EFEDE7',
  fontSize: 13,
  color: '#39424F',
  verticalAlign: 'middle',
};

const pillStyle = (fg: string, bg: string): CSSProperties => ({
  display: 'inline-block',
  fontFamily: FONT,
  fontSize: 10.5,
  fontWeight: 500,
  letterSpacing: '.05em',
  textTransform: 'uppercase',
  color: fg,
  background: bg,
  borderRadius: 999,
  padding: '3px 10px',
  whiteSpace: 'nowrap',
});

const primaryBtn: CSSProperties = {
  border: 0,
  borderRadius: 10,
  background: '#1B2430',
  color: '#FBFBF9',
  padding: '10px 18px',
  fontFamily: FONT,
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
};

const secondaryBtn: CSSProperties = {
  background: '#F5F4EF',
  border: '1px solid #E7E5DF',
  borderRadius: 8,
  padding: '8px 13px',
  fontSize: 12.5,
  color: '#39424F',
  cursor: 'pointer',
  fontFamily: FONT,
};

const dangerBtn: CSSProperties = {
  ...primaryBtn,
  background: '#A8443B',
};

const menuItemStyle = (disabled: boolean, danger = false): CSSProperties => ({
  display: 'block',
  width: '100%',
  textAlign: 'left',
  border: 0,
  background: 'transparent',
  fontFamily: FONT,
  fontSize: 12.5,
  color: disabled ? '#B9BDC3' : danger ? '#A8443B' : '#39424F',
  padding: '9px 14px',
  cursor: disabled ? 'default' : 'pointer',
});

const fieldLabel: CSSProperties = { fontSize: 12, color: '#5B626C', marginBottom: 6 };

const bannerStyle = (tone: 'good' | 'bad'): CSSProperties => ({
  background: tone === 'good' ? '#EEF3EF' : '#F7ECEA',
  color: tone === 'good' ? '#3E7A55' : '#A8443B',
  borderRadius: 8,
  padding: '10px 14px',
  fontSize: 12.5,
  marginBottom: 16,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 16,
});

const fmtDate = (d: Date | string): string => {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
};

const initials = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase() || '?';

export default function Admin() {
  const toast = useToast();
  const session = authClient.useSession();
  const currentUserId: string | undefined = session.data?.user?.id;

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<Modal>(null);

  // create-user modal state
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user');
  const [modalError, setModalError] = useState('');
  // ban modal state
  const [banReason, setBanReason] = useState('');
  // remove modal state (type-to-confirm)
  const [removeConfirm, setRemoveConfirm] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const res = await authClient.admin.listUsers({
        query: { limit: LIST_LIMIT, sortBy: 'createdAt', sortDirection: 'desc' },
      });
      if (res.error) {
        setLoadError(res.error.message || 'Could not load users.');
      } else {
        const data = res.data as unknown as { users?: AdminUser[]; total?: number } | null;
        setUsers(data?.users ?? []);
        setTotal(data?.total ?? data?.users?.length ?? 0);
      }
    } catch {
      setLoadError('Could not load users. Check that the backend is running.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const closeModal = () => {
    setModal(null);
    setModalError('');
    setBanReason('');
    setRemoveConfirm('');
  };

  const openCreate = () => {
    setNewName('');
    setNewEmail('');
    setNewRole('user');
    setModalError('');
    setModal({ kind: 'create' });
  };

  // Runs a Better Auth admin client call, surfaces the outcome as a toast,
  // and refreshes the table on success.
  const runAction = async (
    label: string,
    fn: () => Promise<{ error?: { message?: string } | null } | null | undefined>,
    successText: string,
  ) => {
    setBusy(true);
    try {
      const res = await fn();
      if (res && res.error) {
        toast.error(res.error.message || `Could not ${label}.`, 'User management');
      } else {
        toast.success(successText);
        await load();
      }
    } catch {
      toast.error(`Could not ${label}.`, 'User management');
    }
    setBusy(false);
  };

  const createUser = async () => {
    const name = newName.trim();
    const email = newEmail.trim();
    if (!name || !email) {
      setModalError('Enter the user’s name and email.');
      return;
    }
    setBusy(true);
    setModalError('');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, role: newRole }),
      });
      if (!res.ok) {
        let msg = 'Could not create the user.';
        try {
          const body = (await res.json()) as { error?: string };
          if (body && body.error) msg = body.error;
        } catch {
          /* non-JSON error body */
        }
        setModalError(msg);
      } else {
        closeModal();
        toast.success(
          `${email} will receive a welcome email to set their password.`,
          'Invitation sent',
        );
        await load();
      }
    } catch {
      setModalError('Could not reach the server. Check that the backend is running.');
    }
    setBusy(false);
  };

  const sendResetLink = (u: AdminUser) =>
    runAction(
      'send the reset link',
      () => authClient.requestPasswordReset({ email: u.email, redirectTo: '/?screen=set-password' }),
      `Password reset link sent to ${u.email}.`,
    );

  const toggleRole = (u: AdminUser) => {
    const role = u.role === 'admin' ? 'user' : 'admin';
    return runAction(
      'change the role',
      () => authClient.admin.setRole({ userId: u.id, role }),
      `${u.name || u.email} is now ${role === 'admin' ? 'an administrator' : 'a standard user'}.`,
    );
  };

  const banUser = (u: AdminUser, reason: string) =>
    runAction(
      'suspend the account',
      () => authClient.admin.banUser({ userId: u.id, banReason: reason || undefined }),
      `${u.email} has been suspended.`,
    );

  const unbanUser = (u: AdminUser) =>
    runAction(
      'reinstate the account',
      () => authClient.admin.unbanUser({ userId: u.id }),
      `${u.email} has been reinstated.`,
    );

  const revokeSessions = (u: AdminUser) =>
    runAction(
      'revoke sessions',
      () => authClient.admin.revokeUserSessions({ userId: u.id }),
      `All sessions for ${u.email} have been signed out.`,
    );

  const removeUser = (u: AdminUser) =>
    runAction(
      'remove the user',
      () => authClient.admin.removeUser({ userId: u.id }),
      `${u.email} has been removed.`,
    );

  // ---- derived rows ----
  const q = search.toLowerCase().trim();
  const rows = users.filter(
    (u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
  );

  return (
    <div>
      {/* header: blurb + search + add */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 20,
          marginBottom: 24,
          flexWrap: 'wrap',
        }}
      >
        <p style={{ fontSize: 13.5, color: '#757C86', margin: 0, maxWidth: 520, lineHeight: 1.5 }}>
          {loading ? 'Loading account list…' : `${total} account${total === 1 ? '' : 's'}`} · Invite
          finance staff, manage roles and suspend access. Public registration is disabled — every
          account is created here.
        </p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <input
            className="num-input"
            style={{ width: 240 }}
            placeholder="Search name or email…"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
          <button onClick={openCreate} style={{ ...primaryBtn, whiteSpace: 'nowrap' }}>
            Add user
          </button>
        </div>
      </div>

      {loadError && (
        <div style={bannerStyle('bad')}>
          <span>{loadError}</span>
          <span
            onClick={() => {
              setLoading(true);
              load();
            }}
            style={{ cursor: 'pointer', fontWeight: 500, flex: 'none' }}
          >
            Retry
          </span>
        </div>
      )}

      {/* users table */}
      <div style={cardStyle}>
        {loading && (
          <div style={{ padding: '40px 20px', textAlign: 'center', fontSize: 13, color: '#9AA0A8' }}>
            Loading users…
          </div>
        )}
        {!loading && rows.length === 0 && (
          <div style={{ padding: '48px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 14, color: '#39424F', marginBottom: 6 }}>
              {q ? 'No accounts match your search.' : 'No accounts yet.'}
            </div>
            <div style={{ fontSize: 12.5, color: '#9AA0A8' }}>
              {q
                ? 'Try a different name or email.'
                : 'Use “Add user” to invite the first team member.'}
            </div>
          </div>
        )}
        {!loading && rows.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Role</th>
                <th style={thStyle}>Verified</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Created</th>
                <th style={{ ...thStyle, width: 44 }} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const isSelf = u.id === currentUserId;
                const isAdmin = u.role === 'admin';
                // Dim banned rows per content cell (NOT on the <tr>): ancestor
                // opacity would also fade the actions dropdown rendered inside
                // the last td, washing out the "Reinstate account" menu.
                const dim: CSSProperties | undefined = u.banned ? { opacity: 0.75 } : undefined;
                return (
                  <tr key={u.id}>
                    <td style={{ ...tdStyle, color: '#1B2430', ...dim }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: '50%',
                            background: '#F1EFEA',
                            color: '#5B626C',
                            fontSize: 10.5,
                            fontWeight: 500,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flex: 'none',
                          }}
                        >
                          {initials(u.name)}
                        </span>
                        <span style={{ fontSize: 13.5, fontWeight: 500 }}>
                          {u.name}
                          {isSelf && (
                            <span style={{ color: '#9AA0A8', fontWeight: 400 }}> (you)</span>
                          )}
                        </span>
                      </span>
                    </td>
                    <td style={{ ...tdStyle, ...dim }}>{u.email}</td>
                    <td style={{ ...tdStyle, ...dim }}>
                      {isAdmin ? (
                        <span style={pillStyle('#8A6A2A', 'rgba(201,162,75,.16)')}>Admin</span>
                      ) : (
                        <span style={pillStyle('#757C86', '#F1EFEA')}>User</span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, ...dim }}>
                      {u.emailVerified ? (
                        <span style={{ color: '#3E7A55', fontSize: 12.5 }}>✓ Verified</span>
                      ) : (
                        <span style={{ color: '#8A6A2A', fontSize: 12.5 }}>Pending</span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, ...dim }}>
                      {u.banned ? (
                        <span
                          title={u.banReason || undefined}
                          style={pillStyle('#A8443B', '#F7ECEA')}
                        >
                          Banned
                        </span>
                      ) : (
                        <span style={{ color: '#757C86', fontSize: 12.5 }}>Active</span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', ...dim }}>
                      {fmtDate(u.createdAt)}
                    </td>
                    <td style={{ ...tdStyle, position: 'relative', textAlign: 'right' }}>
                      <button
                        onClick={() => setMenuFor(menuFor === u.id ? null : u.id)}
                        aria-label={`Actions for ${u.email}`}
                        style={{
                          ...secondaryBtn,
                          padding: '4px 10px',
                          fontSize: 14,
                          lineHeight: 1,
                          letterSpacing: '.05em',
                        }}
                      >
                        ⋯
                      </button>
                      {menuFor === u.id && (
                        <>
                          {/* click-away layer */}
                          <div
                            onClick={() => setMenuFor(null)}
                            style={{ position: 'fixed', inset: 0, zIndex: 40 }}
                          />
                          <div
                            style={{
                              position: 'absolute',
                              right: 12,
                              top: '78%',
                              zIndex: 50,
                              background: '#FFFFFF',
                              border: '1px solid #E7E5DF',
                              borderRadius: 10,
                              boxShadow: '0 16px 40px rgba(27,36,48,.16)',
                              minWidth: 190,
                              padding: '6px 0',
                              textAlign: 'left',
                            }}
                          >
                            <button
                              disabled={busy}
                              style={menuItemStyle(busy)}
                              className="navbtn"
                              onClick={() => {
                                setMenuFor(null);
                                sendResetLink(u);
                              }}
                            >
                              Send password reset
                            </button>
                            <button
                              disabled={busy || (isSelf && isAdmin)}
                              title={isSelf && isAdmin ? 'You cannot demote yourself.' : undefined}
                              style={menuItemStyle(busy || (isSelf && isAdmin))}
                              className="navbtn"
                              onClick={() => {
                                if (isSelf && isAdmin) return;
                                setMenuFor(null);
                                toggleRole(u);
                              }}
                            >
                              {isAdmin ? 'Make standard user' : 'Make administrator'}
                            </button>
                            <button
                              disabled={busy}
                              style={menuItemStyle(busy)}
                              className="navbtn"
                              onClick={() => {
                                setMenuFor(null);
                                revokeSessions(u);
                              }}
                            >
                              Revoke sessions
                            </button>
                            <div style={{ borderTop: '1px solid #EFEDE7', margin: '6px 0' }} />
                            {u.banned ? (
                              <button
                                disabled={busy}
                                style={menuItemStyle(busy)}
                                className="navbtn"
                                onClick={() => {
                                  setMenuFor(null);
                                  unbanUser(u);
                                }}
                              >
                                Reinstate account
                              </button>
                            ) : (
                              <button
                                disabled={busy || isSelf}
                                title={isSelf ? 'You cannot suspend yourself.' : undefined}
                                style={menuItemStyle(busy || isSelf, true)}
                                className="navbtn"
                                onClick={() => {
                                  if (isSelf) return;
                                  setMenuFor(null);
                                  setBanReason('');
                                  setModal({ kind: 'ban', user: u });
                                }}
                              >
                                Suspend account…
                              </button>
                            )}
                            <button
                              disabled={busy || isSelf}
                              title={isSelf ? 'You cannot remove yourself.' : undefined}
                              style={menuItemStyle(busy || isSelf, true)}
                              className="navbtn"
                              onClick={() => {
                                if (isSelf) return;
                                setMenuFor(null);
                                setRemoveConfirm('');
                                setModal({ kind: 'remove', user: u });
                              }}
                            >
                              Remove user…
                            </button>
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {!loading && total > LIST_LIMIT && (
        <p style={{ fontSize: 12.5, color: '#9AA0A8', margin: '14px 0 0' }}>
          Showing the {LIST_LIMIT} most recent accounts of {total}. Use search to narrow the list.
        </p>
      )}

      {/* ---- modals ---- */}
      {modal && (
        <div
          onClick={closeModal}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(27,36,48,.32)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 32,
            zIndex: 60,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(440px,96vw)',
              maxHeight: '86vh',
              overflow: 'auto',
              background: '#FFFFFF',
              border: '1px solid #E7E5DF',
              borderRadius: 14,
              boxShadow: '0 30px 60px rgba(27,36,48,.22)',
              padding: '28px 30px',
              fontFamily: FONT,
            }}
          >
            {modal.kind === 'create' && (
              <div>
                <div
                  style={{
                    fontFamily: FONT,
                    fontSize: 10,
                    letterSpacing: '.12em',
                    textTransform: 'uppercase',
                    color: '#A0885E',
                    fontWeight: 500,
                    marginBottom: 8,
                  }}
                >
                  Administration
                </div>
                <h2
                  style={{
                    fontFamily: FONT,
                    fontWeight: 300,
                    fontSize: 24,
                    lineHeight: 1.1,
                    color: '#1B2430',
                    margin: '0 0 8px',
                  }}
                >
                  Add user
                </h2>
                <p style={{ fontSize: 13, color: '#757C86', margin: '0 0 22px', lineHeight: 1.5 }}>
                  They’ll receive a confirmation email and a welcome email with a link to set their
                  own password. No password is sent by email.
                </p>
                <label style={{ display: 'block', marginBottom: 14 }}>
                  <div style={fieldLabel}>Full name</div>
                  <input
                    className="fld"
                    type="text"
                    value={newName}
                    onChange={(e) => {
                      setNewName(e.currentTarget.value);
                      setModalError('');
                    }}
                    placeholder="e.g. Grace Fletcher"
                  />
                </label>
                <label style={{ display: 'block', marginBottom: 14 }}>
                  <div style={fieldLabel}>Email</div>
                  <input
                    className="fld"
                    type="email"
                    value={newEmail}
                    onChange={(e) => {
                      setNewEmail(e.currentTarget.value);
                      setModalError('');
                    }}
                    placeholder="them@adventist.org.au"
                  />
                </label>
                <label style={{ display: 'block', marginBottom: 18 }}>
                  <div style={fieldLabel}>Role</div>
                  <select
                    className="fld"
                    value={newRole}
                    onChange={(e) => setNewRole(e.currentTarget.value === 'admin' ? 'admin' : 'user')}
                  >
                    <option value="user">User — dashboard access</option>
                    <option value="admin">Administrator — dashboard + user management</option>
                  </select>
                </label>
                {!!modalError && (
                  <div
                    style={{
                      background: '#F7ECEA',
                      color: '#A8443B',
                      borderRadius: 8,
                      padding: '10px 12px',
                      fontSize: 12.5,
                      marginBottom: 16,
                    }}
                  >
                    {modalError}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button onClick={closeModal} style={secondaryBtn}>
                    Cancel
                  </button>
                  <button onClick={createUser} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.7 : 1 }}>
                    {busy ? 'Sending invitation…' : 'Create & send invitation'}
                  </button>
                </div>
              </div>
            )}

            {modal.kind === 'ban' && (
              <div>
                <h2
                  style={{
                    fontFamily: FONT,
                    fontWeight: 300,
                    fontSize: 24,
                    lineHeight: 1.1,
                    color: '#1B2430',
                    margin: '0 0 8px',
                  }}
                >
                  Suspend {modal.user.name || modal.user.email}
                </h2>
                <p style={{ fontSize: 13, color: '#757C86', margin: '0 0 20px', lineHeight: 1.5 }}>
                  {modal.user.email} will be unable to sign in until reinstated. Their active
                  sessions are revoked.
                </p>
                <label style={{ display: 'block', marginBottom: 18 }}>
                  <div style={fieldLabel}>Reason (shown to administrators)</div>
                  <input
                    className="fld"
                    type="text"
                    value={banReason}
                    onChange={(e) => setBanReason(e.currentTarget.value)}
                    placeholder="e.g. Left the organisation"
                  />
                </label>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button onClick={closeModal} style={secondaryBtn}>
                    Cancel
                  </button>
                  <button
                    disabled={busy}
                    style={{ ...dangerBtn, opacity: busy ? 0.7 : 1 }}
                    onClick={async () => {
                      const { user } = modal;
                      const reason = banReason.trim();
                      closeModal();
                      await banUser(user, reason);
                    }}
                  >
                    {busy ? 'Suspending…' : 'Suspend account'}
                  </button>
                </div>
              </div>
            )}

            {modal.kind === 'remove' && (
              <div>
                <h2
                  style={{
                    fontFamily: FONT,
                    fontWeight: 300,
                    fontSize: 24,
                    lineHeight: 1.1,
                    color: '#1B2430',
                    margin: '0 0 8px',
                  }}
                >
                  Remove {modal.user.name || modal.user.email}
                </h2>
                <p style={{ fontSize: 13, color: '#757C86', margin: '0 0 20px', lineHeight: 1.5 }}>
                  This permanently deletes the account and cannot be undone. Type{' '}
                  <strong style={{ color: '#1B2430', fontWeight: 500 }}>{modal.user.email}</strong>{' '}
                  to confirm.
                </p>
                <label style={{ display: 'block', marginBottom: 18 }}>
                  <div style={fieldLabel}>Confirm email</div>
                  <input
                    className="fld"
                    type="text"
                    value={removeConfirm}
                    onChange={(e) => setRemoveConfirm(e.currentTarget.value)}
                    placeholder={modal.user.email}
                    autoComplete="off"
                  />
                </label>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button onClick={closeModal} style={secondaryBtn}>
                    Cancel
                  </button>
                  <button
                    disabled={busy || removeConfirm.trim().toLowerCase() !== modal.user.email.toLowerCase()}
                    style={{
                      ...dangerBtn,
                      opacity:
                        busy || removeConfirm.trim().toLowerCase() !== modal.user.email.toLowerCase()
                          ? 0.5
                          : 1,
                      cursor:
                        busy || removeConfirm.trim().toLowerCase() !== modal.user.email.toLowerCase()
                          ? 'default'
                          : 'pointer',
                    }}
                    onClick={async () => {
                      const { user } = modal;
                      closeModal();
                      await removeUser(user);
                    }}
                  >
                    {busy ? 'Removing…' : 'Remove user'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
