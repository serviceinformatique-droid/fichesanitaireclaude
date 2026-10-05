#!/bin/bash
# ============================================================================
# patch-pieces-jointes.sh  -  build attachments-limit-20261004
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# CAUSE de la panne du 04/10 : UNE SEULE fiche (5,4 Mo de pieces jointes) pesait plus que le
# reste de la base ; or la base entiere est telechargee par chaque navigateur a l'ouverture.
# Rien ne limitait la taille des pieces jointes (ordonnances, PAI, justificatifs).
#
# CORRECTION :
#  - NAVIGATEUR : les photos sont REDUITES avant enregistrement (1600 px, JPEG ; une photo de
#    telephone de 5 Mo devient ~300 Ko) ; les PDF de plus de 1,5 Mo sont refuses avec un
#    message clair ; seuls PDF et images sont acceptes.
#  - SERVEUR : une NOUVELLE piece jointe de plus de ~2,2 Mo est refusee (HTTP 413) ; les pieces
#    deja enregistrees restent modifiables (une fiche deja lourde n'est jamais bloquee).
#
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/patch-pieces-jointes.sh && /root/patch-pieces-jointes.sh
# ============================================================================
set -e

APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"
BUILD="attachments-limit-20261004"
BACKUP_DIR="$APP_DIR/backup-avant-$BUILD"
FILES="server/index.js src/components/CerfaEditor.tsx"
NEWFILES="src/utils/attachments.ts"
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
[ -d "$APP_DIR/src/utils" ] || { echo "ERREUR : $APP_DIR/src/utils introuvable."; exit 1; }

SRV="$APP_DIR/server/index.js"
EDT="$APP_DIR/src/components/CerfaEditor.tsx"

m=0
grep -q "attachmentSizeGuard" "$SRV" && m=$((m+1))
grep -q "prepareAttachment" "$EDT" && m=$((m+1))
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

# --- 2. Utilitaire de pieces jointes ---------------------------------------------
echo ">>> Creation de src/utils/attachments.ts ..."
cat > "$APP_DIR/src/utils/attachments.ts" << 'ATTEOF_X'
console.log('[fichesanitaire] build attachments-limit-20261004');

// --- Pièces jointes (ordonnances, PAI, justificatifs) : contrôle et compression ---
// Les pièces jointes sont stockées dans la base en base64 et téléchargées par TOUS les navigateurs
// à l'ouverture du portail : une seule photo de 5 Mo pesait plus que le reste de la base.
// Les images sont réduites (1600 px, JPEG) ; les PDF sont limités en taille.

export const MAX_ATTACHMENT_BYTES = 1.5 * 1024 * 1024; // taille maximale d'une pièce jointe enregistrée
export const MAX_INPUT_BYTES = 40 * 1024 * 1024; // au-delà : refusé d'emblée (photo > 40 Mo)
const MAX_SIDE = 1600;

export function formatMo(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1).replace('.', ',') + ' Mo';
}

export function validateAttachment(file: { type: string; size: number }): string | null {
  const isPdf = file.type === 'application/pdf';
  const isImage = file.type.startsWith('image/');
  if (!isPdf && !isImage) return 'Format non accepté : envoyez un PDF ou une photo (JPEG, PNG).';
  if (file.size === 0) return 'Le fichier est vide.';
  if (file.size > MAX_INPUT_BYTES) return `Fichier trop volumineux (${formatMo(file.size)}).`;
  if (isPdf && file.size > MAX_ATTACHMENT_BYTES) {
    return `PDF trop volumineux (${formatMo(file.size)}) : ${formatMo(MAX_ATTACHMENT_BYTES)} maximum. Réduisez-le (scan en basse résolution, « enregistrer sous » en taille réduite) ou envoyez plutôt une photo.`;
  }
  return null;
}

// Dimensions finales d'une image : le plus grand côté ne dépasse jamais maxSide
export function fitSize(w: number, h: number, maxSide = MAX_SIDE) {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Lecture impossible')));
    reader.onerror = () => reject(new Error('Lecture impossible'));
    reader.readAsDataURL(file);
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image illisible : enregistrez-la en JPEG ou en PNG puis recommencez."));
    };
    img.src = url;
  });
}

export interface PreparedAttachment {
  dataUrl: string;
  sizeBytes: number;
  name: string;
}

