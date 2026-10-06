#!/bin/bash
# ============================================================================
# maj-portail.sh  -  MISE A JOUR ET OUTILS du portail Fiche Sanitaire (NDM)
# Script AUTO-EXTRACTIBLE : il contient tous les correctifs et les deux outils.
# Il suffit de le deposer UNE fois (et de l'ECRASER a chaque nouvelle version).
#
#   ./maj-portail.sh --etat        etat : quels correctifs sont installes / en attente
#   ./maj-portail.sh --outils      installe ou met a jour rattacher-fiche.sh et
#                                  restaurer-sauvegarde.sh dans /root (aucune reconstruction)
#   ./maj-portail.sh --readme      (re)genere le README complet dans /opt/readme/README.md
#   ./maj-portail.sh --github      enregistre le jeton GitHub (UNE fois, saisie masquee) dans /root/.github-token
#   ./maj-portail.sh --push        pousse le projet vers GitHub (aussi fait a chaque --appliquer ; NO_PUSH=1 pour l'eviter)
#   ./maj-portail.sh --appliquer   applique les correctifs en attente (dans le bon ordre),
#                                  reconstruit l'application UNE seule fois, verifie /health
#                                  (ajoutez --oui pour ne pas demander de confirmation)
#                                  et regenere le README complet dans /opt/readme/
#
# SECURITES : copie de l'application avant toute modification
# (/root/avant-maj_<date>.tar.gz) ; chaque correctif se restaure seul en cas d'erreur
# et le script s'arrete au premier probleme ; rien n'est reconstruit si tout est deja a jour.
#
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/maj-portail.sh && /root/maj-portail.sh --etat
# ============================================================================
set -e

APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"
TOOLS_DIR="${TOOLS_DIR:-/root}"
BUNDLE_VERSION="2026-10-05-2a38b75f"
PAYLOAD_SHA256="b0f5caedc42c4f62db88d3cdffaeec3fae824d26186b88d01620d14a5babb496"
SELF="$0"

PATCHES="patch-pdf-archive patch-doublons patch-brouillon patch-anti-ecrasement patch-messagerie patch-accueil patch-ui-signature patch-parent-guard patch-comptes patch-stockage patch-pieces-jointes patch-etablissement patch-regeneration-pdf patch-messagerie-icone patch-pdf-sante patch-messagerie-suppression patch-messagerie-lecture patch-pdf-organisateurs patch-fin-annee patch-rgpd patch-fleches patch-corrections patch-mot-de-passe-parent"
TOOLS="rattacher-fiche restaurer-sauvegarde"

WORK=""
cleanup() { [ -n "$WORK" ] && rm -rf "$WORK"; }
trap cleanup EXIT

die() { echo ""; echo "!!! $*"; exit 1; }

describe() {
  case "$1" in
    patch-pdf-archive)        echo "PDF archives sur le serveur (fiches-pdf/<Classe>/...)";;
    patch-doublons)           echo "anti-doublons de fiches (formulaire parent + serveur)";;
    patch-brouillon)          echo "filigrane BROUILLON + bandeau fiche non finalisee";;
    patch-anti-ecrasement)    echo "anti-ecrasement entre deux enregistrements (409 conflict)";;
    patch-messagerie)         echo "messagerie interne + popups";;
    patch-accueil)            echo "message d'accueil + verrou sur les comptes";;
    patch-ui-signature)       echo "import de signature (admin) + vue d'ensemble sans defilement";;
    patch-parent-guard)       echo "plus de fiche sans parent (refus serveur)";;
    patch-comptes)            echo "liste des comptes triee + retour a l'administrateur";;
    patch-stockage)           echo "chargement fiable meme si la base depasse 5 Mo (panne du 04/10)";;
    patch-pieces-jointes)     echo "photos reduites, PDF limites (pieces jointes)";;
    patch-etablissement)      echo "nom de l'etablissement affiche sur toutes les fiches, PDF et listes";;
    patch-regeneration-pdf)   echo "bouton : regenerer les PDF archives avec le nom enregistre";;
    patch-messagerie-icone)   echo "messagerie : bouton plus grand, pastille de messages non lus clignotante";;
    patch-pdf-sante)          echo "PDF archive : regime alimentaire et sante en grand";;
    patch-messagerie-suppression) echo "messagerie : supprimer un message ou une conversation (admin)";;
    patch-messagerie-lecture) echo "messagerie : accuse de lecture (lu / pas encore lu)";;
    patch-pdf-organisateurs) echo "vrais PDF pour les organisateurs (liste, releve, fiche)";;
    patch-fin-annee) echo "fin d annee : desinscription de tous les eleves des voyages (auto + manuel + annulation)";;
    patch-rgpd) echo "onglet RGPD pour les parents, PDF supprimes avec la fiche, polices Google retirees";;
    patch-fleches) echo "fleches haut / bas pour aller tout en haut ou tout en bas de la page";;
    patch-corrections) echo "audit : PDF (voyages, symboles, textes longs), texte RGPD exact";;
    patch-mot-de-passe-parent) echo "bouton bleu Changer mon mot de passe dans l Espace Famille";;
  esac
}

