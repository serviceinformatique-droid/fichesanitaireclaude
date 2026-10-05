#!/bin/bash
# ============================================================================
# patch-ui-signature.sh  -  build ui-signature-20261001
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# 1) IMPORT D'UNE SIGNATURE - reserve a l'ADMINISTRATION
#    Dans la rubrique 5 (Signature) de la fiche, l'administration voit un bloc
#    "Importer une signature" : image PNG / JPEG / WebP (5 Mo max), par exemple une
#    signature scannee sur un document papier. L'image est nettoyee (fond blanc rendu
#    transparent, marges rognees, centree sans deformation). Elle est tracee dans
#    l'historique de la fiche ("Signature importee par l'administration") et signalee
#    dans la vue officielle et le PDF. Les parents et le lien direct ne voient JAMAIS ce bloc.
#
# 2) AUCUNE BARRE DE DEFILEMENT HORIZONTALE dans la vue d'ensemble
#    - Tableau "Suivi global" : compact et adapte a la largeur (>= 1024 px) ; sous 1024 px,
#      chaque eleve devient une carte empilee lisible (telephone / tablette).
#    - En-tete : le selecteur de compte administrateur est masque sous 1024 px
#      (le bouton "Admin" ouvre la meme selection de profil) - il faisait deborder la page.
#
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/patch-ui-signature.sh && /root/patch-ui-signature.sh
# ============================================================================
set -e

APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"
BUILD="ui-signature-20261001"
BACKUP_DIR="$APP_DIR/backup-avant-$BUILD"
FILES="src/index.css src/types.ts src/components/AdminSpace.tsx src/components/Header.tsx src/components/SignaturePad.tsx src/components/CerfaEditor.tsx src/components/CerfaOfficialView.tsx src/utils/pdfGenerator.ts"
NEWFILES="src/utils/signatureImage.ts"
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

CSS="$APP_DIR/src/index.css"
TYP="$APP_DIR/src/types.ts"
ADM="$APP_DIR/src/components/AdminSpace.tsx"
HDR="$APP_DIR/src/components/Header.tsx"
PAD="$APP_DIR/src/components/SignaturePad.tsx"
EDT="$APP_DIR/src/components/CerfaEditor.tsx"
OFV="$APP_DIR/src/components/CerfaOfficialView.tsx"
PDF="$APP_DIR/src/utils/pdfGenerator.ts"

m=0
grep -q "suivi-table" "$CSS" && m=$((m+1))
grep -q "uploadedBy" "$TYP" && m=$((m+1))
grep -q "suivi-table" "$ADM" && m=$((m+1))
grep -q "hidden lg:block bg-slate-50" "$HDR" && m=$((m+1))
grep -q "Math.min(rect.width / img.width" "$PAD" && m=$((m+1))
grep -q "handleAdminSignatureUpload" "$EDT" && m=$((m+1))
grep -q "Signature importée par l'administration" "$OFV" && m=$((m+1))
grep -q "Signature importée (admin)" "$PDF" && m=$((m+1))
for f in $NEWFILES; do [ -f "$APP_DIR/$f" ] && m=$((m+1)); done
if [ "$m" -eq 9 ]; then
  echo ">>> Patch deja applique. Rien a faire."
  exit 0
elif [ "$m" -gt 0 ]; then
  echo "ERREUR : etat partiel detecte ($m/9 elements deja en place)."
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

# --- 2. Utilitaire d'import de signature ------------------------------------
echo ">>> Creation de src/utils/signatureImage.ts ..."
cat > "$APP_DIR/src/utils/signatureImage.ts" << 'UIEOF_X'
console.log('[fichesanitaire] build ui-signature-20261001');

// --- Import d'une image de signature (réservé à l'administration) ---
// L'image est nettoyée avant d'être enregistrée : fond clair rendu transparent, marges
// rognées, puis centrée dans un cadre de 1300 x 200 px (même proportion que la zone
// « Signature » du PDF : 39 x 6 mm) pour ne jamais être déformée.

