#!/bin/bash
# ============================================================================
# patch-messagerie.sh  -  build messagerie-20261001
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# Ajoute :
#  1) une MESSAGERIE INTERNE (bouton "Messagerie" en bas a gauche, pour tous les roles)
#     - Parents : ecrire a l'etablissement, suivre les reponses, badge de messages non lus.
#     - Administration : boite de reception de tous les echanges, reponses, message
#       collectif (tous les parents / une ou plusieurs classes / parents precis) :
#       chaque parent recoit une conversation PERSONNELLE.
#  2) des POPUPS : l'administration publie un message qui s'affiche tout de suite
#     (rafraichissement toutes les 15 s) par-dessus l'ecran des parents :
#     niveaux Information / Important / Urgent, ciblage (tous / classes / parents precis),
#     duree d'affichage, bouton "J'ai lu et compris", suivi du nombre de lectures.
#     Les popups "tous les parents" apparaissent aussi via le lien direct (sans compte).
#
# Securite des donnees : les messages et popups sont stockes UNIQUEMENT cote serveur
# (cles cerfa_messages_v1 / cerfa_popups_v1) et ne sont JAMAIS renvoyes par GET /api/data
# ni /api/data/:key. Seules les routes /api/messages/* et /api/popups/* y donnent acces.
#
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/patch-messagerie.sh && /root/patch-messagerie.sh
# ============================================================================
set -e

APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"
BUILD="messagerie-20261001"
BACKUP_DIR="$APP_DIR/backup-avant-$BUILD"
FILES="server/index.js src/App.tsx src/main.tsx"
NEWFILES="src/utils/messaging.ts src/components/PopupModal.tsx src/components/AnonymousPopups.tsx src/components/CommunicationCenter.tsx"
TMP="$(mktemp -d)"

PATCHING=0
cleanup() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ "$PATCHING" = "1" ]; then
    echo ""
    echo "!!! ERREUR pendant le patch : restauration automatique des fichiers d'origine ..."
    for f in $FILES; do cp -p "$BACKUP_DIR/$f" "$APP_DIR/$f"; done
    for f in $NEWFILES; do rm -f "$APP_DIR/$f"; done
    echo "!!! Fichiers d'origine restaures : aucune modification n'a ete conservee."
    echo "!!! Envoyez le message d'erreur ci-dessus pour obtenir un script corrige."
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

echo ">>> Patch $BUILD sur $APP_DIR"

for f in $FILES; do
  [ -f "$APP_DIR/$f" ] || { echo "ERREUR : $APP_DIR/$f introuvable."; exit 1; }
done
command -v perl >/dev/null || { echo "ERREUR : perl est requis (apt install -y perl)."; exit 1; }
[ -d "$APP_DIR/src/components" ] && [ -d "$APP_DIR/src/utils" ] || { echo "ERREUR : arborescence src/ introuvable dans $APP_DIR."; exit 1; }

SRV="$APP_DIR/server/index.js"
APPF="$APP_DIR/src/App.tsx"
MAINF="$APP_DIR/src/main.tsx"

m=0
grep -q "COMM_PRIVATE_PREFIXES" "$SRV" && m=$((m+1))
grep -q "CommunicationCenter" "$APPF" && m=$((m+1))
grep -q "AnonymousPopups" "$MAINF" && m=$((m+1))
for f in $NEWFILES; do [ -f "$APP_DIR/$f" ] && m=$((m+1)); done
if [ "$m" -eq 7 ]; then
  echo ">>> Patch deja applique. Rien a faire."
  exit 0
elif [ "$m" -gt 0 ]; then
  echo "ERREUR : etat partiel detecte ($m/7 elements deja en place)."
  echo "Restaurez d'abord les fichiers d'origine depuis un backup-avant-* puis relancez ce script."
  exit 1
fi

# --- Fonctions utilitaires -------------------------------------------------
count_occ() { OLD="$2" perl -0777 -ne 'my $c = () = /\Q$ENV{OLD}\E/g; print $c' "$1"; }

replace_once() { # fichier  ancien_texte  nouveau_texte
  local file="$1" old="$2" new="$3" n
  n="$(count_occ "$file" "$old")"
  [ "$n" = "1" ] || { echo "ERREUR : repere trouve $n fois dans $file (attendu : 1) :"; echo "$old"; exit 1; }
  OLD="$old" NEW="$new" perl -0777 -i -pe 's/\Q$ENV{OLD}\E/$ENV{NEW}/' "$file"
}

# --- 1. Sauvegarde ----------------------------------------------------------
echo ">>> Sauvegarde dans $BACKUP_DIR ..."
for f in $FILES; do
  mkdir -p "$BACKUP_DIR/$(dirname "$f")"
  cp -p "$APP_DIR/$f" "$BACKUP_DIR/$f"
done
PATCHING=1

# --- 2. Nouveaux fichiers cote navigateur ------------------------------------
echo ">>> Creation des composants ..."
cat > "$APP_DIR/src/utils/messaging.ts" << 'MSGEOF_X'
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
MSGEOF_X

cat > "$APP_DIR/src/components/PopupModal.tsx" << 'MSGEOF_X'
import React from 'react';
import { AlertTriangle, Info, BellRing, X } from 'lucide-react';
import { PopupItem } from '../utils/messaging';

interface PopupModalProps {
  popups: PopupItem[];
  onAck: (popup: PopupItem) => void | Promise<void>;
}

const STYLES: Record<string, { box: string; head: string; btn: string; label: string }> = {
  info: {
    box: 'border-blue-300',
    head: 'bg-blue-900 text-white',
    btn: 'bg-blue-900 hover:bg-blue-950',
    label: 'Information',
  },
  important: {
    box: 'border-amber-400',
    head: 'bg-amber-500 text-slate-900',
    btn: 'bg-amber-600 hover:bg-amber-700',
    label: 'Important',
  },
  urgent: {
    box: 'border-red-500',
    head: 'bg-red-600 text-white',
    btn: 'bg-red-600 hover:bg-red-700',
    label: 'URGENT',
  },
};

