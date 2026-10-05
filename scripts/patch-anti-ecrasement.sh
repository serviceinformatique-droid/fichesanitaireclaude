#!/bin/bash
# ============================================================================
# patch-anti-ecrasement.sh  -  build anti-overwrite-20261001
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# Empeche deux personnes (les 2 parents, 2 appareils, parent + administration)
# d'ECRASER mutuellement une fiche sanitaire :
#  - Chaque enregistrement indique la version de la fiche sur laquelle il se base.
#  - Si la fiche a ete enregistree entre-temps par quelqu'un d'autre, le serveur
#    REFUSE (409 conflict) : rien n'est ecrase. La personne est invitee a recharger
#    la derniere version.
#  - Verrou serveur : deux enregistrements simultanes ne peuvent plus se melanger.
#  - La date d'archivage du PDF (pdfSentAt) n'est jamais perdue par un enregistrement.
#  Concerne : lien direct (PUT /api/magic-link/:token) ET portail connecte.
#
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/patch-anti-ecrasement.sh && /root/patch-anti-ecrasement.sh
# ============================================================================
set -e

APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"
BUILD="anti-overwrite-20261001"
BACKUP_DIR="$APP_DIR/backup-avant-$BUILD"
FILES="server/index.js src/utils/storage.ts src/App.tsx src/components/MagicLinkAccess.tsx"
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
STO="$APP_DIR/src/utils/storage.ts"
APPF="$APP_DIR/src/App.tsx"
MLA="$APP_DIR/src/components/MagicLinkAccess.tsx"

m=0
grep -q "studentVersionGuard" "$SRV" && m=$((m+1))
grep -q "saveStudentChecked" "$STO" && m=$((m+1))
grep -q "saveStudentChecked" "$APPF" && m=$((m+1))
grep -q "saveStudentViaLink" "$MLA" && m=$((m+1))
if [ "$m" -eq 4 ]; then
  echo ">>> Patch deja applique. Rien a faire."
  exit 0
elif [ "$m" -gt 0 ]; then
  echo "ERREUR : etat partiel detecte ($m/4 fichiers deja modifies)."
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

# --- 2. Serveur -------------------------------------------------------------
cat > "$TMP/server_block.js" << 'SRV_EOF'
app.use(express.json({ limit: '15mb' }));

// --- Anti-écrasement : contrôle de version des fiches + verrou d'écriture ---
// Le client envoie "baseUpdatedAt" (la version de la fiche sur laquelle il s'appuie).
// Si la fiche a été enregistrée par quelqu'un d'autre entre-temps (autre responsable,
// autre appareil, administration), l'enregistrement est refusé (409 "conflict") au lieu
// d'écraser son travail. Sans baseUpdatedAt (anciens clients), aucun contrôle n'est fait.
let studentWriteChain = Promise.resolve();
function lockStudentWrites() {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const previous = studentWriteChain;
  studentWriteChain = previous.then(() => gate);
  return previous.then(() => release);
}

async function studentVersionGuard(req, res, next) {
  const release = await lockStudentWrites();
  let done = false;
  let timer = null;
  const unlock = () => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    release();
  };
  timer = setTimeout(unlock, 20000); // sécurité : jamais de verrou bloqué
  res.on('finish', unlock);
  res.on('close', unlock);
  try {
    const body = req.body || {};
    const incoming = body.student;
    if (incoming && incoming.id) {
      const list = (await readKv(STUDENTS_KEY)) || [];
      const stored = list.find((s) => s.id === incoming.id);
      if (stored) {
        if (body.baseUpdatedAt && stored.updatedAt && stored.updatedAt !== body.baseUpdatedAt) {
          console.log(`[anti-ecrasement] Enregistrement refusé (fiche modifiée entre-temps) : ${incoming.id}`);
          return res.status(409).json({ error: 'conflict', currentUpdatedAt: stored.updatedAt });
        }
        // La date d'archivage du PDF est posée par le serveur : un enregistrement ne doit jamais la perdre
        if (stored.pdfSentAt && !incoming.pdfSentAt) incoming.pdfSentAt = stored.pdfSentAt;
      }
    }
    next();
  } catch (e) {
    console.error("[anti-ecrasement] Erreur de contrôle :", e);
    unlock();
    res.status(500).json({ error: 'Erreur serveur' });
  }
}
app.post('/api/students/upsert', studentVersionGuard);
app.put('/api/magic-link/:token', studentVersionGuard);
SRV_EOF

echo ">>> Patch de server/index.js ..."
replace_once "$SRV" "app.use(express.json({ limit: '15mb' }));" "$(cat "$TMP/server_block.js")"

# --- 3. Client : storage.ts -------------------------------------------------
cat > "$TMP/storage_block.ts" << 'STO_EOF'
console.log('[fichesanitaire] build anti-overwrite-20261001');

