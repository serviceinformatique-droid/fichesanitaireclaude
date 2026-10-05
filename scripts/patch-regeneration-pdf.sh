#!/bin/bash
# ============================================================================
# patch-regeneration-pdf.sh  -  build pdf-regeneration-20261005
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# CORRIGE : les PDF DEJA archives dans /opt/fichesanitaire-voyages/fiches-pdf/ affichent encore
# l'ancien nom d'etablissement ("College & Lycee Jean Moulin"). Un PDF n'est regenere que
# lorsqu'une fiche COMPLETE est enregistree a nouveau.
#
# AJOUTE : dans l'espace administration, onglet "Etablissement scolaire", un bouton
# "Regenerer les PDF de toutes les fiches completes" :
#  - genere le PDF de chaque fiche complete avec le nom d'etablissement ENREGISTRE et
#    remplace le fichier du serveur (fiches-pdf/<Classe>/<NOM_Prenom>.pdf) ;
#  - cree aussi le PDF des fiches completes qui n'en avaient pas (completes avant le 01/10) ;
#  - barre de progression, bouton Arreter, liste des echecs, relancable a volonte ;
#  - AUCUNE fiche n'est modifiee (le serveur ne reecrit pas la liste des eleves ; la date
#    d'archivage n'est posee que si elle manquait).
#
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/patch-regeneration-pdf.sh && /root/patch-regeneration-pdf.sh
# ============================================================================
set -e

APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"
BUILD="pdf-regeneration-20261005"
BACKUP_DIR="$APP_DIR/backup-avant-$BUILD"
FILES="server/index.js src/components/AdminSpace.tsx"
NEWFILES="src/components/PdfRegenerator.tsx"
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

SRV="$APP_DIR/server/index.js"
ADM="$APP_DIR/src/components/AdminSpace.tsx"

grep -q "archiveStudentPdf" "$SRV" || { echo "ERREUR : l'archivage des PDF sur le serveur (patch-pdf-archive) n'est pas installe : appliquez-le d'abord."; exit 1; }

m=0
grep -q "req.body.regenerate === true" "$SRV" && m=$((m+1))
grep -q "PdfRegenerator" "$ADM" && m=$((m+1))
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

# --- 2. Composant ---------------------------------------------------------------
echo ">>> Creation de src/components/PdfRegenerator.tsx ..."
cat > "$APP_DIR/src/components/PdfRegenerator.tsx" << 'PRGEOF_X'
import React, { useRef, useState } from 'react';
import { FileText, Loader2, CheckCircle2, AlertTriangle, Square } from 'lucide-react';
import { Student, Trip } from '../types';
import { generateCerfaPdf } from '../utils/pdfGenerator';

console.log('[fichesanitaire] build pdf-regeneration-20261005');

interface PdfRegeneratorProps {
  students: Student[];
  trips: Trip[];
  establishmentName: string;
}

