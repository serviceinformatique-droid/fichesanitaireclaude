#!/bin/bash
# ============================================================================
# patch-authentification.sh  -  build auth-20261006 (v2 : verification prealable des reperes)
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# AUTHENTIFICATION DANS LE PORTAIL : la connexion est verifiee PAR LE SERVEUR.
#
#  AVANT : toute la base (fiches de sante, comptes, mots de passe en clair, liens directs, mots de passe de
#          voyage) etait envoyee a n'importe quel visiteur ; le mot de passe etait compare dans le navigateur ;
#          n'importe qui pouvait ecraser les donnees, telecharger les sauvegardes ou creer un administrateur.
#  APRES :
#   - mots de passe et reponses secretes STOCKES sous forme d'empreintes illisibles (scrypt) : les anciens mots
#     de passe sont convertis automatiquement au demarrage, personne n'a rien a changer ;
#   - session par jeton (familles 30 jours, personnel 7 jours, accompagnateurs 12 h) ;
#   - blocage apres 5 mots de passe faux de suite (15 minutes), message clair ;
#   - chaque role ne recoit que SES donnees : une famille ses enfants ; un professeur les eleves de son voyage ;
#     un accompagnateur (mot de passe du voyage) les eleves de ce voyage ; l'administration tout ;
#   - toutes les routes d'administration (sauvegardes, fin d'annee, relances, messages generaux, suppressions,
#     ecriture des donnees) sont reservees aux administrateurs, verifiees par le serveur ;
#   - impossible de se faire passer pour un autre compte ou de s'octroyer des droits ;
#   - liens directs : valables 30 jours (renouvelables), sans le mot de passe des voyages ;
#   - mot de passe : minimum 6 caracteres ; changement avec verification de l'ancien par le serveur ;
#   - installation neuve ou aucun administrateur : un compte « Administrateur » est cree avec un mot de passe
#     temporaire affiche une seule fois dans le journal ;
#   - les outils d'exploitation (rattacher-fiche.sh, commandes du README) utilisent un secret local au conteneur.
#  L'interface reste la meme : meme ecran de connexion, meme espace famille. Une page se recharge apres la
#  connexion, et tout le monde doit se reconnecter UNE fois le jour de la mise en service.
#
#  SECURITE DU PATCH : avant toute modification, le script verifie sur une COPIE que tous ses reperes existent
#  dans vos fichiers ; sinon il liste TOUS les reperes manquants (rapport /root/diagnostic-auth.txt) et s'arrete
#  sans rien avoir modifie.
#
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/patch-authentification.sh && /root/patch-authentification.sh
# ============================================================================
set -e

APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"
BUILD="auth-20261006"
BACKUP_DIR="$APP_DIR/backup-avant-$BUILD"
FILES="server/index.js src/main.tsx src/utils/storage.ts src/components/StartupAuthGate.tsx src/components/LoginModal.tsx src/components/Header.tsx src/App.tsx src/components/OrganizerSpace.tsx"
OPTIONAL_FILES="src/components/ParentPasswordModal.tsx"
NEWFILES="server/auth.js src/utils/auth.ts"
TMP="$(mktemp -d)"
DRY=0
FAILS=0
REPORT="$TMP/rapport.txt"
: > "$REPORT"

PATCHING=0
cleanup() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ "$PATCHING" = "1" ]; then
    echo ""
    echo "!!! ERREUR pendant le patch : restauration automatique des fichiers d'origine ..."
    for f in $FILES $OPTIONAL_FILES; do [ -f "$BACKUP_DIR/$f" ] && cp -p "$BACKUP_DIR/$f" "$APP_DIR/$f"; done
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

set_paths() { # racine
  SRV="$1/server/index.js"
  MAIN="$1/src/main.tsx"
  STO="$1/src/utils/storage.ts"
  GATE="$1/src/components/StartupAuthGate.tsx"
  LOGIN="$1/src/components/LoginModal.tsx"
  HEADER="$1/src/components/Header.tsx"
  APP="$1/src/App.tsx"
  ORG="$1/src/components/OrganizerSpace.tsx"
}
set_paths "$APP_DIR"

grep -q "function lockUserWrites" "$SRV" || { echo "ERREUR : le verrou des comptes (patch-messagerie) n'est pas installe : appliquez les correctifs precedents d'abord."; exit 1; }
grep -q "function commSendWelcome" "$SRV" || { echo "ERREUR : la messagerie (patch-messagerie) n'est pas installee : appliquez-la d'abord."; exit 1; }
grep -q "function studentVersionGuard" "$SRV" || { echo "ERREUR : le controle anti-ecrasement n'est pas installe : appliquez-le d'abord."; exit 1; }
grep -q "const STUDENTS_KEY" "$SRV" || { echo "ERREUR : serveur de version inattendue."; exit 1; }

if [ -f "$APP_DIR/server/auth.js" ]; then
  echo ">>> Patch deja applique. Rien a faire."
  exit 0
fi

# --- Fonctions utilitaires -------------------------------------------------
count_occ() { OLD="$2" perl -0777 -ne 'my $c = () = /\Q$ENV{OLD}\E/g; print $c' "$1"; }

relpath() { # chemin reel ou chemin de la copie de verification -> chemin relatif a l'application
  local f="$1"
  f="${f#"$TMP"/dry/}"
  f="${f#"$APP_DIR"/}"
  printf '%s' "$f"
}

report_missing() { # fichier  repere  nombre
  local rel orig l1 key
  rel="$(relpath "$1")"
  orig="$APP_DIR/$rel"
  {
    echo "=========================================================="
    echo "Fichier : $rel   (repere trouve $3 fois, attendu 1)"
    echo "--- repere attendu :"
    printf '%s\n' "$2" | head -14
    l1="$(printf '%s\n' "$2" | sed 's/^[[:space:]]*//' | awk 'length($0)>14{print; exit}')"
    echo "--- dans votre fichier, autour de la ligne : $l1"
    if grep -q -F -- "$l1" "$orig"; then
      grep -n -F -m1 -B3 -A12 -- "$l1" "$orig"
    else
      echo "   (cette ligne est absente de votre fichier ; lignes proches :)"
      key="$(printf '%s' "$l1" | grep -oE '[A-Za-z_][A-Za-z0-9_]{7,}' | head -1)"
      [ -n "$key" ] && grep -n -F -m3 -B1 -A3 -- "$key" "$orig" || true
    fi
  } >> "$REPORT"
}
report_missing_range() { # fichier  regex_debut  code
  local rel orig name
  rel="$(relpath "$1")"
  orig="$APP_DIR/$rel"
  name="$(printf '%s' "$2" | sed 's/^\^ *//; s/ = *$//')"
  {
    echo "=========================================================="
    echo "Fichier : $rel   (fonction introuvable ou ambigue : $2 ; code $3 : 3=debut absent, 4=fin absente, 5=debut en double)"
    echo "--- lignes de votre fichier qui contiennent « $name » :"
    grep -n -F -- "$name" "$orig" | head -5 || true
    echo "--- fonctions de ce niveau dans votre fichier :"
    grep -n -E '^  (const|function) [A-Za-z0-9_]+' "$orig" | head -45 || true
  } >> "$REPORT"
}

replace_once() { # fichier  ancien_texte  nouveau_texte
  local file="$1" old="$2" new="$3" n
  n="$(count_occ "$file" "$old")"
  if [ "$n" != "1" ]; then
    if [ "$DRY" = "1" ]; then FAILS=$((FAILS + 1)); report_missing "$file" "$old" "$n"; return 0; fi
    echo "ERREUR : repere trouve $n fois dans $file (attendu : 1) :"; echo "$old" | head -3; exit 1
  fi
  OLD="$old" NEW="$new" perl -0777 -i -pe 's/\Q$ENV{OLD}\E/$ENV{NEW}/' "$file"
}

# remplace une fonction entiere : de la ligne qui correspond a regex_debut jusqu'a la premiere ligne suivante qui correspond a regex_fin
replace_range() { # fichier  regex_debut  regex_fin  nouveau_texte
  local file="$1" sre="$2" ere="$3" new="$4" rc=0
  perl -CA -e '
    my ($f, $sre, $ere, $new) = @ARGV;
    open(my $in, "<:encoding(UTF-8)", $f) or exit 2;
    my @l = <$in>; close $in;
    my @s = grep { $l[$_] =~ /$sre/ } 0..$#l;
    exit 3 if @s == 0;
    exit 5 if @s > 1;
    my $a = $s[0]; my $b = -1;
    for my $j ($a + 1 .. $#l) { if ($l[$j] =~ /$ere/) { $b = $j; last } }
    exit 4 if $b < 0;
    splice(@l, $a, $b - $a + 1, $new . "\n");
    open(my $out, ">:encoding(UTF-8)", $f) or exit 2;
    print $out @l; close $out;
  ' "$file" "$sre" "$ere" "$new" || rc=$?
  if [ "$rc" != "0" ]; then
    if [ "$DRY" = "1" ]; then FAILS=$((FAILS + 1)); report_missing_range "$file" "$sre" "$rc"; return 0; fi
    echo "ERREUR : fonction introuvable ou ambigue dans $file : $sre (code $rc)"; exit 1
  fi
}

run_edits() {
  cat > "$TMP/e1_old.txt" << 'AUTHEOF_X'
app.use(express.json({ limit: '15mb' }));

AUTHEOF_X
  cat > "$TMP/e1_new.txt" << 'AUTHEOF_X'
app.use(express.json({ limit: '15mb' }));

// --- Authentification (build auth-20261006) : voir server/auth.js ---
// Toutes les routes /api sont contrôlées avant les gestionnaires ci-dessous (connexion par jeton, droits par rôle).
const fsAuth = require('./auth').install(app, {
  readKv: (k) => readKv(k),
  writeKv: (k, v) => writeKv(k, v),
  lockUserWrites: () => lockUserWrites(),
  commSendWelcome: (u) => commSendWelcome(u),
});

AUTHEOF_X
  replace_once "$SRV" "$(cat "$TMP/e1_old.txt")" "$(cat "$TMP/e1_new.txt")"

  cat > "$TMP/e2_old.txt" << 'AUTHEOF_X'
console.log(`Serveur fiche sanitaire voyages sur le port ${PORT}`)
AUTHEOF_X
  cat > "$TMP/e2_new.txt" << 'AUTHEOF_X'
(console.log(`Serveur fiche sanitaire voyages sur le port ${PORT}`), fsAuth.migrate())
AUTHEOF_X
  replace_once "$SRV" "$(cat "$TMP/e2_old.txt")" "$(cat "$TMP/e2_new.txt")"

  cat > "$TMP/e3_old.txt" << 'AUTHEOF_X'
  const existingEntry = Object.entries(links).find(([, v]) => v.studentId === studentId);
  if (existingEntry) return existingEntry[0];

AUTHEOF_X
  cat > "$TMP/e3_new.txt" << 'AUTHEOF_X'
  const existingEntry = Object.entries(links).find(([, v]) => v.studentId === studentId);
  if (existingEntry && !(existingEntry[1].expiresAt && Date.parse(existingEntry[1].expiresAt) < Date.now())) return existingEntry[0];
  if (existingEntry) delete links[existingEntry[0]]; // lien expiré : remplacé par un nouveau (build auth-20261006)

AUTHEOF_X
  replace_once "$SRV" "$(cat "$TMP/e3_old.txt")" "$(cat "$TMP/e3_new.txt")"

  cat > "$TMP/e4_old.txt" << 'AUTHEOF_X'
  links[token] = { studentId, createdAt: new Date().toISOString() };
AUTHEOF_X
  cat > "$TMP/e4_new.txt" << 'AUTHEOF_X'
  links[token] = {
    studentId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + Number(process.env.MAGIC_LINK_DAYS || 30) * 86400000).toISOString(),
  };
AUTHEOF_X
  replace_once "$SRV" "$(cat "$TMP/e4_old.txt")" "$(cat "$TMP/e4_new.txt")"

  cat > "$TMP/e5_old.txt" << 'AUTHEOF_X'
  const safeName = path.basename(req.params.name);
  const filePath = path.join(BACKUP_DIR, safeName);
AUTHEOF_X
  cat > "$TMP/e5_new.txt" << 'AUTHEOF_X'
  const safeName = path.basename(req.params.name);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(safeName)) return res.status(404).json({ error: 'Sauvegarde introuvable' });
  const filePath = path.join(BACKUP_DIR, safeName);
AUTHEOF_X
  replace_once "$SRV" "$(cat "$TMP/e5_old.txt")" "$(cat "$TMP/e5_new.txt")"

  cat > "$TMP/e6_old.txt" << 'AUTHEOF_X'