// --- Anti-écrasement : enregistrements de fiche avec contrôle de version ---
// "baseUpdatedAt" = version de la fiche sur laquelle l'utilisateur s'appuie. Si le serveur
// a une version plus récente (enregistrée par quelqu'un d'autre), il refuse (conflict).
// Les enregistrements sont exécutés l'un après l'autre (jamais en parallèle).
export interface CheckedSaveResult {
  ok: boolean;
  conflict: boolean;
  error?: string;
}

let studentEditQueue: Promise<unknown> = Promise.resolve();
function enqueueStudentEdit<T>(task: () => Promise<T>): Promise<T> {
  const run = studentEditQueue.then(task, task);
  studentEditQueue = run.catch(() => undefined);
  return run;
}

function cacheStudentLocally(student: Student): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.STUDENTS);
    const list: Student[] = raw ? JSON.parse(raw) : [];
    const idx = list.findIndex((s) => s.id === student.id);
    if (idx === -1) list.push(student);
    else list[idx] = student;
    localStorage.setItem(STORAGE_KEYS.STUDENTS, JSON.stringify(list));
  } catch (e) {
    console.error(e);
  }
}

async function sendCheckedSave(
  url: string,
  method: 'POST' | 'PUT',
  student: Student,
  baseUpdatedAt?: string
): Promise<CheckedSaveResult> {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student, baseUpdatedAt }),
    });
    if (res.status === 409) {
      const j = await res.json().catch(() => ({}));
      return { ok: false, conflict: j.error === 'conflict', error: j.error };
    }
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return { ok: false, conflict: false, error: j.error || `Erreur serveur (${res.status})` };
    }
    cacheStudentLocally(student);
    return { ok: true, conflict: false };
  } catch (e) {
    return { ok: false, conflict: false, error: 'Serveur injoignable' };
  }
}

// Portail connecté (parent / administration)
export function saveStudentChecked(student: Student, baseUpdatedAt?: string): Promise<CheckedSaveResult> {
  return enqueueStudentEdit(() => sendCheckedSave('/api/students/upsert', 'POST', student, baseUpdatedAt));
}

// Lien direct (sans connexion)
export function saveStudentViaLink(token: string, student: Student, baseUpdatedAt?: string): Promise<CheckedSaveResult> {
  return enqueueStudentEdit(() =>
    sendCheckedSave(`/api/magic-link/${encodeURIComponent(token)}`, 'PUT', student, baseUpdatedAt)
  );
}

STO_EOF

echo ">>> Patch de src/utils/storage.ts ..."
replace_once "$STO" \
  "// Suppression définitive fusionnée côté serveur d'UN SEUL élève (corbeille)." \
  "$(cat "$TMP/storage_block.ts")
// Suppression définitive fusionnée côté serveur d'UN SEUL élève (corbeille)."

# --- 4. Client : App.tsx (portail connecté) ----------------------------------
echo ">>> Patch de src/App.tsx ..."
replace_once "$APPF" "  upsertStoredStudent," "  upsertStoredStudent,
  saveStudentChecked,"

cat > "$TMP/app_conflict.tsx" << 'APPC_EOF'
  // Conflit d'enregistrement : la fiche a été modifiée par quelqu'un d'autre depuis l'ouverture
  const handleSaveConflict = () => {
    const reload = window.confirm(
      "Cette fiche vient d'être modifiée par quelqu'un d'autre (l'autre responsable, un autre appareil ou l'établissement) depuis votre ouverture de la page.\n\nPour ne pas écraser ses informations, votre enregistrement a été refusé.\n\nOK : recharger la dernière version.\nAnnuler : rester sur cette page (vous devrez la recharger pour pouvoir enregistrer)."
    );
    if (reload) window.location.reload();
  };

  // Save CERFA modifications
APPC_EOF
replace_once "$APPF" "  // Save CERFA modifications" "$(cat "$TMP/app_conflict.tsx")"

cat > "$TMP/app_old1.tsx" << 'A1_EOF'
    setStudents(updatedList);
    await upsertStoredStudent(updatedStudent);
    setSelectedStudent(updatedStudent);
    setActiveTab('cerfa_view');
A1_EOF
cat > "$TMP/app_new1.tsx" << 'A1N_EOF'
    const knownVersion = students.find((s) => s.id === updatedStudent.id)?.updatedAt;
    setStudents(updatedList);
    const saveResult = await saveStudentChecked(updatedStudent, knownVersion);
    if (!saveResult.ok) {
      setStudents(students);
      if (saveResult.conflict) handleSaveConflict();
      else window.alert("L'enregistrement sur le serveur a échoué. Vérifiez votre connexion et réessayez.");
      return;
    }
    setSelectedStudent(updatedStudent);
    setActiveTab('cerfa_view');
A1N_EOF
replace_once "$APPF" "$(cat "$TMP/app_old1.tsx")" "$(cat "$TMP/app_new1.tsx")"

