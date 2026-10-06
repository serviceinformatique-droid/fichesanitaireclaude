#!/bin/bash
# ============================================================================
# patch-message-accueil.sh  -  build welcome-text-20261006
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# MESSAGE D'ACCUEIL : PLUS DE « CREER UN COMPTE PAR ENFANT ».
# L'ancien texte poussait les parents a creer un compte par enfant (avec une adresse e-mail
# differente) au lieu d'utiliser le bouton « + Ajouter un enfant ». Nouveau texte :
#  - UN SEUL COMPTE pour toute la famille ;
#  - pour chaque enfant : bouton « + Ajouter un enfant » (« Ajouter mon premier enfant » la premiere fois) ;
#  - la consigne sur la signature d'un seul responsable et sur la fiche deja creee par l'autre
#    responsable est conservee ; la consigne sur l'adresse e-mail differente est supprimee.
# Si votre administration a ENREGISTRE le texte (Messagerie > Message d'accueil), il est corrige
# automatiquement au demarrage du serveur (une seule fois), sans toucher a vos autres modifications.
# Les messages d'accueil DEJA envoyes aux parents ne sont pas modifies (voir le message de rappel propose).
#
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/patch-message-accueil.sh && /root/patch-message-accueil.sh
# ============================================================================
set -e

APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"
BUILD="welcome-text-20261006"
BACKUP_DIR="$APP_DIR/backup-avant-$BUILD"
FILES="server/index.js"
TMP="$(mktemp -d)"

PATCHING=0
cleanup() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ "$PATCHING" = "1" ]; then
    echo ""
    echo "!!! ERREUR pendant le patch : restauration automatique du fichier d'origine ..."
    for f in $FILES; do cp -p "$BACKUP_DIR/$f" "$APP_DIR/$f"; done
    echo "!!! Fichier d'origine restaure : aucune modification n'a ete conservee."
    echo "!!! Envoyez le message d'erreur ci-dessus pour obtenir un script corrige."
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

echo ">>> Patch $BUILD sur $APP_DIR"

SRV="$APP_DIR/server/index.js"
[ -f "$SRV" ] || { echo "ERREUR : $SRV introuvable."; exit 1; }
command -v perl >/dev/null || { echo "ERREUR : perl est requis (apt install -y perl)."; exit 1; }

grep -q "WELCOME_DEFAULT_BODY" "$SRV" || { echo "ERREUR : le message d'accueil (patch-accueil) n'est pas installe : appliquez-le d'abord."; exit 1; }

if grep -q "welcomeTextMigration" "$SRV"; then
  echo ">>> Patch deja applique. Rien a faire."
  exit 0
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
echo ">>> Modification de server/index.js ..."
cat > "$TMP/e1_old.txt" << 'WELCEOF_X'
Merci de créer un compte par enfant. Chaque enfant a sa propre fiche sanitaire, et la signature d'un seul responsable légal suffit pour la valider : il n'est donc pas nécessaire que les deux parents créent un compte ni signent la fiche.

