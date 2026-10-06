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
import { WelcomeSettings } from './WelcomeSettings';
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

type AdminView = 'inbox' | 'compose' | 'popups' | 'welcome';

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
    ) : adminView === 'welcome' ? (
      <WelcomeSettings adminId={currentUser.id} />
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
        className={`fixed bottom-5 left-5 z-40 bg-blue-900 hover:bg-blue-950 text-white rounded-full shadow-2xl min-h-16 min-w-16 px-5 sm:px-7 py-4 inline-flex items-center justify-center gap-3 text-lg font-bold cursor-pointer print:hidden ${
          unread > 0 ? 'comm-button-alert' : 'ring-2 ring-white/70'
        }`}
        aria-label="Ouvrir la messagerie"
        title={unread > 0 ? `${unread} nouveau${unread > 1 ? 'x' : ''} message${unread > 1 ? 's' : ''}` : 'Messagerie'}
        data-testid="comm-button"
      >
        <MessageSquare className="w-8 h-8" />
        <span className="hidden sm:inline">Messagerie</span>
        {unread > 0 && (
          <span
            className="comm-badge-blink absolute -top-3 -right-3 bg-red-600 text-white text-lg font-extrabold rounded-full min-w-9 h-9 px-2 inline-flex items-center justify-center ring-4 ring-white shadow-lg"
            data-testid="comm-unread"
            aria-label={`${unread} message${unread > 1 ? 's' : ''} non lu${unread > 1 ? 's' : ''}`}
          >
            {unread > 99 ? '99+' : unread}
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
                    ['welcome', "Message d'accueil"],
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
