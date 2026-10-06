#!/bin/bash
# ============================================================================
# patch-messagerie-suppression.sh  -  build comm-delete-20261006
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# MESSAGERIE (administration) : supprimer LE MESSAGE QUE L'ON VEUT.
#  - dans une conversation, chaque message (des parents comme de l'etablissement) a un bouton
#    "Supprimer" avec confirmation (apercu du message) ; si c'etait le dernier message de la
#    conversation, la conversation disparait ;
#  - dans la liste, chaque conversation a une corbeille pour la supprimer en entier
#    (la corbeille de l'en-tete de conversation reste disponible) ;
#  - le compteur "non lus" des parents est recalcule (un message supprime ne reste jamais
#    "non lu") ; operation reservee a l'administrateur (controle serveur), tracee dans le
#    journal : docker compose logs app | grep messagerie ;
#  - les parents et les professeurs n'ont AUCUN bouton de suppression.
#
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/patch-messagerie-suppression.sh && /root/patch-messagerie-suppression.sh
# ============================================================================
set -e

APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"
BUILD="comm-delete-20261006"
BACKUP_DIR="$APP_DIR/backup-avant-$BUILD"
FILES="server/index.js src/utils/messaging.ts src/components/CommunicationCenter.tsx"
TMP="$(mktemp -d)"

PATCHING=0
cleanup() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ "$PATCHING" = "1" ]; then
    echo ""
    echo "!!! ERREUR pendant le patch : restauration automatique des fichiers d'origine ..."
    for f in $FILES; do cp -p "$BACKUP_DIR/$f" "$APP_DIR/$f"; done
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

SRV="$APP_DIR/server/index.js"
MSG="$APP_DIR/src/utils/messaging.ts"
CMP="$APP_DIR/src/components/CommunicationCenter.tsx"

grep -q "/api/messages/delete'" "$SRV" || { echo "ERREUR : la messagerie (patch-messagerie) n'est pas installee : appliquez-la d'abord."; exit 1; }

m=0
grep -q "/api/messages/delete-message" "$SRV" && m=$((m+1))
grep -q "deleteMessage" "$MSG" && m=$((m+1))
grep -q "comm-delete-message" "$CMP" && m=$((m+1))
if [ "$m" -eq 3 ]; then
  echo ">>> Patch deja applique. Rien a faire."
  exit 0
elif [ "$m" -gt 0 ]; then
  echo "ERREUR : etat partiel detecte ($m/3 fichiers deja modifies)."
  echo "Restaurez d'abord les fichiers d'origine depuis un backup-avant-* puis relancez ce script."
  exit 1
fi

# --- Fonctions utilitaires -------------------------------------------------
count_occ() { OLD="$2" perl -0777 -ne 'my $c = () = /\Q$ENV{OLD}\E/g; print $c' "$1"; }

replace_once() { # fichier  ancien_texte  nouveau_texte
  local file="$1" old="$2" new="$3" n
  n="$(count_occ "$file" "$old")"
  [ "$n" = "1" ] || { echo "ERREUR : repere trouve $n fois dans $file (attendu : 1) :"; echo "$old" | head -3; exit 1; }
  OLD="$old" NEW="$new" perl -0777 -i -pe 's/\Q$ENV{OLD}\E/$ENV{NEW}/' "$file"
}

# --- 1. Sauvegarde ----------------------------------------------------------
echo ">>> Sauvegarde dans $BACKUP_DIR ..."
for f in $FILES; do
  mkdir -p "$BACKUP_DIR/$(dirname "$f")"
  cp -p "$APP_DIR/$f" "$BACKUP_DIR/$f"
done
PATCHING=1

