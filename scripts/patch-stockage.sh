#!/bin/bash
# ============================================================================
# patch-stockage.sh  -  build storage-fallback-20261004
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# CORRIGE : "nom de l'etablissement = Jean Moulin" + "mot de passe refuse" + portail
# qui ressemble a un autre portail (donnees de demonstration), alors que la base est intacte.
#
# CAUSE : au chargement, le navigateur copie TOUTE la base dans son stockage local
# (limite d'environ 5 Mo). Les fiches sont enregistrees EN PREMIER ; des que la base depasse
# la limite (pieces jointes en base64), l'enregistrement echoue (QuotaExceededError) et les
# cles suivantes - COMPTES, nom de l'etablissement, classes, voyages - ne sont jamais
# enregistrees : l'application affiche alors ses valeurs de demonstration.
#
# CORRECTION (src/utils/storage.ts uniquement) :
#  - les cles sont enregistrees de la plus PETITE a la plus GRANDE (comptes, nom, classes passent
#    toujours) ;
#  - si le stockage local est plein, la donnee reste disponible EN MEMOIRE pour la session
#    (plus d'echec) ; le cache local n'est qu'une optimisation.
#
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/patch-stockage.sh && /root/patch-stockage.sh
# ============================================================================
set -e

APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"
BUILD="storage-fallback-20261004"
BACKUP_DIR="$APP_DIR/backup-avant-$BUILD"
FILES="src/utils/storage.ts"
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

STO="$APP_DIR/src/utils/storage.ts"

if grep -q "kvStorage" "$STO"; then
  echo ">>> Patch deja applique. Rien a faire."
  exit 0
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

# --- 2. Chargement : cles de la plus petite a la plus grande -------------------
echo ">>> Patch de src/utils/storage.ts ..."
cat > "$TMP/boot_old.ts" << 'STOEOF_X'
    Object.entries(STORAGE_KEYS).forEach(([name, key]) => {
      if (name === 'CURRENT_USER_ID') return;
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        localStorage.setItem(key, JSON.stringify((data as any)[key]));
      }
    });
STOEOF_X
cat > "$TMP/boot_new.ts" << 'STOEOF_X'
    // Les clés sont enregistrées de la plus PETITE à la plus GRANDE : comptes, nom de l'établissement,
    // classes, voyages passent toujours, même si les fiches (volumineuses) dépassent le quota du navigateur.
    const entries = Object.entries(STORAGE_KEYS)
      .filter(([name, key]) => name !== 'CURRENT_USER_ID' && Object.prototype.hasOwnProperty.call(data, key))
      .map(([, key]) => [key, JSON.stringify((data as any)[key])] as [string, string])
      .sort((a, b) => a[1].length - b[1].length);
    for (const [key, value] of entries) kvStorage.setItem(key, value);
STOEOF_X
replace_once "$STO" "$(cat "$TMP/boot_old.ts")" "$(cat "$TMP/boot_new.ts")"

# --- 3. Tout le fichier passe par le cache tolerant au quota --------------------
perl -pi -e 's/\blocalStorage\./kvStorage./g' "$STO"
left="$(grep -c 'localStorage\.' "$STO" || true)"
[ "$left" = "0" ] || { echo "ERREUR : $left usage(s) de localStorage restant(s) dans storage.ts"; exit 1; }

cat > "$TMP/wrapper.ts" << 'STOEOF_X'
console.log('[fichesanitaire] build storage-fallback-20261004');

// Cache navigateur tolérant au quota (≈ 5 Mo). Quand localStorage est plein, la donnée reste
// disponible EN MÉMOIRE pour la session. Avant : une base de plus de 5 Mo faisait échouer le
// chargement (« QuotaExceededError ») → nom d'établissement par défaut, comptes de démonstration,
// mots de passe refusés, alors que la base du serveur était intacte.
const memStore = new Map<string, string>();
const kvStorage = {
  getItem(key: string): string | null {
    if (memStore.has(key)) return memStore.get(key) as string;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
      memStore.delete(key);
    } catch {
      // quota dépassé ou stockage bloqué : la valeur reste en mémoire ; l'ancienne copie locale
      // (périmée) est supprimée pour libérer de la place et ne jamais être relue après un rechargement
      memStore.set(key, value);
      try {
        localStorage.removeItem(key);
      } catch {
        /* stockage indisponible */
      }
    }
  },
  removeItem(key: string): void {
    memStore.delete(key);
    try {
      localStorage.removeItem(key);
    } catch {
      /* stockage indisponible */
    }
  },
};

STOEOF_X
replace_once "$STO" "const STORAGE_KEYS = {" "$(cat "$TMP/wrapper.ts")
const STORAGE_KEYS = {"

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
 - Le portail charge de nouveau les comptes et le nom de l'etablissement, quelle que soit
   la taille de la base (le cache du navigateur n'est plus une condition).
 Retour arriere possible : copie dans $BACKUP_DIR
 IMPORTANT : videz le cache du navigateur (Ctrl+F5) sur chaque poste.
 Console navigateur : "[fichesanitaire] build storage-fallback-20261004"
============================================================
MSG