export const SIGNATURE_MAX_BYTES = 5 * 1024 * 1024;
export const SIGNATURE_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const SIGNATURE_OUT_WIDTH = 1300;
export const SIGNATURE_OUT_HEIGHT = 200;

export function validateSignatureFile(file: { type: string; size: number }): string | null {
  if (!SIGNATURE_ACCEPTED_TYPES.includes(file.type)) {
    return 'Format non pris en charge : choisissez une image PNG, JPEG ou WebP.';
  }
  if (file.size === 0) return 'Le fichier est vide.';
  if (file.size > SIGNATURE_MAX_BYTES) return 'Image trop volumineuse (5 Mo maximum).';
  return null;
}

// Plus grand rectangle de même proportion que (srcW x srcH) contenu et centré dans (boxW x boxH)
export function containRect(srcW: number, srcH: number, boxW: number, boxH: number) {
  const scale = Math.min(boxW / srcW, boxH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

// Rend transparent le fond clair (papier blanc d'un scan) ; les traits sombres restent intacts
export function whitenToTransparent(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const min = Math.min(data[i], data[i + 1], data[i + 2]);
    if (min >= 235) data[i + 3] = 0;
    else if (min > 190) data[i + 3] = Math.round((data[i + 3] * (235 - min)) / 45);
  }
}

// Cadre englobant des pixels visibles (null si l'image est vide)
export function visibleBounds(data: Uint8ClampedArray, width: number, height: number, threshold = 24) {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
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
      reject(new Error('Image illisible'));
    };
    img.src = url;
  });
}

export async function signatureFileToDataUrl(file: File): Promise<string> {
  const img = await loadImage(file);
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const ww = Math.max(1, Math.round(img.naturalWidth * scale));
  const wh = Math.max(1, Math.round(img.naturalHeight * scale));

  const work = document.createElement('canvas');
  work.width = ww;
  work.height = wh;
  const wctx = work.getContext('2d');
  if (!wctx) throw new Error('Canvas indisponible');
  wctx.drawImage(img, 0, 0, ww, wh);
  const pixels = wctx.getImageData(0, 0, ww, wh);
  whitenToTransparent(pixels.data);
  wctx.putImageData(pixels, 0, 0);

  const b = visibleBounds(pixels.data, ww, wh);
  if (!b) throw new Error('Aucune signature visible dans cette image');
  const margin = Math.round(Math.max(b.w, b.h) * 0.02);
  const sx = Math.max(0, b.x - margin);
  const sy = Math.max(0, b.y - margin);
  const sw = Math.min(ww - sx, b.w + 2 * margin);
  const sh = Math.min(wh - sy, b.h + 2 * margin);

  const out = document.createElement('canvas');
  out.width = SIGNATURE_OUT_WIDTH;
  out.height = SIGNATURE_OUT_HEIGHT;
  const octx = out.getContext('2d');
  if (!octx) throw new Error('Canvas indisponible');
  octx.clearRect(0, 0, out.width, out.height);
  const r = containRect(sw, sh, SIGNATURE_OUT_WIDTH - 20, SIGNATURE_OUT_HEIGHT - 12);
  octx.drawImage(work, sx, sy, sw, sh, r.x + 10, r.y + 6, r.w, r.h);
  return out.toDataURL('image/png');
}
UIEOF_X

# --- 3. Mise en page : tableau Suivi global sans defilement horizontal -----------
echo ">>> Patch de src/index.css ..."
cat >> "$CSS" << 'UIEOF_X'

/* ============================================================================
   Vue d'ensemble : tableau « Suivi global » SANS barre de défilement horizontale
   (build ui-compact-20261001)
   - Grands écrans (>= 1024 px) : tableau compact qui s'adapte à la largeur.
   - Petits écrans (< 1024 px) : chaque élève devient une fiche (carte) empilée.
   ============================================================================ */
