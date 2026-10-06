#!/bin/bash
# ============================================================================
# patch-mot-de-passe-parent.sh  -  build parent-password-20261006
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# BOUTON « CHANGER MON MOT DE PASSE » dans l'Espace Famille : bouton bleu clair, grand et bien
# visible, place juste en dessous du bouton « + Ajouter un enfant ».
#  - fenetre : mot de passe actuel, nouveau mot de passe (6 caracteres au moins), confirmation,
#    « Afficher les mots de passe » (pratique sur telephone) ;
#  - verifications : ancien mot de passe exact, nouveau different de l'ancien, deux saisies
#    identiques ; en cas d'echec reseau l'ancien mot de passe reste valable ;
#  - enregistre sur le serveur (meme mecanisme que l'espace organisateur) ; Echap ou Annuler ferme.
#
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/patch-mot-de-passe-parent.sh && /root/patch-mot-de-passe-parent.sh
# ============================================================================
set -e

APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"
BUILD="parent-password-20261006"
BACKUP_DIR="$APP_DIR/backup-avant-$BUILD"
FILES="src/components/ParentSpace.tsx src/App.tsx"
NEWFILES="src/components/ParentPasswordModal.tsx"
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

PS="$APP_DIR/src/components/ParentSpace.tsx"
APP="$APP_DIR/src/App.tsx"

grep -q "handleUpdateUserPassword" "$APP" || { echo "ERREUR : App.tsx sans handleUpdateUserPassword (version trop ancienne du portail)."; exit 1; }

m=0
grep -q "ParentPasswordModal" "$PS" && m=$((m+1))
perl -0777 -ne 'exit(/onUnregisterTrip=\{handleUnregisterTrip\}\n\s*onUpdateUserPassword=\{handleUpdateUserPassword\}\n\s*\/>/ ? 0 : 1)' "$APP" && m=$((m+1))
for f in $NEWFILES; do [ -f "$APP_DIR/$f" ] && m=$((m+1)); done
if [ "$m" -eq 3 ]; then
  echo ">>> Patch deja applique. Rien a faire."
  exit 0
elif [ "$m" -gt 0 ]; then
  echo "ERREUR : etat partiel detecte ($m/3 elements deja en place)."
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

# --- 2. Fenetre de changement de mot de passe -----------------------------------
echo ">>> Creation de src/components/ParentPasswordModal.tsx ..."
cat > "$APP_DIR/src/components/ParentPasswordModal.tsx" << 'PWDEOF_X'
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound, X } from 'lucide-react';
import { User } from '../types';

console.log('[fichesanitaire] build parent-password-20261006');

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
    const actual = currentUser.password || '';
    if (actual && current !== actual) {
      setError('Le mot de passe actuel saisi est incorrect.');
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
    if (actual && next.trim() === actual) {
      setError("Le nouveau mot de passe doit être différent de l'ancien.");
      return;
    }
    if (!onUpdateUserPassword) {
      setError("Le changement de mot de passe n'est pas disponible pour le moment.");
      return;
    }
    setBusy(true);
    try {
      await onUpdateUserPassword(currentUser.id, next.trim());
    } catch {
      setBusy(false);
      setError("Échec de l'enregistrement. Vérifiez votre connexion et réessayez : votre ancien mot de passe reste valable.");
      return;
    }
    setBusy(false);
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
PWDEOF_X

# --- 3. Modifications ---------------------------------------------------------
echo ">>> Modification de ParentSpace.tsx et App.tsx ..."
cat > "$TMP/e1_old.txt" << 'PWDEOF_X'
import { Student, Trip, User, SchoolClass } from '../types';
PWDEOF_X
cat > "$TMP/e1_new.txt" << 'PWDEOF_X'
import { Student, Trip, User, SchoolClass } from '../types';
import { KeyRound } from 'lucide-react';
import { ParentPasswordModal } from './ParentPasswordModal';
PWDEOF_X
replace_once "$PS" "$(cat "$TMP/e1_old.txt")" "$(cat "$TMP/e1_new.txt")"

cat > "$TMP/e2_old.txt" << 'PWDEOF_X'
  onUnregisterTrip: (studentId: string, tripId: string) => void;
}
PWDEOF_X
cat > "$TMP/e2_new.txt" << 'PWDEOF_X'
  onUnregisterTrip: (studentId: string, tripId: string) => void;
  onUpdateUserPassword?: (userId: string, newPassword: string) => void | Promise<void>;
}
PWDEOF_X
replace_once "$PS" "$(cat "$TMP/e2_old.txt")" "$(cat "$TMP/e2_new.txt")"

cat > "$TMP/e3_old.txt" << 'PWDEOF_X'
  onUnregisterTrip,
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
PWDEOF_X
cat > "$TMP/e3_new.txt" << 'PWDEOF_X'
  onUnregisterTrip,
  onUpdateUserPassword,
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
PWDEOF_X
replace_once "$PS" "$(cat "$TMP/e3_old.txt")" "$(cat "$TMP/e3_new.txt")"

cat > "$TMP/e4_old.txt" << 'PWDEOF_X'
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl font-semibold text-xs shadow-md transition-all shrink-0 cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            + Ajouter un enfant
          </button>
PWDEOF_X
cat > "$TMP/e4_new.txt" << 'PWDEOF_X'
          {/* Bouton « Changer mon mot de passe » sous « Ajouter un enfant » (build parent-password-20261006) */}
          <div className="flex flex-col items-stretch gap-3 shrink-0">
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl font-semibold text-xs shadow-md transition-all shrink-0 cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              + Ajouter un enfant
            </button>

            <button
              type="button"
              onClick={() => setShowPasswordModal(true)}
              className="flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-400 text-white px-4 py-3 rounded-xl font-bold text-sm shadow-lg ring-2 ring-white/90 transition-all cursor-pointer"
              data-testid="parent-password-button"
            >
              <KeyRound className="w-5 h-5" />
              Changer mon mot de passe
            </button>
            {showPasswordModal && (
              <ParentPasswordModal
                currentUser={currentUser}
                onUpdateUserPassword={onUpdateUserPassword}
                onClose={() => setShowPasswordModal(false)}
              />
            )}
          </div>
PWDEOF_X
replace_once "$PS" "$(cat "$TMP/e4_old.txt")" "$(cat "$TMP/e4_new.txt")"

cat > "$TMP/e5_old.txt" << 'PWDEOF_X'
            onAddStudent={handleAddChild}
            onRegisterTrip={handleRegisterTrip}
            onUnregisterTrip={handleUnregisterTrip}
          />
PWDEOF_X
cat > "$TMP/e5_new.txt" << 'PWDEOF_X'
            onAddStudent={handleAddChild}
            onRegisterTrip={handleRegisterTrip}
            onUnregisterTrip={handleUnregisterTrip}
            onUpdateUserPassword={handleUpdateUserPassword}
          />
PWDEOF_X
replace_once "$APP" "$(cat "$TMP/e5_old.txt")" "$(cat "$TMP/e5_new.txt")"

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
  echo "!!! Pour revenir en arriere : cp -a $BACKUP_DIR/src $APP_DIR/ && rm -f $APP_DIR/src/components/ParentPasswordModal.tsx"
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
 - Espace Famille : bouton bleu « Changer mon mot de passe » sous « + Ajouter un enfant ».
 Retour arriere possible : copie dans $BACKUP_DIR
 IMPORTANT : videz le cache du navigateur (Ctrl+F5).
 Console navigateur : "[fichesanitaire] build parent-password-20261006"
============================================================
MSG