cat > "$TMP/app_old2.tsx" << 'A2_EOF'
    setStudents(updatedList);
    await upsertStoredStudent(updatedStudent);
    setSelectedStudent(updatedStudent);
    showToast('Brouillon enregistré.
A2_EOF
cat > "$TMP/app_new2.tsx" << 'A2N_EOF'
    const knownVersion = students.find((s) => s.id === updatedStudent.id)?.updatedAt;
    setStudents(updatedList);
    const saveResult = await saveStudentChecked(updatedStudent, knownVersion);
    if (!saveResult.ok) {
      setStudents(students);
      if (saveResult.conflict) handleSaveConflict();
      else window.alert("L'enregistrement du brouillon sur le serveur a échoué. Vérifiez votre connexion et réessayez.");
      return;
    }
    setSelectedStudent(updatedStudent);
    showToast('Brouillon enregistré.
A2N_EOF
replace_once "$APPF" "$(cat "$TMP/app_old2.tsx")" "$(cat "$TMP/app_new2.tsx")"

# --- 5. Client : MagicLinkAccess.tsx (lien direct) ----------------------------
echo ">>> Patch de src/components/MagicLinkAccess.tsx ..."
replace_once "$MLA" "import React, { useEffect, useState } from 'react';" "import React, { useEffect, useRef, useState } from 'react';"
replace_once "$MLA" "import { sendCompletedFichePdfByEmail } from '../utils/pdfGenerator';" "import { sendCompletedFichePdfByEmail } from '../utils/pdfGenerator';
import { saveStudentViaLink } from '../utils/storage';"
replace_once "$MLA" "  const [justCompleted, setJustCompleted] = useState(false);" "  const [justCompleted, setJustCompleted] = useState(false);
  // Version de la fiche sur laquelle cette page s'appuie (sert à détecter une modification faite ailleurs)
  const baseRef = useRef<string | undefined>(undefined);"
replace_once "$MLA" "        setData(json);" "        setData(json);
        baseRef.current = json.student?.updatedAt;"

cat > "$TMP/ml_old1.tsx" << 'M1_EOF'
  const handleSave = async (updatedStudent: Student) => {
    const res = await fetch(`/api/magic-link/${token}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student: updatedStudent }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      alert(json.error || "L'enregistrement a échoué. Merci de réessayer.");
      return;
    }
M1_EOF
cat > "$TMP/ml_new1.tsx" << 'M1N_EOF'
  // Conflit : l'autre responsable (ou un autre appareil) a enregistré cette fiche entre-temps.
  const handleConflict = () => {
    const reload = window.confirm(
      "Cette fiche vient d'être modifiée par quelqu'un d'autre (l'autre responsable, un autre appareil ou l'établissement) depuis votre ouverture de la page.\n\nPour ne pas écraser ses informations, votre enregistrement a été refusé.\n\nOK : recharger la dernière version de la fiche.\nAnnuler : rester sur cette page (vous devrez la recharger pour pouvoir enregistrer)."
    );
    if (reload) fetchData();
  };

  const handleSave = async (updatedStudent: Student) => {
    const base = baseRef.current;
    baseRef.current = updatedStudent.updatedAt;
    const result = await saveStudentViaLink(token, updatedStudent, base);
    if (!result.ok) {
      baseRef.current = base;
      if (result.conflict) {
        handleConflict();
        return;
      }
      alert(result.error || "L'enregistrement a échoué. Merci de réessayer.");
      return;
    }
M1N_EOF
replace_once "$MLA" "$(cat "$TMP/ml_old1.tsx")" "$(cat "$TMP/ml_new1.tsx")"

cat > "$TMP/ml_old2.tsx" << 'M2_EOF'
    try {
      const res = await fetch(`/api/magic-link/${token}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student: updatedStudent }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        alert(json.error || "L'enregistrement du brouillon a échoué. Merci de réessayer.");
        return;
      }
      setData((prev) => (prev ? { ...prev, student: updatedStudent } : prev));
    } catch (e) {
      alert("Impossible de contacter le serveur pour enregistrer le brouillon.");
    }
M2_EOF
cat > "$TMP/ml_new2.tsx" << 'M2N_EOF'
    const base = baseRef.current;
    baseRef.current = updatedStudent.updatedAt;
    const result = await saveStudentViaLink(token, updatedStudent, base);
    if (!result.ok) {
      baseRef.current = base;
      if (result.conflict) {
        handleConflict();
        return;
      }
      alert(result.error || "L'enregistrement du brouillon a échoué. Merci de réessayer.");
      return;
    }
    setData((prev) => (prev ? { ...prev, student: updatedStudent } : prev));
M2N_EOF
replace_once "$MLA" "$(cat "$TMP/ml_old2.tsx")" "$(cat "$TMP/ml_new2.tsx")"

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
 - Un enregistrement base sur une version perimee de la fiche est REFUSE
   (aucune donnee ecrasee) et la personne peut recharger la derniere version.
 - Verrou serveur contre les enregistrements simultanes.
 Retour arriere possible : copie dans $BACKUP_DIR
 IMPORTANT : videz le cache du navigateur (Ctrl+F5).
 Console navigateur : "[fichesanitaire] build anti-overwrite-20261001"
 Logs serveur : docker compose logs app | grep anti-ecrasement
============================================================
MSG