.suivi-wrap {
  width: 100%;
  max-width: 100%;
}
.suivi-table {
  width: 100%;
  max-width: 100%;
  table-layout: auto;
}
.suivi-table th,
.suivi-table td {
  padding: 0.5rem 0.4rem;
  overflow-wrap: break-word;
}
.suivi-table td:nth-child(4),
.suivi-table th:nth-child(4) {
  min-width: 4.25rem;
}
/* Pension : liste déroulante compacte (texte tronqué avec « … » si l'écran est étroit) */
.suivi-table td:nth-child(3) select {
  width: 100%;
  max-width: 7rem;
  text-overflow: ellipsis;
}
@media (min-width: 1200px) {
  .suivi-table td:nth-child(3) select {
    max-width: none;
    width: auto;
  }
}
/* la colonne « Élève » n'a plus besoin d'être collée : il n'y a plus de défilement */
.suivi-table th:first-child,
.suivi-table td:first-child {
  position: static;
  box-shadow: none;
}
.suivi-table select {
  max-width: 100%;
  min-width: 0;
}
.suivi-table td:last-child > div {
  flex-wrap: wrap;
}

@media (max-width: 1023px) {
  .suivi-table,
  .suivi-table tbody,
  .suivi-table tr,
  .suivi-table td {
    display: block;
    width: 100%;
  }
  .suivi-table thead {
    display: none;
  }
  .suivi-table tbody tr {
    border: 1px solid #e2e8f0;
    border-radius: 0.75rem;
    margin-bottom: 0.75rem;
    padding: 0.25rem 0;
    background: #ffffff;
  }
  .suivi-table td {
    display: grid;
    grid-template-columns: 7.25rem minmax(0, 1fr);
    column-gap: 0.5rem;
    align-items: start;
    padding: 0.4rem 0.75rem;
    border: 0;
    text-align: left;
  }
  .suivi-table td::before {
    font-size: 11px;
    font-weight: 700;
    color: #475569;
  }
  /* « Élève » sert de titre de la carte : pas d'étiquette */
  .suivi-table td:nth-child(1) {
    display: block;
    font-size: 0.8125rem;
    border-bottom: 1px solid #f1f5f9;
    padding-bottom: 0.5rem;
    margin-bottom: 0.25rem;
  }
  .suivi-table td:nth-child(2)::before { content: "Classe"; }
  .suivi-table td:nth-child(3)::before { content: "Pension"; }
  .suivi-table td:nth-child(4)::before { content: "Régime"; }
  .suivi-table td:nth-child(5)::before { content: "PAI & justificatifs"; }
  .suivi-table td:nth-child(6)::before { content: "Complétude CERFA"; }
  .suivi-table td:nth-child(7)::before { content: "Signature"; }
  .suivi-table td:nth-child(8)::before { content: "Archivage PDF"; }
  .suivi-table td:nth-child(9)::before { content: "Voyages"; }
  .suivi-table td:nth-child(10)::before { content: "Actions"; }
  .suivi-table td:last-child { text-align: left; }
  .suivi-table td:last-child > div { justify-content: flex-start; }
}
UIEOF_X

echo ">>> Patch de src/components/AdminSpace.tsx ..."
cat > "$TMP/adm_old.tsx" << 'UIEOF_X'
<div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-3 sticky left-0 z-20 bg-slate-100 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]">Élève</th>
UIEOF_X
cat > "$TMP/adm_new.tsx" << 'UIEOF_X'
<div className="suivi-wrap">
              <table className="suivi-table w-full text-xs text-left border-collapse">
                <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-3 sticky left-0 z-20 bg-slate-100 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]">Élève</th>
UIEOF_X
replace_once "$ADM" "$(cat "$TMP/adm_old.tsx")" "$(cat "$TMP/adm_new.tsx")"

echo ">>> Patch de src/components/Header.tsx ..."
cat > "$TMP/hdr_old.tsx" << 'UIEOF_X'
                  onChange={(e) => handleUserSelectChange(e.target.value)}
                  className="bg-slate-50 border
UIEOF_X
cat > "$TMP/hdr_new.tsx" << 'UIEOF_X'
                  onChange={(e) => handleUserSelectChange(e.target.value)}
                  className="hidden lg:block bg-slate-50 border