import { bootstrapFromServer } from './utils/storage';
AUTHEOF_X
  cat > "$TMP/e6_new.txt" << 'AUTHEOF_X'
import { bootstrapFromServer } from './utils/storage';
import { installAuthFetch, validateStoredSession, setMagicToken } from './utils/auth';
AUTHEOF_X
  replace_once "$MAIN" "$(cat "$TMP/e6_old.txt")" "$(cat "$TMP/e6_new.txt")"

  cat > "$TMP/e7_old.txt" << 'AUTHEOF_X'
  if (!isMagicLinkAccess) {
    await bootstrapFromServer();
  }
AUTHEOF_X
  cat > "$TMP/e7_new.txt" << 'AUTHEOF_X'
  installAuthFetch(); // joint le jeton de session à chaque requête /api (build auth-20261006)
  if (isMagicLinkAccess) setMagicToken(new URLSearchParams(window.location.search).get('ficheToken'));
  if (!isMagicLinkAccess) {
    await validateStoredSession();
    await bootstrapFromServer();
  }
AUTHEOF_X
  replace_once "$MAIN" "$(cat "$TMP/e7_old.txt")" "$(cat "$TMP/e7_new.txt")"

  cat > "$TMP/e8_old.txt" << 'AUTHEOF_X'
export function clearStoredCurrentUserId(): void {
AUTHEOF_X
  cat > "$TMP/e8_new.txt" << 'AUTHEOF_X'
// Efface les données mises en cache dans le navigateur (déconnexion, changement de compte) : build auth-20261006
export function clearAllCachedData(): void {
  memStore.clear();
  Object.values(STORAGE_KEYS).forEach((k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* stockage indisponible */
    }
  });
}

export function clearStoredCurrentUserId(): void {
AUTHEOF_X
  replace_once "$STO" "$(cat "$TMP/e8_old.txt")" "$(cat "$TMP/e8_new.txt")"

  cat > "$TMP/e9_old.txt" << 'AUTHEOF_X'
import React, { useState, useMemo } from 'react';
AUTHEOF_X
  cat > "$TMP/e9_new.txt" << 'AUTHEOF_X'
import React, { useState, useMemo, useEffect } from 'react';
AUTHEOF_X
  replace_once "$GATE" "$(cat "$TMP/e9_old.txt")" "$(cat "$TMP/e9_new.txt")"

  cat > "$TMP/e10_old.txt" << 'AUTHEOF_X'
import { CerfaOfficialView } from './CerfaOfficialView';
AUTHEOF_X
  cat > "$TMP/e10_new.txt" << 'AUTHEOF_X'
import { CerfaOfficialView } from './CerfaOfficialView';
import {
  authLogin,
  authRegister,
  authResetPassword,
  authSecretQuestion,
  authChaperone,
  authLogout,
  authFailureMessage,
  getChaperoneSession,
  takeGateMode,
  takeExpiredFlag,
} from '../utils/auth';

// État de l'écran à l'ouverture de la page (lu une seule fois) : accompagnateur déjà connecté, onglet demandé, session expirée
const GATE_BOOT = { chaperoneTrip: getChaperoneSession(), mode: takeGateMode(), expired: takeExpiredFlag() };
AUTHEOF_X
  replace_once "$GATE" "$(cat "$TMP/e10_old.txt")" "$(cat "$TMP/e10_new.txt")"

  cat > "$TMP/e11_old.txt" << 'AUTHEOF_X'
  const [viewMode, setViewMode] = useState<'parent_login' | 'parent_register' | 'parent_forgot' | 'staff_login' | 'chaperone_access'>('parent_login');
AUTHEOF_X
  cat > "$TMP/e11_new.txt" << 'AUTHEOF_X'
  const [viewMode, setViewMode] = useState<'parent_login' | 'parent_register' | 'parent_forgot' | 'staff_login' | 'chaperone_access'>(
    (GATE_BOOT.chaperoneTrip ? 'chaperone_access' : (GATE_BOOT.mode as any)) || 'parent_login'
  );
AUTHEOF_X
  replace_once "$GATE" "$(cat "$TMP/e11_old.txt")" "$(cat "$TMP/e11_new.txt")"

  cat > "$TMP/e12_old.txt" << 'AUTHEOF_X'
  const [chaperoneAuthenticatedTripId, setChaperoneAuthenticatedTripId] = useState<string>('');
AUTHEOF_X
  cat > "$TMP/e12_new.txt" << 'AUTHEOF_X'
  const [chaperoneAuthenticatedTripId, setChaperoneAuthenticatedTripId] = useState<string>(GATE_BOOT.chaperoneTrip);
AUTHEOF_X
  replace_once "$GATE" "$(cat "$TMP/e12_old.txt")" "$(cat "$TMP/e12_new.txt")"

  cat > "$TMP/e13_old.txt" << 'AUTHEOF_X'
  const [errorMsg, setErrorMsg] = useState<string>('');
AUTHEOF_X
  cat > "$TMP/e13_new.txt" << 'AUTHEOF_X'
  const [errorMsg, setErrorMsg] = useState<string>(GATE_BOOT.expired ? 'Votre session a expiré. Veuillez vous reconnecter.' : '');
AUTHEOF_X
  replace_once "$GATE" "$(cat "$TMP/e13_old.txt")" "$(cat "$TMP/e13_new.txt")"

  cat > "$TMP/e14_old.txt" << 'AUTHEOF_X'
    setViewMode(mode);
    setErrorMsg('');
AUTHEOF_X
  cat > "$TMP/e14_new.txt" << 'AUTHEOF_X'
    // un accompagnateur connecté qui change d'onglet ferme sa session (le jeton de voyage ne sert qu'à ce voyage)
    if (GATE_BOOT.chaperoneTrip && chaperoneAuthenticatedTripId) {
      authLogout(mode);
      return;
    }
    setViewMode(mode);
    setErrorMsg('');
AUTHEOF_X
  replace_once "$GATE" "$(cat "$TMP/e14_old.txt")" "$(cat "$TMP/e14_new.txt")"

  cat > "$TMP/e15_sre.txt" << 'AUTHEOF_X'
^  const handleChaperoneAccess = 
AUTHEOF_X
  cat > "$TMP/e15_ere.txt" << 'AUTHEOF_X'
^  };\s*$
AUTHEOF_X
  cat > "$TMP/e15_new.txt" << 'AUTHEOF_X'
  const handleChaperoneAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!chaperoneTripId) {
      setErrorMsg('Veuillez sélectionner un voyage.');
      return;
    }
    // le mot de passe du voyage est vérifié par le serveur ; la page se recharge ensuite avec les seuls élèves de ce voyage
    const res = await authChaperone(chaperoneTripId, chaperonePasswordInput);
    if (!res.ok) setErrorMsg(res.message);
  };
AUTHEOF_X
  replace_range "$GATE" "$(cat "$TMP/e15_sre.txt")" "$(cat "$TMP/e15_ere.txt")" "$(cat "$TMP/e15_new.txt")"

  cat > "$TMP/e16_sre.txt" << 'AUTHEOF_X'
^  const handleParentLogin = 
AUTHEOF_X
  cat > "$TMP/e16_ere.txt" << 'AUTHEOF_X'
^  };\s*$
AUTHEOF_X
  cat > "$TMP/e16_new.txt" << 'AUTHEOF_X'
  const handleParentLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const query = parentEmailInput.trim().toLowerCase();
    if (!query) {
      setErrorMsg('Veuillez renseigner votre adresse email ou identifiant.');
      return;
    }
    if (!parentPasswordInput) {
      setErrorMsg('Veuillez renseigner votre mot de passe.');
      return;
    }

    // Vérification par le serveur (build auth-20261006) : le mot de passe n'est plus comparé dans le navigateur
    const res = await authLogin('parent', query, parentPasswordInput);
    if (res.ok) {
      setSuccessMsg(`Connexion réussie ! Bienvenue ${res.user.name}`);
    } else {
      setErrorMsg(authFailureMessage(res, 'Identifiant ou mot de passe incorrect.'));
    }
  };
AUTHEOF_X
  replace_range "$GATE" "$(cat "$TMP/e16_sre.txt")" "$(cat "$TMP/e16_ere.txt")" "$(cat "$TMP/e16_new.txt")"

  cat > "$TMP/e17_sre.txt" << 'AUTHEOF_X'
^  const handleParentRegister = 
AUTHEOF_X
  cat > "$TMP/e17_ere.txt" << 'AUTHEOF_X'
^  };\s*$
AUTHEOF_X
  cat > "$TMP/e17_new.txt" << 'AUTHEOF_X'
  const handleParentRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!regLastName.trim() || !regFirstName.trim() || !regEmail.trim() || !regPassword.trim() || !regAnswer.trim()) {
      setErrorMsg('Tous les champs obligatoires doivent être renseignés (Nom, Prénom, Email, Mot de passe, Question secrète).');
      return;
    }

    if (regPassword !== regConfirmPassword) {
      setErrorMsg('Les deux mots de passe ne correspondent pas.');
      return;
    }

    if (regPassword.length < 6) {
      setErrorMsg('Le mot de passe doit comporter au moins 6 caractères.');
      return;
    }

    // Création du compte par le serveur (adresse unique, mot de passe haché, message d'accueil, connexion immédiate)
    const result = await authRegister({
      firstName: regFirstName.trim(),
      lastName: regLastName.trim(),
      email: regEmail.trim().toLowerCase(),
      phone: regPhone.trim(),
      password: regPassword,
      secretQuestion: regQuestion,
      secretAnswer: regAnswer.trim(),
    });
    if (!result.ok) {
      setErrorMsg(result.message);
      return;
    }
    setSuccessMsg(`Compte parent créé avec succès pour ${result.user.name} ! Connexion en cours...`);
  };
AUTHEOF_X
  replace_range "$GATE" "$(cat "$TMP/e17_sre.txt")" "$(cat "$TMP/e17_ere.txt")" "$(cat "$TMP/e17_new.txt")"

  cat > "$TMP/e18_sre.txt" << 'AUTHEOF_X'
^  const handleStaffLogin = 
AUTHEOF_X
  cat > "$TMP/e18_ere.txt" << 'AUTHEOF_X'
^  };\s*$
AUTHEOF_X
  cat > "$TMP/e18_new.txt" << 'AUTHEOF_X'
  const handleStaffLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const res =
      staffRole === 'admin'
        ? await authLogin('admin', '', staffPasswordInput)
        : await authLogin('organizer', staffEmailInput.trim(), staffPasswordInput);
    if (res.ok) {
      setSuccessMsg(`Accès autorisé : ${res.user.name}`);
    } else {
      setErrorMsg(authFailureMessage(res, staffRole === 'admin' ? 'Mot de passe administrateur incorrect.' : 'Identifiant ou mot de passe incorrect.'));
    }
  };
AUTHEOF_X
  replace_range "$GATE" "$(cat "$TMP/e18_sre.txt")" "$(cat "$TMP/e18_ere.txt")" "$(cat "$TMP/e18_new.txt")"

  cat > "$TMP/e19_sre.txt" << 'AUTHEOF_X'
^  const handleForgotPassword = 
AUTHEOF_X
  cat > "$TMP/e19_ere.txt" << 'AUTHEOF_X'
^  };\s*$
AUTHEOF_X
  cat > "$TMP/e19_new.txt" << 'AUTHEOF_X'
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!forgotEmail.trim() || !forgotAnswer.trim() || !forgotNewPassword.trim()) {
      setErrorMsg('Veuillez renseigner votre email, la réponse à la question secrète et le nouveau mot de passe.');
      return;
    }

    const res = await authResetPassword(forgotEmail.trim().toLowerCase(), forgotAnswer.trim(), forgotNewPassword);
    if (!res.ok) {
      setErrorMsg(res.message);
      return;
    }
    setSuccessMsg('Mot de passe mis à jour avec succès !');
  };
AUTHEOF_X
  replace_range "$GATE" "$(cat "$TMP/e19_sre.txt")" "$(cat "$TMP/e19_ere.txt")" "$(cat "$TMP/e19_new.txt")"

  cat > "$TMP/e20_sre.txt" << 'AUTHEOF_X'
^  // Determine secret question
AUTHEOF_X
  cat > "$TMP/e20_ere.txt" << 'AUTHEOF_X'
