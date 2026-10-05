console.log('[fichesanitaire] build messagerie-20261001');

// --- Messagerie interne + popups : client API ---
// Les données sont stockées uniquement sur le serveur (clés cerfa_messages_v1 / cerfa_popups_v1),
// jamais envoyées en bloc depuis le navigateur : chaque action est une opération unitaire.

export const COMM_POLL_MS = 15000; // délai de rafraîchissement (messages non lus + popups)

export type PopupLevel = 'info' | 'important' | 'urgent';

export type Audience =
  | { type: 'all_parents' }
  | { type: 'class'; classNames: string[] }
  | { type: 'users'; userIds: string[] };

export interface ThreadMessage {
  id: string;
  fromRole: 'user' | 'admin';
  fromUserId: string;
  fromName: string;
  body: string;
  createdAt: string;
  kind?: 'broadcast';
}

export interface MessageThread {
  id: string;
  parentId: string;
  parentName: string;
  subject: string;
  studentLabel?: string;
  createdAt: string;
  lastMessageAt: string;
  lastFromRole: 'user' | 'admin';
  userReadAt?: string;
  adminReadAt?: string;
  unread?: boolean;
  messages: ThreadMessage[];
}

export interface PopupItem {
  id: string;
  title: string;
  body: string;
  level: PopupLevel;
  requireAck: boolean;
  createdAt: string;
  // Champs réservés à l'administration
  audience?: Audience;
  createdByName?: string;
  expiresAt?: string | null;
  active?: boolean;
  status?: 'active' | 'expired' | 'disabled';
  recipients?: number;
  acked?: number;
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: any = {};
  try {
    json = await res.json();
  } catch {
    /* réponse vide */
  }
  if (!res.ok) throw new Error(json.error || `Erreur serveur (${res.status})`);
  return json as T;
}

// Rafraîchissement léger : nombre de messages non lus + popups à afficher pour cet utilisateur
export const pollComm = (userId: string) =>
  api<{ unreadMessages: number; popups: PopupItem[] }>('/api/comm/poll', { userId });

export const listThreads = (userId: string) => api<{ threads: MessageThread[] }>('/api/messages/list', { userId });

export const sendMessage = (p: {
  userId: string;
  threadId?: string;
  parentId?: string;
  subject?: string;
  body: string;
  studentLabel?: string;
}) => api<{ thread: MessageThread }>('/api/messages/send', p);

export const markThreadRead = (userId: string, threadId: string) =>
  api<{ ok: boolean }>('/api/messages/read', { userId, threadId });

export const deleteThread = (userId: string, threadId: string) =>
  api<{ ok: boolean }>('/api/messages/delete', { userId, threadId });

export const broadcastMessage = (p: { userId: string; audience: Audience; subject: string; body: string }) =>
  api<{ count: number }>('/api/messages/broadcast', p);

export const sendPopup = (p: {
  userId: string;
  title: string;
  body: string;
  level: PopupLevel;
  audience: Audience;
  expiresInMinutes: number | null;
  requireAck: boolean;
}) => api<{ popup: PopupItem; recipients: number }>('/api/popups/send', p);

export const listPopups = (userId: string) => api<{ popups: PopupItem[] }>('/api/popups/list', { userId });

export const deactivatePopup = (userId: string, popupId: string) =>
  api<{ ok: boolean }>('/api/popups/deactivate', { userId, popupId });

export const deletePopup = (userId: string, popupId: string) =>
  api<{ ok: boolean }>('/api/popups/delete', { userId, popupId });

export const ackPopup = (userId: string, popupId: string) =>
  api<{ ok: boolean }>('/api/popups/ack', { userId, popupId });

// Popups « tous les parents » visibles sans connexion (lien direct)
export const fetchPublicPopups = () => api<{ popups: PopupItem[] }>('/api/popups/public');

export function formatCommDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export function audienceLabel(a?: Audience, classCountHint?: number): string {
  if (!a) return '';
  if (a.type === 'all_parents') return 'Tous les parents';
  if (a.type === 'class') return `Parents de : ${a.classNames.join(', ')}`;
  const n = a.userIds.length;
  return `${n} parent${n > 1 ? 's' : ''} précis${classCountHint ? '' : ''}`;
}

// --- Message d'accueil par défaut (build accueil-20261001) ---
export interface WelcomeConfig {
  enabled: boolean;
  subject: string;
  body: string;
}

export const getWelcomeConfig = (userId: string) =>
  api<{ config: WelcomeConfig; defaults: { subject: string; body: string } }>('/api/messages/welcome/get', { userId });

export const saveWelcomeConfig = (userId: string, c: WelcomeConfig) =>
  api<{ ok: boolean }>('/api/messages/welcome/save', { userId, ...c });

export const sendWelcomeToExisting = (userId: string) =>
  api<{ count: number }>('/api/messages/welcome/send-existing', { userId });
