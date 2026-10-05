#!/bin/bash
# ============================================================================
# patch-comptes.sh  -  build switch-admin-20261002
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# 1) LISTE DES COMPTES PAR ORDRE ALPHABETIQUE (selecteur de l'en-tete et fenetre
#    "Selection du profil") : regroupee par Administrateurs / Professeurs / Parents,
#    triee sans tenir compte des accents ni des majuscules, et en ignorant le titre
#    des professeurs ("Mme CHERIF", "M. MATTARD", "M.ROMERO" sont classes sur CHERIF,
#    MATTARD, ROMERO).
# 2) RETOUR A L'ADMINISTRATEUR SANS SE DECONNECTER : quand l'administrateur consulte
#    un compte professeur ou parent, un bouton "Revenir a <son nom>" apparait dans
#    l'en-tete, le selecteur reste disponible (on peut passer directement d'un compte
#    a un autre) et l'onglet "Espace Administrateur" ramene aussi a son compte, sans
#    mot de passe. Le retour est memorise pour l'onglet du navigateur seulement
#    (sessionStorage) : il disparait a la deconnexion ou a la fermeture de l'onglet.
#
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/patch-comptes.sh && /root/patch-comptes.sh
# ============================================================================
set -e

APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"
BUILD="switch-admin-20261002"
BACKUP_DIR="$APP_DIR/backup-avant-$BUILD"
FILES="src/App.tsx src/components/Header.tsx src/components/LoginModal.tsx"
NEWFILES="src/utils/sortUsers.ts"
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

APPF="$APP_DIR/src/App.tsx"
HDR="$APP_DIR/src/components/Header.tsx"
LGN="$APP_DIR/src/components/LoginModal.tsx"

m=0
grep -q "originAdminId" "$APPF" && m=$((m+1))
grep -q "sortUsersByName" "$HDR" && m=$((m+1))
grep -q "sortUsersByName" "$LGN" && m=$((m+1))
for f in $NEWFILES; do [ -f "$APP_DIR/$f" ] && m=$((m+1)); done
if [ "$m" -eq 4 ]; then
  echo ">>> Patch deja applique. Rien a faire."
  exit 0
elif [ "$m" -gt 0 ]; then
  echo "ERREUR : etat partiel detecte ($m/4 elements deja en place)."
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

# --- 2. Utilitaire de tri ---------------------------------------------------
echo ">>> Creation de src/utils/sortUsers.ts ..."
cat > "$APP_DIR/src/utils/sortUsers.ts" << 'PRIEOF_X'
console.log('[fichesanitaire] build switch-admin-20261002');

import type { User } from '../types';