UIEOF_X
replace_once "$HDR" "$(cat "$TMP/hdr_old.tsx")" "$(cat "$TMP/hdr_new.tsx")"

# --- 4. Signature : types ---------------------------------------------------
echo ">>> Patch de src/types.ts ..."
cat > "$TMP/typ_old.ts" << 'UIEOF_X'
    validatedAt: string;
    version: number;
  };
UIEOF_X
cat > "$TMP/typ_new.ts" << 'UIEOF_X'
    validatedAt: string;
    version: number;
    method?: 'drawn' | 'uploaded'; // tracée à l'écran ou image importée par l'administration
    uploadedBy?: string;
  };
UIEOF_X
replace_once "$TYP" "$(cat "$TMP/typ_old.ts")" "$(cat "$TMP/typ_new.ts")"

# --- 5. Signature : zone de dessin (affichage sans deformation) ---------------
echo ">>> Patch de src/components/SignaturePad.tsx ..."
cat > "$TMP/pad_new.tsx" << 'UIEOF_X'
const scale = Math.min(rect.width / img.width, rect.height / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        ctx.drawImage(img, (rect.width - dw) / 2, (rect.height - dh) / 2, dw, dh);
UIEOF_X
replace_once "$PAD" "ctx.drawImage(img, 0, 0, rect.width, rect.height);" "$(cat "$TMP/pad_new.tsx")"
replace_once "$PAD" "        {hasDrawn && (
" "        {(hasDrawn || Boolean(initialSignature)) && (
"

# --- 6. Signature : editeur de la fiche (bloc reserve a l'administration) --------
echo ">>> Patch de src/components/CerfaEditor.tsx ..."
replace_once "$EDT" "import { SignaturePad } from './SignaturePad';" "import { SignaturePad } from './SignaturePad';
import { signatureFileToDataUrl, validateSignatureFile } from '../utils/signatureImage';"
replace_once "$EDT" "  const [modificationNote, setModificationNote] = useState('');" "  const [modificationNote, setModificationNote] = useState('');
  const [signatureUploadError, setSignatureUploadError] = useState('');"

cat > "$TMP/edt_handler.tsx" << 'UIEOF_X'
  const isParent = authorRole.toLowerCase().includes('parent');
  // Import d'une image de signature : réservé à l'administration (jamais proposé aux parents)
  const isAdminAuthor = authorRole.toLowerCase().includes('administration');
  const handleAdminSignatureUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || !isAdminAuthor) return;
    setSignatureUploadError('');
    const problem = validateSignatureFile(file);
    if (problem) {
      setSignatureUploadError(problem);
      return;
    }
    try {
      const dataUrl = await signatureFileToDataUrl(file);
      setFormData((prev) => ({
        ...prev,
        signature: {
          ...prev.signature,
          signatureDataUrl: dataUrl,
          signedByName: prev.legalGuardian.fullName || authorName,
          signedDate: new Date().toISOString().substring(0, 10),
          method: 'uploaded',
          uploadedBy: authorName,
        },
      }));
    } catch (err) {
      setSignatureUploadError(
        "Impossible d'utiliser cette image (illisible ou sans signature visible). Essayez un autre fichier PNG ou JPEG."
      );
    }
  };
UIEOF_X
replace_once "$EDT" "  const isParent = authorRole.toLowerCase().includes('parent');" "$(cat "$TMP/edt_handler.tsx")"

cat > "$TMP/edt_old.tsx" << 'UIEOF_X'
                      signedDate: new Date().toISOString().substring(0, 10),
                    },
                  }));
                }}
              />
            </div>
