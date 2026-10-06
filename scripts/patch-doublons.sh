#!/bin/bash
# ============================================================================
# patch-doublons.sh  -  build dup-guard-20261001
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# Evite les doublons de fiches :
#  - Formulaire parent "Ajouter un enfant" : des que prenom + nom correspondent
#    a une fiche existante, message d'alerte et bouton "Creer la fiche" bloque.
#  - Controle aussi cote serveur (refus 409) : impossible de creer un doublon
#    meme avec deux onglets ou deux comptes parents en parallele.
#  - Suivi global (admin) : badge "Doublon possible" sur les fiches existantes
#    qui portent le meme prenom + nom.
#
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/patch-doublons.sh && /root/patch-doublons.sh
# ============================================================================
set -e

APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"
BUILD="dup-guard-20261001"
BACKUP_DIR="$APP_DIR/backup-avant-$BUILD"
FILES="server/index.js src/utils/storage.ts src/App.tsx src/components/ParentSpace.tsx src/components/AdminSpace.tsx"
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

m=0
grep -q "check-duplicate" "$APP_DIR/server/index.js" && m=$((m+1))
grep -q "checkStudentDuplicate" "$APP_DIR/src/utils/storage.ts" && m=$((m+1))
grep -q "checkDuplicate: true" "$APP_DIR/src/App.tsx" && m=$((m+1))
grep -q "dupInfo" "$APP_DIR/src/components/ParentSpace.tsx" && m=$((m+1))
grep -q "studentDuplicateKey" "$APP_DIR/src/components/AdminSpace.tsx" && m=$((m+1))
if [ "$m" -eq 5 ]; then
  echo ">>> Patch deja applique (serveur + 4 fichiers client). Rien a faire."
  exit 0
elif [ "$m" -gt 0 ]; then
  echo "ERREUR : etat partiel detecte ($m/5 fichiers deja modifies)."
  echo "Restaurez d'abord les fichiers d'origine depuis un backup-avant-* puis relancez ce script."
  exit 1
fi

# Ce correctif REMPLACE des plages entieres de code (route d'enregistrement d'un eleve, fonction de stockage).
# Applique APRES des correctifs plus recents qui y ont ajoute du code, il effacerait leurs modifications.
for mk in studentVersionGuard parentIdGuard attachmentSizeGuard saveStudentChecked; do
  if grep -q "$mk" "$APP_DIR/server/index.js" "$APP_DIR/src/utils/storage.ts" "$APP_DIR/src/App.tsx" 2>/dev/null; then
    echo "ERREUR : ce correctif doit etre applique AVANT les correctifs plus recents (code detecte : $mk)."
    echo "Il aurait efface leurs modifications. Aucun fichier n'a ete modifie."
    exit 1
  fi
done

# --- Fonctions utilitaires -------------------------------------------------
count_occ() { OLD="$2" perl -0777 -ne 'my $c = () = /\Q$ENV{OLD}\E/g; print $c' "$1"; }

replace_between() { # fichier  repere_debut  repere_fin(non inclus)  fichier_nouveau_contenu
  local file="$1" start="$2" end="$3" newfile="$4"
  [ "$(count_occ "$file" "$start")" = "1" ] || { echo "ERREUR : repere debut absent ou multiple dans $file : $start"; exit 1; }
  [ "$(count_occ "$file" "$end")" -ge "1" ] || { echo "ERREUR : repere fin absent dans $file : $end"; exit 1; }
  START="$start" END="$end" NEW="$(cat "$newfile")" \
    perl -0777 -i -pe 's/\Q$ENV{START}\E.*?(?=\Q$ENV{END}\E)/$ENV{NEW}\n\n/s' "$file"
}

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

# --- 2. Serveur : controle de doublon --------------------------------------
cat > "$TMP/server_block.js" << 'SRV_EOF'
// --- Anti-doublons : un seul dossier par élève (même prénom + nom) ---
function dupNorm(v) {
  return String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}
// Clé indépendante de l'ordre (certains parents inversent nom et prénom)
function dupKey(first, last) {
  return [dupNorm(first), dupNorm(last)].sort().join('|');
}
function findDuplicateStudents(students, first, last, excludeId) {
  if (!dupNorm(first) || !dupNorm(last)) return [];
  const key = dupKey(first, last);
  return (students || []).filter((s) => {
    if (!s || s.deletedAt || s.id === excludeId) return false;
    const idt = (s.cerfa && s.cerfa.identity) || {};
    return dupKey(idt.firstName, idt.lastName) === key;
  });
}