export async function prepareAttachment(file: File): Promise<PreparedAttachment> {
  const problem = validateAttachment(file);
  if (problem) throw new Error(problem);

  if (file.type === 'application/pdf') {
    return { dataUrl: await readAsDataUrl(file), sizeBytes: file.size, name: file.name };
  }

  const img = await loadImage(file);
  const { width, height } = fitSize(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Traitement de l\'image impossible sur cet appareil.');
  ctx.fillStyle = '#ffffff'; // fond blanc (documents scannés / PNG transparents)
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  // qualité abaissée progressivement jusqu'à tenir sous la limite
  let blob: Blob | null = null;
  for (const q of [0.78, 0.65, 0.5, 0.4]) {
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', q));
    if (blob && blob.size <= MAX_ATTACHMENT_BYTES) break;
  }
  if (!blob || blob.size > MAX_ATTACHMENT_BYTES) {
    throw new Error('Image trop détaillée pour être réduite : essayez avec une photo plus simple ou un PDF léger.');
  }
  const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
  return { dataUrl: await readAsDataUrl(blob), sizeBytes: blob.size, name };
}

// Message temporaire : un seul minuteur à la fois (avant, le minuteur d'un message précédent pouvait
// effacer trop tôt le message suivant, par exemple un refus affiché juste après un succès).
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
export function flashNotice(set: (message: string) => void, message: string, ms: number): void {
  if (noticeTimer) clearTimeout(noticeTimer);
  set(message);
  noticeTimer = setTimeout(() => set(''), ms);
}
ATTEOF_X

# --- 3. Editeur de la fiche : controle + reduction des photos --------------------
echo ">>> Patch de src/components/CerfaEditor.tsx ..."
replace_once "$EDT" "import { SignaturePad } from './SignaturePad';" "import { SignaturePad } from './SignaturePad';
import { flashNotice, prepareAttachment, validateAttachment } from '../utils/attachments';"

cat > "$TMP/edt_old.tsx" << 'ATTEOF_X'
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, docType: AttachedDocument['type']) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : undefined;
      const newDoc: AttachedDocument = {
        id: 'doc-' + Date.now(),
        name: docType === 'pai' ? `Protocole PAI - ${file.name}` : file.name,
        type: docType,
        uploadDate: new Date().toISOString(),
        sizeKb: Math.max(1, Math.round(file.size / 1024)),
        fileName: file.name,
        sensitiveMedical: true,
        dataUrl,
      };

      setFormData((prev) => ({
        ...prev,
        documents: [newDoc, ...prev.documents],
        medicalInfo: {
          ...prev.medicalInfo,
          hasPai: docType === 'pai' ? true : prev.medicalInfo.hasPai,
          hasPrescriptionAttached: docType === 'ordonnance' ? true : prev.medicalInfo.hasPrescriptionAttached,
        },
      }));

      setUploadNotice(`Document "${file.name}" ajouté avec succès !`);
      setTimeout(() => setUploadNotice(''), 4000);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };
ATTEOF_X
cat > "$TMP/edt_new.tsx" << 'ATTEOF_X'
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, docType: AttachedDocument['type']) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    // Contrôle du type et de la taille ; les photos sont réduites avant d'être enregistrées
    const problem = validateAttachment(file);
    if (problem) {
      flashNotice(setUploadNotice, problem, 9000);
      return;
    }

    prepareAttachment(file)
      .then(({ dataUrl, sizeBytes, name }) => {
        const newDoc: AttachedDocument = {
          id: 'doc-' + Date.now(),
          name: docType === 'pai' ? `Protocole PAI - ${name}` : name,
          type: docType,
          uploadDate: new Date().toISOString(),
          sizeKb: Math.max(1, Math.round(sizeBytes / 1024)),
          fileName: name,
          sensitiveMedical: true,
          dataUrl,
        };

        setFormData((prev) => ({
          ...prev,
          documents: [newDoc, ...prev.documents],
          medicalInfo: {
            ...prev.medicalInfo,
            hasPai: docType === 'pai' ? true : prev.medicalInfo.hasPai,
            hasPrescriptionAttached: docType === 'ordonnance' ? true : prev.medicalInfo.hasPrescriptionAttached,
          },
        }));

        flashNotice(setUploadNotice, `Document "${name}" ajouté avec succès !`, 4000);
      })
      .catch((err) => {
        flashNotice(setUploadNotice, err && err.message ? err.message : "Ce fichier n'a pas pu être ajouté.", 9000);
      });
  };
ATTEOF_X
replace_once "$EDT" "$(cat "$TMP/edt_old.tsx")" "$(cat "$TMP/edt_new.tsx")"