^  \);\s*$
AUTHEOF_X
  cat > "$TMP/e20_new.txt" << 'AUTHEOF_X'
  // Question secrète du compte saisi (demandée au serveur : la liste des comptes n'est plus dans le navigateur)
  const [forgotQuestion, setForgotQuestion] = useState<string | null>(null);
  useEffect(() => {
    const email = forgotEmail.trim().toLowerCase();
    if (!email.includes('@')) {
      setForgotQuestion(null);
      return;
    }
    const timer = setTimeout(() => {
      authSecretQuestion(email).then(setForgotQuestion);
    }, 350);
    return () => clearTimeout(timer);
  }, [forgotEmail]);
AUTHEOF_X
  replace_range "$GATE" "$(cat "$TMP/e20_sre.txt")" "$(cat "$TMP/e20_ere.txt")" "$(cat "$TMP/e20_new.txt")"

  cat > "$TMP/e21_old.txt" << 'AUTHEOF_X'
                  {matchingForgotUser && matchingForgotUser.secretQuestion && (
AUTHEOF_X
  cat > "$TMP/e21_new.txt" << 'AUTHEOF_X'
                  {forgotQuestion && (
AUTHEOF_X
  replace_once "$GATE" "$(cat "$TMP/e21_old.txt")" "$(cat "$TMP/e21_new.txt")"

  cat > "$TMP/e22_old.txt" << 'AUTHEOF_X'
« {matchingForgotUser.secretQuestion} »
AUTHEOF_X
  cat > "$TMP/e22_new.txt" << 'AUTHEOF_X'
« {forgotQuestion} »
AUTHEOF_X
  replace_once "$GATE" "$(cat "$TMP/e22_old.txt")" "$(cat "$TMP/e22_new.txt")"

  cat > "$TMP/e23_old.txt" << 'AUTHEOF_X'
                  onClick={() => {
                    setChaperoneAuthenticatedTripId('');
                    setChaperonePasswordInput('');
                  }}
AUTHEOF_X
  cat > "$TMP/e23_new.txt" << 'AUTHEOF_X'
                  onClick={() => {
                    authLogout('chaperone_access'); // ferme la session de ce voyage (le jeton ne sert qu'à lui)
                    setChaperoneAuthenticatedTripId('');
                    setChaperonePasswordInput('');
                  }}
AUTHEOF_X
  replace_once "$GATE" "$(cat "$TMP/e23_old.txt")" "$(cat "$TMP/e23_new.txt")"

  cat > "$TMP/e24_old.txt" << 'AUTHEOF_X'
import { User } from '../types';
AUTHEOF_X
  cat > "$TMP/e24_new.txt" << 'AUTHEOF_X'
import { User, UserRole } from '../types';
import { authLogin, authFailureMessage } from '../utils/auth';
AUTHEOF_X
  replace_once "$LOGIN" "$(cat "$TMP/e24_old.txt")" "$(cat "$TMP/e24_new.txt")"

  cat > "$TMP/e25_old.txt" << 'AUTHEOF_X'
  targetTabName?: string;
}
AUTHEOF_X
  cat > "$TMP/e25_new.txt" << 'AUTHEOF_X'
  targetTabName?: string;
  targetRole?: UserRole;
}
AUTHEOF_X
  replace_once "$LOGIN" "$(cat "$TMP/e25_old.txt")" "$(cat "$TMP/e25_new.txt")"

  cat > "$TMP/e26_old.txt" << 'AUTHEOF_X'
  targetTabName,
}) => {
  const isAdmin = currentUser.role === 'admin';
AUTHEOF_X
  cat > "$TMP/e26_new.txt" << 'AUTHEOF_X'
  targetTabName,
  targetRole,
}) => {
  const isAdmin = currentUser.role === 'admin';
  // Accès à l'espace d'un AUTRE rôle : le serveur vérifie le mot de passe (la liste des comptes de ce rôle n'est plus fournie)
  const crossRole = !isAdmin && !!targetRole && targetRole !== currentUser.role;
  const [identifierInput, setIdentifierInput] = useState<string>('');
AUTHEOF_X
  replace_once "$LOGIN" "$(cat "$TMP/e26_old.txt")" "$(cat "$TMP/e26_new.txt")"

  cat > "$TMP/e27_old.txt" << 'AUTHEOF_X'
    if (!targetUser) return;

    // Admin has access
AUTHEOF_X
  cat > "$TMP/e27_new.txt" << 'AUTHEOF_X'
    if (!targetUser && !crossRole) return;

    // Admin has access
AUTHEOF_X
  replace_once "$LOGIN" "$(cat "$TMP/e27_old.txt")" "$(cat "$TMP/e27_new.txt")"

  cat > "$TMP/e28_old.txt" << 'AUTHEOF_X'
    // Standard password check
    const expectedPassword = targetUser.password;

    if (expectedPassword && passwordInput.trim() === expectedPassword) {
      setSuccessMsg(`Authentification réussie ! Bienvenue ${targetUser.name}`);
      setTimeout(() => {
        onSuccessLogin(targetUser);
        onClose();
      }, 400);
    } else {
      setErrorMsg('Mot de passe incorrect pour ce compte. Veuillez réessayer.');
    }
  };
AUTHEOF_X
  cat > "$TMP/e28_new.txt" << 'AUTHEOF_X'
    // Vérification par le serveur (build auth-20261006) : le mot de passe n'est plus comparé dans le navigateur
    const role = ((crossRole ? targetRole : targetUser && targetUser.role) || currentUser.role) as UserRole;
    const identifier = crossRole ? identifierInput.trim() : (targetUser && targetUser.email) || '';
    setErrorMsg('');
    authLogin(role, identifier, passwordInput).then((res) => {
      if (res.ok) {
        setSuccessMsg(`Authentification réussie ! Bienvenue ${res.user.name}`);
      } else {
        setErrorMsg(authFailureMessage(res, 'Mot de passe incorrect pour ce compte. Veuillez réessayer.'));
      }
    });
  };
AUTHEOF_X
  replace_once "$LOGIN" "$(cat "$TMP/e28_old.txt")" "$(cat "$TMP/e28_new.txt")"

  cat > "$TMP/e29_old.txt" << 'AUTHEOF_X'
        {/* User profile selection */}
        <div className="my-4 space-y-3">
AUTHEOF_X
  cat > "$TMP/e29_new.txt" << 'AUTHEOF_X'
        {/* User profile selection */}
        {!crossRole && (
        <div className="my-4 space-y-3">
AUTHEOF_X
  replace_once "$LOGIN" "$(cat "$TMP/e29_old.txt")" "$(cat "$TMP/e29_new.txt")"

  cat > "$TMP/e30_old.txt" << 'AUTHEOF_X'
            })}
          </div>
        </div>

        {/* Password field (if not bypassed by admin) */}
AUTHEOF_X
  cat > "$TMP/e30_new.txt" << 'AUTHEOF_X'
            })}
          </div>
        </div>
        )}

        {crossRole && targetRole !== 'admin' && (
          <div className="my-4">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
              {targetRole === 'organizer' ? 'Identifiant (e-mail) — facultatif' : 'Adresse e-mail'}
            </label>
            <input
              type="text"
              value={identifierInput}
              onChange={(e) => {
                setIdentifierInput(e.target.value);
                setErrorMsg('');
              }}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 focus:ring-2 focus:ring-blue-900 focus:outline-none"
              data-testid="login-modal-identifier"
            />
          </div>
        )}

        {/* Password field (if not bypassed by admin) */}
AUTHEOF_X
  replace_once "$LOGIN" "$(cat "$TMP/e30_old.txt")" "$(cat "$TMP/e30_new.txt")"

  cat > "$TMP/e31_old.txt" << 'AUTHEOF_X'
  const [pendingTargetTabName, setPendingTargetTabName] = useState<string>('');
AUTHEOF_X
  cat > "$TMP/e31_new.txt" << 'AUTHEOF_X'
  const [pendingTargetTabName, setPendingTargetTabName] = useState<string>('');
  const [pendingTargetRole, setPendingTargetRole] = useState<'parent' | 'organizer' | 'admin' | undefined>(undefined);
AUTHEOF_X
  replace_once "$HEADER" "$(cat "$TMP/e31_old.txt")" "$(cat "$TMP/e31_new.txt")"

  cat > "$TMP/e32_old.txt" << 'AUTHEOF_X'
        setPendingTargetUser(parentUser);
        setPendingTargetTabName('Espace Parents');
AUTHEOF_X
  cat > "$TMP/e32_new.txt" << 'AUTHEOF_X'
        setPendingTargetUser(parentUser);
        setPendingTargetRole('parent');
        setPendingTargetTabName('Espace Parents');
AUTHEOF_X
  replace_once "$HEADER" "$(cat "$TMP/e32_old.txt")" "$(cat "$TMP/e32_new.txt")"

  cat > "$TMP/e33_old.txt" << 'AUTHEOF_X'
        setPendingTargetUser(orgUser);
        setPendingTargetTabName('Espace Organisateurs');
AUTHEOF_X
  cat > "$TMP/e33_new.txt" << 'AUTHEOF_X'
        setPendingTargetUser(orgUser);
        setPendingTargetRole('organizer');
        setPendingTargetTabName('Espace Organisateurs');
AUTHEOF_X
  replace_once "$HEADER" "$(cat "$TMP/e33_old.txt")" "$(cat "$TMP/e33_new.txt")"

  cat > "$TMP/e34_old.txt" << 'AUTHEOF_X'
      setPendingTargetUser(adminUser);
      setPendingTargetTabName('Espace Administrateur');
AUTHEOF_X
  cat > "$TMP/e34_new.txt" << 'AUTHEOF_X'
      setPendingTargetUser(adminUser);
      setPendingTargetRole('admin');
      setPendingTargetTabName('Espace Administrateur');
AUTHEOF_X
  replace_once "$HEADER" "$(cat "$TMP/e34_old.txt")" "$(cat "$TMP/e34_new.txt")"

  cat > "$TMP/e35_old.txt" << 'AUTHEOF_X'
      setPendingTargetUser(target);
      setPendingTargetTabName(`Compte de ${target.name}`);
AUTHEOF_X
  cat > "$TMP/e35_new.txt" << 'AUTHEOF_X'
      setPendingTargetUser(target);
      setPendingTargetRole(undefined);
      setPendingTargetTabName(`Compte de ${target.name}`);
AUTHEOF_X
  replace_once "$HEADER" "$(cat "$TMP/e35_old.txt")" "$(cat "$TMP/e35_new.txt")"

  cat > "$TMP/e36_old.txt" << 'AUTHEOF_X'
          targetTabName={pendingTargetTabName}
          onSuccessLogin=
AUTHEOF_X
  cat > "$TMP/e36_new.txt" << 'AUTHEOF_X'
          targetTabName={pendingTargetTabName}
          targetRole={pendingTargetRole}
          onSuccessLogin=
AUTHEOF_X
  replace_once "$HEADER" "$(cat "$TMP/e36_old.txt")" "$(cat "$TMP/e36_new.txt")"

  cat > "$TMP/e37_old.txt" << 'AUTHEOF_X'
import { MagicLinkAccess } from './components/MagicLinkAccess';
AUTHEOF_X
  cat > "$TMP/e37_new.txt" << 'AUTHEOF_X'