// Vérification en direct (formulaire "Ajouter un enfant") : ne renvoie AUCUNE donnée personnelle
app.post('/api/students/check-duplicate', async (req, res) => {
  try {
    const { firstName, lastName, parentId, excludeStudentId } = req.body || {};
    const students = (await readKv(STUDENTS_KEY)) || [];
    const matches = findDuplicateStudents(students, firstName, lastName, excludeStudentId);
    res.json({
      duplicate: matches.length > 0,
      sameAccount: !!parentId && matches.some((s) => s.parentId === parentId),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/students/upsert', async (req, res) => {
  try {
    const { student, checkDuplicate } = req.body;
    if (!student || !student.id) return res.status(400).json({ error: 'student manquant ou invalide' });

    // Création par un parent : refus si une fiche existe déjà pour ce prénom + nom
    if (checkDuplicate) {
      const list = (await readKv(STUDENTS_KEY)) || [];
      const isNew = !list.some((s) => s.id === student.id);
      const idt = (student.cerfa && student.cerfa.identity) || {};
      if (isNew && findDuplicateStudents(list, idt.firstName, idt.lastName, student.id).length > 0) {
        console.log('[dup-guard] Création refusée (doublon) :', idt.lastName, idt.firstName);
        return res.status(409).json({ error: 'duplicate' });
      }
    }

    await upsertInArray(STUDENTS_KEY, student);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
SRV_EOF

echo ">>> Patch de server/index.js ..."
replace_between "$APP_DIR/server/index.js" \
  "app.post('/api/students/upsert', async (req, res) => {" \
  "app.post('/api/students/remove'" \
  "$TMP/server_block.js"

# --- 3. Client : storage.ts -------------------------------------------------
cat > "$TMP/storage_block.ts" << 'STO_EOF'
console.log('[fichesanitaire] build dup-guard-20261001');

// Clé de comparaison prénom + nom (sans accents, insensible à la casse et à l'ordre)
function dupNormClient(v: string | undefined): string {
  return String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}
export function studentDuplicateKey(s: Student): string {
  const idt = s.cerfa?.identity;
  return [dupNormClient(idt?.firstName), dupNormClient(idt?.lastName)].sort().join('|');
}

// Demande au serveur si une fiche existe déjà pour ce prénom + nom (aucune donnée perso renvoyée)
export async function checkStudentDuplicate(
  firstName: string,
  lastName: string,
  parentId?: string,
  excludeStudentId?: string
): Promise<{ duplicate: boolean; sameAccount: boolean }> {
  try {
    const res = await fetch('/api/students/check-duplicate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName, lastName, parentId, excludeStudentId }),
    });
    if (!res.ok) return { duplicate: false, sameAccount: false };
    return await res.json();
  } catch {
    return { duplicate: false, sameAccount: false };
  }
}

// Retourne false si le serveur refuse la création pour cause de doublon (options.checkDuplicate)
export async function upsertStoredStudent(
  student: Student,
  options?: { checkDuplicate?: boolean }
): Promise<boolean> {
  const updateLocalCache = () => {
    // Met aussi à jour le cache local pour un affichage immédiat cohérent,
    // sans jamais l'utiliser comme source de vérité pour l'écriture serveur.
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
  };

  if (options?.checkDuplicate) {
    const res = await fetch('/api/students/upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student, checkDuplicate: true }),
    });
    if (res.status === 409) return false;
    updateLocalCache();
    return true;
  }

  updateLocalCache();
  await fetch('/api/students/upsert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ student }),
  });
  return true;
}
STO_EOF

echo ">>> Patch de src/utils/storage.ts ..."
replace_between "$APP_DIR/src/utils/storage.ts" \
  "export async function upsertStoredStudent(student: Student): Promise<void> {" \
  "// Suppression définitive fusionnée côté serveur d'UN SEUL élève (corbeille)." \
  "$TMP/storage_block.ts"

# --- 4. Client : App.tsx (handleAddChild) -----------------------------------
cat > "$TMP/app_block.tsx" << 'APP_EOF'
const saved = await upsertStoredStudent(newStudent, { checkDuplicate: true });
    if (!saved) {
      showToast(
        `Une fiche existe déjà pour ${data.firstName} ${data.lastName}. Merci de ne pas créer de doublon : une seule fiche par élève et la signature d'un seul responsable légal suffisent.`,
        'warning'
      );
      return;
    }
    setStudents((prev) => [...prev, newStudent]);
    showToast(`Dossier de ${data.firstName} ${data.lastName} créé. Vous pouvez compléter sa fiche.`, 'success');
  };
APP_EOF

echo ">>> Patch de src/App.tsx ..."
replace_between "$APP_DIR/src/App.tsx" \
  "const updated = [...students, newStudent];" \
  "  // Trip registration" \
  "$TMP/app_block.tsx"

# --- 5. Client : ParentSpace.tsx --------------------------------------------
PS="$APP_DIR/src/components/ParentSpace.tsx"
echo ">>> Patch de src/components/ParentSpace.tsx ..."

replace_once "$PS" \
  "import React, { useState } from 'react';" \
  "import React, { useState, useEffect } from 'react';"

replace_once "$PS" \
  "import { openOrDownloadDocument } from '../utils/documentViewer';" \
  "import { openOrDownloadDocument } from '../utils/documentViewer';
import { checkStudentDuplicate } from '../utils/storage';"

replace_once "$PS" \
  "const [newPension, setNewPension] = useState<'DP' | 'Externe' | 'Interne'>('DP');" \
  "const [newPension, setNewPension] = useState<'DP' | 'Externe' | 'Interne'>('DP');
  const [dupInfo, setDupInfo] = useState<{ duplicate: boolean; sameAccount: boolean } | null>(null);

  // Contrôle en direct des doublons dès que prénom + nom sont saisis (étape 1)
  useEffect(() => {
    if (!showAddModal || !newFirstName.trim() || !newLastName.trim()) {
      setDupInfo(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const r = await checkStudentDuplicate(newFirstName, newLastName, currentUser.id);
      if (!cancelled) setDupInfo(r);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [showAddModal, newFirstName, newLastName, currentUser.id]);"

replace_once "$PS" \
  "if (!newFirstName.trim() || !newLastName.trim()) return;" \
  "if (!newFirstName.trim() || !newLastName.trim()) return;
    if (dupInfo?.duplicate) return;"

cat > "$TMP/warn.tsx" << 'WARN_EOF'
              {dupInfo?.duplicate && (
                <div className="rounded-xl border-2 border-red-300 bg-red-50 p-3 text-red-800 leading-relaxed" role="alert">
                  <p className="font-bold mb-1">
                    {dupInfo.sameAccount
                      ? "⚠ Cet enfant figure déjà dans votre compte."
                      : "⚠ Une fiche sanitaire existe déjà pour cet élève."}
                  </p>
                  <p>
                    {dupInfo.sameAccount
                      ? "Retrouvez-le dans « Mes enfants » pour compléter ou consulter sa fiche. Inutile d'en créer une seconde."
                      : "Merci de ne pas continuer : il n'y a qu'une seule fiche par élève et la signature d'un seul responsable légal est nécessaire. Si l'autre responsable l'a déjà remplie, il n'y a rien de plus à faire. Pour la consulter ou la modifier, connectez-vous avec le compte utilisé pour la créer, ou contactez l'établissement."}
                  </p>
                </div>
              )}

WARN_EOF

replace_once "$PS" \
'              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}' \
"$(cat "$TMP/warn.tsx")
              <div className=\"flex justify-end gap-2 pt-3 border-t border-slate-100\">
                <button
                  type=\"button\"
                  onClick={() => setShowAddModal(false)}"

replace_once "$PS" \
  'className="px-5 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-lg font-semibold"' \
  'disabled={!!dupInfo?.duplicate}
                  className="px-5 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-lg font-semibold disabled:opacity-40 disabled:cursor-not-allowed"'

# --- 6. Client : AdminSpace.tsx (badge doublon) -----------------------------
AS="$APP_DIR/src/components/AdminSpace.tsx"
echo ">>> Patch de src/components/AdminSpace.tsx ..."

replace_once "$AS" \
  "import { ReminderTemplate, AutoReminderRunSummary } from '../utils/storage';" \
  "import { ReminderTemplate, AutoReminderRunSummary, studentDuplicateKey } from '../utils/storage';"

replace_once "$AS" \
  '<div className="font-mono font-normal text-[10px] text-slate-400">{s.internalId}</div>' \
  '<div className="font-mono font-normal text-[10px] text-slate-400">{s.internalId}</div>
                          {!s.deletedAt && students.some((o) => o.id !== s.id && !o.deletedAt && studentDuplicateKey(o) === studentDuplicateKey(s)) && (
                            <div className="inline-block mt-0.5 text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">
                              Doublon possible
                            </div>
                          )}'

# --- 6bis. .dockerignore : ne JAMAIS copier les PDF d'eleves ni les sauvegardes dans l'image
touch "$APP_DIR/.dockerignore"
for pattern in 'fiches-pdf/' 'backup-avant-*/' 'node_modules/' '.git/' '.env'; do
  grep -qxF "$pattern" "$APP_DIR/.dockerignore" || echo "$pattern" >> "$APP_DIR/.dockerignore"
done
echo ">>> .dockerignore a jour (fiches-pdf, sauvegardes, .env exclus de l'image)"

# --- 7. Reconstruction ------------------------------------------------------
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

echo ">>> Test du controle de doublon (doit repondre duplicate:false) ..."
curl -fsS -X POST "http://localhost:$APP_PORT_VAL/api/students/check-duplicate" \
  -H 'Content-Type: application/json' \
  -d '{"firstName":"Zzzz","lastName":"Inexistant"}' && echo

cat << MSG

============================================================
 TERMINE - build $BUILD
 - Parents : alerte + blocage si la fiche existe deja (prenom + nom)
 - Serveur : refus 409 en cas de creation en doublon
 - Admin   : badge "Doublon possible" dans le Suivi global
 - .dockerignore : PDF d'eleves et sauvegardes exclus de l'image Docker
 Retour arriere possible : copie dans $BACKUP_DIR
 IMPORTANT : videz le cache du navigateur (Ctrl+F5).
 Console navigateur : "[fichesanitaire] build dup-guard-20261001"
============================================================
MSG
