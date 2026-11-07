'use client';

import { ChangeEvent, DragEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Papa from 'papaparse';
import {
  AlignCenter, AlignLeft, AlignRight, Bold, CalendarDays, ChevronDown, Clock3, FileText,
  IndentDecrease, IndentIncrease, Italic, List, ListOrdered, Paperclip, Quote, Redo2,
  Strikethrough, Type, Underline, Undo2, Upload, X
} from 'lucide-react';
import { apiFetch, readError, Sender } from '@/lib/api';
import { useAuth } from '@/components/auth-provider';

type MailAttachment = { filename: string; content: string; contentType: string };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function localDateTime(value: Date) {
  const offset = value.getTimezoneOffset() * 60000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function getUniqueEmails(values: string[]) {
  const found: string[] = [];
  const seen = new Set<string>();
  values.forEach((value) => {
    value.split(/[\s,;]+/).forEach((part) => {
      const email = part.trim().replace(/^['"<]+|['">]+$/g, '').toLowerCase();
      if (EMAIL_PATTERN.test(email) && !seen.has(email)) {
        found.push(email);
        seen.add(email);
      }
    });
  });
  return found;
}

export default function ComposePage() {
  const { token, ready } = useAuth();
  const [senders, setSenders] = useState<Sender[]>([]);
  const [senderId, setSenderId] = useState('');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [recipientText, setRecipientText] = useState('');
  const [subject, setSubject] = useState('');
  const [delaySeconds, setDelaySeconds] = useState('00');
  const [hourlyLimit, setHourlyLimit] = useState('00');
  const [attachments, setAttachments] = useState<MailAttachment[]>([]);
  const [sendLaterOpen, setSendLaterOpen] = useState(false);
  const [selectedTime, setSelectedTime] = useState('');
  const [pendingTime, setPendingTime] = useState('');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const csvInput = useRef<HTMLInputElement>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ready) return;
    void apiFetch('/api/senders', {}, token).then(async (response) => {
      if (!response.ok) throw new Error(await readError(response));
      const payload = await response.json() as { senders: Sender[] };
      setSenders(payload.senders);
      setSenderId(payload.senders[0]?.id ?? '');
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Unable to load senders'));
  }, [ready, token]);

  const maxDate = useMemo(() => localDateTime(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)), []);

  function addRecipients(values: string[]) {
    const valid = getUniqueEmails(values);
    setRecipients((current) => {
      const merged = new Set(current);
      valid.forEach((email) => merged.add(email));
      return Array.from(merged);
    });
  }

  function commitRecipientText() {
    addRecipients([recipientText]);
    setRecipientText('');
  }

  function onRecipientKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commitRecipientText();
    }
    if (event.key === 'Backspace' && !recipientText && recipients.length) {
      setRecipients((current) => current.slice(0, -1));
    }
  }

  function readCsv(file: File) {
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (result) => {
        const rows = result.data as unknown as Array<Array<string> | string>;
        const values = rows.flatMap((row) => Array.isArray(row) ? row : [row]);
        addRecipients(values);
      },
      error: () => setError('Could not read this CSV file')
    });
  }

  function handleCsvChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) readCsv(file);
    event.target.value = '';
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file?.name.toLowerCase().endsWith('.csv')) readCsv(file);
    else if (file) setError('Upload a CSV file to add recipients');
  }

  async function readAttachments(files: FileList | null) {
    if (!files?.length) return;
    setError('');
    try {
      const converted = await Promise.all(Array.from(files).map(async (file) => {
        if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name} is larger than 5 MB`);
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = '';
        bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
        return { filename: file.name, content: window.btoa(binary), contentType: file.type || 'application/octet-stream' };
      }));
      setAttachments((current) => [...current, ...converted]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to add attachment');
    }
  }

  function runEditorCommand(command: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
  }

  async function send(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    commitRecipientText();
    const finalRecipients = getUniqueEmails([...recipients, recipientText]);
    if (!senderId) {
      setError('Choose a sender before scheduling this email');
      return;
    }
    if (!finalRecipients.length) {
      setError('Add at least one valid recipient email');
      return;
    }
    if (!subject.trim()) {
      setError('Add an email subject');
      return;
    }
    const body = editorRef.current?.innerHTML.trim() ?? '';
    if (!body || body === '<br>') {
      setError('Write a message before scheduling this email');
      return;
    }
    if (selectedTime && new Date(selectedTime).getTime() < Date.now()) {
      setError('Choose a future date and time');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch('/api/emails/schedule', {
        method: 'POST',
        body: JSON.stringify({
          senderId,
          recipients: finalRecipients,
          subject: subject.trim(),
          body,
          startTime: selectedTime ? new Date(selectedTime).toISOString() : new Date().toISOString(),
          delaySeconds: Number(delaySeconds) || 0,
          hourlyLimit: Number(hourlyLimit) || 0,
          attachments
        })
      }, token);
      if (!response.ok) throw new Error(await readError(response));
      window.location.assign('/dashboard?status=SCHEDULED');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to schedule this email');
      setBusy(false);
    }
  }

  function setQuickTime(hoursFromNow: number) {
    const date = new Date();
    date.setHours(date.getHours() + hoursFromNow, 0, 0, 0);
    setPendingTime(localDateTime(date));
  }

  return (
    <main className="min-h-screen bg-white px-[28px] pb-[45px] pt-[28px] max-sm:px-4 max-sm:pt-5">
      <form onSubmit={(event) => void send(event)} className="mx-auto max-w-[1500px]">
        <header className="relative mb-[37px] flex min-h-[39px] items-center justify-between gap-4">
          <Link href="/dashboard" className="flex items-center gap-[12px] text-[25px] font-medium tracking-[-0.5px] text-[#17212f] max-sm:text-[20px]">
            <span aria-hidden="true" className="text-[29px] font-light leading-none">←</span>Compose New Email
          </Link>
          <div className="flex items-center gap-[17px]">
            <input ref={attachmentInput} type="file" multiple className="hidden" onChange={(event) => { void readAttachments(event.target.files); event.target.value = ''; }} />
            <button type="button" aria-label="Attach files" title="Attach files" onClick={() => attachmentInput.current?.click()} className="text-[#98a2b3] transition hover:text-[#00A82D]"><Paperclip size={20} strokeWidth={1.7} /></button>
            <button type="button" aria-label="Choose send time" title="Send later" onClick={() => { setPendingTime(selectedTime || localDateTime(new Date(Date.now() + 60 * 60 * 1000))); setSendLaterOpen((open) => !open); }} className="text-[#98a2b3] transition hover:text-[#00A82D]"><Clock3 size={20} strokeWidth={1.7} /></button>
            <button type="submit" disabled={busy} className="h-[37px] min-w-[103px] rounded-full border border-[#00A82D] px-6 text-[14px] font-medium text-[#00A82D] transition hover:bg-[#f3fbf5] disabled:opacity-50">
              {busy ? 'Sending…' : selectedTime ? 'Send Later' : 'Send'}
            </button>
          </div>
          {sendLaterOpen && <div className="absolute right-0 top-[50px] z-20 w-[332px] rounded-[10px] border border-[#e5e7eb] bg-white p-[17px] shadow-popover max-sm:right-0 max-sm:w-[min(332px,calc(100vw-32px))]">
            <h2 className="mb-[20px] text-[16px] font-medium text-[#17212f]">Send Later</h2>
            <label className="relative block">
              <span className="sr-only">Pick date and time</span>
              <input type="datetime-local" min={localDateTime(new Date(Date.now() + 60 * 1000))} max={maxDate} value={pendingTime} onChange={(event) => setPendingTime(event.target.value)} className="h-[39px] w-full border-b border-[#e2e6e3] bg-transparent pr-1 text-[14px] text-[#6d7278] outline-none focus:border-[#00A82D]" />
              <CalendarDays size={16} className="pointer-events-none absolute right-2 top-[11px] text-[#98a2b3]" />
            </label>
            <div className="mt-[13px] space-y-[2px] text-[14px] text-[#536174]">
              <button type="button" onClick={() => setQuickTime(24)} className="block w-full rounded-md py-[6px] text-left hover:bg-[#f5f7f5]">Tomorrow</button>
              <button type="button" onClick={() => setQuickTime(24)} className="block w-full rounded-md py-[6px] text-left hover:bg-[#f5f7f5]">Tomorrow, 10:00 AM</button>
              <button type="button" onClick={() => setQuickTime(25)} className="block w-full rounded-md py-[6px] text-left hover:bg-[#f5f7f5]">Tomorrow, 11:00 AM</button>
              <button type="button" onClick={() => setQuickTime(29)} className="block w-full rounded-md py-[6px] text-left hover:bg-[#f5f7f5]">Tomorrow, 3:00 PM</button>
            </div>
            <div className="mt-[72px] flex items-center justify-end gap-[25px]">
              <button type="button" onClick={() => setSendLaterOpen(false)} className="text-[14px] text-[#202124] hover:text-[#00A82D]">Cancel</button>
              <button type="button" onClick={() => { if (pendingTime) setSelectedTime(pendingTime); setSendLaterOpen(false); }} className="h-[34px] rounded-full border border-[#00A82D] px-[21px] text-[14px] text-[#00A82D] hover:bg-[#f3fbf5]">Done</button>
            </div>
          </div>}
        </header>

        <div className="mx-auto max-w-[1075px]">
          <div className="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-[18px] max-sm:grid-cols-[44px_minmax(0,1fr)] max-sm:gap-2">
            <label htmlFor="sender" className="text-[14px] text-[#17212f]">From</label>
            <div className="relative w-fit max-w-full">
              <select id="sender" value={senderId} onChange={(event) => setSenderId(event.target.value)} className="h-[40px] max-w-full appearance-none rounded-[9px] bg-[#f3f6f4] py-0 pl-[12px] pr-[37px] text-[14px] text-[#202124] outline-none focus:ring-2 focus:ring-[#cce8d2]">
                {senders.length === 0 && <option value="">Loading senders</option>}
                {senders.map((sender) => <option key={sender.id} value={sender.id}>{sender.email}</option>)}
              </select>
              <ChevronDown size={15} className="pointer-events-none absolute right-[11px] top-[12px] text-[#98a2b3]" />
            </div>
          </div>

          <div className={`mt-[16px] grid min-h-[45px] grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-[18px] border-b border-[#e4e8e6] max-sm:grid-cols-[44px_minmax(0,1fr)] max-sm:gap-2 ${dragging ? 'rounded-lg bg-[#f0faf2]' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
            <label htmlFor="recipient" className="text-[14px] text-[#17212f]">To</label>
            <div className="flex min-w-0 flex-wrap items-center gap-[5px] py-[6px]">
              {recipients.slice(0, 3).map((email) => <span key={email} className="inline-flex h-[24px] max-w-full items-center gap-1 rounded-full border border-[#00A82D] bg-[#f7fcf8] px-[9px] text-[12px] text-[#248a3c]">
                <span className="max-w-[180px] truncate">{email}</span><button type="button" onClick={() => setRecipients((current) => current.filter((value) => value !== email))} aria-label={`Remove ${email}`} className="text-[#71a97b] hover:text-[#ba1a1a]"><X size={12} /></button>
              </span>)}
              {recipients.length > 3 && <span className="inline-flex h-[24px] items-center rounded-full border border-[#00A82D] bg-[#f7fcf8] px-[9px] text-[12px] text-[#248a3c]">+{recipients.length - 3}</span>}
              <input id="recipient" value={recipientText} onChange={(event) => setRecipientText(event.target.value)} onKeyDown={onRecipientKeyDown} onBlur={() => { if (recipientText.trim()) commitRecipientText(); }} placeholder={recipients.length ? '' : 'recipient@example.com'} className="h-[30px] min-w-[170px] flex-1 bg-transparent px-[10px] text-[14px] text-[#17212f] outline-none placeholder:text-[#a1a1a1] max-sm:min-w-[120px]" />
            </div>
            <input ref={csvInput} type="file" accept=".csv,text/csv" className="hidden" onChange={handleCsvChange} />
            <button type="button" onClick={() => csvInput.current?.click()} className="flex items-center gap-[6px] whitespace-nowrap pb-1 text-[13px] font-medium text-[#00A82D] transition hover:text-[#008f26] max-sm:col-start-2 max-sm:justify-self-end"><Upload size={14} />Upload List</button>
          </div>

          <div className="mt-[13px] grid grid-cols-[56px_minmax(0,1fr)] items-center gap-[18px] border-b border-[#e4e8e6] max-sm:grid-cols-[44px_minmax(0,1fr)] max-sm:gap-2">
            <label htmlFor="subject" className="text-[14px] text-[#17212f]">Subject</label>
            <input id="subject" value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Subject" className="h-[42px] bg-transparent px-[10px] text-[15px] text-[#17212f] outline-none placeholder:text-[#a1a1a1]" />
          </div>

          <div className="mt-[15px] flex flex-wrap items-center gap-x-[28px] gap-y-3 text-[14px] max-sm:gap-x-4">
            <label className="flex items-center gap-[15px]">
              <span className="whitespace-nowrap">Delay between 2 emails</span>
              <input aria-label="Delay between emails in seconds" type="number" min="0" max="86400" value={delaySeconds} onChange={(event) => setDelaySeconds(event.target.value)} className="h-[40px] w-[72px] rounded-[9px] border border-[#dfe4e9] bg-white px-[10px] text-[14px] text-[#202124] outline-none focus:border-[#00A82D]" />
            </label>
            <label className="flex items-center gap-[10px]">
              <span className="whitespace-nowrap">Hourly Limit</span>
              <input aria-label="Hourly limit" type="number" min="0" max="100000" value={hourlyLimit} onChange={(event) => setHourlyLimit(event.target.value)} className="h-[40px] w-[72px] rounded-[9px] border border-[#dfe4e9] bg-white px-[10px] text-[14px] text-[#202124] outline-none focus:border-[#00A82D]" />
            </label>
            {selectedTime && <button type="button" onClick={() => setSelectedTime('')} className="ml-auto inline-flex items-center gap-1 text-[12px] text-[#657184] hover:text-[#b42318]"><X size={13} />{new Date(selectedTime).toLocaleString()}</button>}
          </div>

          <section className={`email-editor mt-[16px] overflow-hidden rounded-[10px] bg-[#fafafa] ${dragging ? 'ring-2 ring-[#b6dfc0]' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
            <div className="px-[17px] pt-[16px]">
              <div ref={editorRef} contentEditable suppressContentEditableWarning data-placeholder="Type Your Reply..." aria-label="Email message" className="min-h-[55px] max-h-[200px] overflow-y-auto whitespace-pre-wrap text-[15px] leading-6 text-[#202124] outline-none scrollbar-subtle" />
            </div>
            <div className="mx-[17px] mb-[11px] flex h-[41px] items-center gap-[4px] overflow-x-auto rounded-full bg-white px-[9px] text-[#858585] scrollbar-subtle">
              <ToolbarButton label="Undo" onClick={() => runEditorCommand('undo')}><Undo2 /></ToolbarButton>
              <ToolbarButton label="Redo" onClick={() => runEditorCommand('redo')}><Redo2 /></ToolbarButton>
              <span className="mx-[5px] h-[25px] w-px bg-[#e5e7eb]" />
              <ToolbarButton label="Text style" onClick={() => runEditorCommand('formatBlock', 'p')}><Type /></ToolbarButton>
              <span className="mx-[5px] h-[25px] w-px bg-[#e5e7eb]" />
              <ToolbarButton label="Bold" onClick={() => runEditorCommand('bold')}><Bold /></ToolbarButton>
              <ToolbarButton label="Italic" onClick={() => runEditorCommand('italic')}><Italic /></ToolbarButton>
              <ToolbarButton label="Underline" onClick={() => runEditorCommand('underline')}><Underline /></ToolbarButton>
              <span className="mx-[5px] h-[25px] w-px bg-[#e5e7eb]" />
              <ToolbarButton label="Align left" onClick={() => runEditorCommand('justifyLeft')}><AlignLeft /></ToolbarButton>
              <ToolbarButton label="Align center" onClick={() => runEditorCommand('justifyCenter')}><AlignCenter /></ToolbarButton>
              <ToolbarButton label="Align right" onClick={() => runEditorCommand('justifyRight')}><AlignRight /></ToolbarButton>
              <span className="mx-[5px] h-[25px] w-px bg-[#e5e7eb]" />
              <ToolbarButton label="Numbered list" onClick={() => runEditorCommand('insertOrderedList')}><ListOrdered /></ToolbarButton>
              <ToolbarButton label="Bulleted list" onClick={() => runEditorCommand('insertUnorderedList')}><List /></ToolbarButton>
              <ToolbarButton label="Indent" onClick={() => runEditorCommand('indent')}><IndentIncrease /></ToolbarButton>
              <ToolbarButton label="Outdent" onClick={() => runEditorCommand('outdent')}><IndentDecrease /></ToolbarButton>
              <ToolbarButton label="Quote" onClick={() => runEditorCommand('formatBlock', 'blockquote')}><Quote /></ToolbarButton>
              <ToolbarButton label="Strikethrough" onClick={() => runEditorCommand('strikeThrough')}><Strikethrough /></ToolbarButton>
            </div>
            <div
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => { onDrop(event); }}
              className="min-h-[420px] border-t border-transparent px-[17px] pb-5 max-sm:min-h-[300px]"
            />
          </section>

          {attachments.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{attachments.map((file, index) => <span key={`${file.filename}-${index}`} className="inline-flex items-center gap-2 rounded-lg border border-[#e5e9e6] bg-white px-3 py-2 text-xs text-[#596579]"><FileText size={14} />{file.filename}<button type="button" aria-label={`Remove ${file.filename}`} onClick={() => setAttachments((current) => current.filter((_, fileIndex) => fileIndex !== index))}><X size={13} /></button></span>)}</div>}
          {error && <p role="alert" className="mt-4 text-[13px] text-[#b42318]">{error}</p>}
        </div>
      </form>
    </main>
  );
}

function ToolbarButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-label={label} title={label} onMouseDown={(event) => event.preventDefault()} onClick={onClick} className="flex h-[31px] w-[32px] shrink-0 items-center justify-center rounded-md transition hover:bg-[#f0f2f0] hover:text-[#344054]">
    <span className="[&>svg]:h-[17px] [&>svg]:w-[17px] [&>svg]:stroke-[1.8]">{children}</span>
  </button>;
}
