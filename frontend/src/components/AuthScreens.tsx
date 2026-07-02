'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties, InputHTMLAttributes, KeyboardEvent } from 'react';
import { authClient } from '@/lib/authClient';
import { useToast } from '@/components/Toast';

const FONT = "var(--font-poppins), 'Poppins', sans-serif";

type Screen = 'login' | 'reset' | 'confirm' | 'set-password';

const primaryBtn = {
  width: '100%',
  border: 0,
  borderRadius: 10,
  background: '#1B2430',
  color: '#FBFBF9',
  padding: 13,
  fontFamily: FONT,
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
} as const;

const errorBox = {
  background: '#F7ECEA',
  color: '#A8443B',
  borderRadius: 8,
  padding: '10px 12px',
  fontSize: 12.5,
} as const;

const noticeBox = {
  background: '#EEF3EF',
  color: '#3E7A55',
  borderRadius: 8,
  padding: '10px 12px',
  fontSize: 12.5,
} as const;

const passwordToggleBtn: CSSProperties = {
  position: 'absolute',
  right: 8,
  top: '50%',
  transform: 'translateY(-50%)',
  width: 34,
  height: 34,
  border: 0,
  borderRadius: 8,
  background: 'transparent',
  color: '#757C86',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  cursor: 'pointer',
};

const EyeIcon = ({ hidden }: { hidden: boolean }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {hidden ? (
      <>
        <path d="M10.7 5.1C11.1 5 11.5 5 12 5c5 0 8.5 4.8 9.5 7-0.4 0.9-1.3 2.2-2.6 3.4" />
        <path d="M14.1 14.1A3 3 0 0 1 9.9 9.9" />
        <path d="M3 3l18 18" />
        <path d="M6.5 6.5C4.5 7.9 3.2 10.1 2.5 12c1 2.2 4.5 7 9.5 7 1.5 0 2.8-0.4 4-1" />
      </>
    ) : (
      <>
        <path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    )}
  </svg>
);

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  visible: boolean;
  onToggle: () => void;
};

function PasswordField({ visible, onToggle, style, ...props }: PasswordFieldProps) {
  return (
    <div style={{ position: 'relative' }}>
      <input
        {...props}
        className="fld"
        type={visible ? 'text' : 'password'}
        style={{ paddingRight: 48, ...(style as CSSProperties | undefined) }}
      />
      <button
        type="button"
        aria-label={visible ? 'Hide password' : 'Show password'}
        title={visible ? 'Hide password' : 'Show password'}
        onClick={onToggle}
        style={passwordToggleBtn}
      >
        <EyeIcon hidden={visible} />
      </button>
    </div>
  );
}

const envelopeIcon = (
  <div
    style={{
      width: 52,
      height: 52,
      borderRadius: '50%',
      background: '#F7F1E6',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      margin: '0 auto 18px',
    }}
  >
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#8A6A2A"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="5" width="18" height="14" rx="2"></rect>
      <polyline points="3 7 12 13 21 7"></polyline>
    </svg>
  </div>
);

const checkIcon = (
  <div
    style={{
      width: 52,
      height: 52,
      borderRadius: '50%',
      background: '#EEF3EF',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      margin: '0 auto 18px',
    }}
  >
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#3E7A55"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  </div>
);