# Un correctif est installe si son marqueur est present dans le code de l'application
is_installed() {
  case "$1" in
    patch-pdf-archive)        grep -q "PDF_ARCHIVE_DIR" "$APP_DIR/server/index.js" 2>/dev/null;;
    patch-doublons)           grep -q "check-duplicate" "$APP_DIR/server/index.js" 2>/dev/null;;
    patch-brouillon)          grep -q "draft-watermark" "$APP_DIR/src/components/CerfaOfficialView.tsx" 2>/dev/null;;
    patch-anti-ecrasement)    grep -q "studentVersionGuard" "$APP_DIR/server/index.js" 2>/dev/null;;
    patch-messagerie)         grep -q "COMM_PRIVATE_PREFIXES" "$APP_DIR/server/index.js" 2>/dev/null;;
    patch-accueil)            grep -q "WELCOME_KEY" "$APP_DIR/server/index.js" 2>/dev/null;;
    patch-ui-signature)       grep -q "handleAdminSignatureUpload" "$APP_DIR/src/components/CerfaEditor.tsx" 2>/dev/null;;
    patch-parent-guard)       grep -q "parentIdGuard" "$APP_DIR/server/index.js" 2>/dev/null;;
    patch-comptes)            grep -q "originAdminId" "$APP_DIR/src/App.tsx" 2>/dev/null;;
    patch-stockage)           grep -q "kvStorage" "$APP_DIR/src/utils/storage.ts" 2>/dev/null;;
    patch-pieces-jointes)     grep -q "attachmentSizeGuard" "$APP_DIR/server/index.js" 2>/dev/null;;
    patch-etablissement)      grep -q "etablissement-20261005" "$APP_DIR/src/utils/storage.ts" 2>/dev/null;;
    patch-regeneration-pdf)   grep -q "PdfRegenerator" "$APP_DIR/src/components/AdminSpace.tsx" 2>/dev/null;;
    patch-messagerie-icone)   grep -q "comm-badge-blink" "$APP_DIR/src/components/CommunicationCenter.tsx" 2>/dev/null;;
    patch-pdf-sante)          grep -q "pdf-sante-20261006" "$APP_DIR/src/utils/pdfGenerator.ts" 2>/dev/null;;
    patch-messagerie-suppression) grep -q "comm-delete-message" "$APP_DIR/src/components/CommunicationCenter.tsx" 2>/dev/null;;
    patch-messagerie-lecture) grep -q "comm-filter-unseen" "$APP_DIR/src/components/CommunicationCenter.tsx" 2>/dev/null;;
    patch-pdf-organisateurs) grep -q "pdf-organisateurs-20261006" "$APP_DIR/src/utils/pdfGenerator.ts" 2>/dev/null;;
    patch-fin-annee) grep -q "/api/year-end/get" "$APP_DIR/server/index.js" 2>/dev/null;;
    patch-rgpd) grep -q "rgpd-20261006" "$APP_DIR/index.html" 2>/dev/null;;
    patch-fleches) grep -q "ScrollButtons" "$APP_DIR/src/main.tsx" 2>/dev/null;;
    patch-corrections) [ -f "$APP_DIR/src/utils/pdfSafe.ts" ];;
    patch-mot-de-passe-parent) [ -f "$APP_DIR/src/components/ParentPasswordModal.tsx" ];;
    *) return 1;;
  esac
}

check_app() {
  [ -d "$APP_DIR/src" ] && [ -f "$APP_DIR/server/index.js" ] || die "Application introuvable dans $APP_DIR (dossier src/ ou server/index.js absent)."
}

extract() {
  [ -f "$SELF" ] || die "Ce script doit etre lance depuis un fichier (pas depuis un tube)."
  command -v base64 >/dev/null && command -v tar >/dev/null && command -v sha256sum >/dev/null || die "base64, tar et sha256sum sont requis."
  WORK="$(mktemp -d)"
  sed '1,/^__PAYLOAD_BELOW__$/d' "$SELF" | base64 -d > "$WORK/bundle.tar.gz" 2>/dev/null || die "Contenu du script illisible (fichier tronque ou modifie ?). Redeposez-le."
  got="$(sha256sum "$WORK/bundle.tar.gz" | cut -d' ' -f1)"
  [ "$got" = "$PAYLOAD_SHA256" ] || die "Contenu corrompu (somme de controle differente). Redeposez le script en mode BINAIRE avec FileZilla."
  tar xzf "$WORK/bundle.tar.gz" -C "$WORK"
}

tool_status() { # $1 = nom ; affiche l'etat de l'outil installe
  local dst="$TOOLS_DIR/$1.sh"
  if [ ! -f "$dst" ]; then echo "absent"; return; fi
  if [ "$(sha256sum "$dst" | cut -d' ' -f1)" = "$(sha256sum "$WORK/$1.sh" | cut -d' ' -f1)" ]; then echo "a jour"; else echo "ancienne version"; fi
}

install_tools() {
  [ -n "$WORK" ] || extract
  mkdir -p "$TOOLS_DIR"
  for t in $TOOLS; do
    st="$(tool_status "$t")"
    if [ "$st" = "a jour" ]; then
      echo "   $TOOLS_DIR/$t.sh : deja a jour"
    else
      cp "$WORK/$t.sh" "$TOOLS_DIR/$t.sh" && chmod +x "$TOOLS_DIR/$t.sh"
      [ "$st" = "absent" ] && echo "   $TOOLS_DIR/$t.sh : INSTALLE" || echo "   $TOOLS_DIR/$t.sh : MIS A JOUR"
    fi
  done
}

cmd_etat() {
  check_app
  extract
  echo ""
  echo "Version du lot : $BUNDLE_VERSION   |   application : $APP_DIR"
  echo ""
  echo "CORRECTIFS :"
  pending=0
  for p in $PATCHES; do
    if is_installed "$p"; then s="[installe]    "; else s="[EN ATTENTE]  "; pending=$((pending+1)); fi
    echo "   $s ${p#patch-} : $(describe "$p")"
  done
  echo ""
  echo "OUTILS ($TOOLS_DIR) :"
  for t in $TOOLS; do echo "   $t.sh : $(tool_status "$t")"; done
  echo ""
  if [ "$pending" -gt 0 ]; then
    echo "-> $pending correctif(s) en attente. Pour les appliquer : $SELF --appliquer"
  else
    echo "-> tous les correctifs sont installes."
  fi
}

cmd_outils() {
  extract
  echo ""
  echo "Installation des outils dans $TOOLS_DIR :"
  install_tools
  echo ""
  echo "Utilisation :"
  echo "   $TOOLS_DIR/rattacher-fiche.sh --orphelines | --doublons | --auto [--apply] | <fiche> <email> [--apply]"
  echo "   $TOOLS_DIR/restaurer-sauvegarde.sh --etat | --liste | <fichier> [--apply]"
}