UIEOF_X
cat > "$TMP/edt_new.tsx" << 'UIEOF_X'
                      signedDate: new Date().toISOString().substring(0, 10),
                      method: 'drawn',
                      uploadedBy: undefined,
                    },
                  }));
                }}
              />

              {/* Import d'une image de signature — réservé à l'administration */}
              {isAdminAuthor && (
                <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg space-y-2" data-testid="admin-signature-upload">
                  <div className="flex items-center gap-2 text-xs font-bold text-purple-900">
                    <Upload className="w-4 h-4" />
                    Importer une signature (réservé à l'administration)
                  </div>
                  <p className="text-[11px] text-purple-800 leading-relaxed">
                    Importez une image (PNG, JPEG ou WebP, 5 Mo maximum) de la signature du responsable légal, par exemple une signature scannée
                    sur un document papier. Elle remplace la signature tracée. Pensez à cocher l'attestation ci-dessus : elle vaut pour le
                    responsable légal dont vous détenez la signature.
                  </p>
                  <label className="inline-flex items-center gap-1.5 text-xs font-semibold bg-white hover:bg-purple-100 text-purple-900 border border-purple-300 px-3 py-1.5 rounded-lg cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    Choisir une image…
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      onChange={handleAdminSignatureUpload}
                      data-testid="admin-signature-input"
                    />
                  </label>
                  {signatureUploadError && (
                    <p className="text-[11px] font-semibold text-red-700" role="alert">
                      {signatureUploadError}
                    </p>
                  )}
                  {formData.signature.method === 'uploaded' && formData.signature.signatureDataUrl && (
                    <p className="text-[11px] font-semibold text-emerald-800">
                      ✓ Signature importée par {formData.signature.uploadedBy || 'l\'administration'}
                    </p>
                  )}
                </div>
              )}
            </div>
UIEOF_X
replace_once "$EDT" "$(cat "$TMP/edt_old.tsx")" "$(cat "$TMP/edt_new.tsx")"

# Historique : trace de l'import (qui, quand)
replace_once "$EDT" "      details: modificationNote.trim() || 'Modifications enregistrées'," "      details:
        (modificationNote.trim() || 'Modifications enregistrées') +
        (formData.signature.method === 'uploaded' &&
        formData.signature.signatureDataUrl !== student.cerfa.signature.signatureDataUrl
          ? \` — Signature importée par l'administration (\${authorName})\`
          : ''),"

# --- 7. Vue officielle et PDF : mention "signature importee" -------------------
echo ">>> Patch de src/components/CerfaOfficialView.tsx ..."
cat > "$TMP/ofv_old.tsx" << 'UIEOF_X'
                  <img
                    src={cerfa.signature.signatureDataUrl}
                    alt="Signature"
                    className="max-h-16 object-contain"
                  />
UIEOF_X
cat > "$TMP/ofv_new.tsx" << 'UIEOF_X'
                  <>
                    <img
                      src={cerfa.signature.signatureDataUrl}
                      alt="Signature"
                      className="max-h-16 object-contain"
                    />
                    {cerfa.signature.method === 'uploaded' && (
                      <span className="text-[9px] text-slate-500 italic mt-1">
                        Signature importée par l'administration
                      </span>
                    )}
                  </>
UIEOF_X
replace_once "$OFV" "$(cat "$TMP/ofv_old.tsx")" "$(cat "$TMP/ofv_new.tsx")"

echo ">>> Patch de src/utils/pdfGenerator.ts ..."
replace_once "$PDF" "doc.text('Signature électronique :', signBoxX + 1.5, signBoxY + 2.5);" "doc.text(
      cerfa.signature?.method === 'uploaded' ? 'Signature importée (admin) :' : 'Signature électronique :',
      signBoxX + 1.5,
      signBoxY + 2.5
    );"

# --- 8. Reconstruction ------------------------------------------------------
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
  echo "!!! Pour revenir en arriere : cp -a $BACKUP_DIR/src $APP_DIR/ && rm -f $APP_DIR/src/utils/signatureImage.ts"
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
 - Administration : rubrique 5 de la fiche > "Importer une signature" (PNG / JPEG / WebP).
 - Vue d'ensemble : plus de barre de defilement horizontale (cartes sous 1024 px).
 Retour arriere possible : copie dans $BACKUP_DIR
 IMPORTANT : videz le cache du navigateur (Ctrl+F5).
 Console navigateur : "[fichesanitaire] build ui-signature-20261001"
============================================================
MSG