# --- 2. Modifications ---------------------------------------------------------
echo ">>> Modification des fichiers ..."
cat > "$TMP/e1_old.txt" << 'CDLEOF_X'
app.post('/api/messages/broadcast', async (req, res) => {
CDLEOF_X
cat > "$TMP/e1_new.txt" << 'CDLEOF_X'
// --- Suppression d'UN message d'une conversation (administrateur) - build comm-delete-20261006 ---
app.post('/api/messages/delete-message', async (req, res) => {
  try {
    await withCommLock(async () => {
      const { userId, threadId, messageId } = req.body || {};
      const admin = await commRequireAdmin(userId, res);
      if (!admin) return;
      const threads = (await readKv(MESSAGES_KEY)) || [];
      const idx = threads.findIndex((t) => t.id === threadId);
      if (idx < 0) return res.status(404).json({ error: 'Conversation introuvable.' });
      const t = threads[idx];
      const all = t.messages || [];
      const remaining = all.filter((m) => m.id !== messageId);
      if (remaining.length === all.length) return res.status(404).json({ error: 'Message introuvable.' });
      console.log(`[messagerie] message ${messageId} supprimé de la conversation ${threadId} par ${admin.id}`);
      if (remaining.length === 0) {
        threads.splice(idx, 1);
        await writeKv(MESSAGES_KEY, threads);
        return res.json({ ok: true, threadDeleted: true, thread: null });
      }
      const last = remaining[remaining.length - 1];
      t.messages = remaining;
      t.lastMessageAt = last.createdAt || t.lastMessageAt;
      t.lastFromRole = last.fromRole === 'admin' ? 'admin' : 'user';
      threads[idx] = t;
      await writeKv(MESSAGES_KEY, threads);
      res.json({ ok: true, threadDeleted: false, thread: commThreadForViewer(t, admin) });
    });
  } catch (e) {
    console.error('[messagerie] delete-message :', e);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/messages/broadcast', async (req, res) => {
CDLEOF_X
replace_once "$SRV" "$(cat "$TMP/e1_old.txt")" "$(cat "$TMP/e1_new.txt")"

cat > "$TMP/e2_old.txt" << 'CDLEOF_X'
export const deleteThread = (userId: string, threadId: string) =>
  api<{ ok: boolean }>('/api/messages/delete', { userId, threadId });
CDLEOF_X
cat > "$TMP/e2_new.txt" << 'CDLEOF_X'
export const deleteThread = (userId: string, threadId: string) =>
  api<{ ok: boolean }>('/api/messages/delete', { userId, threadId });

export const deleteMessage = (userId: string, threadId: string, messageId: string) =>
  api<{ ok: boolean; threadDeleted: boolean; thread: MessageThread | null }>('/api/messages/delete-message', {
    userId,
    threadId,
    messageId,
  });
CDLEOF_X
replace_once "$MSG" "$(cat "$TMP/e2_old.txt")" "$(cat "$TMP/e2_new.txt")"

cat > "$TMP/e3_old.txt" << 'CDLEOF_X'
  deleteThread,
  formatCommDate,
CDLEOF_X
cat > "$TMP/e3_new.txt" << 'CDLEOF_X'
  deleteThread,
  deleteMessage,
  formatCommDate,
CDLEOF_X
replace_once "$CMP" "$(cat "$TMP/e3_old.txt")" "$(cat "$TMP/e3_new.txt")"

cat > "$TMP/e4_old.txt" << 'CDLEOF_X'
  const handleSendPopup = async () => {
CDLEOF_X
cat > "$TMP/e4_new.txt" << 'CDLEOF_X'
  // Suppression d'UN message précis d'une conversation (administration) - build comm-delete-20261006
  const handleDeleteMessage = async (t: MessageThread, m: MessageThread['messages'][number]) => {
    const preview = m.body.length > 90 ? m.body.slice(0, 90) + '…' : m.body;
    if (!window.confirm(`Supprimer définitivement ce message ?\n\n« ${preview} »`)) return;
    try {
      const r = await deleteMessage(currentUser.id, t.id, m.id);
      if (r.threadDeleted || !r.thread) {
        setThreads((prev) => prev.filter((x) => x.id !== t.id));
        if (selectedId === t.id) setSelectedId(null);
      } else {
        const updated = r.thread;
        setThreads((prev) => prev.map((x) => (x.id === t.id ? { ...x, ...updated } : x)));
      }
    } catch (e: any) {
      setError(e.message || 'Suppression impossible.');
    }
  };

  const handleSendPopup = async () => {
CDLEOF_X
replace_once "$CMP" "$(cat "$TMP/e4_old.txt")" "$(cat "$TMP/e4_new.txt")"

cat > "$TMP/e5_old.txt" << 'CDLEOF_X'
          return (
            <button
              type="button"
              key={t.id}
              onClick={() => openThread(t)}
              className={`w-full text-left px-3 py-2.5 border-b border-slate-100 hover:bg-blue-50 cursor-pointer ${
                selectedId === t.id ? 'bg-blue-50' : ''
              }`}
            >
CDLEOF_X
cat > "$TMP/e5_new.txt" << 'CDLEOF_X'
          return (
            <div key={t.id} className="relative">
            <button
              type="button"
              onClick={() => openThread(t)}
              className={`w-full text-left px-3 py-2.5 border-b border-slate-100 hover:bg-blue-50 cursor-pointer ${
                selectedId === t.id ? 'bg-blue-50' : ''
              }`}
            >
CDLEOF_X
replace_once "$CMP" "$(cat "$TMP/e5_old.txt")" "$(cat "$TMP/e5_new.txt")"

cat > "$TMP/e6_old.txt" << 'CDLEOF_X'
              <div className="text-[11px] text-slate-500 truncate">{last ? last.body : ''}</div>
            </button>
          );
CDLEOF_X
cat > "$TMP/e6_new.txt" << 'CDLEOF_X'
              <div className={`text-[11px] text-slate-500 truncate ${isAdmin ? 'pr-8' : ''}`}>{last ? last.body : ''}</div>
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => handleDeleteThread(t)}
                className="absolute right-2 bottom-2 p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                title="Supprimer cette conversation"
                aria-label="Supprimer cette conversation"
                data-testid="comm-delete-thread"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            </div>
          );
CDLEOF_X
replace_once "$CMP" "$(cat "$TMP/e6_old.txt")" "$(cat "$TMP/e6_new.txt")"

cat > "$TMP/e7_old.txt" << 'CDLEOF_X'
                <div className={`text-[10px] mt-1 text-right ${mine ? 'text-blue-200' : 'text-slate-400'}`}>
                  {formatCommDate(m.createdAt)}
                </div>
CDLEOF_X
cat > "$TMP/e7_new.txt" << 'CDLEOF_X'
                <div className={`text-[10px] mt-1 flex items-center justify-between gap-4 ${mine ? 'text-blue-200' : 'text-slate-400'}`}>
                  {isAdmin ? (
                    <button
                      type="button"
                      onClick={() => handleDeleteMessage(selected, m)}
                      className={`inline-flex items-center gap-1 font-semibold cursor-pointer ${
                        mine ? 'text-blue-100 hover:text-white' : 'text-slate-500 hover:text-red-600'
                      }`}
                      title="Supprimer ce message"
                      aria-label="Supprimer ce message"
                      data-testid="comm-delete-message"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Supprimer
                    </button>
                  ) : (
                    <span />
                  )}
                  <span>{formatCommDate(m.createdAt)}</span>
                </div>
CDLEOF_X
replace_once "$CMP" "$(cat "$TMP/e7_old.txt")" "$(cat "$TMP/e7_new.txt")"

# --- 3. Reconstruction ------------------------------------------------------
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
  echo "!!! Pour revenir en arriere : cp -a $BACKUP_DIR/server $BACKUP_DIR/src $APP_DIR/"
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

cat << MSG

============================================================
 TERMINE - build $BUILD
 - Messagerie (administration) : bouton "Supprimer" sur chaque message, corbeille sur chaque
   conversation de la liste.
 Retour arriere possible : copie dans $BACKUP_DIR
 IMPORTANT : videz le cache du navigateur (Ctrl+F5).
============================================================
MSG