// Régénère le PDF archivé (fiches-pdf/<Classe>/<NOM_Prenom>.pdf) de TOUTES les fiches complètes
// avec le nom d'établissement enregistré. Les PDF déjà archivés gardent sinon l'ancien nom.
// Aucune fiche n'est modifiée : seul le fichier PDF du serveur est remplacé.
export const PdfRegenerator: React.FC<PdfRegeneratorProps> = ({ students, trips, establishmentName }) => {
  const targets = students.filter((s) => s && !(s as any).deletedAt && s.status === 'complete');
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const [current, setCurrent] = useState('');
  const [finished, setFinished] = useState<null | { ok: number; stopped: boolean }>(null);
  const stopRef = useRef(false);

  const labelOf = (s: Student) => `${s.cerfa?.identity?.lastName || ''} ${s.cerfa?.identity?.firstName || ''}`.trim() || s.id;

  const run = async () => {
    if (running || targets.length === 0) return;
    if (
      !window.confirm(
        `Régénérer les PDF archivés de ${targets.length} fiche${targets.length > 1 ? 's' : ''} complète${targets.length > 1 ? 's' : ''} avec le nom « ${establishmentName} » ?\n\nLes anciens fichiers du serveur seront remplacés. Ne fermez pas cette page pendant l'opération.`
      )
    )
      return;
    stopRef.current = false;
    setRunning(true);
    setFinished(null);
    setFailed([]);
    setDone(0);
    let ok = 0;
    const errs: string[] = [];
    for (let i = 0; i < targets.length; i++) {
      if (stopRef.current) break;
      const s = targets[i];
      setCurrent(labelOf(s));
      try {
        const base64 = await generateCerfaPdf(s, trips, establishmentName, true);
        if (typeof base64 !== 'string' || !base64) throw new Error('génération impossible');
        const res = await fetch('/api/students/send-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentId: s.id,
            pdfBase64: base64,
            studentName: labelOf(s),
            schoolClass: s.schoolClass,
            regenerate: true,
          }),
        });
        if (!res.ok) throw new Error('serveur ' + res.status);
        ok += 1;
      } catch (e) {
        errs.push(labelOf(s));
      }
      setDone(i + 1);
      setFailed([...errs]);
      await new Promise((r) => setTimeout(r, 20)); // laisse respirer le navigateur
    }
    setRunning(false);
    setCurrent('');
    setFinished({ ok, stopped: stopRef.current });
  };

  return (
    <div className="mt-8 pt-6 border-t border-slate-200" data-testid="pdf-regenerator">
      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2 inline-flex items-center gap-2">
        <FileText className="w-4 h-4 text-blue-900" />
        PDF archivés sur le serveur
      </h4>
      <p className="text-xs text-slate-600 leading-relaxed max-w-2xl">
        Les PDF déjà archivés (dossier <code className="bg-slate-100 px-1 rounded">fiches-pdf/</code>) gardent l'ancien nom d'établissement
        tant que la fiche n'est pas enregistrée à nouveau. Ce bouton régénère d'un coup le PDF des{' '}
        <strong>{targets.length} fiche{targets.length > 1 ? 's' : ''} complète{targets.length > 1 ? 's' : ''}</strong> avec le nom
        « <strong>{establishmentName}</strong> ». Il crée aussi les PDF des fiches complètes qui n'en avaient pas. Aucune fiche n'est modifiée.
      </p>
      <div className="flex flex-wrap items-center gap-3 mt-3">
        <button
          type="button"
          onClick={run}
          disabled={running || targets.length === 0}
          className="inline-flex items-center gap-2 bg-blue-900 hover:bg-blue-950 disabled:opacity-40 text-white font-semibold text-xs px-4 py-2.5 rounded-xl cursor-pointer"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
          Régénérer les PDF de toutes les fiches complètes
        </button>
        {running && (
          <button
            type="button"
            onClick={() => {
              stopRef.current = true;
            }}
            className="inline-flex items-center gap-1.5 border border-red-300 text-red-700 hover:bg-red-50 font-semibold text-xs px-3 py-2 rounded-xl cursor-pointer"
          >
            <Square className="w-3.5 h-3.5" /> Arrêter
          </button>
        )}
      </div>
      {(running || finished) && (
        <div className="mt-3 max-w-xl space-y-2" role="status" data-testid="pdf-regenerator-status">
          <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full bg-blue-900 transition-all" style={{ width: `${targets.length ? Math.round((done / targets.length) * 100) : 0}%` }} />
          </div>
          <p className="text-xs text-slate-700">
            {done} / {targets.length}
            {running && current ? ` — ${current}` : ''}
          </p>
          {finished && (
            <p className={`text-xs font-semibold ${failed.length ? 'text-amber-700' : 'text-emerald-700'}`}>
              {failed.length ? <AlertTriangle className="w-3.5 h-3.5 inline" /> : <CheckCircle2 className="w-3.5 h-3.5 inline" />}{' '}
              {finished.ok} PDF régénéré{finished.ok > 1 ? 's' : ''}
              {finished.stopped ? ' (arrêté avant la fin)' : ''}
              {failed.length ? `, ${failed.length} échec${failed.length > 1 ? 's' : ''}` : ''}.
            </p>
          )}
          {failed.length > 0 && <p className="text-[11px] text-amber-800">Échecs : {failed.join(', ')}. Relancez le bouton pour les réessayer.</p>}
        </div>
      )}
    </div>
  );
};
PRGEOF_X

