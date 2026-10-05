#!/bin/bash
# ============================================================================
# patch-pdf-archive.sh  -  build pdf-archive-20261001
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# Remplace l'envoi des PDF par e-mail par un ARCHIVAGE SUR LE SERVEUR :
#   /opt/fichesanitaire-voyages/fiches-pdf/<Classe>/<NOM_Prenom>.pdf
#   (un dossier par classe, fichiers classes par ordre alphabetique)
#
# A DEPOSER avec FileZilla dans : /root/   (n'importe ou, ici /root/)
# A EXECUTER :  chmod +x /root/patch-pdf-archive.sh && /root/patch-pdf-archive.sh
# ============================================================================
set -e

APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"
BUILD="pdf-archive-20261001"
BACKUP_DIR="$APP_DIR/backup-avant-$BUILD"
FILES="server/index.js docker-compose.yml .gitignore src/utils/pdfGenerator.ts src/components/AdminSpace.tsx"
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

for f in server/index.js docker-compose.yml .gitignore src/utils/pdfGenerator.ts src/components/AdminSpace.tsx; do
  [ -f "$APP_DIR/$f" ] || { echo "ERREUR : $APP_DIR/$f introuvable."; exit 1; }
done
command -v perl >/dev/null || { echo "ERREUR : perl est requis (apt install -y perl)."; exit 1; }

m1=0; m2=0; m3=0
grep -q "PDF_ARCHIVE_DIR" "$APP_DIR/server/index.js" && m1=1
grep -q "schoolClass: student.schoolClass" "$APP_DIR/src/utils/pdfGenerator.ts" && m2=1
grep -q "./fiches-pdf:/app/fiches-pdf" "$APP_DIR/docker-compose.yml" && m3=1
if [ $((m1+m2+m3)) -eq 3 ]; then
  echo ">>> Patch deja applique (serveur + client + docker-compose). Rien a faire."
  exit 0
elif [ $((m1+m2+m3)) -gt 0 ]; then
  echo "ERREUR : etat partiel detecte (serveur=$m1 client=$m2 compose=$m3)."
  echo "Restaurez d'abord les fichiers d'origine depuis un backup-avant-* puis relancez ce script."
  exit 1
fi

# --- Fonctions utilitaires -------------------------------------------------
replace_between() { # fichier  repere_debut  repere_fin(non inclus)  fichier_nouveau_contenu
  local file="$1" start="$2" end="$3" newfile="$4"
  grep -qF -- "$start" "$file" || { echo "ERREUR : repere introuvable dans $file : $start"; exit 1; }
  grep -qF -- "$end" "$file"   || { echo "ERREUR : repere introuvable dans $file : $end"; exit 1; }
  START="$start" END="$end" NEW="$(cat "$newfile")" \
    perl -0777 -i -pe 's/\Q$ENV{START}\E.*?(?=\Q$ENV{END}\E)/$ENV{NEW}\n\n/s' "$file"
}

replace_once() { # fichier  ancien_texte  nouveau_texte
  local file="$1" old="$2" new="$3" n
  n=$(grep -cF -- "$old" "$file" || true)
  [ "$n" = "1" ] || { echo "ERREUR : '$old' trouve $n fois dans $file (attendu : 1)."; exit 1; }
  OLD="$old" NEW="$new" perl -0777 -i -pe 's/\Q$ENV{OLD}\E/$ENV{NEW}/' "$file"
}

# --- 1. Sauvegarde des fichiers modifies ----------------------------------
echo ">>> Sauvegarde dans $BACKUP_DIR ..."
mkdir -p "$BACKUP_DIR/server" "$BACKUP_DIR/src/utils" "$BACKUP_DIR/src/components"
cp -p "$APP_DIR/server/index.js"                 "$BACKUP_DIR/server/index.js"
cp -p "$APP_DIR/docker-compose.yml"              "$BACKUP_DIR/docker-compose.yml"
cp -p "$APP_DIR/.gitignore"                      "$BACKUP_DIR/.gitignore"
cp -p "$APP_DIR/src/utils/pdfGenerator.ts"       "$BACKUP_DIR/src/utils/pdfGenerator.ts"
cp -p "$APP_DIR/src/components/AdminSpace.tsx"   "$BACKUP_DIR/src/components/AdminSpace.tsx"
PATCHING=1

