#!/bin/bash
# ============================================================================
# patch-brouillon.sh  -  build draft-watermark-20261001
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# Une fiche NON finalisee (pas de signature electronique / champs manquants)
# ne peut plus passer pour une vraie fiche :
#  - Filigrane "BROUILLON - NON SIGNEE - NON VALABLE" sur l'apercu, l'impression
#    et le PDF telecharge (fichier nomme BROUILLON_CERFA_...pdf).
#  - Bandeau rouge (non imprime) qui liste ce qu'il manque, precise qu'UNE SEULE
#    signature d'UN SEUL responsable legal suffit, et propose le bouton
#    "Aller a la signature" (ou "Completer la fiche").
#  - Badge "Brouillon - incomplete" plus explicite.
#
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/patch-brouillon.sh && /root/patch-brouillon.sh
# ============================================================================
set -e

APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"
BUILD="draft-watermark-20261001"
BACKUP_DIR="$APP_DIR/backup-avant-$BUILD"
FILES="src/components/CerfaOfficialView.tsx src/App.tsx"
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

OV="$APP_DIR/src/components/CerfaOfficialView.tsx"
APPF="$APP_DIR/src/App.tsx"

m=0
grep -q "draft-watermark" "$OV" && m=$((m+1))
grep -q "if (section) setEditorInitialSection(section);" "$APPF" && m=$((m+1))
if [ "$m" -eq 2 ]; then
  echo ">>> Patch deja applique. Rien a faire."
  exit 0
elif [ "$m" -gt 0 ]; then
  echo "ERREUR : etat partiel detecte ($m/2 fichiers deja modifies)."
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

# --- 2. CerfaOfficialView.tsx -----------------------------------------------
echo ">>> Patch de src/components/CerfaOfficialView.tsx ..."

replace_once "$OV" \
  "import { formatDateFr, formatDateTimeFr } from '../utils/cerfaValidation';" \
  "import {
  formatDateFr,
  formatDateTimeFr,
  computeCerfaCompleteness,
  getFirstIncompleteSectionId,
  FormSectionId,
} from '../utils/cerfaValidation';"

replace_once "$OV" \
  "interface CerfaOfficialViewProps {" \
  "console.log('[fichesanitaire] build draft-watermark-20261001');

interface CerfaOfficialViewProps {"

replace_once "$OV" \
  "  onEdit?: () => void;" \
  "  onEdit?: (section?: FormSectionId) => void;"

replace_once "$OV" \
  "  const isSigned = Boolean(cerfa.signature.signatureDataUrl && cerfa.signature.signedByName);" \
  "  const isSigned = Boolean(cerfa.signature.signatureDataUrl && cerfa.signature.signedByName);