// Affiche, par-dessus tout le reste, le premier message de la file. Impossible à ignorer :
// il se ferme uniquement avec le bouton (qui l'enregistre comme lu).
export const PopupModal: React.FC<PopupModalProps> = ({ popups, onAck }) => {
  if (popups.length === 0) return null;
  const popup = popups[0];
  const s = STYLES[popup.level] || STYLES.info;
  const Icon = popup.level === 'info' ? Info : popup.level === 'urgent' ? AlertTriangle : BellRing;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="popup-title"
      data-testid="popup-modal"
    >
      <div className={`bg-white w-full max-w-lg rounded-2xl shadow-2xl border-4 ${s.box} overflow-hidden`}>
        <div className={`${s.head} px-5 py-3 flex items-center gap-2.5`}>
          <Icon className="w-5 h-5 shrink-0" />
          <span className="text-xs font-bold uppercase tracking-wide">{s.label}</span>
          {popups.length > 1 && (
            <span className="ml-auto text-[11px] font-semibold opacity-90">
              Message 1 sur {popups.length}
            </span>
          )}
        </div>
        <div className="p-5 space-y-3">
          <h2 id="popup-title" className="text-lg font-bold text-slate-900 leading-snug">
            {popup.title}
          </h2>
          <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed max-h-[50vh] overflow-y-auto">
            {popup.body}
          </p>
        </div>
        <div className="px-5 pb-5 flex justify-end">
          <button
            type="button"
            onClick={() => onAck(popup)}
            className={`${s.btn} text-white font-semibold text-sm px-5 py-2.5 rounded-lg shadow-xs cursor-pointer inline-flex items-center gap-2`}
            autoFocus
          >
            {popup.requireAck ? (
              "J'ai lu et compris"
            ) : (
              <>
                <X className="w-4 h-4" /> Fermer
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
MSGEOF_X

cat > "$APP_DIR/src/components/AnonymousPopups.tsx" << 'MSGEOF_X'
import React, { useEffect, useState } from 'react';
import { PopupModal } from './PopupModal';
import { COMM_POLL_MS, fetchPublicPopups, PopupItem } from '../utils/messaging';

const SEEN_KEY = 'fiche_popups_seen_v1';

function readSeen(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
  } catch {
    return [];
  }
}

// Popups « tous les parents » pour les personnes qui arrivent par un lien direct (sans compte).
// La lecture est mémorisée sur l'appareil.
export const AnonymousPopups: React.FC = () => {
  const [popups, setPopups] = useState<PopupItem[]>([]);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetchPublicPopups();
        if (stop) return;
        const seen = readSeen();
        setPopups(r.popups.filter((p) => !seen.includes(p.id)));
      } catch {
        /* serveur injoignable : on réessaiera */
      }
    };
    tick();
    const timer = setInterval(tick, COMM_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stop = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const handleAck = (popup: PopupItem) => {
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify([...readSeen(), popup.id].slice(-200)));
    } catch {
      /* stockage indisponible */
    }
    setPopups((prev) => prev.filter((p) => p.id !== popup.id));
  };

  return <PopupModal popups={popups} onAck={handleAck} />;
};
MSGEOF_X

cat > "$APP_DIR/src/components/CommunicationCenter.tsx" << 'MSGEOF_X'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MessageSquare,
  Send,
  X,
  Plus,
  Megaphone,
  Trash2,
  ArrowLeft,
  Search,
  Inbox,
  CheckCircle2,
} from 'lucide-react';
import { User, SchoolClass, Student } from '../types';
import { PopupModal } from './PopupModal';
import {
  Audience,
  COMM_POLL_MS,
  MessageThread,
  PopupItem,
  PopupLevel,
  ackPopup,
  broadcastMessage,
  deactivatePopup,
  deletePopup,
  deleteThread,
  formatCommDate,
  listPopups,
  listThreads,
  markThreadRead,
  pollComm,
  sendMessage,
  sendPopup,
} from '../utils/messaging';

interface CommunicationCenterProps {
  currentUser: User;
  users: User[];
  classes: SchoolClass[];
  students: Student[];
}

type AdminView = 'inbox' | 'compose' | 'popups';

