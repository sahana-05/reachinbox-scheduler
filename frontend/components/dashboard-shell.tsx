'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Clock3, Filter, LogOut, Mail, RefreshCw, Search, Send, Slack, UserRound, X } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/components/auth-provider';

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isCompose = pathname.startsWith('/dashboard/compose');
  if (isCompose) return <>{children}</>;
  return <DashboardFrame>{children}</DashboardFrame>;
}

function DashboardFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, logout, token, ready } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchValue, setSearchValue] = useState(searchParams.get('search') ?? '');
  const [scheduledCount, setScheduledCount] = useState(0);
  const [sentCount, setSentCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const activeStatus = searchParams.get('status')?.toUpperCase() === 'SENT' ? 'SENT' : 'SCHEDULED';

  const refreshCounts = useCallback(async () => {
    const [scheduled, sent] = await Promise.all([
      apiFetch('/api/emails?status=SCHEDULED&limit=1', {}, token),
      apiFetch('/api/emails?status=SENT&limit=1', {}, token)
    ]);
    if (scheduled.ok) setScheduledCount((await scheduled.json() as { scheduledCount?: number }).scheduledCount ?? 0);
    if (sent.ok) setSentCount((await sent.json() as { sentCount?: number }).sentCount ?? 0);
  }, [token]);

  useEffect(() => {
    if (ready && user) void refreshCounts();
  }, [ready, refreshCounts, user]);

  useEffect(() => {
    if (!ready || !user) return;
    const interval = window.setInterval(() => void refreshCounts(), 4000);
    return () => window.clearInterval(interval);
  }, [ready, refreshCounts, user]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (searchValue.trim()) params.set('search', searchValue.trim());
      else params.delete('search');
      router.replace(`${pathname}${params.size ? `?${params.toString()}` : ''}`, { scroll: false });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [pathname, router, searchParams, searchValue]);

  useEffect(() => {
    function closeMenu(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', closeMenu);
    return () => document.removeEventListener('mousedown', closeMenu);
  }, []);

  async function refresh() {
    setRefreshing(true);
    await refreshCounts().catch(() => undefined);
    window.dispatchEvent(new CustomEvent('inbox-refresh'));
    window.setTimeout(() => setRefreshing(false), 400);
  }

  const initials = user?.name?.trim().slice(0, 1).toUpperCase() || 'U';
  return (
    <div className="min-h-screen bg-white text-ink">
      <div className="mx-auto flex min-h-screen w-full max-w-[1720px]">
        <aside className="flex w-[294px] shrink-0 flex-col px-[20px] pb-6 pt-[22px] max-lg:w-[245px] max-md:w-[208px] max-sm:w-[70px] max-sm:px-2">
          <Link href="/dashboard" className="mb-[9px] px-[12px] font-mono text-[38px] font-black leading-none tracking-[-4px] text-black max-sm:px-0 max-sm:text-center max-sm:text-[24px]">ONG</Link>
          <div className="relative mb-[11px]" ref={menuRef}>
            <button onClick={() => setMenuOpen((open) => !open)} className="flex h-[63px] w-full items-center gap-[10px] rounded-[19px] bg-[#f3f6f4] px-[12px] text-left transition hover:bg-[#eef2ef] max-sm:justify-center max-sm:px-0">
              <Avatar name={user?.name ?? 'User'} src={user?.avatarUrl} size="large" />
              <span className="min-w-0 flex-1 max-sm:hidden">
                <span className="block truncate text-[14px] font-medium text-[#202124]">{user?.name ?? 'Your account'}</span>
                <span className="mt-[2px] block truncate text-[11px] text-[#7f8790]">{user?.email ?? ''}</span>
              </span>
              <ChevronDown size={16} className="shrink-0 text-[#98a0a8] max-sm:hidden" />
            </button>
            {menuOpen && <div className="absolute left-0 top-[69px] z-30 w-[250px] rounded-xl border border-[#e5e9e6] bg-white p-2 shadow-popover max-sm:left-12">
              <div className="border-b border-[#eef0ee] px-3 py-2 text-xs text-[#88919b]">Workspace</div>
              <a href="http://localhost:4000/api/slack/connect" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-[#f5f7f5]"><Slack size={16} />Connect Slack</a>
              <a href="http://localhost:4000/admin/queues" target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-[#f5f7f5]"><Mail size={16} />Queue Monitor</a>
              <button onClick={() => void logout()} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-[#b42318] hover:bg-[#fff5f4]"><LogOut size={16} />Logout</button>
            </div>}
          </div>
          <Link href="/dashboard/compose" className="flex h-[39px] w-full items-center justify-center rounded-full border border-[#00A82D] text-[14px] font-medium text-[#00A82D] transition hover:bg-[#f4fbf5] max-sm:rounded-xl max-sm:px-0">
            <span className="max-sm:hidden">Compose</span><span className="hidden max-sm:inline"><Mail size={18} /></span>
          </Link>
          <p className="mb-[7px] mt-[28px] px-[18px] text-[12px] font-medium tracking-[0.4px] text-[#a4aaa7] max-sm:hidden">CORE</p>
          <nav className="space-y-[2px]">
            <Link href="/dashboard?status=SCHEDULED" className={`flex h-[40px] items-center gap-[13px] rounded-[14px] px-[18px] text-[14px] transition max-sm:justify-center max-sm:px-0 ${activeStatus === 'SCHEDULED' ? 'bg-[#E6F4EA] font-semibold text-[#17212f]' : 'text-[#3f4b5c] hover:bg-[#f5f7f5]'}`}>
              <Clock3 size={18} strokeWidth={1.9} /><span className="flex-1 max-sm:hidden">Scheduled</span><span className="text-[12px] font-normal text-[#728092] max-sm:hidden">{scheduledCount}</span>
            </Link>
            <Link href="/dashboard?status=SENT" className={`flex h-[40px] items-center gap-[13px] rounded-[14px] px-[18px] text-[14px] transition max-sm:justify-center max-sm:px-0 ${activeStatus === 'SENT' ? 'bg-[#E6F4EA] font-semibold text-[#17212f]' : 'text-[#3f4b5c] hover:bg-[#f5f7f5]'}`}>
              <Send size={17} strokeWidth={1.8} /><span className="flex-1 max-sm:hidden">Sent</span><span className="text-[12px] font-normal text-[#728092] max-sm:hidden">{sentCount}</span>
            </Link>
          </nav>
          <div className="mt-auto border-t border-[#f0f2f0] px-3 pt-4 text-[11px] text-[#a3aaa5] max-sm:hidden">ReachInbox</div>
        </aside>
        <main className="min-w-0 flex-1 px-[18px] pb-8 pt-[22px] max-sm:px-3">
          <header className="mb-[21px] flex h-[43px] items-center gap-[19px]">
            <div className="flex h-[43px] min-w-0 flex-1 items-center gap-[9px] rounded-full bg-[#f3f6f4] px-[18px] text-[#96a0ad]">
              <Search size={17} className="shrink-0" />
              <input aria-label="Search emails" value={searchValue} onChange={(event) => setSearchValue(event.target.value)} placeholder="Search" className="w-full min-w-0 bg-transparent text-[14px] text-[#344054] outline-none placeholder:text-[#9aa3ae]" />
              {searchValue && <button onClick={() => setSearchValue('')} aria-label="Clear search"><X size={15} /></button>}
            </div>
            <button aria-label="Filter" title="Filter emails" className="p-1 text-[#98a2b3] hover:text-[#526174]"><Filter size={17} strokeWidth={1.6} /></button>
            <button aria-label="Refresh" title="Refresh inbox" onClick={() => void refresh()} className="p-1 text-[#98a2b3] hover:text-[#526174]"><RefreshCw size={16} strokeWidth={1.7} className={refreshing ? 'animate-spin' : ''} /></button>
          </header>
          {children}
        </main>
      </div>
    </div>
  );
}

export function Avatar({ name, src, size = 'small' }: { name: string; src?: string | null; size?: 'small' | 'large' }) {
  const dimension = size === 'large' ? 'h-[36px] w-[36px]' : 'h-[25px] w-[25px]';
  if (src) return <img src={src} alt="" className={`${dimension} shrink-0 rounded-full object-cover`} />;
  return <span className={`${dimension} flex shrink-0 items-center justify-center rounded-full bg-[#d5e2d8] text-xs font-semibold text-[#477554]`}><UserRound size={size === 'large' ? 18 : 14} /></span>;
}