Si vous avez plusieurs enfants, utilisez une adresse e-mail différente pour chaque compte (une adresse e-mail ne peut servir qu'à un seul compte).

Si la fiche de votre enfant a déjà été créée par l'autre responsable légal, ne la recréez pas : le portail vous le signalera.
WELCEOF_X
cat > "$TMP/e1_new.txt" << 'WELCEOF_X'
Un seul compte suffit pour toute la famille : ne créez pas un compte par enfant. Pour chaque enfant, cliquez sur le bouton « + Ajouter un enfant » (en haut de votre espace ; « Ajouter mon premier enfant » la première fois) : sa fiche sanitaire est créée dans votre compte, et vous retrouvez toutes vos fiches dans « Mes enfants ».

Chaque enfant a sa propre fiche sanitaire, et la signature d'un seul responsable légal suffit pour la valider : il n'est donc pas nécessaire que les deux parents créent un compte ni signent la fiche.

Si la fiche de votre enfant a déjà été créée par l'autre responsable légal, ne la recréez pas : le portail vous le signalera.
WELCEOF_X
replace_once "$SRV" "$(cat "$TMP/e1_old.txt")" "$(cat "$TMP/e1_new.txt")"

cat > "$TMP/e2_old.txt" << 'WELCEOF_X'
function commRenderWelcome(text, user) {
WELCEOF_X
cat > "$TMP/e2_new.txt" << 'WELCEOF_X'
// build welcome-text-20261006 : met à jour le texte d'accueil ENREGISTRÉ (s'il contient encore l'ancienne consigne
// « un compte par enfant »), une seule fois et sans toucher aux autres modifications de l'administration.
async function welcomeTextMigration() {
  try {
    const c = await readKv(WELCOME_KEY);
    if (!c || typeof c.body !== 'string') return; // aucun texte personnalisé : le nouveau texte par défaut s'applique
    if (!/créer un compte par enfant|adresse e-mail différente pour chaque compte/.test(c.body)) return; // déjà à jour
    const OLD_P1 = 'Merci de créer un compte par enfant. Chaque enfant a sa propre fiche sanitaire, et la signature d\'un seul responsable légal suffit pour la valider : il n\'est donc pas nécessaire que les deux parents créent un compte ni signent la fiche.';
    const OLD_P2 = 'Si vous avez plusieurs enfants, utilisez une adresse e-mail différente pour chaque compte (une adresse e-mail ne peut servir qu\'à un seul compte).';
    const NEW_P1 = 'Un seul compte suffit pour toute la famille : ne créez pas un compte par enfant. Pour chaque enfant, cliquez sur le bouton « + Ajouter un enfant » (en haut de votre espace ; « Ajouter mon premier enfant » la première fois) : sa fiche sanitaire est créée dans votre compte, et vous retrouvez toutes vos fiches dans « Mes enfants ».';
    const NEW_P2 = 'Chaque enfant a sa propre fiche sanitaire, et la signature d\'un seul responsable légal suffit pour la valider : il n\'est donc pas nécessaire que les deux parents créent un compte ni signent la fiche.';
    if (!c.body.includes(OLD_P1)) {
      console.log("[accueil] Le message d'accueil enregistré parle encore d'un compte par enfant mais il a été modifié : corrigez-le dans Messagerie > Message d'accueil (bouton « Rétablir le texte par défaut »).");
      return;
    }
    let body = c.body.replace(OLD_P1, NEW_P1 + '\n\n' + NEW_P2);
    body = body.replace(OLD_P2 + '\n\n', '').replace('\n\n' + OLD_P2, '').replace(OLD_P2, '');
    await writeKv(WELCOME_KEY, { ...c, body, updatedAt: new Date().toISOString(), updatedBy: 'maj-texte-accueil' });
    console.log("[accueil] Texte du message d'accueil mis à jour : un seul compte par famille, bouton « Ajouter un enfant ».");
  } catch (e) {
    console.error("[accueil] Mise à jour du texte d'accueil impossible :", e.message);
  }
}

function commRenderWelcome(text, user) {
WELCEOF_X
replace_once "$SRV" "$(cat "$TMP/e2_old.txt")" "$(cat "$TMP/e2_new.txt")"

cat > "$TMP/e3_old.txt" << 'WELCEOF_X'
    app.listen(PORT, '0.0.0.0', () => console.log(`Serveur fiche sanitaire voyages sur le port ${PORT}`));
WELCEOF_X
cat > "$TMP/e3_new.txt" << 'WELCEOF_X'
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Serveur fiche sanitaire voyages sur le port ${PORT}`);
      welcomeTextMigration();
    });
WELCEOF_X
replace_once "$SRV" "$(cat "$TMP/e3_old.txt")" "$(cat "$TMP/e3_new.txt")"

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
  echo "!!! Pour revenir en arriere : cp -a $BACKUP_DIR/server $APP_DIR/"
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
sleep 2
docker compose logs --tail 30 app 2>/dev/null | grep "\[accueil\]" | tail -2 || true

cat << MSG

============================================================
 TERMINE - build $BUILD
 - Nouveaux comptes : message d'accueil « Un seul compte suffit pour toute la famille ... + Ajouter un enfant ».
 - Texte deja enregistre par l'administration : corrige automatiquement (voir la ligne [accueil] ci-dessus).
 - Messages d'accueil deja envoyes : inchanges ; envoyez le message de rappel propose dans la reponse de Claude
   (Messagerie > Nouveau message) aux parents concernes.
 Retour arriere possible : copie dans $BACKUP_DIR
============================================================
MSG
