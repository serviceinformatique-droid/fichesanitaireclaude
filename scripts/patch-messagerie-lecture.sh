#!/bin/bash
# ============================================================================
# patch-messagerie-lecture.sh  -  build comm-read-20261006
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# MESSAGERIE : SAVOIR SI UN MESSAGE EST LU OU PAS.
#  - sous chaque message que VOUS avez envoye : "✓✓ Lu par le parent · date et heure"
#    (vert) ou "✓ Envoye · pas encore lu par le parent" (orange) ; cote parent :
#    "Lu par l'etablissement" / "pas encore lu" ;
#  - dans la liste des conversations : etiquette "✓✓ Lu" / "✓ Non lu" sur votre dernier message ;
#  - nouveau filtre (administration) : "Envoyes, pas encore lus par le parent (N)" ;
#  - le serveur enregistre la date de PREMIERE lecture de chaque message ; les anciens messages
#    sont consideres comme lus a la derniere ouverture de la conversation ;
#  - une conversation ouverte a l'ecran est marquee lue des qu'un nouveau message arrive
#    (plus de faux "pas encore lu" quand le destinataire a le message sous les yeux).
#
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/patch-messagerie-lecture.sh && /root/patch-messagerie-lecture.sh
# ============================================================================
set -e

APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"
BUILD="comm-read-20261006"
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
  [ -f "$APP_DIR/$f" ] || { echo "ERREUR : $APP_DIR/$f introuvable (la messagerie est-elle installee ?)."; exit 1; }
done
command -v perl >/dev/null || { echo "ERREUR : perl est requis (apt install -y perl)."; exit 1; }

SRV="$APP_DIR/server/index.js"
MSG="$APP_DIR/src/utils/messaging.ts"
CMP="$APP_DIR/src/components/CommunicationCenter.tsx"

grep -q "/api/messages/read" "$SRV" || { echo "ERREUR : la messagerie (patch-messagerie) n'est pas installee : appliquez-la d'abord."; exit 1; }

m=0
grep -q "Date de PREMIERE lecture" "$SRV" && m=$((m+1))
grep -q "readAt" "$MSG" && m=$((m+1))
grep -q "comm-filter-unseen" "$CMP" && m=$((m+1))
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
cat > "$TMP/e1_old.txt" << 'CRDEOF_X'
      const now = new Date().toISOString();
      if (user.role === 'admin') t.adminReadAt = now;
      else t.userReadAt = now;
CRDEOF_X
cat > "$TMP/e1_new.txt" << 'CRDEOF_X'
      const now = new Date().toISOString();
      if (user.role === 'admin') t.adminReadAt = now;
      else t.userReadAt = now;
      // Date de PREMIERE lecture de chaque message reçu (accusé de lecture, build comm-read-20261006)
      (t.messages || []).forEach((m) => {
        const received = user.role === 'admin' ? m.fromRole === 'user' : m.fromRole === 'admin';
        if (received && !m.readAt) m.readAt = now;
      });
CRDEOF_X
replace_once "$SRV" "$(cat "$TMP/e1_old.txt")" "$(cat "$TMP/e1_new.txt")"

cat > "$TMP/e2_old.txt" << 'CRDEOF_X'
  return { ...t, unread };
CRDEOF_X
cat > "$TMP/e2_new.txt" << 'CRDEOF_X'
  // Accusé de lecture : les anciens messages (sans date de lecture enregistrée) sont considérés comme lus
  // à la dernière ouverture de la conversation par leur destinataire, si elle est postérieure à l'envoi.
  const messages = (t.messages || []).map((m) => {
    if (m.readAt) return m;
    const stamp = m.fromRole === 'admin' ? t.userReadAt : t.adminReadAt;
    return stamp && stamp >= m.createdAt ? { ...m, readAt: stamp } : m;
  });
  return { ...t, messages, unread };
CRDEOF_X
replace_once "$SRV" "$(cat "$TMP/e2_old.txt")" "$(cat "$TMP/e2_new.txt")"

cat > "$TMP/e3_old.txt" << 'CRDEOF_X'
  createdAt: string;
  kind?: 'broadcast';
}
CRDEOF_X
cat > "$TMP/e3_new.txt" << 'CRDEOF_X'
  createdAt: string;
  kind?: 'broadcast';
  readAt?: string; // première lecture par le destinataire (accusé de lecture)
}
CRDEOF_X
replace_once "$MSG" "$(cat "$TMP/e3_old.txt")" "$(cat "$TMP/e3_new.txt")"

cat > "$TMP/e4_old.txt" << 'CRDEOF_X'
  const [onlyUnread, setOnlyUnread] = useState(false);
CRDEOF_X
cat > "$TMP/e4_new.txt" << 'CRDEOF_X'
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [onlyUnseen, setOnlyUnseen] = useState(false);
CRDEOF_X
replace_once "$CMP" "$(cat "$TMP/e4_old.txt")" "$(cat "$TMP/e4_new.txt")"