# --- 2. Nouveau bloc serveur ------------------------------------------------
cat > "$TMP/server_block.js" << 'PDFARCHIVE_EOF'
// --- Archivage des fiches sanitaires complètes (PDF) sur le serveur ---
// Plus d'envoi par e-mail : chaque PDF est enregistré dans
//   <PDF_ARCHIVE_DIR>/<Classe>/<NOM_Prenom>.pdf
// Dossiers = une classe par dossier ; fichiers triés par ordre alphabétique du nom.
// Sur l'hôte (LXC) : /opt/fichesanitaire-voyages/fiches-pdf/
const PDF_ARCHIVE_DIR = process.env.PDF_ARCHIVE_DIR || '/app/fiches-pdf';
const PDF_INDEX_FILE = path.join(PDF_ARCHIVE_DIR, '.index.json');

try {
  fs.mkdirSync(PDF_ARCHIVE_DIR, { recursive: true });
  console.log("[fiches-pdf] build pdf-archive-20261001 - dossier d'archivage :", PDF_ARCHIVE_DIR);
} catch (e) {
  console.error("[fiches-pdf] Impossible de créer le dossier d'archivage:", e);
}

// Transforme un texte en nom de fichier/dossier sûr (sans accents, sans espaces ni "/" ni ".")
function pdfSlug(value, fallback) {
  const s = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s || fallback;
}

function readPdfIndex() {
  try {
    return JSON.parse(fs.readFileSync(PDF_INDEX_FILE, 'utf8'));
  } catch {
    return {};
  }
}

// Écritures séquentielles pour ne jamais corrompre l'index
let pdfArchiveQueue = Promise.resolve();
function runPdfArchiveExclusive(task) {
  const run = pdfArchiveQueue.then(task);
  pdfArchiveQueue = run.catch(() => {});
  return run;
}

async function archiveStudentPdf({ studentId, buffer, lastName, firstName, schoolClass }) {
  return runPdfArchiveExclusive(async () => {
    const classDir = pdfSlug(schoolClass, 'Sans_classe');
    const base = `${pdfSlug(String(lastName || '').toUpperCase(), 'SANS_NOM')}_${pdfSlug(firstName, 'Sans_prenom')}`;
    const index = readPdfIndex();

    let rel = `${classDir}/${base}.pdf`;
    // Homonymes dans la même classe : on suffixe avec un extrait de l'identifiant
    if (Object.keys(index).some((id) => id !== studentId && index[id] === rel)) {
      rel = `${classDir}/${base}_${pdfSlug(studentId, 'id').slice(0, 8)}.pdf`;
    }

    const target = path.join(PDF_ARCHIVE_DIR, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, target);

    // Si l'élève a changé de classe ou de nom : on supprime l'ancien fichier
    const previous = index[studentId];
    if (previous && previous !== rel) {
      const previousFile = path.join(PDF_ARCHIVE_DIR, previous);
      try { fs.unlinkSync(previousFile); } catch {}
      try { fs.rmdirSync(path.dirname(previousFile)); } catch {} // uniquement si le dossier est vide
    }

    index[studentId] = rel;
    fs.writeFileSync(PDF_INDEX_FILE, JSON.stringify(index, null, 2));
    return rel;
  });
}

app.post('/api/students/send-pdf', async (req, res) => {
  try {
    const { studentId, pdfBase64, studentName, schoolClass } = req.body || {};
    if (!studentId || !pdfBase64) {
      return res.status(400).json({ error: 'studentId ou pdfBase64 manquant' });
    }

    const buffer = Buffer.from(String(pdfBase64).replace(/^data:[^,]*,/, ''), 'base64');
    if (buffer.length < 100 || buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
      return res.status(400).json({ error: "Le contenu reçu n'est pas un PDF valide" });
    }

    const students = (await readKv(STUDENTS_KEY)) || [];
    const idx = students.findIndex((s) => s.id === studentId);
    const stored = idx !== -1 ? students[idx] : null;
    const identity = (stored && stored.cerfa && stored.cerfa.identity) || {};

    let firstName = identity.firstName;
    let lastName = identity.lastName;
    if (!firstName && !lastName && studentName) {
      const parts = String(studentName).trim().split(/\s+/);
      firstName = parts.shift();
      lastName = parts.join(' ');
    }

    const rel = await archiveStudentPdf({
      studentId,
      buffer,
      lastName,
      firstName,
      schoolClass: schoolClass || (stored && stored.schoolClass) || '',
    });
    console.log(`[fiches-pdf] Fiche archivée : ${rel} (${buffer.length} octets)`);

    // Enregistre la date d'archivage sur CET élève uniquement (relecture juste avant écriture)
    const sentAt = new Date().toISOString();
    const fresh = (await readKv(STUDENTS_KEY)) || [];
    const freshIdx = fresh.findIndex((s) => s.id === studentId);
    if (freshIdx !== -1) {
      fresh[freshIdx] = { ...fresh[freshIdx], pdfSentAt: sentAt };
      await writeKv(STUDENTS_KEY, fresh);
    }

    res.json({ ok: true, sentAt, path: rel });
  } catch (e) {
    console.error('[fiches-pdf] Échec archivage PDF fiche sanitaire:', e);
    res.status(500).json({ error: "Erreur serveur lors de l'archivage du PDF" });
  }
});