import { MagicLinkAccess } from './components/MagicLinkAccess';
import { authLogout, authImpersonate, authReturnToAdmin, getOriginAdminUser } from './utils/auth';
AUTHEOF_X
  replace_once "$APP" "$(cat "$TMP/e37_old.txt")" "$(cat "$TMP/e37_new.txt")"

  cat > "$TMP/e38_old.txt" << 'AUTHEOF_X'
  const handleLogout = () => {
    setIsAuthenticated(false);
AUTHEOF_X
  cat > "$TMP/e38_new.txt" << 'AUTHEOF_X'
  const handleLogout = () => {
    authLogout(); // ferme la session sur le serveur, efface les données du navigateur et recharge la page (build auth-20261006)
    setIsAuthenticated(false);
AUTHEOF_X
  replace_once "$APP" "$(cat "$TMP/e38_old.txt")" "$(cat "$TMP/e38_new.txt")"

  cat > "$TMP/e39_old.txt" << 'AUTHEOF_X'
  const handleSwitchUser = (newUser: User) => {

AUTHEOF_X
  cat > "$TMP/e39_new.txt" << 'AUTHEOF_X'
  const handleSwitchUser = (newUser: User) => {
    // Consultation d'un autre compte : le serveur délivre un jeton dédié ; l'administrateur garde le sien pour revenir (build auth-20261006)
    if (newUser.role === 'admin' && originAdminId) {
      authReturnToAdmin();
      return;
    }
    if (currentUser && currentUser.role === 'admin' && newUser.id !== currentUser.id) {
      authImpersonate(newUser.id, currentUser).then((ok) => {
        if (!ok) showToast("Impossible d'ouvrir ce compte pour le moment.", 'warning');
      });
      return;
    }

AUTHEOF_X
  replace_once "$APP" "$(cat "$TMP/e39_old.txt")" "$(cat "$TMP/e39_new.txt")"

  cat > "$TMP/e40_old.txt" << 'AUTHEOF_X'
originAdmin={originAdminId ? users.find((u) => u.id === originAdminId && u.role === 'admin') || null : null}
AUTHEOF_X
  cat > "$TMP/e40_new.txt" << 'AUTHEOF_X'
originAdmin={originAdminId ? users.find((u) => u.id === originAdminId && u.role === 'admin') || getOriginAdminUser() : null}
AUTHEOF_X
  replace_once "$APP" "$(cat "$TMP/e40_old.txt")" "$(cat "$TMP/e40_new.txt")"

  cat > "$TMP/e41_old.txt" << 'AUTHEOF_X'
import { exportToPdf } from '../utils/pdfGenerator';
AUTHEOF_X
  cat > "$TMP/e41_new.txt" << 'AUTHEOF_X'
import { exportToPdf } from '../utils/pdfGenerator';
import { authChangePassword } from '../utils/auth';
AUTHEOF_X
  replace_once "$ORG" "$(cat "$TMP/e41_old.txt")" "$(cat "$TMP/e41_new.txt")"

  cat > "$TMP/e42_old.txt" << 'AUTHEOF_X'
    const actualPassword = currentUser.password;
    if (actualPassword && currentPasswordInput && currentPasswordInput !== actualPassword) {
      setPwdError('Le mot de passe actuel saisi est incorrect.');
      return;
    }
AUTHEOF_X
  cat > "$TMP/e42_new.txt" << 'AUTHEOF_X'
    if (!currentPasswordInput) {
      setPwdError('Veuillez saisir votre mot de passe actuel.');
      return;
    }
AUTHEOF_X
  replace_once "$ORG" "$(cat "$TMP/e42_old.txt")" "$(cat "$TMP/e42_new.txt")"

  cat > "$TMP/e43_old.txt" << 'AUTHEOF_X'
    if (newPasswordInput.length < 4) {
      setPwdError('Le nouveau mot de passe doit comporter au moins 4 caractères.');
      return;
    }
AUTHEOF_X
  cat > "$TMP/e43_new.txt" << 'AUTHEOF_X'
    if (newPasswordInput.length < 6) {
      setPwdError('Le nouveau mot de passe doit comporter au moins 6 caractères.');
      return;
    }
AUTHEOF_X
  replace_once "$ORG" "$(cat "$TMP/e43_old.txt")" "$(cat "$TMP/e43_new.txt")"

  cat > "$TMP/e44_old.txt" << 'AUTHEOF_X'
    if (onUpdateUserPassword) {
      try {
        await onUpdateUserPassword(currentUser.id, newPasswordInput.trim());
      } catch (err) {
        setPwdError("Échec de l'enregistrement côté serveur. Réessayez ou vérifiez votre connexion avant de vous déconnecter.");
        return;
      }
    }

AUTHEOF_X
  cat > "$TMP/e44_new.txt" << 'AUTHEOF_X'
    // vérification de l'ancien mot de passe et enregistrement par le serveur (build auth-20261006)
    const chg = await authChangePassword(currentPasswordInput, newPasswordInput.trim());
    if (!chg.ok) {
      setPwdError(chg.message);
      return;
    }

AUTHEOF_X
  replace_once "$ORG" "$(cat "$TMP/e44_old.txt")" "$(cat "$TMP/e44_new.txt")"

}

# --- 1. Verification prealable (sur une copie : RIEN n'est modifie ici) ----------
echo ">>> Verification des reperes dans vos fichiers ..."
mkdir -p "$TMP/dry"
for f in $FILES; do mkdir -p "$TMP/dry/$(dirname "$f")"; cp "$APP_DIR/$f" "$TMP/dry/$f"; done
DRY=1
set_paths "$TMP/dry"
run_edits
DRY=0
set_paths "$APP_DIR"
if [ "$FAILS" -gt 0 ]; then
  echo ""
  echo "!!! $FAILS repere(s) introuvable(s) : certains de vos fichiers different de la version attendue."
  echo "!!! AUCUN fichier n'a ete modifie. Rapport complet :"
  echo ""
  cat "$REPORT"
  cp "$REPORT" /root/diagnostic-auth.txt 2>/dev/null && echo "(rapport copie dans /root/diagnostic-auth.txt)"
  echo ""
  echo "!!! Envoyez ce rapport pour obtenir un script adapte a vos fichiers."
  exit 1
fi
echo "    tous les reperes sont presents."

# --- 2. Sauvegarde ----------------------------------------------------------
echo ">>> Sauvegarde dans $BACKUP_DIR ..."
for f in $FILES $OPTIONAL_FILES; do
  if [ -f "$APP_DIR/$f" ]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$f")"
    cp -p "$APP_DIR/$f" "$BACKUP_DIR/$f"
  fi
done
PATCHING=1

# --- 3. Nouveaux fichiers --------------------------------------------------------
echo ">>> Creation des fichiers ..."
echo "    + server/auth.js"
cat > "$APP_DIR/server/auth.js" << 'AUTHEOF_X'
'use strict';
// ============================================================================
// Authentification du portail (build auth-20261006)
//  - connexion vérifiée PAR LE SERVEUR (mots de passe hachés avec scrypt, jamais renvoyés) ;
//  - sessions par jeton (parents 30 jours, personnel 7 jours, accompagnateurs 12 h, réglable) ;
//  - blocage après des essais ratés répétés ;
//  - chaque rôle ne reçoit que SES données (famille : ses enfants ; professeur : les élèves de son voyage ;
//    accompagnateur : les élèves de son voyage ; administration : tout) ;
//  - toutes les routes /api sont refusées par défaut aux non-administrateurs, sauf celles listées ci-dessous.
// Les outils d'exploitation (rattacher-fiche.sh, commandes du README) utilisent l'en-tête X-Local-Tool avec le
// secret du fichier /app/.local-tool-secret : lisible seulement dans le conteneur.
// ============================================================================
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

console.log('[fichesanitaire] build auth-20261006');

const CFG = {
  sessionDays: Number(process.env.AUTH_SESSION_DAYS || 30), // parents
  staffSessionDays: Number(process.env.AUTH_STAFF_SESSION_DAYS || 7), // professeurs et administration
  chaperoneHours: Number(process.env.AUTH_CHAPERONE_HOURS || 12), // accompagnateurs (mot de passe de voyage)
  impersonationHours: Number(process.env.AUTH_IMPERSONATION_HOURS || 4), // administrateur qui consulte un autre compte
  maxFails: Number(process.env.AUTH_MAX_FAILS || 5), // essais ratés par adresse avant blocage
  maxFailsAccount: Number(process.env.AUTH_MAX_FAILS_ACCOUNT || 30), // essais ratés toutes adresses confondues
  lockMinutes: Number(process.env.AUTH_LOCK_MINUTES || 15),
  magicLinkDays: Number(process.env.MAGIC_LINK_DAYS || 30),
  minPassword: 6,
  testHook: process.env.AUTH_TEST_HOOK === '1',
};

const K = {
  users: 'cerfa_users_v1',
  students: 'cerfa_students_v11',
  trips: 'cerfa_trips_v2',
  classes: 'cerfa_classes_v1',
  notifications: 'cerfa_notifications_v1',
  name: 'cerfa_establishment_name_v1',
  logo: 'cerfa_logo_v1',
  reminderTpl: 'cerfa_reminder_template_v1',
  autoEnabled: 'cerfa_auto_reminder_enabled_v1',
  autoLast: 'cerfa_last_auto_reminder_run_v1',
  sessions: 'cerfa_auth_sessions_v1',
  magic: 'cerfa_magic_links_v1',
};
const ADMIN_WRITABLE = [K.users, K.students, K.trips, K.classes, K.notifications, K.name, K.logo, K.reminderTpl, K.autoEnabled, K.autoLast];

// ----------------------------------------------------------------------------- outils
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const safeEq = (a, b) => {
  const x = Buffer.from(sha256(a));
  const y = Buffer.from(sha256(b));
  return crypto.timingSafeEqual(x, y);
};
const normAnswer = (s) => String(s == null ? '' : s).trim().toLowerCase();
const clip = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

async function hashSecret(plain) {
  const salt = crypto.randomBytes(16);
  const N = 16384;
  const r = 8;
  const p = 1;
  const key = await scrypt(String(plain), salt, 64, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function verifyHash(plain, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, N, r, p, salt, key] = parts;
    const expected = Buffer.from(key, 'base64');
    const got = await scrypt(String(plain), Buffer.from(salt, 'base64'), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  } catch {
    return false;
  }
}
let DUMMY_HASH = null; // sert à égaliser le temps de réponse quand le compte n'existe pas

// Retire tout secret d'un compte avant de l'envoyer au navigateur
function sanitizeUser(u) {
  if (!u) return u;
  const c = { ...u };
  delete c.password;
  delete c.passwordHash;
  delete c.secretAnswer;
  delete c.secretAnswerHash;
  return c;
}
const stripTrip = (t) => {
  if (!t) return t;
  const c = { ...t };
  delete c.chaperonePassword;
  return c;
};

// ----------------------------------------------------------------------------- blocage des essais
const fails = new Map(); // clé -> { count, first, lockedUntil }
function failState(key) {
  const now = Date.now();
  let s = fails.get(key);
  if (s && !s.lockedUntil && now - s.first > CFG.lockMinutes * 60000) s = null;
  if (s && s.lockedUntil && now > s.lockedUntil) s = null;
  if (!s) {
    s = { count: 0, first: now, lockedUntil: 0 };
    fails.set(key, s);
  }
  return s;
}
function lockedFor(keys) {
  const now = Date.now();
  let wait = 0;
  keys.forEach(({ key }) => {
    const s = fails.get(key);
    if (s && s.lockedUntil && s.lockedUntil > now) wait = Math.max(wait, Math.ceil((s.lockedUntil - now) / 1000));
  });
  return wait;
}
function registerFailure(keys) {
  keys.forEach(({ key, max }) => {
    const s = failState(key);
    s.count += 1;
    if (s.count >= max) s.lockedUntil = Date.now() + CFG.lockMinutes * 60000;
  });
}
function clearFailures(keys) {
  keys.forEach(({ key }) => fails.delete(key));
}
setInterval(() => {
  const now = Date.now();
  fails.forEach((s, k) => {
    if ((s.lockedUntil && s.lockedUntil < now) || (!s.lockedUntil && now - s.first > CFG.lockMinutes * 60000)) fails.delete(k);
  });
}, 5 * 60000).unref();

// ----------------------------------------------------------------------------- module
function install(app, deps) {
  const { readKv, writeKv } = deps;

  app.set('trust proxy', process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal');
  const clientIp = (req) => String(req.ip || (req.socket && req.socket.remoteAddress) || 'inconnue');

  // --- secret des outils locaux (rattacher-fiche.sh, commandes du README) ---
  const SECRET_FILE = path.join(__dirname, '..', '.local-tool-secret');
  let TOOL_SECRET = process.env.LOCAL_TOOL_SECRET || '';
  if (!TOOL_SECRET) {
    try {
      TOOL_SECRET = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(SECRET_FILE, TOOL_SECRET, { mode: 0o600 });
    } catch (e) {
      console.error('[auth] Secret des outils locaux non écrit :', e.message);
    }
  }

  // --- comptes (cache de 3 s : évite de relire toute la liste à chaque requête) ---
  let usersCache = null;
  let usersCacheAt = 0;
  async function getUsers() {
    if (usersCache && Date.now() - usersCacheAt < 3000) return usersCache;
    usersCache = (await readKv(K.users)) || [];
    usersCacheAt = Date.now();
    return usersCache;
  }
  const invalidateUsers = () => {
    usersCache = null;
  };
  async function saveUsers(list) {
    await writeKv(K.users, list);
    invalidateUsers();
  }

  // --- sessions ---
  let sessions = new Map(); // empreinte du jeton -> session
  let persistTimer = null;
  const persistSoon = () => {
    if (persistTimer) return;
    persistTimer = setTimeout(async () => {
      persistTimer = null;
      try {
        await writeKv(K.sessions, [...sessions.values()]);
      } catch (e) {
        console.error('[auth] Sauvegarde des sessions impossible :', e.message);
      }
    }, 800);
  };
  async function loadSessions() {
    const list = (await readKv(K.sessions)) || [];
    const now = Date.now();
    sessions = new Map(list.filter((s) => s && s.h && s.expiresAt > now).map((s) => [s.h, s]));
  }
  function createSession(sub, ttlMs) {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    const s = { h: sha256(token), kind: sub.kind, userId: sub.userId || null, tripId: sub.tripId || null, impersonatedBy: sub.impersonatedBy || null, createdAt: now, expiresAt: now + ttlMs };
    sessions.set(s.h, s);
    persistSoon();
    return { token, expiresAt: s.expiresAt };
  }
  function revokeToken(token) {
    if (token && sessions.delete(sha256(token))) persistSoon();
  }
  function revokeUserSessions(userId, exceptHash) {
    let n = 0;
    sessions.forEach((s, h) => {
      if (s.userId === userId && h !== exceptHash) {
        sessions.delete(h);
        n += 1;
      }
    });
    if (n) persistSoon();
  }
  const ttlFor = (role) => (role === 'parent' ? CFG.sessionDays * 86400000 : CFG.staffSessionDays * 86400000);

  const bearer = (req) => {
    const h = String(req.headers.authorization || '');
    return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  };

  // --- identification de l'appelant ---
  async function authenticate(req) {
    const tool = req.headers['x-local-tool'];
    if (tool && TOOL_SECRET && safeEq(String(tool), TOOL_SECRET)) return { kind: 'system', role: 'admin' };
    const token = bearer(req);
    if (!token) return null;
    const h = sha256(token);
    const s = sessions.get(h);
    if (!s || s.expiresAt <= Date.now()) {
      if (s) sessions.delete(h);
      return null;
    }
    if (s.kind === 'chaperone') return { kind: 'chaperone', role: 'chaperone', tripId: s.tripId, hash: h };
    const users = await getUsers();
    const user = users.find((u) => u && u.id === s.userId);
    if (!user) {
      sessions.delete(h);
      return null;
    }
    return { kind: 'user', role: user.role, user, hash: h, impersonatedBy: s.impersonatedBy || null };
  }
  const isAdmin = (a) => !!a && (a.kind === 'system' || (a.kind === 'user' && a.role === 'admin'));

  // --- données visibles par chaque rôle ---
  async function buildView(auth) {
    const out = {};
    const name = await readKv(K.name);
    const logo = await readKv(K.logo);
    const trips = (await readKv(K.trips)) || [];
    if (name !== null) out[K.name] = name;
    if (logo !== null) out[K.logo] = logo;
    const admin = isAdmin(auth);
    out[K.trips] = admin ? trips : trips.map(stripTrip);
    // clés toujours présentes (vides pour un visiteur) : le navigateur n'invente pas de comptes de démonstration
    out[K.users] = [];
    out[K.students] = [];
    out[K.classes] = [];
    out[K.notifications] = [];
    if (!auth) return out;
    const [students, classes, notifs] = [(await readKv(K.students)) || [], (await readKv(K.classes)) || [], (await readKv(K.notifications)) || []];
    if (auth.kind === 'chaperone') {
      out[K.trips] = trips.filter((t) => t.id === auth.tripId).map(stripTrip);
      out[K.students] = students.filter((s) => s && !s.deletedAt && (s.registeredTripIds || []).includes(auth.tripId));
      out[K.classes] = classes;
      return out;
    }
    out[K.classes] = classes;
    if (admin) {
      const users = await getUsers();
      out[K.users] = users.map(sanitizeUser);
      out[K.students] = students;
      out[K.notifications] = notifs;
      const extra = [[K.reminderTpl], [K.autoEnabled], [K.autoLast]];
      for (const [k] of extra) {
        const v = await readKv(k);
        if (v !== null) out[k] = v;
      }
      return out;
    }
    const u = auth.user;
    out[K.users] = [sanitizeUser(u)];
    out[K.notifications] = notifs.filter((n) => n.targetRole === 'all' || n.targetRole === u.role || n.targetUserId === u.id);
    if (u.role === 'parent') out[K.students] = students.filter((s) => s && !s.deletedAt && s.parentId === u.id);
    else if (u.role === 'organizer') {
      const mine = new Set(u.assignedTripIds || []);
      out[K.students] = students.filter((s) => s && !s.deletedAt && (s.registeredTripIds || []).some((id) => mine.has(id)));
    }
    return out;
  }

  // --- règles d'accès ---
  const RULES = [
    ['GET', /^\/api\/data(\/[^/]+)?$/, 'view'],
    ['PUT', /^\/api\/data\/[^/]+$/, 'datawrite'],
    ['POST', /^\/api\/auth\/(login|register|secret-question|reset-password|chaperone|logout)$/, 'public'],
    ['GET', /^\/api\/auth\/me$/, 'public'],
    ['POST', /^\/api\/auth\/change-password$/, 'user'],
    ['POST', /^\/api\/auth\/impersonate$/, 'admin'],
    ['POST', /^\/api\/auth\/test-token$/, 'system'],
    ['GET', /^\/api\/magic-link\/[^/]+$/, 'magic'],
    ['PUT', /^\/api\/magic-link\/[^/]+$/, 'magic'],
    ['GET', /^\/api\/(popups\/public|year-end\/public)$/, 'public'],
    ['POST', /^\/api\/(comm\/poll|messages\/(list|send|read)|popups\/ack)$/, 'user'],
    ['POST', /^\/api\/students\/(upsert|check-duplicate)$/, 'parent_admin'],
    ['POST', /^\/api\/students\/send-pdf$/, 'pdf'],
    ['POST', /^\/api\/users\/upsert$/, 'users_upsert'],
  ];
  const FORCE_USERID = /^\/api\/(comm\/|messages\/|popups\/(ack|send|list|deactivate|delete)|year-end\/(get|save|run|undo)|reminders\/run-auto-now)/;

  const deny = (res, status, error) => res.status(status).json({ error });

  async function magicEntry(token) {
    const links = (await readKv(K.magic)) || {};
    const e = links[token];
    if (!e) return null;
    if (e.expiresAt && Date.parse(e.expiresAt) < Date.now()) return 'expired';
    return e;
  }

  async function middleware(req, res, next) {
    try {
      if (!req.path.startsWith('/api/')) return next();
      const p = req.path.replace(/\/+$/, '') || '/';
      let level = 'admin';
      for (const [m, re, lv] of RULES) {
        if (m === req.method && re.test(p)) {
          level = lv;
          break;
        }
      }
      const auth = await authenticate(req);
      req.auth = auth;

      if (level === 'public') return next();
      if (level === 'view') return handleView(req, res, auth, p);
      if (level === 'magic') return handleMagic(req, res, next, p);

      if (!auth && level === 'pdf') {
        // une personne qui utilise un lien direct valide archive le PDF de CET élève uniquement
        const e = await magicEntry(String(req.headers['x-magic-token'] || ''));
        if (e && e !== 'expired' && req.body && e.studentId === req.body.studentId) return next();
        return deny(res, 401, 'auth-required');
      }
      if (!auth) return deny(res, 401, 'auth-required');
      const admin = isAdmin(auth);

      if (level === 'system') {
        if (auth.kind !== 'system') return deny(res, 403, 'forbidden');
        return next();
      }
      if (level === 'datawrite') return handleDataWrite(req, res, auth, p);
      if (level === 'admin' && !admin) return deny(res, 403, 'forbidden');
      if (level === 'user' && auth.kind === 'chaperone') return deny(res, 403, 'forbidden');
      if (level === 'parent_admin') {
        if (!admin && !(auth.kind === 'user' && auth.role === 'parent')) return deny(res, 403, 'forbidden');
        return handleStudentsRoute(req, res, next, auth, p);
      }
      if (level === 'pdf') return handlePdf(req, res, next, auth);
      if (level === 'users_upsert') return handleUsersUpsert(req, res, next, auth);

      // identité imposée : le navigateur ne peut plus se faire passer pour un autre compte
      if (FORCE_USERID.test(p) && req.body && typeof req.body === 'object') {
        if (auth.kind === 'user') req.body.userId = auth.user.id;
        else if (auth.kind === 'system' && !req.body.userId) {
          const first = (await getUsers()).find((u) => u && u.role === 'admin');
          if (first) req.body.userId = first.id;
        }
      }
      if (p === '/api/users/remove') return handleUsersRemove(req, res, next, auth);
      return next();
    } catch (e) {
      console.error('[auth] Erreur de contrôle :', e);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  }
  app.use(middleware);

  async function handleView(req, res, auth, p) {
    const view = await buildView(auth);
    const m = p.match(/^\/api\/data\/([^/]+)$/);
    if (!m) return res.json(view);
    let key = m[1];
    try {
      key = decodeURIComponent(key);
    } catch {
      /* clé brute */
    }
    if (!Object.prototype.hasOwnProperty.call(view, key)) return res.status(404).json({ error: 'Non trouvé' });
    return res.json({ key, value: view[key] });
  }

  async function handleMagic(req, res, next, p) {
    const token = decodeURIComponent(p.split('/').pop() || '');
    const e = await magicEntry(token);
    if (!e) return deny(res, 404, 'Lien invalide.');
    if (e === 'expired') return deny(res, 410, 'Ce lien a expiré : demandez-en un nouveau à l\'établissement.');
    if (req.method === 'GET') {
      // les trajets proposés au parent ne contiennent jamais le mot de passe accompagnateur
      const orig = res.json.bind(res);
      res.json = (obj) => {
        if (obj && Array.isArray(obj.trips)) obj = { ...obj, trips: obj.trips.map(stripTrip) };
        return orig(obj);
      };
    } else if (req.method === 'PUT') {
      // le lien ne permet pas de rattacher la fiche à un autre compte
      const students = (await readKv(K.students)) || [];
      const stored = students.find((s) => s && s.id === e.studentId);
      if (stored && req.body && req.body.student) req.body.student.parentId = stored.parentId;
    }
    return next();
  }

  async function handleDataWrite(req, res, auth, p) {
    let key = p.split('/').pop();
    try {
      key = decodeURIComponent(key);
    } catch {
      /* clé brute */
    }
    const value = req.body ? req.body.value : undefined;
    if (isAdmin(auth)) {
      if (!ADMIN_WRITABLE.includes(key)) return deny(res, 403, 'forbidden');
      if (key === K.users) return adminWriteUsers(res, value);
      await writeKv(key, value);
      return res.json({ ok: true });
    }
    // les autres rôles : seulement l'état « lu » de leurs notifications
    if (key === K.notifications && auth.kind === 'user' && Array.isArray(value)) {
      const u = auth.user;
      const list = (await readKv(K.notifications)) || [];
      const incoming = new Map(value.filter((n) => n && n.id).map((n) => [n.id, n]));
      let changed = false;
      list.forEach((n) => {
        const visible = n.targetRole === 'all' || n.targetRole === u.role || n.targetUserId === u.id;
        const inc = incoming.get(n.id);
        if (visible && inc && typeof inc.read === 'boolean' && inc.read !== n.read) {
          n.read = inc.read;
          changed = true;
        }
      });
      if (changed) await writeKv(K.notifications, list);
      return res.json({ ok: true });
    }
    return deny(res, 403, 'forbidden');
  }

  // Écriture de la liste des comptes par l'administration : les empreintes de mots de passe sont conservées
  async function mergeUser(base, incoming) {
    const merged = { ...(base || {}), ...incoming };
    merged.passwordHash = base && base.passwordHash ? base.passwordHash : undefined;
    merged.secretAnswerHash = base && base.secretAnswerHash ? base.secretAnswerHash : undefined;
    delete merged.password;
    delete merged.secretAnswer;
    if (typeof incoming.password === 'string' && incoming.password.trim()) merged.passwordHash = await hashSecret(incoming.password.trim());
    if (typeof incoming.secretAnswer === 'string' && incoming.secretAnswer.trim()) merged.secretAnswerHash = await hashSecret(normAnswer(incoming.secretAnswer));
    if (!merged.passwordHash) delete merged.passwordHash;
    if (!merged.secretAnswerHash) delete merged.secretAnswerHash;
    return merged;
  }
  async function adminWriteUsers(res, list) {
    if (!Array.isArray(list)) return deny(res, 400, 'liste invalide');
    const release = await deps.lockUserWrites();
    try {
      const stored = (await readKv(K.users)) || [];
      const byId = new Map(stored.map((u) => [u.id, u]));
      const merged = [];
      for (const u of list) {
        if (!u || !u.id) continue;
        merged.push(await mergeUser(byId.get(u.id), u));
      }
      if (!merged.some((u) => u.role === 'admin')) return deny(res, 409, 'Il doit rester au moins un administrateur.');
      const keep = new Set(merged.map((u) => u.id));
      stored.forEach((u) => {
        if (!keep.has(u.id)) revokeUserSessions(u.id);
      });
      await saveUsers(merged);
    } finally {
      release();
    }
    return res.json({ ok: true });
  }

  async function handleUsersUpsert(req, res, next, auth) {
    const incoming = req.body && req.body.user;
    if (!incoming || !incoming.id) return deny(res, 400, 'user manquant ou invalide');
    const users = await getUsers();
    const base = users.find((u) => u && u.id === incoming.id) || null;
    if (isAdmin(auth)) {
      if (!['parent', 'organizer', 'admin'].includes(incoming.role)) return deny(res, 400, 'rôle invalide');
      req.body.user = await mergeUser(base, incoming);
      invalidateUsers();
      res.on('finish', invalidateUsers);
      return next();
    }
    // un utilisateur ne modifie que son propre profil : jamais son rôle, ses voyages ni son mot de passe
    if (auth.kind !== 'user' || incoming.id !== auth.user.id || !base) return deny(res, 403, 'forbidden');
    const picked = {};
    ['name', 'firstName', 'lastName', 'phone', 'email', 'secretQuestion'].forEach((f) => {
      if (incoming[f] !== undefined) picked[f] = clip(incoming[f], 200);
    });
    if (picked.email && users.some((u) => u.id !== base.id && String(u.email || '').toLowerCase() === picked.email.toLowerCase())) return deny(res, 409, 'email-exists');
    const merged = { ...base, ...picked };
    if (typeof incoming.secretAnswer === 'string' && incoming.secretAnswer.trim()) merged.secretAnswerHash = await hashSecret(normAnswer(incoming.secretAnswer));
    req.body.user = merged;
    invalidateUsers();
    res.on('finish', invalidateUsers);
    return next();
  }

  async function handleUsersRemove(req, res, next, auth) {
    const id = req.body && req.body.userId;
    const users = await getUsers();
    const target = users.find((u) => u && u.id === id);
    if (target && target.role === 'admin' && users.filter((u) => u.role === 'admin').length <= 1) return deny(res, 409, 'Il doit rester au moins un administrateur.');
    if (id) revokeUserSessions(id);
    invalidateUsers();
    res.on('finish', invalidateUsers);
    return next();
  }

  async function handleStudentsRoute(req, res, next, auth, p) {
    const admin = isAdmin(auth);
    if (p === '/api/students/check-duplicate') {
      if (!admin && req.body && typeof req.body === 'object') req.body.parentId = auth.user.id;
      return next();
    }
    const stu = req.body && req.body.student;
    if (!stu || !stu.id) return next(); // le contrôle habituel répondra 400
    if (!admin) {
      const students = (await readKv(K.students)) || [];
      const stored = students.find((s) => s && s.id === stu.id);
      if (stored && stored.parentId !== auth.user.id) return deny(res, 403, 'forbidden');
      stu.parentId = stored ? stored.parentId : auth.user.id;
    }
    return next();
  }

  async function handlePdf(req, res, next, auth) {
    const admin = isAdmin(auth);
    const studentId = req.body && req.body.studentId;
    if (admin) return next();
    if (auth.kind === 'user' && auth.role === 'parent') {
      const students = (await readKv(K.students)) || [];
      const stored = students.find((s) => s && s.id === studentId);
      if (!stored || stored.parentId !== auth.user.id) return deny(res, 403, 'forbidden');
      return next();
    }
    return deny(res, 403, 'forbidden');
  }

  // --- connexion ---
  const sessionOut = (user, sess) => ({ ok: true, token: sess.token, expiresAt: sess.expiresAt, user: sanitizeUser(user) });

  async function verifyUserPassword(user, plain) {
    if (user.passwordHash) return verifyHash(plain, user.passwordHash);
    if (typeof user.password === 'string' && user.password) {
      // ancien format (clair) : accepté une dernière fois, puis converti en empreinte
      return safeEq(plain, user.password);
    }
    return false;
  }
  async function upgradeLegacy(user, plain) {
    const release = await deps.lockUserWrites();
    try {
      const users = await readKv(K.users);
      const i = (users || []).findIndex((u) => u.id === user.id);
      if (i === -1) return;
      users[i].passwordHash = await hashSecret(plain);
      delete users[i].password;
      await saveUsers(users);
    } finally {
      release();
    }
  }

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { role, identifier, password } = req.body || {};
      const q = clip(identifier, 200).toLowerCase();
      if (!['parent', 'organizer', 'admin'].includes(role) || typeof password !== 'string' || !password) return deny(res, 400, 'invalid');
      const ip = clientIp(req);
      const kIp = { key: `login|${ip}|${role}|${q}`, max: CFG.maxFails };
      const kAcc = { key: `login|${role}|${q}`, max: CFG.maxFailsAccount };
      const wait = lockedFor([kIp, kAcc]);
      if (wait) return res.status(429).json({ error: 'locked', retryAfterSeconds: wait });

      const users = await getUsers();
      let candidates = users.filter((u) => u && u.role === role);
      if (q) {
        candidates = candidates.filter(
          (u) =>
            String(u.email || '').toLowerCase() === q ||
            String(u.name || '').toLowerCase() === q ||
            (u.firstName && u.lastName && `${u.firstName} ${u.lastName}`.toLowerCase() === q)
        );
      } else if (role === 'parent') candidates = [];
      else if (role === 'organizer' && candidates.length !== 1) candidates = [];

      let matched = null;
      for (const u of candidates) {
        if (await verifyUserPassword(u, password)) {
          matched = u;
          break;
        }
      }
      if (!candidates.length) await verifyHash(password, DUMMY_HASH); // même durée de réponse qu'un vrai essai
      if (!matched) {
        registerFailure([kIp, kAcc]);
        console.log(`[auth] échec de connexion (${role}) depuis ${ip}`);
        return res.status(401).json({ error: 'invalid' });
      }
      clearFailures([kIp, kAcc]);
      if (!matched.passwordHash) await upgradeLegacy(matched, password);
      const sess = createSession({ kind: 'user', userId: matched.id }, ttlFor(matched.role));
      console.log(`[auth] connexion (${matched.role}) ${matched.id}`);
      return res.json(sessionOut(matched, sess));
    } catch (e) {
      console.error('[auth] login :', e);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  const regCount = new Map(); // ip -> [horodatages]
  app.post('/api/auth/register', async (req, res) => {
    try {
      const b = req.body || {};
      const firstName = clip(b.firstName, 80);
      const lastName = clip(b.lastName, 80);
      const email = clip(b.email, 150).toLowerCase();
      const phone = clip(b.phone, 40);
      const password = typeof b.password === 'string' ? b.password : '';
      const secretQuestion = clip(b.secretQuestion, 200);
      const secretAnswer = clip(b.secretAnswer, 200);
      if (!firstName || !lastName || !email || !password || !secretAnswer) return deny(res, 400, 'missing-fields');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return deny(res, 400, 'bad-email');
      if (password.length < CFG.minPassword) return res.status(400).json({ error: 'weak-password', min: CFG.minPassword });
      const ip = clientIp(req);
      const now = Date.now();
      const recent = (regCount.get(ip) || []).filter((t) => now - t < 3600000);
      if (recent.length >= 15) return res.status(429).json({ error: 'too-many', retryAfterSeconds: 600 });
      recent.push(now);
      regCount.set(ip, recent);

      const release = await deps.lockUserWrites();
      let user;
      try {
        const users = (await readKv(K.users)) || [];
        if (users.some((u) => u && String(u.email || '').toLowerCase() === email)) return deny(res, 409, 'email-exists');
        user = {
          id: 'parent-' + Date.now() + '-' + crypto.randomBytes(2).toString('hex'),
          name: `${firstName} ${lastName}`,
          firstName,
          lastName,
          email,
          phone,
          role: 'parent',
          passwordHash: await hashSecret(password),
          secretQuestion,
          secretAnswerHash: await hashSecret(normAnswer(secretAnswer)),
          isDemo: false,
        };
        users.push(user);
        await saveUsers(users);
      } finally {
        release();
      }
      try {
        await deps.commSendWelcome({ id: user.id, name: user.name, firstName: user.firstName, lastName: user.lastName });
      } catch (e) {
        console.error("[auth] Message d'accueil impossible :", e.message);
      }
      const sess = createSession({ kind: 'user', userId: user.id }, ttlFor('parent'));
      console.log(`[auth] compte parent créé ${user.id}`);
      return res.json(sessionOut(user, sess));
    } catch (e) {
      console.error('[auth] register :', e);
      if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  const questionCount = new Map();
  app.post('/api/auth/secret-question', async (req, res) => {
    try {
      const ip = clientIp(req);
      const now = Date.now();
      const recent = (questionCount.get(ip) || []).filter((t) => now - t < 900000);
      if (recent.length >= 30) return res.status(429).json({ error: 'too-many' });
      recent.push(now);
      questionCount.set(ip, recent);
      const email = clip(req.body && req.body.email, 150).toLowerCase();
      const u = email ? (await getUsers()).find((x) => x && x.role === 'parent' && String(x.email || '').toLowerCase() === email) : null;
      return res.json({ question: u && u.secretQuestion && (u.secretAnswerHash || u.secretAnswer) ? u.secretQuestion : null });
    } catch (e) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  app.post('/api/auth/reset-password', async (req, res) => {
    try {
      const b = req.body || {};
      const email = clip(b.email, 150).toLowerCase();
      const answer = typeof b.secretAnswer === 'string' ? b.secretAnswer : '';
      const newPassword = typeof b.newPassword === 'string' ? b.newPassword : '';
      const ip = clientIp(req);
      const kIp = { key: `reset|${ip}|${email}`, max: CFG.maxFails };
      const kAcc = { key: `reset|${email}`, max: CFG.maxFailsAccount };
      const wait = lockedFor([kIp, kAcc]);
      if (wait) return res.status(429).json({ error: 'locked', retryAfterSeconds: wait });
      const users = (await readKv(K.users)) || [];
      const i = users.findIndex((x) => x && x.role === 'parent' && String(x.email || '').toLowerCase() === email);
      if (i === -1) {
        registerFailure([kIp, kAcc]);
        return res.status(404).json({ error: 'no-account' });
      }
      const u = users[i];
      if (!u.secretAnswerHash && !u.secretAnswer) return res.status(409).json({ error: 'no-secret' });
      if (newPassword.length < CFG.minPassword) return res.status(400).json({ error: 'weak-password', min: CFG.minPassword });
      const ok = u.secretAnswerHash ? await verifyHash(normAnswer(answer), u.secretAnswerHash) : safeEq(normAnswer(answer), normAnswer(u.secretAnswer));
      if (!ok) {
        registerFailure([kIp, kAcc]);
        return res.status(401).json({ error: 'wrong-answer' });
      }
      clearFailures([kIp, kAcc]);
      const release = await deps.lockUserWrites();
      try {
        const fresh = (await readKv(K.users)) || [];
        const j = fresh.findIndex((x) => x && x.id === u.id);
        if (j === -1) return deny(res, 404, 'no-account');
        fresh[j].passwordHash = await hashSecret(newPassword);
        delete fresh[j].password;
        if (!fresh[j].secretAnswerHash) {
          fresh[j].secretAnswerHash = await hashSecret(normAnswer(answer));
          delete fresh[j].secretAnswer;
        }
        await saveUsers(fresh);
        revokeUserSessions(u.id);
        const sess = createSession({ kind: 'user', userId: u.id }, ttlFor(fresh[j].role));
        console.log(`[auth] mot de passe réinitialisé ${u.id}`);
        return res.json(sessionOut(fresh[j], sess));
      } finally {
        release();
      }
    } catch (e) {
      console.error('[auth] reset :', e);
      if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  app.post('/api/auth/chaperone', async (req, res) => {
    try {
      const { tripId, password } = req.body || {};
      const ip = clientIp(req);
      const kIp = { key: `chap|${ip}|${tripId}`, max: CFG.maxFails };
      const kAcc = { key: `chap|${tripId}`, max: CFG.maxFailsAccount };
      const wait = lockedFor([kIp, kAcc]);
      if (wait) return res.status(429).json({ error: 'locked', retryAfterSeconds: wait });
      const trips = (await readKv(K.trips)) || [];
      const trip = trips.find((t) => t && t.id === tripId);
      if (!trip) return deny(res, 404, 'no-trip');
      if (!trip.chaperonePassword || !String(trip.chaperonePassword).trim()) return deny(res, 409, 'no-password');
      if (typeof password !== 'string' || !safeEq(password, trip.chaperonePassword)) {
        registerFailure([kIp, kAcc]);
        return res.status(401).json({ error: 'invalid' });
      }
      clearFailures([kIp, kAcc]);
      const sess = createSession({ kind: 'chaperone', tripId: trip.id }, CFG.chaperoneHours * 3600000);
      return res.json({ ok: true, token: sess.token, expiresAt: sess.expiresAt, tripId: trip.id });
    } catch (e) {
      console.error('[auth] chaperone :', e);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    revokeToken(bearer(req));
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => {
    const a = req.auth;
    if (!a || a.kind === 'system') return res.json({ authenticated: false });
    if (a.kind === 'chaperone') return res.json({ authenticated: true, kind: 'chaperone', tripId: a.tripId });
    return res.json({ authenticated: true, kind: 'user', user: sanitizeUser(a.user), impersonatedBy: a.impersonatedBy });
  });

  app.post('/api/auth/change-password', async (req, res) => {
    try {
      const a = req.auth;
      const { currentPassword, newPassword } = req.body || {};
      if (a.kind !== 'user') return deny(res, 403, 'forbidden');
      if (typeof newPassword !== 'string' || newPassword.length < CFG.minPassword) return res.status(400).json({ error: 'weak-password', min: CFG.minPassword });
      const kAcc = { key: `chg|${a.user.id}`, max: CFG.maxFails };
      const wait = lockedFor([kAcc]);
      if (wait) return res.status(429).json({ error: 'locked', retryAfterSeconds: wait });
      const full = ((await readKv(K.users)) || []).find((u) => u.id === a.user.id);
      if (!full || !(await verifyUserPassword(full, String(currentPassword || '')))) {
        registerFailure([kAcc]);
        return res.status(401).json({ error: 'wrong-current' });
      }
      clearFailures([kAcc]);
      if (await verifyUserPassword(full, newPassword)) return deny(res, 400, 'same-password');
      const release = await deps.lockUserWrites();
      try {
        const users = (await readKv(K.users)) || [];
        const i = users.findIndex((u) => u.id === a.user.id);
        users[i].passwordHash = await hashSecret(newPassword);
        delete users[i].password;
        await saveUsers(users);
      } finally {
        release();
      }
      revokeUserSessions(a.user.id, a.hash); // les autres appareils doivent se reconnecter
      console.log(`[auth] mot de passe changé ${a.user.id}`);
      return res.json({ ok: true });
    } catch (e) {
      console.error('[auth] change-password :', e);
      if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  app.post('/api/auth/impersonate', async (req, res) => {
    try {
      const a = req.auth;
      const target = (await getUsers()).find((u) => u && u.id === (req.body && req.body.userId));
      if (!target) return deny(res, 404, 'no-user');
      if (a.kind === 'user' && a.impersonatedBy) return deny(res, 403, 'forbidden');
      const sess = createSession({ kind: 'user', userId: target.id, impersonatedBy: a.kind === 'user' ? a.user.id : 'system' }, CFG.impersonationHours * 3600000);
      console.log(`[auth] consultation du compte ${target.id} par ${a.kind === 'user' ? a.user.id : 'système'}`);
      return res.json(sessionOut(target, sess));
    } catch (e) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  app.post('/api/auth/test-token', async (req, res) => {
    if (!CFG.testHook) return deny(res, 404, 'Not found');
    const u = (await getUsers()).find((x) => x && x.id === (req.body && req.body.userId));
    if (!u) return deny(res, 404, 'no-user');
    return res.json(sessionOut(u, createSession({ kind: 'user', userId: u.id }, ttlFor(u.role))));
  });

  // --- démarrage : conversion des mots de passe en clair, sessions, liens directs ---
  async function migrate() {
    try {
      DUMMY_HASH = await hashSecret('mot-de-passe-factice');
      await loadSessions();
      const users = (await readKv(K.users)) || [];
      let n = 0;
      for (const u of users) {
        if (typeof u.password === 'string' && u.password) {
          if (!u.passwordHash) u.passwordHash = await hashSecret(u.password);
          delete u.password;
          n += 1;
        } else if ('password' in u) {
          delete u.password;
        }
        if (typeof u.secretAnswer === 'string' && u.secretAnswer) {
          if (!u.secretAnswerHash) u.secretAnswerHash = await hashSecret(normAnswer(u.secretAnswer));
          delete u.secretAnswer;
          n += 1;
        }
      }
      if (n > 0) {
        await saveUsers(users);
        console.log(`[auth] ${n} mot(s) de passe / réponse(s) secrète(s) en clair converti(s) en empreintes illisibles.`);
      }
      // Aucun administrateur (installation neuve, ou comptes perdus) : un compte « Administrateur » est créé avec un mot de passe
      // temporaire, affiché une seule fois dans le journal (INITIAL_ADMIN_PASSWORD le fixe à l'avance, sans l'afficher)
      if (!users.some((u) => u && u.role === 'admin')) {
        const fixed = process.env.INITIAL_ADMIN_PASSWORD || '';
        const pwd = fixed.length >= CFG.minPassword ? fixed : crypto.randomBytes(9).toString('base64url');
        users.push({ id: 'admin-initial', name: 'Administrateur', email: 'administrateur@portail.local', role: 'admin', passwordHash: await hashSecret(pwd), isDemo: false });
        await saveUsers(users);
        console.log(
          fixed.length >= CFG.minPassword
            ? '[auth] AUCUN compte administrateur : compte « Administrateur » créé avec le mot de passe INITIAL_ADMIN_PASSWORD (à changer dans Administration).'
            : `[auth] AUCUN compte administrateur : compte « Administrateur » créé. Mot de passe temporaire (à changer aussitôt dans Administration) : ${pwd}`
        );
      }
      // liens directs existants : une échéance de 30 jours est posée à partir d'aujourd'hui
      const links = (await readKv(K.magic)) || {};
      let m = 0;
      const exp = new Date(Date.now() + CFG.magicLinkDays * 86400000).toISOString();
      Object.keys(links).forEach((t) => {
        if (!links[t].expiresAt) {
          links[t].expiresAt = exp;
          m += 1;
        }
      });
      if (m > 0) {
        await writeKv(K.magic, links);
        console.log(`[auth] ${m} lien(s) direct(s) existant(s) : échéance fixée au ${exp.slice(0, 10)}.`);
      }
      console.log(`[auth] authentification active : sessions parents ${CFG.sessionDays} j, personnel ${CFG.staffSessionDays} j, blocage après ${CFG.maxFails} essais (${CFG.lockMinutes} min).`);
    } catch (e) {
      console.error('[auth] Migration impossible :', e);
    }
  }

  return { migrate, K, CFG, hashSecret, sanitizeUser };
}

module.exports = { install };
AUTHEOF_X
echo "    + src/utils/auth.ts"
cat > "$APP_DIR/src/utils/auth.ts" << 'AUTHEOF_X'
import { User, UserRole } from '../types';
import { setCurrentUserId, clearStoredCurrentUserId, clearAllCachedData } from './storage';

console.log('[fichesanitaire] build auth-20261006');

// ============================================================================
// Authentification côté navigateur : la connexion est vérifiée PAR LE SERVEUR.
// Le navigateur ne reçoit plus la liste des comptes ni les mots de passe ; il garde seulement un jeton de session
// (valable 30 jours pour les familles) qu'il joint à chaque requête vers /api.
// Après une connexion, un changement de compte ou une déconnexion, la page est rechargée : l'application repart
// alors avec les seules données autorisées pour le nouveau compte.
// ============================================================================

const TOKEN_KEY = 'cerfa_auth_token_v1';
const CHAPERONE_KEY = 'cerfa_chaperone_trip_v1';
const GATE_MODE_KEY = 'cerfa_gate_mode_v1';
const EXPIRED_KEY = 'cerfa_session_expired_v1';
const ORIGIN_ADMIN_ID_KEY = 'cerfa_origin_admin_id'; // même clé que l'application (retour administrateur)
const ORIGIN_TOKEN_KEY = 'cerfa_origin_token_v1';
const ORIGIN_USER_KEY = 'cerfa_origin_admin_user_v1';

let memToken = '';
let magicToken: string | null = null;

export const setMagicToken = (t: string | null): void => {
  magicToken = t;
};

export const getAuthToken = (): string => {
  try {
    return localStorage.getItem(TOKEN_KEY) || memToken;
  } catch {
    return memToken;
  }
};
const setAuthToken = (t: string): void => {
  memToken = t;
  try {
    localStorage.setItem(TOKEN_KEY, t);
  } catch {
    /* stockage indisponible : le jeton reste en mémoire pour cette page */
  }
};
const ss = {
  get: (k: string): string | null => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string): void => {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      /* ignoré */
    }
  },
  del: (k: string): void => {
    try {
      sessionStorage.removeItem(k);
    } catch {
      /* ignoré */
    }
  },
};

function clearAuthState(): void {
  memToken = '';
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignoré */
  }
  [CHAPERONE_KEY, ORIGIN_ADMIN_ID_KEY, ORIGIN_TOKEN_KEY, ORIGIN_USER_KEY].forEach(ss.del);
  clearStoredCurrentUserId();
  clearAllCachedData(); // aucune donnée de santé ne reste dans le navigateur après la déconnexion
}

const reloadSoon = (ms = 350): void => {
  setTimeout(() => window.location.reload(), ms);
};

function sessionExpired(): void {
  if (!getAuthToken()) return;
  ss.set(EXPIRED_KEY, '1');
  clearAuthState();
  window.location.reload();
}

// Joint le jeton à toutes les requêtes /api ; une réponse « non connecté » ramène à l'écran de connexion
export function installAuthFetch(): void {
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const isApi = url.startsWith('/api/') || url.startsWith(window.location.origin + '/api/');
    if (!isApi) return original(input, init);
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    const token = getAuthToken();
    if (token && !headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + token);
    if (magicToken) headers.set('X-Magic-Token', magicToken);
    const res = await original(input, { ...init, headers });
    if (res.status === 401 && token && !url.includes('/api/auth/')) sessionExpired();
    return res;
  };
}

// Au démarrage : si le jeton mémorisé n'est plus valable (expiré, mot de passe changé ailleurs), on repart de zéro
export async function validateStoredSession(): Promise<void> {
  if (!getAuthToken()) return;
  try {
    const res = await fetch('/api/auth/me');
    const j = await res.json();
    if (!j.authenticated) {
      ss.set(EXPIRED_KEY, '1');
      clearAuthState();
    }
  } catch {
    /* serveur injoignable : on garde le jeton, la reconnexion se fera plus tard */
  }
}

export const takeExpiredFlag = (): boolean => {
  const v = ss.get(EXPIRED_KEY);
  ss.del(EXPIRED_KEY);
  return !!v;
};
export const takeGateMode = (): string | null => {
  const v = ss.get(GATE_MODE_KEY);
  ss.del(GATE_MODE_KEY);
  return v;
};
// Accompagnateur déjà connecté avec le mot de passe de son voyage (jeton limité à ce voyage)
export const getChaperoneSession = (): string => (getAuthToken() ? ss.get(CHAPERONE_KEY) || '' : '');

// ----------------------------------------------------------------------------- requêtes
// Résultat d'une opération d'authentification (ok = réussie ; sinon error / message expliquent l'échec)
export interface AuthFailure {
  ok: boolean;
  error: string;
  message: string;
  retryAfterSeconds?: number;
  user?: User;
}
const success = (user?: User): AuthFailure => ({ ok: true, error: '', message: '', user });
type Raw = { status: number; body: any };

async function post(path: string, body: unknown): Promise<Raw | null> {
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let j: any = {};
    try {
      j = await res.json();
    } catch {
      /* corps vide */
    }
    return { status: res.status, body: j };
  } catch {
    return null; // réseau
  }
}
const waitText = (s?: number): string => {
  const m = Math.max(1, Math.ceil((s || 900) / 60));
  return `Trop de tentatives. Réessayez dans ${m} minute${m > 1 ? 's' : ''}.`;
};
const NETWORK = 'Connexion au serveur impossible. Vérifiez votre connexion et réessayez.';

function failure(r: Raw | null, map: Record<string, string>, fallback: string): AuthFailure {
  if (!r) return { ok: false, error: 'network', message: NETWORK };
  const code = (r.body && r.body.error) || '';
  if (r.status === 429) return { ok: false, error: 'locked', message: waitText(r.body && r.body.retryAfterSeconds), retryAfterSeconds: r.body && r.body.retryAfterSeconds };
  return { ok: false, error: code || 'error', message: map[code] || fallback };
}

function enterSession(token: string, user: User | null): void {
  setAuthToken(token);
  [ORIGIN_ADMIN_ID_KEY, ORIGIN_TOKEN_KEY, ORIGIN_USER_KEY, CHAPERONE_KEY].forEach(ss.del);
  if (user) setCurrentUserId(user.id);
  else clearStoredCurrentUserId();
  clearAllCachedData(); // le navigateur ne garde pas les données de la session précédente
  if (user) setCurrentUserId(user.id);
  reloadSoon();
}

export type LoginResult = AuthFailure;

export async function authLogin(role: UserRole, identifier: string, password: string): Promise<LoginResult> {
  const r = await post('/api/auth/login', { role, identifier, password });
  if (r && r.status === 200 && r.body && r.body.token) {
    enterSession(r.body.token, r.body.user);
    return success(r.body.user);
  }
  return failure(r, { invalid: '' }, '');
}
// Message à afficher pour un échec de connexion (identifiant ou mot de passe incorrect par défaut)
export const authFailureMessage = (f: AuthFailure, fallback: string): string => (f.error === 'invalid' || f.error === 'error' ? fallback : f.message);

export interface RegisterData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  secretQuestion: string;
  secretAnswer: string;
}
export async function authRegister(d: RegisterData): Promise<LoginResult> {
  const r = await post('/api/auth/register', d);
  if (r && r.status === 200 && r.body && r.body.token) {
    enterSession(r.body.token, r.body.user);
    return success(r.body.user);
  }
  return failure(
    r,
    {
      'email-exists': 'Un compte existe déjà avec cette adresse email. Veuillez vous connecter ou réinitialiser votre mot de passe.',
      'weak-password': 'Le mot de passe doit comporter au moins 6 caractères.',
      'bad-email': 'Cette adresse email ne semble pas valide.',
      'missing-fields': 'Tous les champs obligatoires doivent être renseignés (Nom, Prénom, Email, Mot de passe, Question secrète).',
      'too-many': 'Trop de créations de comptes depuis cette connexion. Réessayez plus tard.',
    },
    "La création du compte a échoué. Réessayez dans un instant."
  );
}

export async function authSecretQuestion(email: string): Promise<string | null> {
  const r = await post('/api/auth/secret-question', { email });
  return r && r.status === 200 && r.body && r.body.question ? String(r.body.question) : null;
}

export async function authResetPassword(email: string, secretAnswer: string, newPassword: string): Promise<LoginResult> {
  const r = await post('/api/auth/reset-password', { email, secretAnswer, newPassword });
  if (r && r.status === 200 && r.body && r.body.token) {
    enterSession(r.body.token, r.body.user);
    return success(r.body.user);
  }
  return failure(
    r,
    {
      'no-account': 'Aucun compte trouvé avec cette adresse email.',
      'no-secret': "Aucune question secrète n'a été configurée pour ce compte. Veuillez contacter l'administration.",
      'wrong-answer': 'Réponse secrète incorrecte.',
      'weak-password': 'Le nouveau mot de passe doit comporter au moins 6 caractères.',
    },
    'La réinitialisation a échoué. Réessayez dans un instant.'
  );
}

export async function authChaperone(tripId: string, password: string): Promise<AuthFailure> {
  const r = await post('/api/auth/chaperone', { tripId, password });
  if (r && r.status === 200 && r.body && r.body.token) {
    setAuthToken(r.body.token);
    clearStoredCurrentUserId();
    clearAllCachedData();
    ss.set(CHAPERONE_KEY, tripId);
    ss.set(GATE_MODE_KEY, 'chaperone_access');
    reloadSoon();
    return success();
  }
  return failure(
    r,
    {
      invalid: 'Mot de passe incorrect pour ce voyage.',
      'no-password': "Aucun mot de passe accompagnateur n'est configuré pour ce voyage. Contactez l'administration.",
      'no-trip': 'Voyage introuvable.',
    },
    'Accès impossible pour le moment. Réessayez dans un instant.'
  );
}

export async function authChangePassword(currentPassword: string, newPassword: string): Promise<AuthFailure> {
  const r = await post('/api/auth/change-password', { currentPassword, newPassword });
  if (r && r.status === 200) return success();
  return failure(
    r,
    {
      'wrong-current': 'Le mot de passe actuel saisi est incorrect.',
      'weak-password': 'Le nouveau mot de passe doit comporter au moins 6 caractères.',
      'same-password': "Le nouveau mot de passe doit être différent de l'ancien.",
    },
    "Échec de l'enregistrement. Vérifiez votre connexion et réessayez : votre ancien mot de passe reste valable."
  );
}

// Administrateur : consulte le compte d'un autre utilisateur (jeton dédié de courte durée) ; son propre jeton est conservé
export async function authImpersonate(userId: string, admin: User): Promise<boolean> {
  const r = await post('/api/auth/impersonate', { userId });
  if (!r || r.status !== 200 || !r.body || !r.body.token) return false;
  if (!ss.get(ORIGIN_TOKEN_KEY)) {
    ss.set(ORIGIN_TOKEN_KEY, getAuthToken());
    ss.set(ORIGIN_ADMIN_ID_KEY, admin.id);
    ss.set(ORIGIN_USER_KEY, JSON.stringify({ id: admin.id, name: admin.name, email: admin.email, role: admin.role }));
  }
  const origin = [ss.get(ORIGIN_TOKEN_KEY), ss.get(ORIGIN_ADMIN_ID_KEY), ss.get(ORIGIN_USER_KEY)];
  setAuthToken(r.body.token);
  clearAllCachedData();
  setCurrentUserId(r.body.user.id);
  ss.set(ORIGIN_TOKEN_KEY, origin[0] || '');
  ss.set(ORIGIN_ADMIN_ID_KEY, origin[1] || '');
  ss.set(ORIGIN_USER_KEY, origin[2] || '');
  reloadSoon(250);
  return true;
}

export const getOriginAdminUser = (): User | null => {
  try {
    const raw = ss.get(ORIGIN_USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
};

export function authReturnToAdmin(): void {
  const originToken = ss.get(ORIGIN_TOKEN_KEY);
  const adminId = ss.get(ORIGIN_ADMIN_ID_KEY);
  const current = getAuthToken();
  if (!originToken || !adminId) {
    sessionExpired();
    return;
  }
  // ferme le jeton de consultation puis revient à celui de l'administrateur
  if (current && current !== originToken) {
    fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => undefined);
  }
  [ORIGIN_TOKEN_KEY, ORIGIN_ADMIN_ID_KEY, ORIGIN_USER_KEY].forEach(ss.del);
  setTimeout(() => {
    setAuthToken(originToken);
    clearAllCachedData();
    setCurrentUserId(adminId);
    window.location.reload();
  }, 120);
}

export async function authLogout(gateMode?: string): Promise<void> {
  const token = getAuthToken();
  const origin = ss.get(ORIGIN_TOKEN_KEY);
  const send = (t: string) =>
    fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, keepalive: true }).catch(() => undefined);
  const calls: Promise<unknown>[] = [];
  if (token) calls.push(send(token));
  if (origin && origin !== token) calls.push(send(origin));
  await Promise.race([Promise.all(calls), new Promise((r) => setTimeout(r, 900))]);
  clearAuthState();
  if (gateMode) ss.set(GATE_MODE_KEY, gateMode);
  window.location.reload();
}
AUTHEOF_X
if [ -f "$APP_DIR/src/components/ParentPasswordModal.tsx" ]; then
  echo "    ~ src/components/ParentPasswordModal.tsx"
  cat > "$APP_DIR/src/components/ParentPasswordModal.tsx" << 'AUTHEOF_X'
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound, X } from 'lucide-react';
import { User } from '../types';
import { authChangePassword } from '../utils/auth';

console.log('[fichesanitaire] build parent-password-20261006 (serveur : auth-20261006)');

interface ParentPasswordModalProps {
  currentUser: User;
  onUpdateUserPassword?: (userId: string, newPassword: string) => void | Promise<void>;
  onClose: () => void;
}

const MIN_LENGTH = 6;

// Fenêtre « Changer mon mot de passe » de l'Espace Famille
export const ParentPasswordModal: React.FC<ParentPasswordModalProps> = ({ currentUser, onUpdateUserPassword, onClose }) => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const firstField = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    firstField.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || success) return;
    setError('');
    if (!current) {
      setError('Veuillez saisir votre mot de passe actuel.');
      return;
    }
    if (next.trim().length < MIN_LENGTH) {
      setError(`Le nouveau mot de passe doit comporter au moins ${MIN_LENGTH} caractères.`);
      return;
    }
    if (next !== confirm) {
      setError('Les deux nouveaux mots de passe ne correspondent pas.');
      return;
    }
    if (next.trim() === current) {
      setError("Le nouveau mot de passe doit être différent de l'ancien.");
      return;
    }
    setBusy(true);
    // vérification et enregistrement par le serveur (l'ancien mot de passe n'est plus comparé dans le navigateur)
    const res = await authChangePassword(current, next.trim());
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setSuccess('Votre mot de passe a été modifié. Utilisez-le à votre prochaine connexion.');
    setTimeout(onClose, 1800);
  };

  const field = 'w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500';

  return createPortal(
    <div
      className="fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-[60]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="parent-pwd-title"
      data-testid="parent-password-modal"
    >
      <form onSubmit={submit} className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-100 text-blue-900 rounded-lg">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h3 id="parent-pwd-title" className="font-bold text-base text-slate-900">
                Changer mon mot de passe
              </h3>
              <p className="text-xs text-slate-500">Compte : {currentUser.name}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer rounded-lg" aria-label="Fermer" data-testid="parent-pwd-close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <label className="block text-xs font-semibold text-slate-700">
          Mot de passe actuel
          <input
            ref={firstField}
            type={show ? 'text' : 'password'}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            className={field + ' mt-1'}
            data-testid="parent-pwd-current"
          />
        </label>
        <label className="block text-xs font-semibold text-slate-700">
          Nouveau mot de passe <span className="font-normal text-slate-500">({MIN_LENGTH} caractères au moins)</span>
          <input
            type={show ? 'text' : 'password'}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            className={field + ' mt-1'}
            data-testid="parent-pwd-new"
          />
        </label>
        <label className="block text-xs font-semibold text-slate-700">
          Confirmer le nouveau mot de passe
          <input
            type={show ? 'text' : 'password'}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            className={field + ' mt-1'}
            data-testid="parent-pwd-confirm"
          />
        </label>

        <button type="button" onClick={() => setShow((v) => !v)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-900 hover:underline cursor-pointer" data-testid="parent-pwd-toggle">
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          {show ? 'Masquer les mots de passe' : 'Afficher les mots de passe'}
        </button>

        {error && (
          <div className="flex items-start gap-2 text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert" data-testid="parent-pwd-error">
            <AlertCircle className="w-4 h-4 shrink-0 mt-px" /> {error}
          </div>
        )}
        {success && (
          <div className="flex items-start gap-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2" role="status" data-testid="parent-pwd-success">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-px" /> {success}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2.5 text-xs font-semibold text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer">
            Annuler
          </button>
          <button type="submit" disabled={busy || !!success} className="px-4 py-2.5 text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg cursor-pointer" data-testid="parent-pwd-submit">
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
};
AUTHEOF_X
fi

# --- 4. Modifications ---------------------------------------------------------
echo ">>> Modification des fichiers ..."
run_edits

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
  echo "!!! Pour revenir en arriere : cp -a $BACKUP_DIR/. $APP_DIR/ && rm -f $APP_DIR/server/auth.js $APP_DIR/src/utils/auth.ts"
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
sleep 3
docker compose logs --tail 40 app 2>/dev/null | grep "\[auth\]" | tail -4 || true

cat << MSG

============================================================
 TERMINE - build $BUILD
 - Connexion verifiee par le serveur ; mots de passe convertis en empreintes illisibles (voir ligne [auth] ci-dessus).
 - Tout le monde doit se reconnecter UNE fois (anciennes sessions supprimees) ; les mots de passe ne changent pas.
 - Si aucun administrateur n'existait : mot de passe temporaire affiche ci-dessus (a changer aussitot).
 - Verification : ouvrez  https://VOTRE-SITE/api/data  dans un navigateur NON connecte : seules des listes vides
   et les voyages (sans leur mot de passe) doivent apparaitre ; /api/backups doit repondre « auth-required ».
 - Les outils d'exploitation lisent le secret local : voir le README (commandes docker exec).
 Retour arriere possible : copie dans $BACKUP_DIR
 IMPORTANT : videz le cache du navigateur (Ctrl+F5).
 Console navigateur : "[fichesanitaire] build auth-20261006"
============================================================
MSG