// Clé de tri d'un compte : sans titre de civilité (« Mme CHERIF », « M. MATTARD », « M.ROMERO »
// sont classés sur CHERIF, MATTARD, ROMERO), insensible aux accents et à la casse.
export function userSortKey(u: Pick<User, 'name'>): string {
  const name = String(u && u.name ? u.name : '').trim();
  const stripped = name.replace(/^(?:mme|mlle|mr|m\.|monsieur|madame|mademoiselle|dr|pr)\.?\s*/i, '').trim();
  return (stripped || name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function sortUsersByName(list: User[]): User[] {
  return [...list].sort((a, b) => userSortKey(a).localeCompare(userSortKey(b), 'fr', { sensitivity: 'base', numeric: true }));
}
PRIEOF_X

# --- 3. En-tete : liste triee + retour a l'administrateur ----------------------
echo ">>> Patch de src/components/Header.tsx ..."
replace_once "$HDR" "import { LoginModal } from './LoginModal';" "import { LoginModal } from './LoginModal';
import { sortUsersByName } from '../utils/sortUsers';"

replace_once "$HDR" "  onSwitchUser: (user: User) => void;
  notifications: NotificationItem[];" "  onSwitchUser: (user: User) => void;
  // Administrateur d'origine quand il consulte un autre compte (retour sans reconnexion)
  originAdmin?: User | null;
  notifications: NotificationItem[];"

replace_once "$HDR" "  onSwitchUser,
  notifications,
  onMarkNotificationRead," "  onSwitchUser,
  originAdmin = null,
  notifications,
  onMarkNotificationRead,"

cat > "$TMP/hdr_tab_old.tsx" << 'PRIEOF_X'
    if (currentUser.role === 'admin') {
      onSelectTab(tab);
      return;
    }
PRIEOF_X
cat > "$TMP/hdr_tab_new.tsx" << 'PRIEOF_X'
    if (currentUser.role === 'admin') {
      onSelectTab(tab);
      return;
    }

    // L'administrateur qui consulte un autre compte retrouve son espace sans mot de passe
    if (originAdmin && tab === 'admin') {
      onSwitchUser(originAdmin);
      return;
    }
PRIEOF_X
replace_once "$HDR" "$(cat "$TMP/hdr_tab_old.tsx")" "$(cat "$TMP/hdr_tab_new.tsx")"

replace_once "$HDR" "    if (currentUser.role === 'admin') {
      // Admin has instant access to all without password" "    if (currentUser.role === 'admin' || originAdmin) {
      // Admin (ou admin en consultation d'un autre compte) : accès immédiat sans mot de passe"

replace_once "$HDR" "            {currentUser.role === 'admin' && (
              <div className=\"flex items-center gap-2\">" "            {(currentUser.role === 'admin' || originAdmin) && (
              <div className=\"flex items-center gap-2\">"

replace_once "$HDR" "                  onClick={() => {
                    setPendingTargetUser(null);
                    setPendingTargetTabName('Sélection du profil');" "                  onClick={() => {
                    if (originAdmin && currentUser.role !== 'admin') {
                      onSwitchUser(originAdmin);
                      return;
                    }
                    setPendingTargetUser(null);
                    setPendingTargetTabName('Sélection du profil');"

replace_once "$HDR" ": 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'" ": 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'"

cat > "$TMP/hdr_lbl_old.tsx" << 'PRIEOF_X'
                    <>
                      <Lock className="w-3.5 h-3.5 text-slate-500" />
                      <span className="hidden sm:inline">Changer de compte</span>
                    </>
PRIEOF_X
cat > "$TMP/hdr_lbl_new.tsx" << 'PRIEOF_X'
                    <>
                      <ShieldCheck className="w-3.5 h-3.5 text-amber-700" />
                      <span data-testid="return-admin">Revenir à {originAdmin ? originAdmin.name : 'l\'administrateur'}</span>
                    </>
PRIEOF_X
replace_once "$HDR" "$(cat "$TMP/hdr_lbl_old.tsx")" "$(cat "$TMP/hdr_lbl_new.tsx")"

cat > "$TMP/hdr_list_old.tsx" << 'PRIEOF_X'
                  {(currentUser.role === 'admin' ? users : users.filter((u) => u.role === currentUser.role)).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.role === 'parent' ? '👨‍👩‍👧 ' : u.role === 'organizer' ? '📋 ' : '🛡️ '}
                      {u.name} ({u.role === 'admin' ? 'Admin' : u.role === 'organizer' ? 'Prof' : 'Parent'})
                    </option>
                  ))}
PRIEOF_X
cat > "$TMP/hdr_list_new.tsx" << 'PRIEOF_X'
                  {(['admin', 'organizer', 'parent'] as const).map((r) => {
                    const group = sortUsersByName(users.filter((u) => u.role === r));
                    if (group.length === 0) return null;
                    return (
                      <optgroup
                        key={r}
                        label={r === 'admin' ? 'Administrateurs' : r === 'organizer' ? 'Professeurs' : `Parents (${group.length})`}
                      >
                        {group.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.role === 'parent' ? '👨‍👩‍👧 ' : u.role === 'organizer' ? '📋 ' : '🛡️ '}
                            {u.name} ({u.role === 'admin' ? 'Admin' : u.role === 'organizer' ? 'Prof' : 'Parent'})
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
PRIEOF_X
replace_once "$HDR" "$(cat "$TMP/hdr_list_old.tsx")" "$(cat "$TMP/hdr_list_new.tsx")"

# --- 4. Fenetre "Selection du profil" : liste triee ----------------------------
echo ">>> Patch de src/components/LoginModal.tsx ..."
replace_once "$LGN" "import { User } from '../types';" "import { User } from '../types';
import { sortUsersByName } from '../utils/sortUsers';"
replace_once "$LGN" "  const selectableUsers = isAdmin ? users : users.filter((u) => u.role === currentUser.role);" "  const selectableUsers = sortUsersByName(isAdmin ? users : users.filter((u) => u.role === currentUser.role));"

# --- 5. App : memorisation de l'administrateur d'origine ------------------------
echo ">>> Patch de src/App.tsx ..."
cat > "$TMP/app_state.tsx" << 'PRIEOF_X'
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // Administrateur d'origine quand il consulte un autre compte : retour en un clic, sans se
  // reconnecter. Mémorisé pour l'onglet du navigateur seulement (sessionStorage).
  const ORIGIN_ADMIN_KEY = 'cerfa_origin_admin_id';
  const [originAdminId, setOriginAdminId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(ORIGIN_ADMIN_KEY);
    } catch {
      return null;
    }
  });
  const updateOriginAdmin = (id: string | null) => {
    setOriginAdminId(id);
    try {
      if (id) sessionStorage.setItem(ORIGIN_ADMIN_KEY, id);
      else sessionStorage.removeItem(ORIGIN_ADMIN_KEY);
    } catch {
      /* stockage indisponible : le retour fonctionne tant que la page reste ouverte */
    }
  };
PRIEOF_X
replace_once "$APPF" "  const [currentUser, setCurrentUser] = useState<User | null>(null);" "$(cat "$TMP/app_state.tsx")"

replace_once "$APPF" "    clearStoredCurrentUserId();
    showToast('Déconnexion effectuée. À bientôt !', 'info');" "    clearStoredCurrentUserId();
    updateOriginAdmin(null);
    showToast('Déconnexion effectuée. À bientôt !', 'info');"

replace_once "$APPF" "  const handleSwitchUser = (newUser: User) => {
    setCurrentUser(newUser);" "  const handleSwitchUser = (newUser: User) => {
    // Un administrateur qui consulte un autre compte garde la possibilité d'y revenir
    if (currentUser && currentUser.role === 'admin' && newUser.role !== 'admin') updateOriginAdmin(currentUser.id);
    else if (newUser.role === 'admin') updateOriginAdmin(null);
    setCurrentUser(newUser);"

replace_once "$APPF" "        onSwitchUser={handleSwitchUser}
" "        onSwitchUser={handleSwitchUser}
        originAdmin={originAdminId ? users.find((u) => u.id === originAdminId && u.role === 'admin') || null : null}
"

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
  echo "!!! Pour revenir en arriere : cp -a $BACKUP_DIR/src $APP_DIR/ && rm -f $APP_DIR/src/utils/sortUsers.ts"
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
 - Liste des comptes classee par ordre alphabetique (Administrateurs / Professeurs / Parents).
 - Apres avoir choisi un professeur ou un parent, le bouton "Revenir a <votre nom>"
   (en haut a droite) vous ramene a votre compte administrateur sans vous deconnecter.
 Retour arriere possible : copie dans $BACKUP_DIR
 IMPORTANT : videz le cache du navigateur (Ctrl+F5).
 Console navigateur : "[fichesanitaire] build switch-admin-20261002"
============================================================
MSG