# Message de televersement : ROUGE en cas de refus (avant : toujours vert, meme pour une erreur)
cat > "$TMP/notice_old.tsx" << 'ATTEOF_X'
                    {uploadNotice && (
                      <div className="p-2 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded text-xs flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                        <span>{uploadNotice}</span>
                      </div>
                    )}
ATTEOF_X
cat > "$TMP/notice_new.tsx" << 'ATTEOF_X'
                    {uploadNotice && (
                      <div
                        className={`p-2 border rounded text-xs flex items-center gap-1.5 ${
                          /ajouté avec succès/.test(uploadNotice)
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                            : 'bg-red-50 border-red-300 text-red-800 font-semibold'
                        }`}
                        role="status"
                        data-testid="upload-notice"
                      >
                        {/ajouté avec succès/.test(uploadNotice) ? (
                          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                        ) : (
                          <span aria-hidden="true">⚠</span>
                        )}
                        <span>{uploadNotice}</span>
                      </div>
                    )}
ATTEOF_X
replace_once "$EDT" "$(cat "$TMP/notice_old.tsx")" "$(cat "$TMP/notice_new.tsx")"

# --- 4. Serveur : refus des nouvelles pieces jointes trop lourdes -------------------
echo ">>> Patch de server/index.js ..."
cat > "$TMP/server_guard.js" << 'ATTEOF_X'
app.use(express.json({ limit: '15mb' }));

// --- Limite de taille des NOUVELLES pièces jointes (build attachments-limit-20261004) ---
// Une pièce jointe de plus de ~2,2 Mo (3 000 000 caractères en base64) est refusée si elle est
// nouvelle ou modifiée. Les pièces jointes déjà enregistrées restent modifiables : l'enregistrement
// d'une fiche déjà volumineuse n'est jamais bloqué. (Le navigateur compresse déjà les images ;
// ce contrôle protège contre un ancien navigateur ou un envoi direct.)
const MAX_ATTACHMENT_CHARS = 3000000;
async function attachmentSizeGuard(req, res, next) {
  try {
    const incoming = req.body && req.body.student;
    const docs = incoming && incoming.cerfa && Array.isArray(incoming.cerfa.documents) ? incoming.cerfa.documents : [];
    const heavy = docs.filter((d) => d && typeof d.dataUrl === 'string' && d.dataUrl.length > MAX_ATTACHMENT_CHARS);
    if (heavy.length > 0 && incoming && incoming.id) {
      const list = (await readKv(STUDENTS_KEY)) || [];
      const stored = list.find((s) => s && s.id === incoming.id);
      const storedDocs = stored && stored.cerfa && Array.isArray(stored.cerfa.documents) ? stored.cerfa.documents : [];
      const refused = heavy.find((d) => !storedDocs.some((o) => o && o.id === d.id && typeof o.dataUrl === 'string' && o.dataUrl.length === d.dataUrl.length));
      if (refused) {
        console.log(`[pieces-jointes] Refusé : « ${refused.name || refused.id} » (${Math.round(refused.dataUrl.length / 1024)} Ko) pour la fiche ${incoming.id}`);
        return res.status(413).json({ error: 'document-too-large', name: refused.name || '' });
      }
    }
  } catch (e) {
    console.error('[pieces-jointes] Erreur de contrôle :', e);
  }
  next();
}
app.post('/api/students/upsert', attachmentSizeGuard);
app.put('/api/magic-link/:token', attachmentSizeGuard);
ATTEOF_X
replace_once "$SRV" "app.use(express.json({ limit: '15mb' }));" "$(cat "$TMP/server_guard.js")"

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
  echo "!!! Pour revenir en arriere : cp -a $BACKUP_DIR/server $BACKUP_DIR/src $APP_DIR/ && rm -f $APP_DIR/src/utils/attachments.ts"
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
 - Les photos ajoutees comme pieces jointes sont reduites (1600 px, JPEG) ; PDF limites a 1,5 Mo.
 - Le serveur refuse toute NOUVELLE piece jointe de plus de ~2,2 Mo.
 - Les pieces deja enregistrees ne sont pas modifiees (voir la commande de diagnostic).
 Retour arriere possible : copie dans $BACKUP_DIR
 IMPORTANT : videz le cache du navigateur (Ctrl+F5).
 Console navigateur : "[fichesanitaire] build attachments-limit-20261004"
 Logs serveur : docker compose logs app | grep pieces-jointes
============================================================
MSG
