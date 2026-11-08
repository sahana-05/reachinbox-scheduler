'use client';

import { createContext, FormEvent, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { apiFetch, readError, SessionUser } from '@/lib/api';

type AuthContextValue = {
  user: SessionUser | null;
  token: string | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const TOKEN_KEY = 'reachinbox.token';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  const refreshUser = useCallback(async () => {
    const storedToken = typeof window !== 'undefined' ? window.localStorage.getItem(TOKEN_KEY) : token;
    if (storedToken) setToken(storedToken);
    try {
      const response = await apiFetch('/api/auth/me', {}, storedToken);
      if (!response.ok) {
        setUser(null);
        if (response.status === 401 && storedToken) {
          window.localStorage.removeItem(TOKEN_KEY);
          setToken(null);
        }
        return;
      }
      const payload = await response.json() as { user: SessionUser };
      setUser(payload.user);
    } catch {
      setUser(null);
    } finally {
      setReady(true);
    }
  }, [token]);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  useEffect(() => {
    if (!ready) return;
    const isPrivate = pathname.startsWith('/dashboard');
    if (isPrivate && !user) router.replace('/');
    if (pathname === '/' && user) router.replace('/dashboard');
  }, [pathname, ready, router, user]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    if (!response.ok) throw new Error(await readError(response));
    const payload = await response.json() as { token: string; user: SessionUser };
    window.localStorage.setItem(TOKEN_KEY, payload.token);
    setToken(payload.token);
    setUser(payload.user);
    setReady(true);
    router.push('/dashboard');
  }, [router]);

  const logout = useCallback(async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' }, token).catch(() => undefined);
    window.localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    router.replace('/');
  }, [router, token]);

  const value = useMemo(() => ({ user, token, ready, login, logout, refreshUser }), [user, token, ready, login, logout, refreshUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider is missing');
  return context;
}

export function LoginForm() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign in');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-5">
      <section className="w-full max-w-[460px] rounded-[10px] border border-[#e3e7eb] px-[52px] pb-[46px] pt-[48px] max-sm:px-7">
        <h1 className="mb-[25px] text-center text-[36px] font-semibold leading-[44px] tracking-[-1px] text-[#202124]">Login</h1>
        <a href="/api/auth/google" className="flex h-[45px] w-full items-center justify-center gap-[10px] rounded-[11px] bg-[#E8F5E9] text-[14px] text-[#202124] transition hover:bg-[#dff0e3]">
          <span aria-hidden="true" className="google-mark">G</span>
          <span>Login with Google</span>
        </a>
        <div className="my-[18px] flex items-center gap-[17px] text-[13px] tracking-[0.15px] text-[#a6aaae]">
          <span className="h-px flex-1 bg-[#eceff1]" />
          <span>or sign up through email</span>
          <span className="h-px flex-1 bg-[#eceff1]" />
        </div>
        <form onSubmit={onSubmit} className="space-y-[11px]">
          <label className="sr-only" htmlFor="email">Email ID</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email ID" className="h-[53px] w-full rounded-[10px] bg-[#f3f6f4] px-[18px] text-[14px] text-[#202124] outline-none placeholder:text-[#687078] focus:ring-2 focus:ring-[#b5dfbf]" />
          <label className="sr-only" htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" className="h-[53px] w-full rounded-[10px] bg-[#f3f6f4] px-[18px] text-[14px] text-[#202124] outline-none placeholder:text-[#687078] focus:ring-2 focus:ring-[#b5dfbf]" />
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <button disabled={submitting} className="mt-[15px] h-[45px] w-full rounded-[11px] bg-[#00A82D] text-[14px] font-medium text-white transition hover:bg-[#009526] disabled:opacity-60">
            {submitting ? 'Logging in…' : 'Login'}
          </button>
        </form>
      </section>
    </main>
  );
}