cmd_appliquer() {
  check_app
  extract
  pending_list=""
  n=0
  for p in $PATCHES; do
    if ! is_installed "$p"; then pending_list="$pending_list $p"; n=$((n+1)); fi
  done
  echo ""
  if [ "$n" -eq 0 ]; then
    echo ">>> Tous les correctifs sont deja installes : aucune reconstruction necessaire."
    echo ""
    echo "Outils :"
    install_tools
    generate_readme_safe
    push_github
    return 0
  fi
  echo "Correctifs a appliquer ($n) :"
  for p in $pending_list; do echo "   - ${p#patch-} : $(describe "$p")"; done
  echo ""
  echo "Conseil : faites d'abord un SNAPSHOT Proxmox du LXC."
  if [ "$1" != "--oui" ]; then
    [ -t 0 ] || die "Pas de terminal : relancez avec --oui pour confirmer."
    read -r -p "Appliquer ces correctifs et reconstruire l'application ? [o/N] " rep
    case "$rep" in o|O|oui|OUI) ;; *) echo "Annule."; exit 0;; esac
  fi

  stamp="$(date +%Y%m%d-%H%M%S)"
  safety="$TOOLS_DIR/avant-maj_$stamp.tar.gz"
  mkdir -p "$TOOLS_DIR"
  ( cd "$APP_DIR" && tar czf "$safety" src server docker-compose.yml package.json .gitignore .dockerignore 2>/dev/null || tar czf "$safety" src server docker-compose.yml package.json )
  echo ""
  echo ">>> Copie de securite : $safety"
  echo "    (retour arriere : tar xzf $safety -C $APP_DIR && cd $APP_DIR && docker compose up -d --build)"

  applied=0
  for p in $pending_list; do
    echo ""
    echo ">>> $p ..."
    if ! SKIP_BUILD=1 APP_DIR="$APP_DIR" bash "$WORK/$p.sh"; then
      echo ""
      die "Le correctif '$p' a echoue (il a restaure ses propres fichiers). Arret : les correctifs suivants n'ont pas ete appliques. Envoyez le message d'erreur ci-dessus."
    fi
    applied=$((applied+1))
  done

  echo ""
  echo ">>> Outils :"
  install_tools

  if [ "${SKIP_BUILD:-0}" = "1" ]; then
    echo ""
    echo ">>> SKIP_BUILD=1 : $applied correctif(s) applique(s), pas de reconstruction Docker."
    generate_readme_safe
    push_github
    return 0
  fi

  echo ""
  echo ">>> Reconstruction de l'application (1 a 3 minutes) ..."
  cd "$APP_DIR"
  if ! docker compose up -d --build; then
    die "ECHEC de la reconstruction Docker. Retour arriere : tar xzf $safety -C $APP_DIR && cd $APP_DIR && docker compose up -d --build"
  fi
  APP_PORT_VAL="$(grep -E '^APP_PORT=' .env 2>/dev/null | cut -d= -f2 || true)"
  APP_PORT_VAL="${APP_PORT_VAL:-8099}"
  ok=0
  for i in $(seq 1 30); do
    if curl -fsS "http://localhost:$APP_PORT_VAL/health" >/dev/null 2>&1; then ok=1; break; fi
    sleep 2
  done
  echo ""
  echo "============================================================"
  if [ "$ok" = "1" ]; then
    echo " TERMINE : $applied correctif(s) applique(s), application demarree (/health OK)."
  else
    echo " ATTENTION : l'application ne repond pas sur /health : docker logs fichesanitaire_app --tail 50"
  fi
  echo " IMPORTANT : videz le cache du navigateur (Ctrl+F5) sur chaque poste."
  echo " Copie de securite : $safety"
  echo "============================================================"
  generate_readme_safe
  push_github
}

# ---------------------------------------------------------------- README AUTOMATIQUE
# Genere /opt/readme/README.md : etat reel de l'installation + documentation + commandes + TOUS les
# scripts (code source complet du projet tel qu'installe). Aucun secret : valeurs du .env, mots de passe,
# noms et e-mails des familles, donnees de sante ne sont JAMAIS ecrits (seulement des compteurs).
README_DIR="${README_DIR:-/opt/readme}"
PSQL_CMD="${PSQL_CMD-docker exec fichesanitaire_db psql -U fichesanitaire -d fichesanitaire}"
APP_EXEC="${APP_EXEC-docker exec fichesanitaire_app}"
BACKUPS_PATH="${BACKUPS_PATH:-/app/backups}"
TOP_FILES="Dockerfile docker-compose.yml .env.example .gitignore .dockerignore package.json package-lock.json tsconfig.json vite.config.ts index.html"

db_ok() { [ -n "$PSQL_CMD" ] && $PSQL_CMD -At -c "select 1" >/dev/null 2>&1; }
dbq() { [ -n "$PSQL_CMD" ] || return 0; $PSQL_CMD -At -c "$1" 2>/dev/null || true; }

