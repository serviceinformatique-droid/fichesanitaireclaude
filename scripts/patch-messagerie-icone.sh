#!/bin/bash
# ============================================================================
# patch-messagerie-icone.sh  -  build comm-badge-20261005
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# MESSAGERIE (bouton en bas a gauche, pour les parents et l'administration) :
#  - bouton PLUS GRAND : icone 32 px (au lieu de 20), bouton d'au moins 64 px de haut,
#    texte "Messagerie" plus gros ;
#  - le NOMBRE de nouveaux messages devient une grosse pastille ronde rouge, collee au coin
#    du bouton, avec un liseré blanc, et elle CLIGNOTE (rouge / jaune) ;
#  - le bouton lui-meme est entoure d'un halo rouge qui pulse tant qu'il y a des messages non lus ;
#  - sans message non lu : bouton calme, pas de pastille ;
#  - accessibilite : si l'appareil demande moins de mouvement, plus d'animation (la pastille
#    reste grande et rouge) ; "99+" au-dela de 99 ; infobulle "N nouveaux messages".
#
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/patch-messagerie-icone.sh && /root/patch-messagerie-icone.sh
# ============================================================================
set -e

APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"
BUILD="comm-badge-20261005"
BACKUP_DIR="$APP_DIR/backup-avant-$BUILD"
FILES="src/components/CommunicationCenter.tsx src/index.css"
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

CMP="$APP_DIR/src/components/CommunicationCenter.tsx"
CSS="$APP_DIR/src/index.css"

m=0
grep -q "comm-badge-blink" "$CMP" && m=$((m+1))
grep -q "commBadgeBlink" "$CSS" && m=$((m+1))
if [ "$m" -eq 2 ]; then
  echo ">>> Patch deja applique. Rien a faire."
  exit 0
elif [ "$m" -gt 0 ]; then
  echo "ERREUR : etat partiel detecte ($m/2 fichiers deja modifies)."
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

# --- 2. Bouton et pastille -------------------------------------------------------
echo ">>> Patch de src/components/CommunicationCenter.tsx ..."
cat > "$TMP/btn_old.txt" << 'CMBEOF_X'
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
CMBEOF_X
cat > "$TMP/btn_new.txt" << 'CMBEOF_X'
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
CMBEOF_X
replace_once "$CMP" "$(cat "$TMP/btn_old.txt")" "$(cat "$TMP/btn_new.txt")"

# --- 3. Animations (CSS) -----------------------------------------------------------
echo ">>> Patch de src/index.css ..."
cat >> "$CSS" << 'CMBEOF_X'

/* ============================================================================
   Messagerie : bouton agrandi + pastille de messages non lus CLIGNOTANTE
   (build comm-badge-20261005). Les animations sont coupées pour les personnes qui
   demandent moins de mouvement (prefers-reduced-motion) : la pastille reste grande et rouge.
   ============================================================================ */
@keyframes commBadgeBlink {
  0%, 100% { transform: scale(1); background-color: #dc2626; color: #ffffff; }
  50% { transform: scale(1.25); background-color: #facc15; color: #7f1d1d; }
}
@keyframes commButtonOutline {
  0%, 100% { outline-offset: 0; outline-color: rgba(220, 38, 38, 0.95); }
  50% { outline-offset: 9px; outline-color: rgba(220, 38, 38, 0.1); }
}
.comm-badge-blink { animation: commBadgeBlink 1s ease-in-out infinite; }
.comm-button-alert { outline: 4px solid rgba(220, 38, 38, 0.95); animation: commButtonOutline 1.3s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .comm-badge-blink, .comm-button-alert { animation: none; }
}
CMBEOF_X

# --- 4. Reconstruction ------------------------------------------------------
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
  echo "!!! Pour revenir en arriere : cp -a $BACKUP_DIR/src $APP_DIR/"
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
 - Bouton Messagerie plus grand ; pastille du nombre de nouveaux messages grosse,
   rouge, clignotante ; halo rouge autour du bouton tant que des messages sont non lus.
 Retour arriere possible : copie dans $BACKUP_DIR
 IMPORTANT : videz le cache du navigateur (Ctrl+F5).
============================================================
MSG
