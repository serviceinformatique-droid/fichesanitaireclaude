#!/bin/bash
# ============================================================================
# patch-parent-guard.sh  -  build parent-guard-20261002
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# Empeche les "fiches orphelines" (fiche sans parent rattache) :
#  - SERVEUR : une NOUVELLE fiche sans identifiant de parent est refusee (HTTP 400,
#    "parent-required") ; un enregistrement qui ne contient pas le parent N'EFFACE JAMAIS
#    le parent deja enregistre sur la fiche (lien direct et portail connecte).
#  - NAVIGATEUR : "Ajouter un enfant" est refuse si la session n'a pas d'identifiant
#    (message : se deconnecter puis se reconnecter) ; l'espace famille n'affiche plus
#    jamais les fiches sans parent a une session sans identifiant (avant : deux valeurs
#    "absentes" etaient considerees comme egales, donc une session vide voyait toutes
#    les fiches orphelines des autres familles).
#
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/patch-parent-guard.sh && /root/patch-parent-guard.sh
# ============================================================================
set -e

APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"
BUILD="parent-guard-20261002"
BACKUP_DIR="$APP_DIR/backup-avant-$BUILD"
FILES="server/index.js src/App.tsx src/components/ParentSpace.tsx"
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
APPF="$APP_DIR/src/App.tsx"
PS="$APP_DIR/src/components/ParentSpace.tsx"

m=0
grep -q "parentIdGuard" "$SRV" && m=$((m+1))
grep -q "Votre session n'est plus valide" "$APPF" && m=$((m+1))
grep -q "Boolean(currentUser.id) && s.parentId === currentUser.id" "$PS" && m=$((m+1))
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

# --- 2. Serveur ---------------------------------------------------------------
cat > "$TMP/server_guard.js" << 'PGEOF_X'
app.use(express.json({ limit: '15mb' }));

// --- Protection du parent d'une fiche (build parent-guard-20261002) ---
// 1) Une NOUVELLE fiche sans identifiant de parent est refusée (sinon elle serait invisible
//    pour tous les comptes : fiche « orpheline »).
// 2) Un enregistrement ne peut jamais EFFACER le parent déjà enregistré sur la fiche.
async function parentIdGuard(req, res, next) {
  try {
    const incoming = req.body && req.body.student;
    if (incoming && incoming.id) {
      const list = (await readKv(STUDENTS_KEY)) || [];
      const stored = list.find((s) => s && s.id === incoming.id);
      if (stored) {
        if (stored.parentId && !incoming.parentId) {
          incoming.parentId = stored.parentId;
          console.log(`[parent-guard] parentId conservé pour la fiche ${incoming.id} (l'enregistrement reçu ne le contenait pas)`);
        }
      } else if (!incoming.parentId) {
        console.log(`[parent-guard] Création refusée : fiche ${incoming.id} sans parent`);
        return res.status(400).json({ error: 'parent-required' });
      }
    }
  } catch (e) {
    console.error('[parent-guard] Erreur de contrôle :', e);
  }
  next();
}
app.post('/api/students/upsert', parentIdGuard);
app.put('/api/magic-link/:token', parentIdGuard);
PGEOF_X

echo ">>> Patch de server/index.js ..."
replace_once "$SRV" "app.use(express.json({ limit: '15mb' }));" "$(cat "$TMP/server_guard.js")"

# --- 3. App.tsx : refuser "Ajouter un enfant" si la session n'a pas d'identifiant ----
echo ">>> Patch de src/App.tsx ..."
cat > "$TMP/app_old.tsx" << 'PGEOF_X'
    if (!currentUser) return;

    const newCerfa: CerfaSanitarySheet = createBlankCerfa({
PGEOF_X
cat > "$TMP/app_new.tsx" << 'PGEOF_X'
    if (!currentUser) return;
    if (!currentUser.id) {
      showToast("Votre session n'est plus valide : déconnectez-vous puis reconnectez-vous avant d'ajouter un enfant.", 'warning');
      return;
    }

    const newCerfa: CerfaSanitarySheet = createBlankCerfa({
PGEOF_X
replace_once "$APPF" "$(cat "$TMP/app_old.tsx")" "$(cat "$TMP/app_new.tsx")"

# --- 4. ParentSpace : jamais de fiche orpheline pour une session sans identifiant ----
echo ">>> Patch de src/components/ParentSpace.tsx ..."
replace_once "$PS" \
  "const myChildren = students.filter((s) => s.parentId === currentUser.id);" \
  "const myChildren = students.filter((s) => Boolean(currentUser.id) && s.parentId === currentUser.id);"

# --- 5. Reconstruction ------------------------------------------------------
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
 - Serveur : une fiche sans parent est refusee ; le parent d'une fiche n'est jamais efface.
 - Navigateur : "Ajouter un enfant" refuse si la session n'a pas d'identifiant.
 Retour arriere possible : copie dans $BACKUP_DIR
 IMPORTANT : videz le cache du navigateur (Ctrl+F5).
 Logs serveur : docker compose logs app | grep parent-guard
============================================================
MSG