# --- 3. Serveur : remplacement du fichier sans reecrire la fiche ----------------
echo ">>> Patch de server/index.js ..."
cat > "$TMP/srv_old.txt" << 'PRGEOF_X'
    // Enregistre la date d'archivage sur CET élève uniquement (relecture juste avant écriture)
PRGEOF_X
cat > "$TMP/srv_new.txt" << 'PRGEOF_X'
    // Régénération en masse (onglet Établissement) : le fichier est remplacé, la fiche N'EST PAS réécrite
    // (la date d'archivage n'est posée que si elle manquait : fiche complète d'avant l'archivage serveur)
    if (req.body && req.body.regenerate === true && stored && stored.pdfSentAt) {
      return res.json({ ok: true, sentAt: stored.pdfSentAt, path: rel, regenerated: true });
    }

    // Enregistre la date d'archivage sur CET élève uniquement (relecture juste avant écriture)
PRGEOF_X
replace_once "$SRV" "$(cat "$TMP/srv_old.txt")" "$(cat "$TMP/srv_new.txt")"

# --- 4. Administration : bouton dans l'onglet Etablissement scolaire ---------------
echo ">>> Patch de src/components/AdminSpace.tsx ..."
cat > "$TMP/a1_old.txt" << 'PRGEOF_X'
import { openOrDownloadDocument } from '../utils/documentViewer';
PRGEOF_X
cat > "$TMP/a1_new.txt" << 'PRGEOF_X'
import { openOrDownloadDocument } from '../utils/documentViewer';
import { PdfRegenerator } from './PdfRegenerator';
PRGEOF_X
replace_once "$ADM" "$(cat "$TMP/a1_old.txt")" "$(cat "$TMP/a1_new.txt")"
cat > "$TMP/a2_old.txt" << 'PRGEOF_X'
            </form>

            {/* Live Visual Preview */}
PRGEOF_X
cat > "$TMP/a2_new.txt" << 'PRGEOF_X'
            </form>

            {/* PDF archivés : régénération en masse avec le nom enregistré (build pdf-regeneration-20261005) */}
            <PdfRegenerator students={students} trips={trips} establishmentName={establishmentName} />

            {/* Live Visual Preview */}
PRGEOF_X
replace_once "$ADM" "$(cat "$TMP/a2_old.txt")" "$(cat "$TMP/a2_new.txt")"
cat > "$TMP/a3_old.txt" << 'PRGEOF_X'
Met à jour le champ établissement de tous les dossiers élèves déjà présents dans l'application pour que tous les exports PDF soient uniformes.
PRGEOF_X
cat > "$TMP/a3_new.txt" << 'PRGEOF_X'
Le nom enregistré est utilisé partout (fiches, pied de page, nouveaux PDF, liste des inscrits). Pour corriger les PDF déjà archivés sur le serveur, utilisez le bouton « Régénérer les PDF » plus bas.
PRGEOF_X
replace_once "$ADM" "$(cat "$TMP/a3_old.txt")" "$(cat "$TMP/a3_new.txt")"

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
  echo "!!! Pour revenir en arriere : cp -a $BACKUP_DIR/server $BACKUP_DIR/src $APP_DIR/ && rm -f $APP_DIR/src/components/PdfRegenerator.tsx"
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
 - Administration > "Etablissement scolaire" > "PDF archives sur le serveur" :
   bouton "Regenerer les PDF de toutes les fiches completes".
 - A lancer UNE fois apres chaque changement du nom de l'etablissement.
 Retour arriere possible : copie dans $BACKUP_DIR
 IMPORTANT : videz le cache du navigateur (Ctrl+F5).
 Console navigateur : "[fichesanitaire] build pdf-regeneration-20261005"
============================================================
MSG