// ---------------------------------------------------------------------------
// Sélecteur de destinataires (admin) : tous les parents / classes / parents précis
// ---------------------------------------------------------------------------
const AudiencePicker: React.FC<{
  audience: Audience;
  onChange: (a: Audience) => void;
  classes: SchoolClass[];
  parents: User[];
  recipientCount: number;
}> = ({ audience, onChange, classes, parents, recipientCount }) => {
  const [search, setSearch] = useState('');
  const filteredParents = parents
    .filter((p) => (p.name + ' ' + p.email).toLowerCase().includes(search.toLowerCase()))
    .slice(0, 60);

  return (
    <div className="space-y-2">
      <label className="block text-xs font-semibold text-slate-700">Destinataires</label>
      <select
        value={audience.type}
        onChange={(e) => {
          const t = e.target.value;
          if (t === 'all_parents') onChange({ type: 'all_parents' });
          else if (t === 'class') onChange({ type: 'class', classNames: [] });
          else onChange({ type: 'users', userIds: [] });
        }}
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
      >
        <option value="all_parents">Tous les parents</option>
        <option value="class">Les parents d'une ou plusieurs classes</option>
        <option value="users">Un ou plusieurs parents précis</option>
      </select>

      {audience.type === 'class' && (
        <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-2 bg-slate-50">
          {classes.length === 0 && <span className="text-xs text-slate-500">Aucune classe définie.</span>}
          {classes.map((c) => {
            const on = audience.classNames.includes(c.name);
            return (
              <button
                type="button"
                key={c.id}
                onClick={() =>
                  onChange({
                    type: 'class',
                    classNames: on ? audience.classNames.filter((n) => n !== c.name) : [...audience.classNames, c.name],
                  })
                }
                className={`text-xs px-2.5 py-1 rounded-full border cursor-pointer ${
                  on ? 'bg-blue-900 text-white border-blue-900' : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      )}

      {audience.type === 'users' && (
        <div className="border border-slate-200 rounded-lg p-2 bg-slate-50 space-y-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un parent (nom ou e-mail)"
              className="w-full border border-slate-300 rounded-lg pl-8 pr-3 py-2 text-xs bg-white"
            />
          </div>
          <div className="max-h-40 overflow-y-auto space-y-0.5">
            {filteredParents.map((p) => {
              const on = audience.userIds.includes(p.id);
              return (
                <label key={p.id} className="flex items-center gap-2 text-xs px-1.5 py-1 rounded hover:bg-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      onChange({
                        type: 'users',
                        userIds: on ? audience.userIds.filter((i) => i !== p.id) : [...audience.userIds, p.id],
                      })
                    }
                  />
                  <span className="font-medium text-slate-800">{p.name}</span>
                  <span className="text-slate-400 truncate">{p.email}</span>
                </label>
              );
            })}
            {filteredParents.length === 0 && <p className="text-xs text-slate-500 px-1.5">Aucun parent trouvé.</p>}
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-500">
        Environ <strong>{recipientCount}</strong> destinataire{recipientCount > 1 ? 's' : ''}
      </p>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Composant principal : bouton flottant + messagerie + popups
// ---------------------------------------------------------------------------
export const CommunicationCenter: React.FC<CommunicationCenterProps> = ({ currentUser, users, classes, students }) => {
  const isAdmin = currentUser.role === 'admin';
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [popups, setPopups] = useState<PopupItem[]>([]);
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adminView, setAdminView] = useState<AdminView>('inbox');
  const [composing, setComposing] = useState(false); // côté parent
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [onlyUnread, setOnlyUnread] = useState(false);

  // nouveau message (parent : vers l'établissement / admin : diffusion)
  const [newSubject, setNewSubject] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newStudent, setNewStudent] = useState('');
  const [msgAudience, setMsgAudience] = useState<Audience>({ type: 'all_parents' });

  // popups (admin)
  const [adminPopups, setAdminPopups] = useState<PopupItem[]>([]);
  const [pTitle, setPTitle] = useState('');
  const [pBody, setPBody] = useState('');
  const [pLevel, setPLevel] = useState<PopupLevel>('important');
  const [pExpires, setPExpires] = useState<string>('1440');
  const [pRequireAck, setPRequireAck] = useState(true);
  const [pAudience, setPAudience] = useState<Audience>({ type: 'all_parents' });

  const openRef = useRef(open);
  openRef.current = open;

  const parents = useMemo(() => users.filter((u) => u.role === 'parent'), [users]);
  const myChildren = useMemo(
    () => students.filter((s) => s.parentId === currentUser.id && !(s as any).deletedAt),
    [students, currentUser.id]
  );

  const countAudience = useCallback(
    (a: Audience): number => {
      if (a.type === 'all_parents') return parents.length;
      if (a.type === 'users') return a.userIds.length;
      const ids = new Set(
        students.filter((s) => a.classNames.includes(s.schoolClass) && !(s as any).deletedAt).map((s) => s.parentId)
      );
      return parents.filter((p) => ids.has(p.id)).length;
    },
    [parents, students]
  );

  const loadThreads = useCallback(async () => {
    try {
      const r = await listThreads(currentUser.id);
      setThreads(r.threads);
    } catch (e: any) {
      setError(e.message || 'Impossible de charger les messages.');
    }
  }, [currentUser.id]);

  const loadAdminPopups = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const r = await listPopups(currentUser.id);
      setAdminPopups(r.popups);
    } catch (e: any) {
      setError(e.message || 'Impossible de charger les popups.');
    }
  }, [currentUser.id, isAdmin]);

  // Rafraîchissement régulier : non lus + popups à afficher immédiatement
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await pollComm(currentUser.id);
        if (stop) return;
        setUnread((prev) => {
          if (prev !== r.unreadMessages && openRef.current) loadThreads();
          return r.unreadMessages;
        });
        setPopups(r.popups);
      } catch {
        /* serveur injoignable : on réessaiera */
      }
    };
    tick();
    const timer = setInterval(tick, COMM_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      stop = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [currentUser.id, loadThreads]);

  useEffect(() => {
    if (open) {
      setError('');
      loadThreads();
      if (isAdmin && adminView === 'popups') loadAdminPopups();
    }
  }, [open, adminView, isAdmin, loadThreads, loadAdminPopups]);

  const handleAckPopup = async (popup: PopupItem) => {
    setPopups((prev) => prev.filter((p) => p.id !== popup.id));
    try {
      await ackPopup(currentUser.id, popup.id);
    } catch {
      /* il réapparaîtra au prochain rafraîchissement si l'enregistrement a échoué */
    }
  };

  const selected = threads.find((t) => t.id === selectedId) || null;

  const openThread = async (t: MessageThread) => {
    setSelectedId(t.id);
    setComposing(false);
    setReply('');
    if (t.unread) {
      try {
        await markThreadRead(currentUser.id, t.id);
        setThreads((prev) => prev.map((x) => (x.id === t.id ? { ...x, unread: false } : x)));
        setUnread((u) => Math.max(0, u - 1));
      } catch {
        /* sans gravité */
      }
    }
  };

  const handleReply = async () => {
    if (!selected || !reply.trim()) return;
    setBusy(true);
    setError('');
    try {
      const r = await sendMessage({ userId: currentUser.id, threadId: selected.id, body: reply });
      setThreads((prev) => prev.map((x) => (x.id === r.thread.id ? r.thread : x)));
      setReply('');
    } catch (e: any) {
      setError(e.message || "L'envoi a échoué.");
    }
    setBusy(false);
  };

  const handleNewParentMessage = async () => {
    if (!newSubject.trim() || !newBody.trim()) {
      setError('Merci de renseigner un objet et un message.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await sendMessage({
        userId: currentUser.id,
        subject: newSubject,
        body: newBody,
        studentLabel: newStudent || undefined,
      });
      setThreads((prev) => [r.thread, ...prev]);
      setSelectedId(r.thread.id);
      setComposing(false);
      setNewSubject('');
      setNewBody('');
      setNewStudent('');
    } catch (e: any) {
      setError(e.message || "L'envoi a échoué.");
    }
    setBusy(false);
  };

  const handleBroadcast = async () => {
    if (!newSubject.trim() || !newBody.trim()) {
      setError('Merci de renseigner un objet et un message.');
      return;
    }
    const n = countAudience(msgAudience);
    if (n === 0) {
      setError('Aucun destinataire sélectionné.');
      return;
    }
    if (!window.confirm(`Envoyer ce message à environ ${n} parent${n > 1 ? 's' : ''} ?`)) return;
    setBusy(true);
    setError('');
    try {
      const r = await broadcastMessage({ userId: currentUser.id, audience: msgAudience, subject: newSubject, body: newBody });
      setNotice(`Message envoyé à ${r.count} parent${r.count > 1 ? 's' : ''}.`);
      setNewSubject('');
      setNewBody('');
      await loadThreads();
      setAdminView('inbox');
    } catch (e: any) {
      setError(e.message || "L'envoi a échoué.");
    }
    setBusy(false);
  };

  const handleDeleteThread = async (t: MessageThread) => {
    if (!window.confirm('Supprimer définitivement cette conversation ?')) return;
    try {
      await deleteThread(currentUser.id, t.id);
      setThreads((prev) => prev.filter((x) => x.id !== t.id));
      if (selectedId === t.id) setSelectedId(null);
    } catch (e: any) {
      setError(e.message || 'Suppression impossible.');
    }
  };

  const handleSendPopup = async () => {
    if (!pTitle.trim() || !pBody.trim()) {
      setError('Merci de renseigner un titre et un message.');
      return;
    }
    const n = countAudience(pAudience);
    if (n === 0) {
      setError('Aucun destinataire sélectionné.');
      return;
    }
    if (!window.confirm(`Afficher ce popup immédiatement à environ ${n} parent${n > 1 ? 's' : ''} ?`)) return;
    setBusy(true);
    setError('');
    try {
      const r = await sendPopup({
        userId: currentUser.id,
        title: pTitle,
        body: pBody,
        level: pLevel,
        audience: pAudience,
        expiresInMinutes: pExpires === 'never' ? null : Number(pExpires),
        requireAck: pRequireAck,
      });
      setNotice(`Popup publié pour ${r.recipients} parent${r.recipients > 1 ? 's' : ''} : visible dans les secondes qui suivent.`);
      setPTitle('');
      setPBody('');
      await loadAdminPopups();
    } catch (e: any) {
      setError(e.message || 'Publication impossible.');
    }
    setBusy(false);
  };

  const visibleThreads = threads.filter((t) => {
    if (onlyUnread && !t.unread) return false;
    const q = filterText.trim().toLowerCase();
    if (!q) return true;
    return (t.subject + ' ' + t.parentName + ' ' + (t.studentLabel || '')).toLowerCase().includes(q);
  });

  const ThreadList = (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-3 border-b border-slate-200 space-y-2">
        {!isAdmin && (
          <button
            type="button"
            onClick={() => {
              setComposing(true);
              setSelectedId(null);
              setError('');
            }}
            className="w-full inline-flex items-center justify-center gap-1.5 bg-blue-900 hover:bg-blue-950 text-white text-xs font-semibold px-3 py-2 rounded-lg cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Nouveau message à l'établissement
          </button>
        )}
        {isAdmin && (
          <>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Rechercher (parent, objet, élève)"
                className="w-full border border-slate-300 rounded-lg pl-8 pr-3 py-2 text-xs"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
              <input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} />
              Non lus uniquement
            </label>
          </>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {visibleThreads.length === 0 && (
          <div className="p-6 text-center text-xs text-slate-500">
            <Inbox className="w-8 h-8 mx-auto mb-2 text-slate-300" />
            Aucune conversation.
          </div>
        )}
        {visibleThreads.map((t) => {
          const last = t.messages[t.messages.length - 1];
          return (
            <button
              type="button"
              key={t.id}
              onClick={() => openThread(t)}
              className={`w-full text-left px-3 py-2.5 border-b border-slate-100 hover:bg-blue-50 cursor-pointer ${
                selectedId === t.id ? 'bg-blue-50' : ''
              }`}
            >
              <div className="flex items-center gap-2">
                {t.unread && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" aria-label="non lu" />}
                <span className={`text-xs truncate ${t.unread ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`}>
                  {t.subject}
                </span>
                <span className="ml-auto text-[10px] text-slate-400 shrink-0">{formatCommDate(t.lastMessageAt)}</span>
              </div>
              {isAdmin && <div className="text-[11px] text-blue-900 truncate">{t.parentName}{t.studentLabel ? ` · ${t.studentLabel}` : ''}</div>}
              <div className="text-[11px] text-slate-500 truncate">{last ? last.body : ''}</div>
            </button>
          );
        })}
      </div>
    </div>
  );

  const Conversation = selected ? (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-3 border-b border-slate-200 flex items-start gap-2">
        <button
          type="button"
          onClick={() => setSelectedId(null)}
          className="md:hidden p-1 text-slate-500 cursor-pointer"
          aria-label="Retour à la liste"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-900 truncate">{selected.subject}</h3>
          <p className="text-[11px] text-slate-500">
            {isAdmin ? selected.parentName : 'Échange avec l\'établissement'}
            {selected.studentLabel ? ` · Concernant : ${selected.studentLabel}` : ''}
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => handleDeleteThread(selected)}
            className="ml-auto p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
            title="Supprimer la conversation"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 bg-slate-50">
        {selected.messages.map((m) => {
          const mine = isAdmin ? m.fromRole === 'admin' : m.fromRole === 'user';
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-xs ${
                  mine ? 'bg-blue-900 text-white rounded-br-sm' : 'bg-white text-slate-800 border border-slate-200 rounded-bl-sm'
                }`}
              >
                <div className={`text-[10px] font-semibold mb-0.5 ${mine ? 'text-blue-200' : 'text-slate-500'}`}>
                  {m.fromRole === 'admin' && !isAdmin ? `Établissement · ${m.fromName}` : m.fromName}
                  {m.kind === 'broadcast' ? ' · message collectif' : ''}
                </div>
                <div className="whitespace-pre-wrap leading-relaxed">{m.body}</div>
                <div className={`text-[10px] mt-1 text-right ${mine ? 'text-blue-200' : 'text-slate-400'}`}>
                  {formatCommDate(m.createdAt)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="p-3 border-t border-slate-200 bg-white flex gap-2 items-end">
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={2}
          placeholder="Votre réponse…"
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm resize-none"
        />
        <button
          type="button"
          onClick={handleReply}
          disabled={busy || !reply.trim()}
          className="bg-blue-900 hover:bg-blue-950 disabled:opacity-40 text-white p-2.5 rounded-lg cursor-pointer"
          aria-label="Envoyer"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  ) : null;

  const ParentCompose = (
    <div className="p-4 space-y-3 overflow-y-auto">
      <h3 className="text-sm font-bold text-slate-900">Nouveau message à l'établissement</h3>
      {myChildren.length > 0 && (
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Concernant (facultatif)</label>
          <select
            value={newStudent}
            onChange={(e) => setNewStudent(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value="">— Aucun élève en particulier —</option>
            {myChildren.map((s) => (
              <option key={s.id} value={`${s.cerfa.identity.firstName} ${s.cerfa.identity.lastName} (${s.schoolClass})`}>
                {s.cerfa.identity.firstName} {s.cerfa.identity.lastName} ({s.schoolClass})
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">Objet</label>
        <input
          value={newSubject}
          onChange={(e) => setNewSubject(e.target.value)}
          maxLength={150}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">Message</label>
        <textarea
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          rows={6}
          maxLength={5000}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
        />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setComposing(false)} className="px-4 py-2 text-sm text-slate-600 cursor-pointer">
          Annuler
        </button>
        <button
          type="button"
          onClick={handleNewParentMessage}
          disabled={busy}
          className="px-5 py-2 bg-blue-900 hover:bg-blue-950 disabled:opacity-40 text-white rounded-lg text-sm font-semibold cursor-pointer"
        >
          Envoyer
        </button>
      </div>
    </div>
  );

  const AdminCompose = (
    <div className="p-4 space-y-3 overflow-y-auto h-full">
      <h3 className="text-sm font-bold text-slate-900">Nouveau message aux parents</h3>
      <p className="text-xs text-slate-500">
        Chaque parent reçoit une conversation personnelle : il ne voit pas les autres destinataires et peut vous répondre.
      </p>
      <AudiencePicker
        audience={msgAudience}
        onChange={setMsgAudience}
        classes={classes}
        parents={parents}
        recipientCount={countAudience(msgAudience)}
      />
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">Objet</label>
        <input value={newSubject} onChange={(e) => setNewSubject(e.target.value)} maxLength={150} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">Message</label>
        <textarea value={newBody} onChange={(e) => setNewBody(e.target.value)} rows={7} maxLength={5000} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleBroadcast}
          disabled={busy}
          className="px-5 py-2 bg-blue-900 hover:bg-blue-950 disabled:opacity-40 text-white rounded-lg text-sm font-semibold cursor-pointer inline-flex items-center gap-2"
        >
          <Send className="w-4 h-4" /> Envoyer
        </button>
      </div>
    </div>
  );

  const LEVELS: { id: PopupLevel; label: string; cls: string }[] = [
    { id: 'info', label: 'Information', cls: 'border-blue-400 bg-blue-50 text-blue-900' },
    { id: 'important', label: 'Important', cls: 'border-amber-400 bg-amber-50 text-amber-900' },
    { id: 'urgent', label: 'Urgent', cls: 'border-red-500 bg-red-50 text-red-800' },
  ];

  const AdminPopups = (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <div className="space-y-3 bg-white border border-slate-200 rounded-xl p-4">
        <h3 className="text-sm font-bold text-slate-900 inline-flex items-center gap-2">
          <Megaphone className="w-4 h-4 text-red-600" /> Publier un popup (s'affiche tout de suite sur l'écran des parents)
        </h3>
        <div className="flex gap-2">
          {LEVELS.map((l) => (
            <button
              type="button"
              key={l.id}
              onClick={() => {
                setPLevel(l.id);
                if (l.id === 'urgent') setPRequireAck(true);
              }}
              className={`flex-1 text-xs font-semibold py-2 rounded-lg border-2 cursor-pointer ${
                pLevel === l.id ? l.cls : 'border-slate-200 bg-white text-slate-500'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Titre</label>
          <input value={pTitle} onChange={(e) => setPTitle(e.target.value)} maxLength={120} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Message</label>
          <textarea value={pBody} onChange={(e) => setPBody(e.target.value)} rows={5} maxLength={2000} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <AudiencePicker audience={pAudience} onChange={setPAudience} classes={classes} parents={parents} recipientCount={countAudience(pAudience)} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Durée d'affichage</label>
            <select value={pExpires} onChange={(e) => setPExpires(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
              <option value="60">1 heure</option>
              <option value="1440">24 heures</option>
              <option value="10080">7 jours</option>
              <option value="never">Jusqu'à désactivation</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-700 sm:mt-6 cursor-pointer">
            <input type="checkbox" checked={pRequireAck} onChange={(e) => setPRequireAck(e.target.checked)} />
            Le parent doit cliquer sur « J'ai lu et compris »
          </label>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSendPopup}
            disabled={busy}
            className="px-5 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-lg text-sm font-semibold cursor-pointer inline-flex items-center gap-2"
          >
            <Megaphone className="w-4 h-4" /> Publier maintenant
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold text-slate-900 mb-2">Popups publiés</h3>
        {adminPopups.length === 0 && <p className="text-xs text-slate-500">Aucun popup pour le moment.</p>}
        <div className="space-y-2">
          {adminPopups.map((p) => (
            <div key={p.id} className="bg-white border border-slate-200 rounded-xl p-3 text-xs">
              <div className="flex items-start gap-2">
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    p.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {p.status === 'active' ? 'EN LIGNE' : p.status === 'expired' ? 'EXPIRÉ' : 'DÉSACTIVÉ'}
                </span>
                <strong className="text-slate-900 text-sm">{p.title}</strong>
                <span className="ml-auto text-slate-400 shrink-0">{formatCommDate(p.createdAt)}</span>
              </div>
              <p className="text-slate-600 mt-1 whitespace-pre-wrap line-clamp-3">{p.body}</p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-slate-500">
                <span>
                  <CheckCircle2 className="w-3.5 h-3.5 inline text-emerald-600" /> {p.acked ?? 0} / {p.recipients ?? 0} ont vu ce message
                </span>
                {p.createdByName && <span>par {p.createdByName}</span>}
                <span className="ml-auto flex gap-2">
                  {p.status === 'active' && (
                    <button
                      type="button"
                      onClick={async () => {
                        await deactivatePopup(currentUser.id, p.id);
                        loadAdminPopups();
                      }}
                      className="text-amber-700 font-semibold cursor-pointer"
                    >
                      Désactiver
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm('Supprimer ce popup ?')) return;
                      await deletePopup(currentUser.id, p.id);
                      loadAdminPopups();
                    }}
                    className="text-red-600 font-semibold cursor-pointer"
                  >
                    Supprimer
                  </button>
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const panelBody = isAdmin ? (
    adminView === 'compose' ? (
      AdminCompose
    ) : adminView === 'popups' ? (
      AdminPopups
    ) : (
      <div className="flex h-full min-h-0">
        <div className={`${selected ? 'hidden md:block' : 'block'} w-full md:w-80 border-r border-slate-200 bg-white min-h-0`}>{ThreadList}</div>
        <div className={`${selected ? 'block' : 'hidden md:flex'} flex-1 min-h-0 min-w-0 md:items-center md:justify-center`}>
          {Conversation || <p className="text-xs text-slate-400 p-6">Sélectionnez une conversation.</p>}
        </div>
      </div>
    )
  ) : (
    <div className="flex h-full min-h-0">
      <div className={`${selected || composing ? 'hidden md:block' : 'block'} w-full md:w-80 border-r border-slate-200 bg-white min-h-0`}>{ThreadList}</div>
      <div className={`${selected || composing ? 'block' : 'hidden md:flex'} flex-1 min-h-0 min-w-0 md:items-center md:justify-center`}>
        {composing ? ParentCompose : Conversation || <p className="text-xs text-slate-400 p-6">Sélectionnez une conversation ou écrivez à l'établissement.</p>}
      </div>
    </div>
  );

  return (
    <>
      <PopupModal popups={popups} onAck={handleAckPopup} />

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 left-5 z-40 bg-blue-900 hover:bg-blue-950 text-white rounded-full shadow-2xl px-4 py-3 inline-flex items-center gap-2 text-sm font-semibold cursor-pointer print:hidden"
        aria-label="Ouvrir la messagerie"
        data-testid="comm-button"
      >
        <MessageSquare className="w-5 h-5" />
        <span className="hidden sm:inline">Messagerie</span>
        {unread > 0 && (
          <span className="bg-red-500 text-white text-[11px] font-bold rounded-full min-w-5 h-5 px-1.5 inline-flex items-center justify-center" data-testid="comm-unread">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[90] bg-slate-900/50 flex justify-end print:hidden" data-testid="comm-panel">
          <div className="bg-slate-100 w-full sm:max-w-4xl h-full flex flex-col shadow-2xl">
            <div className="bg-blue-900 text-white px-4 py-3 flex items-center gap-3">
              <MessageSquare className="w-5 h-5" />
              <h2 className="text-sm font-bold">Messagerie interne</h2>
              {isAdmin && (
                <div className="flex gap-1 ml-2">
                  {([
                    ['inbox', 'Messages'],
                    ['compose', 'Nouveau message'],
                    ['popups', 'Popups'],
                  ] as [AdminView, string][]).map(([v, label]) => (
                    <button
                      type="button"
                      key={v}
                      onClick={() => {
                        setAdminView(v);
                        setError('');
                        setNotice('');
                      }}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer ${
                        adminView === v ? 'bg-white text-blue-900' : 'text-blue-100 hover:bg-blue-800'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <button type="button" onClick={() => setOpen(false)} className="ml-auto p-1 hover:bg-blue-800 rounded cursor-pointer" aria-label="Fermer la messagerie">
                <X className="w-5 h-5" />
              </button>
            </div>
            {(error || notice) && (
              <div className={`px-4 py-2 text-xs font-medium ${error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`} role="status">
                {error || notice}
              </div>
            )}
            <div className="flex-1 min-h-0">{panelBody}</div>
          </div>
        </div>
      )}
    </>
  );
};
MSGEOF_X

# --- 3. Serveur : routes messagerie / popups + protection des cles privees ----
cat > "$TMP/server_comm.js" << 'MSGEOF_X'
app.use(express.json({ limit: '15mb' }));

// ============================================================================
// Messagerie interne + popups (build messagerie-20261001)
// Données dans le kv_store : cerfa_messages_v1 (conversations) et cerfa_popups_v1 (popups).
// Ces deux clés ne sont JAMAIS renvoyées par GET /api/data ni GET/PUT /api/data/:key.
// ============================================================================
const MESSAGES_KEY = 'cerfa_messages_v1';
const POPUPS_KEY = 'cerfa_popups_v1';
const COMM_PRIVATE_PREFIXES = ['cerfa_messages', 'cerfa_popups'];
const isPrivateKvKey = (k) => COMM_PRIVATE_PREFIXES.some((p) => String(k).startsWith(p));

app.use('/api/data', (req, res, next) => {
  let key = '';
  try {
    key = decodeURIComponent((req.path || '/').replace(/^\//, ''));
  } catch {
    key = '';
  }
  if (key && isPrivateKvKey(key)) return res.status(403).json({ error: 'Accès refusé' });
  if (req.method === 'GET' && !key) {
    const originalJson = res.json.bind(res);
    res.json = (obj) => {
      if (obj && typeof obj === 'object') {
        Object.keys(obj).forEach((k) => {
          if (isPrivateKvKey(k)) delete obj[k];
        });
      }
      return originalJson(obj);
    };
  }
  next();
});

// Une seule écriture de messagerie à la fois (lecture-modification-écriture atomique)
let commChain = Promise.resolve();
function withCommLock(fn) {
  const run = commChain.then(fn);
  commChain = run.catch(() => {});
  return run;
}

const commId = (prefix) => prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
const commClip = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

async function commGetUser(userId) {
  if (!userId) return null;
  const users = (await readKv(USERS_KEY)) || [];
  return users.find((u) => u && u.id === userId) || null;
}

// Retourne l'utilisateur si c'est un administrateur, sinon envoie un 403 et retourne null
async function commRequireAdmin(userId, res) {
  const user = await commGetUser(userId);
  if (!user || user.role !== 'admin') {
    res.status(403).json({ error: 'Action réservée à l\'administration.' });
    return null;
  }
  return user;
}

function commUnreadFor(user, threads) {
  if (user.role === 'admin') {
    return threads.filter((t) => t.lastFromRole === 'user' && (!t.adminReadAt || t.lastMessageAt > t.adminReadAt)).length;
  }
  return threads.filter(
    (t) => t.parentId === user.id && t.lastFromRole === 'admin' && (!t.userReadAt || t.lastMessageAt > t.userReadAt)
  ).length;
}

function commThreadForViewer(t, user) {
  const unread =
    user.role === 'admin'
      ? t.lastFromRole === 'user' && (!t.adminReadAt || t.lastMessageAt > t.adminReadAt)
      : t.lastFromRole === 'admin' && (!t.userReadAt || t.lastMessageAt > t.userReadAt);
  return { ...t, unread };
}

// Destinataires d'une audience (parents ou comptes précis)
function commResolveAudience(audience, users, students) {
  const type = audience && audience.type;
  const parents = users.filter((u) => u && u.role === 'parent');
  if (type === 'all_parents') return parents;
  if (type === 'class') {
    const names = new Set((audience.classNames || []).map(String));
    const parentIds = new Set(
      students.filter((s) => s && !s.deletedAt && names.has(s.schoolClass)).map((s) => s.parentId)
    );
    return parents.filter((u) => parentIds.has(u.id));
  }
  if (type === 'users') {
    const ids = new Set((audience.userIds || []).map(String));
    return users.filter((u) => u && u.role !== 'admin' && ids.has(u.id));
  }
  return [];
}

function commCleanAudience(a) {
  if (!a || typeof a !== 'object') return null;
  if (a.type === 'all_parents') return { type: 'all_parents' };
  if (a.type === 'class') {
    const classNames = (Array.isArray(a.classNames) ? a.classNames : []).map((n) => commClip(n, 80)).filter(Boolean).slice(0, 100);
    return classNames.length ? { type: 'class', classNames } : null;
  }
  if (a.type === 'users') {
    const userIds = (Array.isArray(a.userIds) ? a.userIds : []).map((n) => commClip(n, 120)).filter(Boolean).slice(0, 2000);
    return userIds.length ? { type: 'users', userIds } : null;
  }
  return null;
}

// --- Popups : état et ciblage ---
function popupStatus(p, now) {
  if (!p.active) return 'disabled';
  if (p.expiresAt && p.expiresAt <= now) return 'expired';
  return 'active';
}

function popupTargetsUser(p, user, students) {
  const a = p.audience || {};
  if (a.type === 'all_parents') return user.role === 'parent';
  if (a.type === 'users') return (a.userIds || []).includes(user.id);
  if (a.type === 'class') {
    if (user.role !== 'parent') return false;
    const names = new Set(a.classNames || []);
    return students.some((s) => s && !s.deletedAt && s.parentId === user.id && names.has(s.schoolClass));
  }
  return false;
}

const POPUP_LEVEL_RANK = { urgent: 0, important: 1, info: 2 };
function popupPublicView(p) {
  return { id: p.id, title: p.title, body: p.body, level: p.level, requireAck: !!p.requireAck, createdAt: p.createdAt };
}

app.post('/api/comm/poll', async (req, res) => {
  try {
    const user = await commGetUser(req.body && req.body.userId);
    if (!user) return res.json({ unreadMessages: 0, popups: [] });
    const threads = (await readKv(MESSAGES_KEY)) || [];
    const popups = (await readKv(POPUPS_KEY)) || [];
    const now = new Date().toISOString();
    let students = [];
    if (popups.some((p) => p.audience && p.audience.type === 'class')) students = (await readKv(STUDENTS_KEY)) || [];
    const mine = popups
      .filter((p) => popupStatus(p, now) === 'active' && !(p.acks && p.acks[user.id]) && popupTargetsUser(p, user, students))
      .sort((a, b) => (POPUP_LEVEL_RANK[a.level] - POPUP_LEVEL_RANK[b.level]) || (a.createdAt < b.createdAt ? 1 : -1))
      .map(popupPublicView);
    res.json({ unreadMessages: commUnreadFor(user, threads), popups: mine });
  } catch (e) {
    console.error('[messagerie] poll :', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// --- Messagerie ---
app.post('/api/messages/list', async (req, res) => {
  try {
    const user = await commGetUser(req.body && req.body.userId);
    if (!user) return res.status(403).json({ error: 'Utilisateur inconnu.' });
    const threads = (await readKv(MESSAGES_KEY)) || [];
    const visible = user.role === 'admin' ? threads : threads.filter((t) => t.parentId === user.id);
    visible.sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1));
    res.json({ threads: visible.map((t) => commThreadForViewer(t, user)) });
  } catch (e) {
    console.error('[messagerie] list :', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/messages/send', async (req, res) => {
  try {
    await withCommLock(async () => {
      const { userId, threadId, parentId, subject, body, studentLabel } = req.body || {};
      const user = await commGetUser(userId);
      if (!user) return res.status(403).json({ error: 'Utilisateur inconnu.' });
      const text = commClip(body, 5000);
      if (!text) return res.status(400).json({ error: 'Le message est vide.' });
      const isAdmin = user.role === 'admin';
      const now = new Date().toISOString();
      const message = {
        id: commId('m'),
        fromRole: isAdmin ? 'admin' : 'user',
        fromUserId: user.id,
        fromName: user.name || 'Utilisateur',
        body: text,
        createdAt: now,
      };
      const threads = (await readKv(MESSAGES_KEY)) || [];
      let thread;
      if (threadId) {
        thread = threads.find((t) => t.id === threadId);
        if (!thread) return res.status(404).json({ error: 'Conversation introuvable.' });
        if (!isAdmin && thread.parentId !== user.id) return res.status(403).json({ error: 'Accès refusé.' });
        thread.messages.push(message);
      } else {
        let owner = user;
        if (isAdmin) {
          owner = await commGetUser(parentId);
          if (!owner || owner.role === 'admin') return res.status(400).json({ error: 'Destinataire invalide.' });
        }
        thread = {
          id: commId('t'),
          parentId: owner.id,
          parentName: owner.name || 'Parent',
          subject: commClip(subject, 150) || 'Sans objet',
          studentLabel: commClip(studentLabel, 150) || undefined,
          createdAt: now,
          messages: [message],
        };
        threads.push(thread);
      }
      thread.lastMessageAt = now;
      thread.lastFromRole = message.fromRole;
      if (isAdmin) thread.adminReadAt = now;
      else thread.userReadAt = now;
      await writeKv(MESSAGES_KEY, threads);
      res.json({ thread: commThreadForViewer(thread, user) });
    });
  } catch (e) {
    console.error('[messagerie] send :', e);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/messages/read', async (req, res) => {
  try {
    await withCommLock(async () => {
      const { userId, threadId } = req.body || {};
      const user = await commGetUser(userId);
      if (!user) return res.status(403).json({ error: 'Utilisateur inconnu.' });
      const threads = (await readKv(MESSAGES_KEY)) || [];
      const t = threads.find((x) => x.id === threadId);
      if (!t) return res.status(404).json({ error: 'Conversation introuvable.' });
      if (user.role !== 'admin' && t.parentId !== user.id) return res.status(403).json({ error: 'Accès refusé.' });
      const now = new Date().toISOString();
      if (user.role === 'admin') t.adminReadAt = now;
      else t.userReadAt = now;
      await writeKv(MESSAGES_KEY, threads);
      res.json({ ok: true });
    });
  } catch (e) {
    console.error('[messagerie] read :', e);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/messages/delete', async (req, res) => {
  try {
    await withCommLock(async () => {
      const { userId, threadId } = req.body || {};
      if (!(await commRequireAdmin(userId, res))) return;
      const threads = (await readKv(MESSAGES_KEY)) || [];
      await writeKv(MESSAGES_KEY, threads.filter((t) => t.id !== threadId));
      res.json({ ok: true });
    });
  } catch (e) {
    console.error('[messagerie] delete :', e);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/messages/broadcast', async (req, res) => {
  try {
    await withCommLock(async () => {
      const { userId, audience, subject, body } = req.body || {};
      const admin = await commRequireAdmin(userId, res);
      if (!admin) return;
      const aud = commCleanAudience(audience);
      const text = commClip(body, 5000);
      if (!aud) return res.status(400).json({ error: 'Destinataires invalides.' });
      if (!text) return res.status(400).json({ error: 'Le message est vide.' });
      const users = (await readKv(USERS_KEY)) || [];
      const students = aud.type === 'class' ? (await readKv(STUDENTS_KEY)) || [] : [];
      const recipients = commResolveAudience(aud, users, students);
      if (recipients.length === 0) return res.status(400).json({ error: 'Aucun destinataire trouvé.' });
      const threads = (await readKv(MESSAGES_KEY)) || [];
      const now = new Date().toISOString();
      const subj = commClip(subject, 150) || 'Message de l\'établissement';
      recipients.forEach((r) => {
        threads.push({
          id: commId('t'),
          parentId: r.id,
          parentName: r.name || 'Parent',
          subject: subj,
          createdAt: now,
          lastMessageAt: now,
          lastFromRole: 'admin',
          adminReadAt: now,
          messages: [
            { id: commId('m'), fromRole: 'admin', fromUserId: admin.id, fromName: admin.name || 'Administration', body: text, createdAt: now, kind: 'broadcast' },
          ],
        });
      });
      await writeKv(MESSAGES_KEY, threads);
      console.log(`[messagerie] Message collectif envoyé à ${recipients.length} destinataire(s) par ${admin.id}`);
      res.json({ count: recipients.length });
    });
  } catch (e) {
    console.error('[messagerie] broadcast :', e);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

// --- Popups ---
app.post('/api/popups/send', async (req, res) => {
  try {
    await withCommLock(async () => {
      const { userId, title, body, level, audience, expiresInMinutes, requireAck } = req.body || {};
      const admin = await commRequireAdmin(userId, res);
      if (!admin) return;
      const aud = commCleanAudience(audience);
      const t = commClip(title, 120);
      const b = commClip(body, 2000);
      if (!aud) return res.status(400).json({ error: 'Destinataires invalides.' });
      if (!t || !b) return res.status(400).json({ error: 'Titre et message obligatoires.' });
      const lvl = ['info', 'important', 'urgent'].includes(level) ? level : 'info';
      const minutes = Number(expiresInMinutes);
      const now = new Date();
      const popup = {
        id: commId('p'),
        title: t,
        body: b,
        level: lvl,
        audience: aud,
        requireAck: lvl === 'urgent' ? true : !!requireAck,
        createdAt: now.toISOString(),
        createdBy: admin.id,
        createdByName: admin.name || 'Administration',
        expiresAt: Number.isFinite(minutes) && minutes > 0 ? new Date(now.getTime() + Math.min(minutes, 60 * 24 * 365) * 60000).toISOString() : null,
        active: true,
        acks: {},
      };
      const popups = (await readKv(POPUPS_KEY)) || [];
      popups.push(popup);
      await writeKv(POPUPS_KEY, popups);
      const users = (await readKv(USERS_KEY)) || [];
      const students = aud.type === 'class' ? (await readKv(STUDENTS_KEY)) || [] : [];
      const recipients = commResolveAudience(aud, users, students).length;
      console.log(`[messagerie] Popup "${t}" (${lvl}) publié pour ${recipients} destinataire(s) par ${admin.id}`);
      res.json({ popup: popupPublicView(popup), recipients });
    });
  } catch (e) {
    console.error('[messagerie] popup send :', e);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/popups/list', async (req, res) => {
  try {
    if (!(await commRequireAdmin(req.body && req.body.userId, res))) return;
    const popups = (await readKv(POPUPS_KEY)) || [];
    const users = (await readKv(USERS_KEY)) || [];
    const students = (await readKv(STUDENTS_KEY)) || [];
    const now = new Date().toISOString();
    const out = popups
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((p) => ({
        ...popupPublicView(p),
        audience: p.audience,
        createdByName: p.createdByName,
        expiresAt: p.expiresAt,
        active: p.active,
        status: popupStatus(p, now),
        recipients: commResolveAudience(p.audience, users, students).length,
        acked: Object.keys(p.acks || {}).length,
      }));
    res.json({ popups: out });
  } catch (e) {
    console.error('[messagerie] popup list :', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/popups/deactivate', async (req, res) => {
  try {
    await withCommLock(async () => {
      const { userId, popupId } = req.body || {};
      if (!(await commRequireAdmin(userId, res))) return;
      const popups = (await readKv(POPUPS_KEY)) || [];
      const p = popups.find((x) => x.id === popupId);
      if (!p) return res.status(404).json({ error: 'Popup introuvable.' });
      p.active = false;
      await writeKv(POPUPS_KEY, popups);
      res.json({ ok: true });
    });
  } catch (e) {
    console.error('[messagerie] popup deactivate :', e);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/popups/delete', async (req, res) => {
  try {
    await withCommLock(async () => {
      const { userId, popupId } = req.body || {};
      if (!(await commRequireAdmin(userId, res))) return;
      const popups = (await readKv(POPUPS_KEY)) || [];
      await writeKv(POPUPS_KEY, popups.filter((x) => x.id !== popupId));
      res.json({ ok: true });
    });
  } catch (e) {
    console.error('[messagerie] popup delete :', e);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/popups/ack', async (req, res) => {
  try {
    await withCommLock(async () => {
      const { userId, popupId } = req.body || {};
      const user = await commGetUser(userId);
      if (!user) return res.status(403).json({ error: 'Utilisateur inconnu.' });
      const popups = (await readKv(POPUPS_KEY)) || [];
      const p = popups.find((x) => x.id === popupId);
      if (!p) return res.status(404).json({ error: 'Popup introuvable.' });
      p.acks = p.acks || {};
      if (!p.acks[user.id]) p.acks[user.id] = new Date().toISOString();
      await writeKv(POPUPS_KEY, popups);
      res.json({ ok: true });
    });
  } catch (e) {
    console.error('[messagerie] popup ack :', e);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Popups « tous les parents » visibles sans connexion (lien direct) : aucune donnée personnelle
app.get('/api/popups/public', async (req, res) => {
  try {
    const popups = (await readKv(POPUPS_KEY)) || [];
    const now = new Date().toISOString();
    res.json({
      popups: popups
        .filter((p) => popupStatus(p, now) === 'active' && p.audience && p.audience.type === 'all_parents')
        .sort((a, b) => (POPUP_LEVEL_RANK[a.level] - POPUP_LEVEL_RANK[b.level]) || (a.createdAt < b.createdAt ? 1 : -1))
        .map(popupPublicView),
    });
  } catch (e) {
    console.error('[messagerie] popup public :', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

MSGEOF_X

echo ">>> Patch de server/index.js ..."
replace_once "$SRV" "app.use(express.json({ limit: '15mb' }));" "$(cat "$TMP/server_comm.js")"

# --- 4. App.tsx : bouton Messagerie + popups pour les utilisateurs connectes --
echo ">>> Patch de src/App.tsx ..."
replace_once "$APPF" "import { Header } from './components/Header';" "import { Header } from './components/Header';
import { CommunicationCenter } from './components/CommunicationCenter';"

cat > "$TMP/app_old.tsx" << 'MSGEOF_X'
      </footer>
    </div>
  );
}
MSGEOF_X
cat > "$TMP/app_new.tsx" << 'MSGEOF_X'
      </footer>

      {/* Messagerie interne + popups (build messagerie-20261001) */}
      <CommunicationCenter currentUser={currentUser} users={users} classes={classes} students={activeStudents} />
    </div>
  );
}
MSGEOF_X
replace_once "$APPF" "$(cat "$TMP/app_old.tsx")" "$(cat "$TMP/app_new.tsx")"

# --- 5. main.tsx : popups "tous les parents" pour le lien direct --------------
echo ">>> Patch de src/main.tsx ..."
replace_once "$MAINF" "import { bootstrapFromServer } from './utils/storage';" "import { bootstrapFromServer } from './utils/storage';
import { AnonymousPopups } from './components/AnonymousPopups';"
replace_once "$MAINF" "<App />" "<App />
      {isMagicLinkAccess && <AnonymousPopups />}"

# --- 6. Reconstruction ------------------------------------------------------
PATCHING=0
if [ "${SKIP_BUILD:-0}" = "1" ]; then
  echo ">>> SKIP_BUILD=1 : pas de reconstruction Docker."
  exit 0
fi

echo ">>> Reconstruction de l'application (1 a 3 minutes) ..."
cd "$APP_DIR"
if ! docker compose up -d --build; then
  echo ""
  echo "!!! ECHEC de la reconstruction Docker. L'ancien conteneur reste en service s'il tournait."
  echo "!!! Pour revenir en arriere : cp -a $BACKUP_DIR/server $BACKUP_DIR/src $APP_DIR/ && rm -f $(for f in $NEWFILES; do printf '%s ' "$APP_DIR/$f"; done)"
  exit 1
fi

echo ">>> Attente du demarrage ..."
APP_PORT_VAL="$(grep -E '^APP_PORT=' .env 2>/dev/null | cut -d= -f2 || true)"
APP_PORT_VAL="${APP_PORT_VAL:-8099}"
for i in $(seq 1 30); do
  if curl -fsS "http://localhost:$APP_PORT_VAL/health" >/dev/null 2>&1; then
    echo ">>> /health OK"
    break
  fi
  sleep 2
done

echo ">>> Verification : les messages ne sont pas exposes par /api/data ..."
code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$APP_PORT_VAL/api/data/cerfa_messages_v1" || true)"
[ "$code" = "403" ] && echo ">>> OK (403 attendu)" || echo "!!! ATTENTION : code $code au lieu de 403 sur /api/data/cerfa_messages_v1"

cat << MSG

============================================================
 TERMINE - build $BUILD
 - Bouton "Messagerie" (en bas a gauche) pour parents, accompagnateurs, administration.
 - Administration : onglets Messages / Nouveau message / Popups.
 - Les popups apparaissent chez les parents en moins de 15 secondes.
 Retour arriere possible : copie dans $BACKUP_DIR
 IMPORTANT : videz le cache du navigateur (Ctrl+F5).
 Console navigateur : "[fichesanitaire] build messagerie-20261001"
 Logs serveur : docker compose logs app | grep messagerie
============================================================
MSG