PDFARCHIVE_EOF

echo ">>> Patch de server/index.js ..."
replace_between "$APP_DIR/server/index.js" \
  "// Destinataire fixe pour l'envoi automatique de la fiche sanitaire complète en PDF" \
  "app.post('/api/reminders/send'" \
  "$TMP/server_block.js"

# --- 3. Client : envoie la classe avec le PDF -------------------------------
echo ">>> Patch de src/utils/pdfGenerator.ts ..."
replace_once "$APP_DIR/src/utils/pdfGenerator.ts" \
  "body: JSON.stringify({ studentId: student.id, pdfBase64: base64, studentName })," \
  "body: JSON.stringify({ studentId: student.id, pdfBase64: base64, studentName, schoolClass: student.schoolClass }),"

# --- 4. Interface : "Envoye" -> "Archive" -----------------------------------
echo ">>> Patch de src/components/AdminSpace.tsx ..."
replace_once "$APP_DIR/src/components/AdminSpace.tsx" \
  '<CheckCircle className="w-3.5 h-3.5" /> Envoyé' \
  '<CheckCircle className="w-3.5 h-3.5" /> Archivé'
replace_once "$APP_DIR/src/components/AdminSpace.tsx" \
  '<th className="p-3">Envoi PDF</th>' \
  '<th className="p-3">Archivage PDF</th>'

# --- 5. docker-compose : dossier monte sur l'hote ---------------------------
echo ">>> Patch de docker-compose.yml ..."
replace_once "$APP_DIR/docker-compose.yml" \
  '      BACKUP_RETENTION_HOURS: ${BACKUP_RETENTION_HOURS:-336}' \
  '      BACKUP_RETENTION_HOURS: ${BACKUP_RETENTION_HOURS:-336}
      PDF_ARCHIVE_DIR: /app/fiches-pdf'
replace_once "$APP_DIR/docker-compose.yml" \
  '      - fichesanitaire_backups:/app/backups' \
  '      - fichesanitaire_backups:/app/backups
      - ./fiches-pdf:/app/fiches-pdf'

# --- 6. Dossier hote + .gitignore (donnees de sante : JAMAIS sur GitHub) ----
mkdir -p "$APP_DIR/fiches-pdf"
chmod 750 "$APP_DIR/fiches-pdf"
grep -qx 'fiches-pdf/' "$APP_DIR/.gitignore" || printf 'fiches-pdf/\nbackup-avant-*/\n' >> "$APP_DIR/.gitignore"

# --- 7. Reconstruction et redemarrage ---------------------------------------
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
  echo "!!! Pour revenir en arriere : cp -a $BACKUP_DIR/server $BACKUP_DIR/src $BACKUP_DIR/docker-compose.yml $BACKUP_DIR/.gitignore $APP_DIR/"
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

echo ">>> Test d'ecriture dans le dossier d'archivage ..."
docker exec fichesanitaire_app sh -c 'touch /app/fiches-pdf/.test && rm /app/fiches-pdf/.test' \
  && echo ">>> Ecriture OK" || echo "!!! ECHEC d'ecriture dans /app/fiches-pdf (verifier les droits de $APP_DIR/fiches-pdf)"

echo ">>> Logs de demarrage :"
docker compose logs app --tail 15 | grep -i "fiches-pdf" || true

cat << MSG

============================================================
 TERMINE - build $BUILD
 Les PDF sont maintenant ranges dans :
   $APP_DIR/fiches-pdf/<Classe>/<NOM_Prenom>.pdf
 Retour arriere possible : copie dans $BACKUP_DIR
 IMPORTANT : videz le cache du navigateur (Ctrl+F5) pour charger la nouvelle version.
============================================================
MSG