cat > "$TMP/e5_old.txt" << 'CRDEOF_X'
  const visibleThreads = threads.filter((t) => {
    if (onlyUnread && !t.unread) return false;
CRDEOF_X
cat > "$TMP/e5_new.txt" << 'CRDEOF_X'
  // Messages envoyés par l'établissement et pas encore lus par le parent (build comm-read-20261006)
  const isUnseenByParent = (t: MessageThread) => {
    const lm = t.messages[t.messages.length - 1];
    return Boolean(lm) && lm.fromRole === 'admin' && !lm.readAt;
  };
  const unseenCount = threads.filter(isUnseenByParent).length;

  const visibleThreads = threads.filter((t) => {
    if (onlyUnread && !t.unread) return false;
    if (onlyUnseen && !isUnseenByParent(t)) return false;
CRDEOF_X
replace_once "$CMP" "$(cat "$TMP/e5_old.txt")" "$(cat "$TMP/e5_new.txt")"

cat > "$TMP/e6_old.txt" << 'CRDEOF_X'
              Non lus uniquement
            </label>
CRDEOF_X
cat > "$TMP/e6_new.txt" << 'CRDEOF_X'
              Non lus uniquement
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer" data-testid="comm-filter-unseen">
              <input type="checkbox" checked={onlyUnseen} onChange={(e) => setOnlyUnseen(e.target.checked)} />
              Envoyés, pas encore lus par le parent ({unseenCount})
            </label>
CRDEOF_X
replace_once "$CMP" "$(cat "$TMP/e6_old.txt")" "$(cat "$TMP/e6_new.txt")"

cat > "$TMP/e7_old.txt" << 'CRDEOF_X'
                <span className="ml-auto text-[10px] text-slate-400 shrink-0">{formatCommDate(t.lastMessageAt)}</span>
CRDEOF_X
cat > "$TMP/e7_new.txt" << 'CRDEOF_X'
                <span className="ml-auto flex items-center gap-1.5 shrink-0">
                  {last && (isAdmin ? last.fromRole === 'admin' : last.fromRole === 'user') && (
                    <span
                      className={`text-[10px] font-bold ${last.readAt ? 'text-emerald-600' : 'text-amber-600'}`}
                      title={last.readAt ? `Lu le ${formatCommDate(last.readAt)}` : 'Pas encore lu par le destinataire'}
                      data-testid="comm-list-readstate"
                    >
                      {last.readAt ? '✓✓ Lu' : '✓ Non lu'}
                    </span>
                  )}
                  <span className="text-[10px] text-slate-400">{formatCommDate(t.lastMessageAt)}</span>
                </span>
CRDEOF_X
replace_once "$CMP" "$(cat "$TMP/e7_old.txt")" "$(cat "$TMP/e7_new.txt")"

cat > "$TMP/e8_old.txt" << 'CRDEOF_X'
                <div className="whitespace-pre-wrap leading-relaxed">{m.body}</div>
CRDEOF_X
cat > "$TMP/e8_new.txt" << 'CRDEOF_X'
                <div className="whitespace-pre-wrap leading-relaxed">{m.body}</div>
                {mine && (
                  <div
                    className={`text-[10px] font-semibold mt-1 ${m.readAt ? 'text-emerald-300' : 'text-amber-300'}`}
                    data-testid="comm-readstate"
                  >
                    {m.readAt
                      ? `✓✓ Lu ${isAdmin ? 'par le parent' : "par l'établissement"} · ${formatCommDate(m.readAt)}`
                      : `✓ Envoyé · pas encore lu ${isAdmin ? 'par le parent' : "par l'établissement"}`}
                  </div>
                )}
CRDEOF_X
replace_once "$CMP" "$(cat "$TMP/e8_old.txt")" "$(cat "$TMP/e8_new.txt")"

cat > "$TMP/e9_old.txt" << 'CRDEOF_X'
  const openThread = async (t: MessageThread) => {
CRDEOF_X
cat > "$TMP/e9_new.txt" << 'CRDEOF_X'
  // Si la conversation est affichée à l'écran quand un nouveau message arrive, il est lu : on l'enregistre
  // (sinon l'expéditeur verrait « pas encore lu » alors que le destinataire a le message sous les yeux).
  useEffect(() => {
    if (!open || !selected || !selected.unread) return;
    const id = selected.id;
    markThreadRead(currentUser.id, id)
      .then(() => {
        setThreads((prev) => prev.map((x) => (x.id === id ? { ...x, unread: false } : x)));
        setUnread((u) => Math.max(0, u - 1));
      })
      .catch(() => {
        /* sans gravité */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selected?.id, selected?.unread, selected?.lastMessageAt]);

  const openThread = async (t: MessageThread) => {
CRDEOF_X
replace_once "$CMP" "$(cat "$TMP/e9_old.txt")" "$(cat "$TMP/e9_new.txt")"

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
 - Messagerie : "Lu / pas encore lu" sous chaque message envoye, etiquette dans la liste,
   filtre "Envoyes, pas encore lus par le parent".
 Retour arriere possible : copie dans $BACKUP_DIR
 IMPORTANT : videz le cache du navigateur (Ctrl+F5).
============================================================
MSG