export default function AuthScreens({ onAuthed }: { onAuthed: () => void }) {
  const toast = useToast();
  const [screen, setScreen] = useState<Screen>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [resetToken, setResetToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [passwordSet, setPasswordSet] = useState(false);

  // URL intake: the emailed links land back on "/" with query params.
  //  - /?screen=set-password&token=<t>   -> set-new-password screen (reset flow)
  //  - /?verified=1&error=<CODE>         -> confirm screen (expired/invalid verification link)
  //  - /?error=<CODE>                    -> reset screen with an expiry error
  //  - /?verified=1 (no error)           -> login screen with a success note
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const err = params.get('error');
    const wantsSetPassword = params.get('screen') === 'set-password';
    const verified = params.get('verified') === '1';

    if (wantsSetPassword && token) {
      setResetToken(token);
      setScreen('set-password');
    } else if (err) {
      // Better Auth redirects failed links with an error code (TOKEN_EXPIRED,
      // INVALID_TOKEN, USER_NOT_FOUND, ...). Treat any code as failure; route
      // by origin — verification links carry verified=1, reset links do not.
      if (verified) {
        setScreen('confirm');
        setError('This confirmation link has expired — use "Resend link" below.');
      } else {
        setScreen('reset');
        setError('This link is invalid or has expired.');
      }
    } else if (wantsSetPassword && !token) {
      setScreen('reset');
      setError('This link is invalid or has expired.');
    } else if (verified) {
      setScreen('login');
      setNotice('Email confirmed — you can sign in.');
      toast.success('Email confirmed — you can sign in.');
    }

    if (wantsSetPassword || token || err || verified) {
      window.history.replaceState(null, '', '/');
    }
    // toast is a stable context api; the effect still runs once on mount.
  }, [toast]);

  const doLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setError('Enter your email and password to continue.');
      return;
    }
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    const { data, error: err } = await authClient.signIn.email({ email: email.trim(), password });
    setBusy(false);
    if (!err) {
      const firstName = data?.user?.name?.split(' ')[0];
      toast.success(firstName ? `Welcome back, ${firstName}.` : 'Welcome back.', 'Signed in');
      onAuthed();
      return;
    }
    if (err.code === 'EMAIL_NOT_VERIFIED') {
      setLinkSent(false);
      setScreen('confirm');
      return;
    }
    setError(err.message || 'Invalid email or password.');
  };

  const goAuth = (s: Screen) => {
    setScreen(s);
    setError('');
    setNotice('');
    setResetSent(false);
    setLinkSent(false);
  };

  const sendReset = async () => {
    if (!email.trim()) {
      setError('Enter the email linked to your account.');
      return;
    }
    if (busy) return;
    setBusy(true);
    setError('');
    // Always shows the "sent" card regardless of outcome — no user enumeration.
    await authClient.requestPasswordReset({
      email: email.trim(),
      redirectTo: '/?screen=set-password',
    });
    setBusy(false);
    setResetSent(true);
    toast.success('If that address has an account, a reset link is on its way.', 'Reset link sent');
  };

  const resendVerification = async () => {
    if (!email.trim()) {
      setError('Enter your email on the sign-in screen first.');
      return;
    }
    if (busy) return;
    setBusy(true);
    setError('');
    await authClient.sendVerificationEmail({
      email: email.trim(),
      callbackURL: '/?verified=1',
    });
    setBusy(false);
    setLinkSent(true);
    toast.success('Confirmation link sent — check your inbox.');
  };

  const doSetPassword = async () => {
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (!resetToken) {
      setError('This link has expired. Request a new one.');
      return;
    }
    if (busy) return;
    setBusy(true);
    setError('');
    const { error: err } = await authClient.resetPassword({
      newPassword,
      token: resetToken,
    });
    setBusy(false);
    if (err) {
      setError('This link has expired. Request a new one.');
      return;
    }
    setNewPassword('');
    setConfirmPassword('');
    setPasswordSet(true);
    toast.success('Password updated — sign in with your new password.');
  };

  const onLoginKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void doLogin();
    }
  };

  const onSetPasswordKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void doSetPassword();
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#FAFAF8',
        fontFamily: FONT,
        color: '#1B2430',
        padding: 24,
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      <div style={{ width: '100%', maxWidth: 406 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            justifyContent: 'center',
            marginBottom: 26,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/sda-logo.png"
            alt="SDA"
            style={{ width: 38, height: 38, borderRadius: 9, display: 'block' }}
          />
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.1 }}>CFO Command Centre</div>
            <div
              style={{
                fontFamily: FONT,
                fontSize: 9.5,
                letterSpacing: '.1em',
                textTransform: 'uppercase',
                color: '#9AA0A8',
                marginTop: 3,
              }}
            >
              South NSW Conference
            </div>
          </div>
        </div>
        <div
          style={{
            background: '#FFFFFF',
            border: '1px solid #E7E5DF',
            borderRadius: 16,
            padding: 32,
            boxShadow: '0 24px 60px rgba(27,36,48,.07)',
          }}
        >
          {screen === 'login' && (
            <div>
              <h2 style={{ fontFamily: FONT, fontWeight: 400, fontSize: 22, margin: '0 0 6px' }}>
                Sign in
              </h2>
              <p style={{ fontSize: 13, color: '#757C86', margin: '0 0 24px', lineHeight: 1.5 }}>
                Authorised finance staff only. Use your conference account.
              </p>
              {!!notice && <div style={{ ...noticeBox, marginBottom: 16 }}>{notice}</div>}
              <label style={{ display: 'block', marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: '#5B626C', marginBottom: 6 }}>Email</div>
                <input
                  className="fld"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError('');
                  }}
                  placeholder="you@adventist.org.au"
                />
              </label>
              <label style={{ display: 'block', marginBottom: 9 }}>
                <div style={{ fontSize: 12, color: '#5B626C', marginBottom: 6 }}>Password</div>
                <PasswordField
                  visible={showPassword}
                  onToggle={() => setShowPassword((v) => !v)}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError('');
                  }}
                  onKeyDown={onLoginKey}
                  placeholder="Enter your password"
                />
              </label>
              <div style={{ textAlign: 'right', marginBottom: 18 }}>
                <span className="lnk" onClick={() => goAuth('reset')} style={{ fontSize: 12.5 }}>
                  Forgot password?
                </span>
              </div>
              {!!error && <div style={{ ...errorBox, marginBottom: 16 }}>{error}</div>}
              <button onClick={doLogin} disabled={busy} style={primaryBtn}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
              <div style={{ textAlign: 'center', marginTop: 20, fontSize: 12.5, color: '#9AA0A8' }}>
                Haven’t confirmed your email?{' '}
                <span className="lnk" onClick={() => goAuth('confirm')}>
                  Confirm now
                </span>
              </div>
            </div>
          )}

          {screen === 'reset' && (
            <div>
              {!resetSent && (
                <div>
                  <h2 style={{ fontFamily: FONT, fontWeight: 400, fontSize: 22, margin: '0 0 6px' }}>
                    Reset your password
                  </h2>
                  <p style={{ fontSize: 13, color: '#757C86', margin: '0 0 24px', lineHeight: 1.5 }}>
                    Enter your account email and we’ll send a secure reset link.
                  </p>
                  <label style={{ display: 'block', marginBottom: 9 }}>
                    <div style={{ fontSize: 12, color: '#5B626C', marginBottom: 6 }}>Email</div>
                    <input
                      className="fld"
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setError('');
                      }}
                      placeholder="you@adventist.org.au"
                    />
                  </label>
                  {!!error && <div style={{ ...errorBox, margin: '6px 0 16px' }}>{error}</div>}
                  <button onClick={sendReset} disabled={busy} style={{ ...primaryBtn, marginTop: 8 }}>
                    {busy ? 'Sending…' : 'Send reset link'}
                  </button>
                  <div style={{ textAlign: 'center', marginTop: 20, fontSize: 12.5 }}>
                    <span className="lnk" onClick={() => goAuth('login')}>
                      Back to sign in
                    </span>
                  </div>
                </div>
              )}
              {resetSent && (
                <div style={{ textAlign: 'center' }}>
                  {envelopeIcon}
                  <h2 style={{ fontFamily: FONT, fontWeight: 400, fontSize: 21, margin: '0 0 8px' }}>
                    Check your inbox
                  </h2>
                  <p style={{ fontSize: 13, color: '#757C86', margin: '0 0 22px', lineHeight: 1.55 }}>
                    If an account exists for {email}, a password reset link is on its way. The link
                    expires in 60 minutes.
                  </p>
                  <button onClick={() => goAuth('login')} style={primaryBtn}>
                    Back to sign in
                  </button>
                </div>
              )}
            </div>
          )}

          {screen === 'confirm' && (
            <div style={{ textAlign: 'center' }}>
              {envelopeIcon}
              <h2 style={{ fontFamily: FONT, fontWeight: 400, fontSize: 21, margin: '0 0 8px' }}>
                Confirm your email
              </h2>
              <p style={{ fontSize: 13, color: '#757C86', margin: '0 0 22px', lineHeight: 1.55 }}>
                {email
                  ? `We sent a confirmation link to ${email}. Click it to activate your access to the command centre.`
                  : 'We sent a confirmation link to your email. Click it to activate your access to the command centre.'}
              </p>
              {!!error && (
                <div style={{ ...errorBox, marginBottom: 16, textAlign: 'left' }}>{error}</div>
              )}
              {linkSent && <div style={{ ...noticeBox, marginBottom: 16 }}>Link sent — check your inbox.</div>}
              <button
                onClick={() => {
                  goAuth('login');
                  setNotice('Confirmed? Sign in below.');
                }}
                style={primaryBtn}
              >
                I’ve confirmed my email
              </button>
              <div style={{ marginTop: 18, fontSize: 12.5, color: '#9AA0A8' }}>
                Didn’t get it?{' '}
                <span className="lnk" onClick={resendVerification}>
                  {busy ? 'Sending…' : 'Resend link'}
                </span>{' '}
                ·{' '}
                <span className="lnk" onClick={() => goAuth('login')}>
                  Back to sign in
                </span>
              </div>
            </div>
          )}

          {screen === 'set-password' && (
            <div>
              {!passwordSet && (
                <div>
                  <h2 style={{ fontFamily: FONT, fontWeight: 400, fontSize: 22, margin: '0 0 6px' }}>
                    Set your password
                  </h2>
                  <p style={{ fontSize: 13, color: '#757C86', margin: '0 0 24px', lineHeight: 1.5 }}>
                    Choose a new password for your account. At least 8 characters.
                  </p>
                  <label style={{ display: 'block', marginBottom: 14 }}>
                    <div style={{ fontSize: 12, color: '#5B626C', marginBottom: 6 }}>
                      New password
                    </div>
                    <PasswordField
                      visible={showNewPassword}
                      onToggle={() => setShowNewPassword((v) => !v)}
                      value={newPassword}
                      onChange={(e) => {
                        setNewPassword(e.target.value);
                        setError('');
                      }}
                      placeholder="Enter a new password"
                    />
                  </label>
                  <label style={{ display: 'block', marginBottom: 9 }}>
                    <div style={{ fontSize: 12, color: '#5B626C', marginBottom: 6 }}>
                      Confirm password
                    </div>
                    <PasswordField
                      visible={showConfirmPassword}
                      onToggle={() => setShowConfirmPassword((v) => !v)}
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        setError('');
                      }}
                      onKeyDown={onSetPasswordKey}
                      placeholder="Re-enter the new password"
                    />
                  </label>
                  {!!error && <div style={{ ...errorBox, margin: '6px 0 16px' }}>{error}</div>}
                  <button
                    onClick={doSetPassword}
                    disabled={busy}
                    style={{ ...primaryBtn, marginTop: 8 }}
                  >
                    {busy ? 'Setting password…' : 'Set password'}
                  </button>
                  <div style={{ textAlign: 'center', marginTop: 20, fontSize: 12.5 }}>
                    <span className="lnk" onClick={() => goAuth('reset')}>
                      Request a new link
                    </span>
                  </div>
                </div>
              )}
              {passwordSet && (
                <div style={{ textAlign: 'center' }}>
                  {checkIcon}
                  <h2 style={{ fontFamily: FONT, fontWeight: 400, fontSize: 21, margin: '0 0 8px' }}>
                    Password set
                  </h2>
                  <p style={{ fontSize: 13, color: '#757C86', margin: '0 0 22px', lineHeight: 1.55 }}>
                    Your new password is active. You can sign in to the command centre now.
                  </p>
                  <button onClick={() => goAuth('login')} style={primaryBtn}>
                    Continue to sign in
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <div
          style={{
            textAlign: 'center',
            marginTop: 20,
            fontSize: 11.5,
            color: '#9AA0A8',
            lineHeight: 1.5,
          }}
        >
          Local-only finance workspace · access limited to authorised conference users.
        </div>
      </div>
    </div>
  );
}