# Liste blanche des fichiers du projet (jamais .env, fiches-pdf, sauvegardes, node_modules...)
source_files() {
  ( cd "$APP_DIR" || exit 0
    for f in $TOP_FILES; do [ -f "$f" ] && echo "$f"; done
    find server src public -type f 2>/dev/null | LC_ALL=C sort )
}
is_text() { [ ! -s "$APP_DIR/$1" ] || grep -Iq . "$APP_DIR/$1"; }
env_value() { grep -E "^$1=" "$APP_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2-; }
envv() { local v; v="$(env_value "$1")"; echo "${v:-(non défini)}"; }

emit_script() { # nom fichier
  echo "<!-- SCRIPT-START:$1 -->"
  echo '```bash'
  cat "$2"
  [ -s "$2" ] && [ -n "$(tail -c1 "$2")" ] && echo
  echo '```'
  echo "<!-- SCRIPT-END:$1 -->"
  echo
}

# --- install-from-scratch.sh : genere A PARTIR DES FICHIERS REELS du serveur ---------------
gen_install() {
  local f d skipped="" dirs
  cat << 'HDR'
#!/bin/bash
set -e

# ============================================================================
# INSTALLATION COMPLETE DEPUIS ZERO - Portail Fiche Sanitaire de Liaison
# Application CERFA n 10008*02 pour voyages scolaires - Ensemble scolaire Notre Dame des Missions
#
# GENERE AUTOMATIQUEMENT par maj-portail.sh a partir des fichiers REELS du serveur :
# il recree exactement le projet installe (tous les correctifs sont deja integres aux sources).
# A executer sur un LXC Debian 12 neuf avec Docker + Docker Compose.
# Variables : APP_DIR=/autre/chemin  SKIP_DOCKER=1 (ecrit les fichiers sans lancer Docker)
HDR
  echo "# Correctifs integres : $(for p in $PATCHES; do is_installed "$p" && printf '%s ' "${p#patch-}"; done)"
  echo "# ============================================================================"
  echo
  echo 'APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"'
  echo 'echo ">>> Creation du repertoire $APP_DIR..."'
  echo 'mkdir -p "$APP_DIR"'
  echo 'cd "$APP_DIR"'
  echo
  dirs="$(source_files | while read -r f; do d="$(dirname "$f")"; [ "$d" != "." ] && echo "$d"; done | sort -u)"
  for d in $dirs; do echo "mkdir -p \"\$APP_DIR/$d\""; done
  echo '# Dossier des PDF archives (monte dans le conteneur) - donnees de sante : jamais sur GitHub'
  echo 'mkdir -p "$APP_DIR/fiches-pdf"'
  echo 'chmod 750 "$APP_DIR/fiches-pdf"'
  echo
  source_files | while read -r f; do
    if ! is_text "$f"; then echo "# (fichier binaire ignore : $f)"; continue; fi
    if grep -qx 'FICHESANIT_EOF' "$APP_DIR/$f"; then echo "# (fichier ignore, contient le delimiteur : $f)"; continue; fi
    echo "echo \">>> Creation de $f...\""
    echo "cat > \"\$APP_DIR/$f\" << 'FICHESANIT_EOF'"
    cat "$APP_DIR/$f"
    [ -s "$APP_DIR/$f" ] && [ -n "$(tail -c1 "$APP_DIR/$f")" ] && echo
    echo "FICHESANIT_EOF"
    echo
  done
  cat << 'FTR'

if [ ! -f "$APP_DIR/.env" ]; then
  echo ">>> Creation du fichier .env a partir de .env.example (A PERSONNALISER !)..."
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  echo "!!! PENSEZ A EDITER $APP_DIR/.env (mot de passe DB, SMTP, PORTAL_URL, etc.) avant de continuer !!!"
fi

if [ "${SKIP_DOCKER:-0}" = "1" ]; then
  echo ">>> SKIP_DOCKER=1 : fichiers ecrits, pas de construction Docker."
  exit 0
fi

echo ">>> Construction et demarrage des conteneurs..."
cd "$APP_DIR"
docker compose up -d --build

echo ">>> Attente du demarrage (15s)..."
sleep 15

docker ps -a --filter "name=fichesanitaire" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

curl -sf http://localhost:$(grep APP_PORT "$APP_DIR/.env" | cut -d= -f2)/health && echo "" || echo "Verifiez les logs : docker logs fichesanitaire_app --tail 50"

echo ""
echo "Installation terminee. PDF des fiches completes : $APP_DIR/fiches-pdf/<Classe>/<NOM_Prenom>.pdf"
echo "Configurez Nginx Proxy Manager vers le port APP_PORT defini dans .env, puis videz le cache du navigateur (Ctrl+F5)."
FTR
}

# --- bloc « ETAT DE L'INSTALLATION » (releve automatique, lecture seule) ---------------------
readme_state() {
  local f n p ports bl first last cnt lastf
  echo "## État de l'installation (relevé automatique)"
  echo
  echo "- Généré le **$(date '+%d/%m/%Y à %H:%M:%S (%Z)')** sur \`$(hostname)\` ; application : \`$APP_DIR\` ; lot de correctifs de \`maj-portail.sh\` : \`$BUNDLE_VERSION\`."
  echo
  echo "**Correctifs :**"
  echo
  for p in $PATCHES; do
    if is_installed "$p"; then echo "- ✅ installé — ${p#patch-} : $(describe "$p")"; else echo "- ❌ **EN ATTENTE** — ${p#patch-} : $(describe "$p")"; fi
  done
  echo
  echo "**Date d'installation des correctifs** (dossiers de sauvegarde \`backup-avant-*\`) :"
  echo
  echo '```'
  ls -ld --time-style=long-iso "$APP_DIR"/backup-avant-* 2>/dev/null | awk '{print $6" "$7"  "$NF}' | sed "s#$APP_DIR/##" || true
  [ -n "$(ls -d "$APP_DIR"/backup-avant-* 2>/dev/null)" ] || echo "(aucun dossier backup-avant-*)"
  echo '```'
  echo
  echo "**Docker :**"
  echo
  echo '```'
  if command -v docker >/dev/null 2>&1; then
    docker ps -a --filter name=fichesanitaire --format '{{.Names}} | {{.Status}} | {{.Ports}}' 2>&1 | head -10
    docker volume ls --format '{{.Name}}' 2>/dev/null | grep fichesanitaire || true
  else
    echo "(docker indisponible sur cette machine)"
  fi
  echo '```'
  echo
  echo "**Configuration (\`.env\`) — noms des variables seulement, jamais les valeurs secrètes :**"
  echo
  if [ -f "$APP_DIR/.env" ]; then
    local keys_env keys_ex missing
    keys_env="$(grep -oE '^[A-Z][A-Z0-9_]*=' "$APP_DIR/.env" | tr -d '=' | sort -u)"
    keys_ex="$(grep -oE '^[A-Z][A-Z0-9_]*=' "$APP_DIR/.env.example" 2>/dev/null | tr -d '=' | sort -u)"
    missing="$(comm -13 <(echo "$keys_env") <(echo "$keys_ex") | tr '\n' ' ')"
    echo "- Variables définies : $(echo $keys_env)"
    echo "- Variables du modèle \`.env.example\` **absentes** de \`.env\` : ${missing:-aucune}"
    echo "- Valeurs non secrètes : APP_PORT=\`$(envv APP_PORT)\` · PORTAL_URL=\`$(envv PORTAL_URL)\` · CRON_SCHEDULE=\`$(envv CRON_SCHEDULE)\` · CRON_TIMEZONE=\`$(envv CRON_TIMEZONE)\` · TRASH_RETENTION_DAYS=\`$(envv TRASH_RETENTION_DAYS)\` · BACKUP_RETENTION_HOURS=\`$(envv BACKUP_RETENTION_HOURS)\`"
    if [ -n "$(env_value SMTP_HOST)" ]; then echo "- SMTP : configuré (relances par e-mail actives)"; else echo "- SMTP : non configuré (relances par e-mail désactivées)"; fi
  else
    echo "- (fichier \`.env\` introuvable dans $APP_DIR)"
  fi
  echo
  echo "**Base de données (compteurs seulement, aucune donnée personnelle) :**"
  echo
  if db_ok; then
    echo '```'
    echo "-- clé | type | éléments | taille | dernière modification"
    dbq "select key || ' | ' || jsonb_typeof(value) || ' | ' || coalesce(case when jsonb_typeof(value)='array' then jsonb_array_length(value)::text end,'-') || ' | ' || (pg_column_size(value)/1024)::text || ' Ko | ' || to_char(updated_at,'YYYY-MM-DD HH24:MI') from kv_store order by key;"
    echo "-- comptes par rôle"
    dbq "select r || ' : ' || n from (select coalesce(u->>'role','?') as r, count(*) as n from kv_store, jsonb_array_elements(value) u where key='cerfa_users_v1' group by 1) t order by 1;"
    echo "-- fiches"
    dbq "select count(*) filter (where e->>'deletedAt' is null) || ' fiches actives, ' || count(*) filter (where e->>'deletedAt' is null and e->>'status'='complete') || ' complètes, ' || count(*) filter (where e->>'deletedAt' is not null) || ' en corbeille' from kv_store, jsonb_array_elements(value) e where key='cerfa_students_v11';"
    echo "fiches SANS parent valide (absent ou compte introuvable) : $(dbq "select count(*) from kv_store s, jsonb_array_elements(s.value) e where s.key='cerfa_students_v11' and e->>'deletedAt' is null and not exists (select 1 from kv_store k, jsonb_array_elements(k.value) u where k.key='cerfa_users_v1' and u->>'id'=e->>'parentId');")"
    echo "trois fiches les plus lourdes : $(dbq "select coalesce(string_agg((length(e::text)/1024)::text || ' Ko', ', ' order by length(e::text) desc),'-') from (select e from kv_store, jsonb_array_elements(value) e where key='cerfa_students_v11' order by length(e::text) desc limit 3) t;")"
    echo "nom de l'établissement enregistré : $(dbq "select coalesce(value #>> '{}', '') from kv_store where key='cerfa_establishment_name_v1';" | head -1)   (vide = valeur par défaut du code : « Ensemble Scolaire Notre Dame des Missions » depuis le correctif etablissement)"
    echo "messagerie : $(dbq "select coalesce(jsonb_array_length(value)::text,'0') from kv_store where key='cerfa_messages_v1';" | head -1) conversation(s) ; popups : $(dbq "select coalesce(jsonb_array_length(value)::text,'0') from kv_store where key='cerfa_popups_v1';" | head -1)"
    echo "poids total de la base téléchargée par chaque navigateur (somme des clés) : $(dbq "select (coalesce(sum(pg_column_size(value)),0)/1024)::int || ' Ko' from kv_store;")   (limite de confort du cache navigateur : ~5000 Ko)"
    echo '```'
  else
    echo "_(base inaccessible depuis ce script : \`PSQL_CMD\` / conteneur \`fichesanitaire_db\` — relever l'état avec \`restaurer-sauvegarde.sh --etat\`)_"
  fi
  echo
  echo "**Sauvegardes et PDF :**"
  echo
  echo '```'
  if [ -n "$APP_EXEC" ] && ! command -v docker >/dev/null 2>&1; then
    echo "(docker indisponible : sauvegardes non listées)"
  else
    bl="$($APP_EXEC ls -1 "$BACKUPS_PATH" 2>/dev/null | grep '^backup_.*\.json$' | sort || true)"
    if [ -n "$bl" ]; then
      cnt="$(echo "$bl" | wc -l)"; first="$(echo "$bl" | head -1)"; last="$(echo "$bl" | tail -1)"
      echo "sauvegardes horaires : $cnt fichier(s), de $first à $last"
      echo "dernière : $($APP_EXEC ls -la "$BACKUPS_PATH/$last" 2>/dev/null | awk '{print $5" octets"}')"
      echo "autres fichiers du dossier : $($APP_EXEC ls -1 "$BACKUPS_PATH" 2>/dev/null | grep -v '^backup_' | wc -l) (rattachement*, avant-restauration*)"
    else
      echo "(aucune sauvegarde horaire lisible dans $BACKUPS_PATH)"
    fi
  fi
  if [ -d "$APP_DIR/fiches-pdf" ]; then
    echo "PDF archivés : $(find "$APP_DIR/fiches-pdf" -name '*.pdf' 2>/dev/null | wc -l) fichier(s), $(du -sh "$APP_DIR/fiches-pdf" 2>/dev/null | cut -f1), $(find "$APP_DIR/fiches-pdf" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l) dossier(s) de classe"
  else
    echo "dossier fiches-pdf absent"
  fi
  echo "disque : $(df -h "$APP_DIR" 2>/dev/null | tail -1 | awk '{print $3" utilisés sur "$2" ("$5")"}')"
  echo '```'
  echo
  if [ -d "$APP_DIR/.git" ] && command -v git >/dev/null 2>&1; then
    echo "**Git :** branche \`$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)\`, dernier commit \`$(git -C "$APP_DIR" log -1 --format='%h %ad %s' --date=short 2>/dev/null)\`, $(git -C "$APP_DIR" status --short 2>/dev/null | wc -l) fichier(s) modifié(s) non validé(s), origine \`$(git -C "$APP_DIR" remote get-url origin 2>/dev/null | sed 's#//[^/@]*@#//#')\`"
  else
    echo "**Git :** \`$APP_DIR\` n'est pas un dépôt git (le push se fait depuis un dépôt local ; voir section 14.6)."
  fi
  echo
  if command -v git >/dev/null 2>&1; then
    echo "**GitHub (push automatique à chaque mise à jour) :** dépôt \`$GITHUB_REPO\` · branche \`$GITHUB_BRANCH\` · jeton : $([ -s "$TOKEN_FILE" ] && echo 'présent (valeur jamais affichée)' || echo '**absent** (bash /root/maj-portail.sh --github)') · dernier push : $(git -C "$GIT_STAGING" log -1 --format='%h le %ad' --date=format:'%d/%m/%Y %H:%M' 2>/dev/null || echo 'aucun')"
  else
    echo "**GitHub :** git n'est pas installé (apt install -y git) : pas de push automatique."
  fi
  echo
  echo "**Fichiers du projet installés (liste blanche, $(source_files | wc -l) fichiers) :**"
  echo
  echo '```'
  source_files | while read -r f; do printf '%7s Ko  %s\n' "$(( ($(wc -c < "$APP_DIR/$f") + 1023) / 1024 ))" "$f"; done
  echo '```'
  echo
}

readme_header() {
  cat << 'EOF'
> **Comment utiliser ce document dans une nouvelle conversation Claude** — le joindre (ou le coller) puis écrire par exemple :
>
> « Voici le README complet de mon projet *Portail Fiche Sanitaire de Liaison* (Notre Dame des Missions). Il contient l'état réel de mon serveur, la documentation, toutes les commandes et tous les scripts. Lis-le en entier, respecte les conventions de la section 0 (français, scripts complets avec chemin FileZilla et commande d'exécution, tout dans un zip, iframe, tags de build, push GitHub), puis aide-moi pour : … »
>
> Pour **extraire tous les scripts** : voir la section 3 (boucle `for … sed …`).

EOF
}

generate_readme() {
  [ -n "$WORK" ] || extract
  local out tmp stamp inst maj
  mkdir -p "$README_DIR/archive" || { echo "README non genere : impossible de creer $README_DIR"; return 1; }
  tmp="$README_DIR/.README.md.tmp"
  inst="$WORK/install-from-scratch.sh"
  maj="$WORK/maj-portail.head.sh"
  gen_install > "$inst"
  { sed '/^__PAYLOAD_BELOW__$/q' "$SELF" | sed '$d'; echo "# (la charge utile base64 — les scripts ci-dessous — est omise ici : elle est regeneree a partir d'eux)"; } > "$maj"

  {
    # le titre vient de docs.md ; l'etat et le mode d'emploi sont inseres juste apres l'introduction
    awk 'BEGIN{done=0} /^## 0\./ && !done {exit} {print}' "$WORK/docs.md"
    readme_header
    readme_state
    awk 'BEGIN{p=0} /^## 0\./ {p=1} p {print}' "$WORK/docs.md"
    cat "$WORK/commandes.md"
    echo
    echo "## 15. Scripts (code complet, extractibles)"
    echo
    echo "Chaque script est encadré par \`<!-- SCRIPT-START:nom -->\` / \`<!-- SCRIPT-END:nom -->\` (voir la boucle d'extraction de la section 3)."
    echo "- \`install-from-scratch.sh\` : généré à partir des **fichiers réels du serveur** ($(source_files | wc -l) fichiers, $(( $(wc -c < "$inst") / 1024 )) Ko) — recrée le projet installé, correctifs intégrés."
    echo "- \`maj-portail.sh\` : script de mise à jour (la charge utile base64 est omise)."
    echo "- \`rattacher-fiche.sh\`, \`restaurer-sauvegarde.sh\` : outils d'exploitation."
    echo "- \`patch-*.sh\` : les $(echo $PATCHES | wc -w) correctifs (utiles pour mettre à niveau une ancienne installation ; leurs ancres montrent comment écrire un nouveau correctif)."
    echo
    emit_script "install-from-scratch.sh" "$inst"
    emit_script "maj-portail.sh" "$maj"
    for t in $TOOLS; do emit_script "$t.sh" "$WORK/$t.sh"; done
    for p in $PATCHES; do emit_script "$p.sh" "$WORK/$p.sh"; done
  } > "$tmp"

  mv -f "$tmp" "$README_DIR/README.md"
  chmod 644 "$README_DIR/README.md"
  stamp="$(date +%Y%m%d-%H%M%S)"
  cp "$README_DIR/README.md" "$README_DIR/archive/README_$stamp.md"
  ls -1t "$README_DIR"/archive/README_*.md 2>/dev/null | tail -n +11 | xargs -r rm -f
  echo ">>> README ecrit : $README_DIR/README.md ($(( $(wc -c < "$README_DIR/README.md") / 1024 )) Ko) ; copie : archive/README_$stamp.md"
}

generate_readme_safe() {
  [ "${NO_README:-0}" = "1" ] && return 0
  generate_readme || echo "!!! README non genere (voir ci-dessus) ; relancez : bash $SELF --readme"
  return 0
}

cmd_readme() {
  check_app
  extract
  echo ""
  generate_readme
}

# ---------------------------------------------------------------- PUSH GITHUB AUTOMATIQUE
# Pousse un MIROIR PROPRE du projet (code + scripts + documentation) vers GitHub a chaque mise a jour.
# Le jeton GitHub n'est JAMAIS ecrit dans un script, un README, l'URL du depot ni la config git :
# il est lu dans $TOKEN_FILE (root seul, chmod 600) par un petit programme temporaire (GIT_ASKPASS).
# Jamais pousses : .env, fiches-pdf/ (donnees de sante), sauvegardes, backup-avant-*, node_modules, PDF.
GITHUB_REPO="${GITHUB_REPO:-https://github.com/serviceinformatique-droid/fichesanitaireclaude.git}"
GITHUB_BRANCH="${GITHUB_BRANCH:-main}"
TOKEN_FILE="${TOKEN_FILE:-/root/.github-token}"
GIT_STAGING="${GIT_STAGING:-/opt/readme/git}"

gh_is_local() { case "$GITHUB_REPO" in file://*|/*) return 0;; esac; return 1; }
gh_clean() { sed -E 's/(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]+/***/g; s/github_pat_[A-Za-z0-9_]+/***/g'; }
gh_err() { # premiere ligne utile du journal d'erreur git, jeton masque
  { grep -m1 -iE 'fatal|error|denied|not found|refused|rejected' "$WORK/git.err" || tail -1 "$WORK/git.err"; } 2>/dev/null | gh_clean | cut -c1-170
}

gh_env() {
  gh_is_local && return 0
  [ -s "$TOKEN_FILE" ] || return 1
  [ -n "$WORK" ] || extract
  cat > "$WORK/askpass.sh" << ASK
#!/bin/sh
case "\$1" in
  Username*) echo "x-access-token" ;;
  *) cat "$TOKEN_FILE" ;;
esac
ASK
  chmod 700 "$WORK/askpass.sh"
  export GIT_ASKPASS="$WORK/askpass.sh" GIT_TERMINAL_PROMPT=0
}

repo_readme() {
  awk 'BEGIN{done=0} /^## 0\./ && !done {exit} {print}' "$WORK/docs.md"
  echo "> Document généré automatiquement par \`maj-portail.sh\` le $(date '+%d/%m/%Y') (lot \`$BUNDLE_VERSION\`). Ce dépôt est un **miroir** de l'installation du serveur : ne pas y modifier de fichiers à la main (ils seraient écrasés à la prochaine mise à jour). Le README complet (état du serveur + tous les scripts) est généré sur le serveur dans \`/opt/readme/README.md\` et n'est pas publié."
  echo
  echo "**Contenu du dépôt :** la racine contient le code de l'application (\`server/\`, \`src/\`, \`Dockerfile\`, \`docker-compose.yml\`…) ; \`scripts/\` contient les correctifs \`patch-*.sh\`, les outils (\`rattacher-fiche.sh\`, \`restaurer-sauvegarde.sh\`) et la logique de mise à jour (\`maj-portail.head.sh\`)."
  echo
  awk 'BEGIN{p=0} /^## 0\./ {p=1} p {print}' "$WORK/docs.md"
  cat "$WORK/commandes.md"
}

# Remplit $1 (vide d'abord, sauf .git) avec le projet, les scripts et la documentation
stage_tree() {
  local d="$1" f p
  # garde-fou : on ne vide que le dossier de travail Git (jamais un dossier quelconque)
  [ -n "$d" ] && [ -d "$d/.git" ] || { echo ">>> GitHub : dossier de travail invalide ($d) : rien n'est efface."; return 1; }
  find "$d" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
  source_files | while read -r f; do
    is_text "$f" || continue
    mkdir -p "$d/$(dirname "$f")"
    cp "$APP_DIR/$f" "$d/$f"
  done
  mkdir -p "$d/scripts"
  for p in $PATCHES $TOOLS; do cp "$WORK/$p.sh" "$d/scripts/$p.sh"; done
  { sed '/^__PAYLOAD_BELOW__$/q' "$SELF" | sed '$d'; } > "$d/scripts/maj-portail.head.sh"
  repo_readme > "$d/README.md"
}

# Retourne 1 si un secret ou une donnee sensible est detecte dans le dossier a publier
staging_guard() {
  local d="$1" bad found=0
  bad="$(cd "$d" && find . -path ./.git -prune -o -type f -print | grep -E '(^|/)\.env(\.[^/]*)?$|fiches-pdf/|backup-avant-|node_modules/|\.pdf$' | grep -v '\.env\.example$' || true)"
  if [ -n "$bad" ]; then echo "   !!! fichier(s) sensible(s) dans la copie a publier :"; echo "$bad" | sed 's/^/       /'; found=1; fi
  bad="$(grep -rIlE --exclude-dir=.git 'ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----' "$d" 2>/dev/null || true)"
  if [ -n "$bad" ]; then echo "   !!! motif de jeton / cle privee trouve dans :"; echo "$bad" | sed "s#^$d/#       #"; found=1; fi
  if [ -s "$TOKEN_FILE" ]; then
    bad="$(grep -rIlF --exclude-dir=.git -f "$TOKEN_FILE" "$d" 2>/dev/null || true)"
    if [ -n "$bad" ]; then echo "   !!! le jeton GitHub enregistre apparait dans :"; echo "$bad" | sed "s#^$d/#       #"; found=1; fi
  fi
  [ "$found" = "0" ]
}

push_github() {
  [ "${NO_PUSH:-0}" = "1" ] && return 0
  command -v git >/dev/null 2>&1 || { echo ">>> GitHub : push ignore (git absent : apt install -y git)"; return 0; }
  [ -d "$APP_DIR/src" ] || return 0
  [ -n "$WORK" ] || extract
  if ! gh_is_local && [ ! -s "$TOKEN_FILE" ]; then
    echo ">>> GitHub : push ignore (jeton absent). A faire une seule fois : bash $SELF --github"
    return 0
  fi
  gh_env
  local stg="$GIT_STAGING" nb msg inst=0 p url
  # garde-fou : GIT_STAGING doit etre un chemin a au moins 3 niveaux (ex. /opt/readme/git), different du dossier
  # de l'application ou de l'un de ses parents ; le script efface le contenu de ce dossier a chaque push.
  case "$stg" in
    /*/*/*) ;;
    *) echo ">>> GitHub : GIT_STAGING invalide ($stg) : push ignore (ex. valide : /opt/readme/git)."; return 0;;
  esac
  case "$APP_DIR/" in
    "$stg"/*) echo ">>> GitHub : GIT_STAGING ($stg) contient le dossier de l'application : push ignore."; return 0;;
  esac
  gitq() { git -C "$stg" -c user.name="maj-portail" -c user.email="maj-portail@fichesanitaire.local" -c core.hooksPath=/dev/null "$@"; }
  url="$(echo "$GITHUB_REPO" | sed 's#\.git$##')"
  mkdir -p "$(dirname "$stg")"
  if [ ! -d "$stg/.git" ]; then
    rm -rf "$stg"
    if ! git clone -q "$GITHUB_REPO" "$stg" 2>"$WORK/git.err"; then
      echo ">>> GitHub : depot inaccessible ($(gh_err))"
      echo "    Verifiez l'adresse du depot, le jeton et ses droits (Contents : Read and write)."
      return 0
    fi
  else
    gitq remote set-url origin "$GITHUB_REPO"
    if ! gitq fetch -q origin 2>"$WORK/git.err"; then
      echo ">>> GitHub : depot inaccessible ($(gh_err))"
      return 0
    fi
  fi
  if gitq rev-parse -q --verify "origin/$GITHUB_BRANCH" >/dev/null 2>&1; then
    gitq checkout -q -B "$GITHUB_BRANCH" "origin/$GITHUB_BRANCH"
  else
    gitq checkout -q -B "$GITHUB_BRANCH"
  fi
  stage_tree "$stg"
  if ! staging_guard "$stg"; then
    echo ">>> GitHub : PUSH ANNULE (donnee sensible detectee, voir ci-dessus). Rien n'a ete envoye."
    find "$stg" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
    return 0
  fi
  gitq add -A
  nb="$(gitq status --porcelain | wc -l)"
  if [ "$nb" = "0" ]; then
    echo ">>> GitHub : aucun changement (depot deja a jour : $url)"
    return 0
  fi
  for p in $PATCHES; do is_installed "$p" && inst=$((inst+1)); done
  msg="maj-portail $(date '+%Y-%m-%d %H:%M') : $inst correctif(s) installe(s), lot $BUNDLE_VERSION"
  if ! gitq commit -q -m "$msg" 2>"$WORK/git.err"; then
    echo ">>> GitHub : commit impossible ($(gh_err))"; return 0
  fi
  if ! gitq push -q origin "HEAD:$GITHUB_BRANCH" 2>"$WORK/git.err"; then
    echo ">>> GitHub : push refuse ($(gh_err))"
    echo "    Le commit reste prepare dans $stg ; relancez : bash $SELF --push"
    return 0
  fi
  echo ">>> GitHub : $nb fichier(s) modifie(s), commit $(gitq rev-parse --short HEAD) pousse sur $url ($GITHUB_BRANCH)"
}

cmd_push() {
  check_app
  extract
  echo ""
  push_github
}

cmd_github() {
  extract
  echo ""
  echo "Configuration du push GitHub automatique"
  echo "  Depot : $GITHUB_REPO"
  echo "  Creez un jeton 'fine-grained' (GitHub > Settings > Developer settings > Personal access tokens > Fine-grained)"
  echo "  limite a CE depot, avec la permission 'Contents : Read and write'."
  echo "  Ne collez JAMAIS ce jeton dans une conversation, un script ou un README."
  echo ""
  local T=""
  if [ -t 0 ]; then
    read -rs -p "Collez le jeton (rien ne s'affiche) : " T; echo
  else
    read -r T
  fi
  [ -n "$T" ] || die "Jeton vide : rien n'a ete enregistre."
  mkdir -p "$(dirname "$TOKEN_FILE")"
  ( umask 077; printf '%s' "$T" > "$TOKEN_FILE" )
  chmod 600 "$TOKEN_FILE"
  T=""
  echo "Jeton enregistre dans $TOKEN_FILE (lecture reservee a root)."
  gh_env || true
  if git ls-remote -q "$GITHUB_REPO" HEAD >/dev/null 2>"$WORK/git.err"; then
    echo "Connexion au depot : OK. Les prochaines mises a jour (--appliquer) pousseront automatiquement."
  else
    echo "ATTENTION : connexion refusee ($(gh_err))."
    echo "Verifiez le jeton (depot cible, permission Contents : Read and write, date d'expiration)."
  fi
}

case "${1:-}" in
  --etat)      cmd_etat;;
  --outils)    cmd_outils;;
  --readme)    cmd_readme;;
  --push)      cmd_push;;
  --github)    cmd_github;;
  --appliquer) cmd_appliquer "${2:-}";;
  *)
    echo "maj-portail.sh (lot $BUNDLE_VERSION)"
    echo ""
    echo "  $0 --etat        quels correctifs sont installes / en attente"
    echo "  $0 --outils      installer ou mettre a jour rattacher-fiche.sh et restaurer-sauvegarde.sh"
    echo "  $0 --readme      (re)generer le README complet dans $README_DIR/README.md"
    echo "  $0 --github      enregistrer le jeton GitHub (une seule fois, saisie masquee)"
    echo "  $0 --push        pousser le projet vers GitHub maintenant (fait aussi a chaque --appliquer ; NO_PUSH=1 pour l'eviter)"
    echo "  $0 --appliquer   appliquer les correctifs en attente puis reconstruire (ajouter --oui : sans confirmation)"
    ;;
esac
exit 0