  // Une fiche est un BROUILLON tant qu'elle n'est pas finalisee (signature electronique
  // + declaration + champs obligatoires). Le PDF/l'impression ne doivent alors jamais
  // pouvoir passer pour une fiche valable.
  const completeness = computeCerfaCompleteness(cerfa);
  const isDraft = student.status !== 'complete' && !completeness.isComplete;
  const targetSection = getFirstIncompleteSectionId(cerfa);"

replace_once "$OV" \
  'filename: `CERFA_Fiche_Sanitaire_${sanitizedName}.pdf`,' \
  'filename: `${isDraft ? '"'"'BROUILLON_'"'"' : '"'"''"'"'}CERFA_Fiche_Sanitaire_${sanitizedName}.pdf`,'

replace_once "$OV" \
  '`⚠ Incomplète (${student.completenessPercent}%)`' \
  '`⚠ Brouillon – incomplète (${student.completenessPercent}%)`'

replace_once "$OV" \
  "onClick={onEdit}" \
  "onClick={() => onEdit?.()}"

cat > "$TMP/banner.tsx" << 'BANNER_EOF'
      {isDraft && (
        <div
          className="mb-4 p-4 bg-red-50 border-2 border-red-400 rounded-xl text-red-900 text-sm flex items-start gap-3 print:hidden"
          role="alert"
          data-testid="draft-banner"
        >
          <AlertTriangle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="font-bold">
              Cette fiche n'est PAS finalisée : le PDF téléchargé ou imprimé porte la mention « BROUILLON – NON SIGNÉE » et n'est pas valable en l'état.
            </p>
            {completeness.missingFields.length > 0 && (
              <div>
                <p className="font-semibold">Il manque encore :</p>
                <ul className="list-disc pl-5 space-y-0.5">
                  {completeness.missingFields.slice(0, 8).map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                  {completeness.missingFields.length > 8 && (
                    <li>… et {completeness.missingFields.length - 8} autre(s) point(s)</li>
                  )}
                </ul>
              </div>
            )}
            <p className="text-xs text-red-800">
              Une seule fiche par élève et la signature électronique d'un seul responsable légal suffisent : il n'y a pas de seconde signature à apporter.
            </p>
            {canEdit && onEdit && (
              <button
                onClick={() => onEdit(targetSection)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white px-3.5 py-2 rounded-lg shadow-xs transition-colors cursor-pointer"
              >
                <Edit3 className="w-4 h-4" />
                {targetSection === 'signature' ? 'Aller à la signature' : 'Compléter la fiche'}
              </button>
            )}
          </div>
        </div>
      )}

BANNER_EOF

replace_once "$OV" \
  "      {/* Official CERFA Document Sheet */}" \
  "$(cat "$TMP/banner.tsx")
      {/* Official CERFA Document Sheet */}"

cat > "$TMP/watermark.tsx" << 'WM_EOF'
<div ref={documentRef} className="relative print-full-page bg-white border-2 border-slate-800 p-6 sm:p-8 rounded-none shadow-sm print:border-0 print:p-2 print:shadow-none font-sans text-slate-900 w-full">
        {isDraft && (
          <div
            aria-hidden="true"
            data-testid="draft-watermark"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              pointerEvents: 'none',
              zIndex: 20,
            }}
          >
            <div
              style={{
                transform: 'rotate(-28deg)',
                textAlign: 'center',
                color: 'rgba(220, 38, 38, 0.22)',
                fontWeight: 900,
                lineHeight: 1.05,
                border: '6px solid rgba(220, 38, 38, 0.22)',
                borderRadius: 16,
                padding: '12px 28px',
                whiteSpace: 'nowrap',
              }}
            >
              <div style={{ fontSize: 'clamp(40px, 9vw, 96px)' }}>BROUILLON</div>
              <div style={{ fontSize: 'clamp(18px, 4vw, 44px)' }}>NON SIGNÉE – NON VALABLE</div>
            </div>
          </div>
        )}
WM_EOF

replace_once "$OV" \
  '<div ref={documentRef} className="print-full-page bg-white border-2 border-slate-800 p-6 sm:p-8 rounded-none shadow-sm print:border-0 print:p-2 print:shadow-none font-sans text-slate-900 w-full">' \
  "$(cat "$TMP/watermark.tsx")"

# --- 3. App.tsx : ouvre l'editeur directement sur la bonne rubrique ----------
echo ">>> Patch de src/App.tsx ..."
replace_once "$APPF" \
  "            onEdit={() => {
              if (currentUser.role !== 'organizer') {
                setActiveTab('cerfa_edit');
              }
            }}" \
  "            onEdit={(section) => {
              if (currentUser.role !== 'organizer') {
                if (section) setEditorInitialSection(section);
                setActiveTab('cerfa_edit');
              }
            }}"

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
 - Fiche non finalisee : filigrane BROUILLON sur apercu / impression / PDF
 - Bandeau rouge avec la liste des points manquants + bouton
   "Aller a la signature"
 Retour arriere possible : copie dans $BACKUP_DIR
 IMPORTANT : videz le cache du navigateur (Ctrl+F5).
 Console navigateur : "[fichesanitaire] build draft-watermark-20261001"
============================================================
MSG
