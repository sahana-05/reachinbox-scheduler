'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Clock3, ExternalLink, Star } from 'lucide-react';
import { apiFetch, EmailJob, EmailStatus, readError } from '@/lib/api';
import { useAuth } from '@/components/auth-provider';

type EmailResponse = {
  items: EmailJob[];
  total: number;
  scheduledCount: number;
  sentCount: number;
  page: number;
  limit: number;
};

function cleanSnippet(value: string) {
  if (typeof document === 'undefined') return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const element = document.createElement('div');
  element.innerHTML = value;
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

export default function DashboardPage() {
  const { token, ready } = useAuth();
  const params = useSearchParams();
  const status: EmailStatus = params.get('status')?.toUpperCase() === 'SENT' ? 'SENT' : 'SCHEDULED';
  const search = params.get('search') ?? '';
  const [emails, setEmails] = useState<EmailJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [starBusy, setStarBusy] = useState<string | null>(null);
  const requestKey = useMemo(() => `${status}:${search}`, [status, search]);

  const loadEmails = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const query = new URLSearchParams({ status, page: '1', limit: '100' });
      if (search) query.set('search', search);
      const response = await apiFetch(`/api/emails?${query.toString()}`, {}, token);
      if (!response.ok) throw new Error(await readError(response));
      const payload = await response.json() as EmailResponse;
      setEmails(payload.items);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load emails');
    } finally {
      setLoading(false);
    }
  }, [requestKey, search, status, token]);

  useEffect(() => {
    if (ready) void loadEmails();
  }, [ready, loadEmails]);

  useEffect(() => {
    if (!ready) return;
    const interval = window.setInterval(() => void loadEmails(true), 4000);
    const onRefresh = () => void loadEmails(true);
    window.addEventListener('inbox-refresh', onRefresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('inbox-refresh', onRefresh);
    };
  }, [loadEmails, ready]);

  async function toggleStar(email: EmailJob) {
    setStarBusy(email.id);
    try {
      const response = await apiFetch(`/api/emails/${email.id}/star`, { method: 'PATCH' }, token);
      if (!response.ok) throw new Error(await readError(response));
      const result = await response.json() as { isStarred: boolean };
      setEmails((current) => current.map((item) => item.id === email.id ? { ...item, isStarred: result.isStarred } : item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update star');
    } finally {
      setStarBusy(null);
    }
  }

  return (
    <section aria-label={status === 'SENT' ? 'Sent emails' : 'Scheduled emails'}>
      {error && <div role="alert" className="mb-3 rounded-lg bg-[#fff2f0] px-4 py-3 text-sm text-[#b42318]">{error}</div>}
      {loading && emails.length === 0 && <div className="px-7 py-6 text-sm text-[#98a2b3]">Loading emails…</div>}
      {!loading && emails.length === 0 && !error && <div className="px-7 py-6 text-sm text-[#98a2b3]">{search ? 'No emails match your search.' : status === 'SENT' ? 'No sent emails yet.' : 'No scheduled emails yet.'}</div>}
      <div className="min-w-0">
        {emails.map((email) => {
          const isSent = email.status === 'SENT';
          const snippet = cleanSnippet(email.body);
          return (
            <article key={email.id} className="grid min-h-[62px] grid-cols-[215px_142px_minmax(100px,1fr)_36px] items-center gap-[10px] border-b border-[#edf0ee] px-[9px] max-lg:grid-cols-[175px_130px_minmax(90px,1fr)_34px] max-md:grid-cols-[140px_118px_minmax(80px,1fr)_30px] max-sm:grid-cols-[1fr_auto_30px] max-sm:gap-2 max-sm:px-1">
              <div className="min-w-0 truncate text-[14px] text-[#17212f]"><span className="font-semibold">To:</span> {email.recipientEmail}</div>
              <div className="flex min-w-0 items-center">
                {isSent ? (
                  <span className="rounded-full bg-[#f0f2f4] px-[10px] py-[5px] text-[11px] font-medium text-[#687386]">Sent</span>
                ) : (
                  <span className="inline-flex items-center gap-[5px] whitespace-nowrap rounded-full border border-[#ffc98b] bg-[#FFF3E0] px-[9px] py-[4px] text-[11px] font-medium text-[#c45b00]">
                    <Clock3 size={12} strokeWidth={1.8} />{formatDate(email.scheduledAt)}
                  </span>
                )}
                {isSent && email.etherealPreviewUrl && <a href={email.etherealPreviewUrl} target="_blank" rel="noreferrer" title="View Ethereal preview" aria-label="View Ethereal preview" className="ml-[7px] text-[#a2aab5] transition hover:text-[#00A82D]"><ExternalLink size={14} /></a>}
              </div>
              <div className="flex min-w-0 items-baseline gap-[6px] overflow-hidden whitespace-nowrap text-[14px] max-sm:col-span-2 max-sm:col-start-1 max-sm:row-start-2 max-sm:pb-3">
                <span className="shrink-0 overflow-hidden text-ellipsis font-semibold text-[#17212f]">{email.subject}</span>
                {snippet && <span className="min-w-0 overflow-hidden text-ellipsis text-[#98a2b3]">- {snippet}</span>}
              </div>
              <button onClick={() => void toggleStar(email)} disabled={starBusy === email.id} aria-label={email.isStarred ? 'Unstar email' : 'Star email'} className={`flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-[#f5f7f5] disabled:opacity-50 ${email.isStarred ? 'text-[#e5a100]' : 'text-[#c8d0db]'}`}>
                <Star size={17} strokeWidth={1.7} fill={email.isStarred ? 'currentColor' : 'none'} />
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
