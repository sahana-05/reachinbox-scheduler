export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export type EmailStatus = 'SCHEDULED' | 'PROCESSING' | 'SENT' | 'FAILED';

export type EmailJob = {
  id: string;
  recipientEmail: string;
  senderEmail: string;
  subject: string;
  body: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  etherealPreviewUrl: string | null;
  isStarred: boolean;
};

export type Sender = {
  id: string;
  userId: string;
  name: string;
  email: string;
  smtpHost: string;
  smtpPort: number;
  createdAt: string;
};

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  slackChannel?: string | null;
  slackTeamName?: string | null;
};

export async function apiFetch(path: string, init: RequestInit = {}, token?: string | null) {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  return fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include' });
}

export async function readError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { error?: string };
    return payload.error ?? `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}
