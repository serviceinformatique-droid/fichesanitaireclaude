#!/bin/bash
# ============================================================================
# patch-fleches.sh  -  build scroll-arrows-20261006
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# FLECHES DE DEFILEMENT : une fleche vers le BAS pour aller tout en bas de la page et une
# fleche vers le HAUT pour revenir tout en haut, sans faire defiler a la main.
#  - boutons ronds bleus en bas a droite de TOUTES les pages (parents, administration,
#    accompagnateurs, fiche, lien direct) ;
#  - la fleche du haut apparait quand on est descendu, celle du bas tant qu'il reste de la
#    page a parcourir ; aucune fleche sur une page courte ;
#  - defilement doux (immediat si l'appareil demande moins de mouvement) ;
#  - fonctionne dans un iframe ; jamais imprimees ; ne gênent pas le bouton Messagerie.
#
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/patch-fleches.sh && /root/patch-fleches.sh
# ============================================================================
set -e

APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"
BUILD="scroll-arrows-20261006"
BACKUP_DIR="$APP_DIR/backup-avant-$BUILD"
FILES="src/main.tsx"
NEWFILES="src/components/ScrollButtons.tsx"
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

MAIN="$APP_DIR/src/main.tsx"

m=0
grep -q "ScrollButtons" "$MAIN" && m=$((m+1))
for f in $NEWFILES; do [ -f "$APP_DIR/$f" ] && m=$((m+1)); done
if [ "$m" -eq 2 ]; then
  echo ">>> Patch deja applique. Rien a faire."
  exit 0
elif [ "$m" -gt 0 ]; then
  echo "ERREUR : etat partiel detecte ($m/2 elements deja en place)."
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

# --- 2. Composant -----------------------------------------------------------
echo ">>> Creation de src/components/ScrollButtons.tsx ..."
cat > "$APP_DIR/src/components/ScrollButtons.tsx" << 'SCREOF_X'
import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';

console.log('[fichesanitaire] build scroll-arrows-20261006');

// Flèches flottantes « aller tout en haut » / « aller tout en bas » : plus besoin de faire défiler à la main
// de longues pages (suivi global, fiche, relevé…). Elles n'apparaissent que si la page est assez longue, la flèche
// du haut seulement quand on est descendu, celle du bas seulement s'il reste du chemin. Elles fonctionnent aussi
// quand le portail est affiché dans un iframe, et ne s'impriment pas.
const THRESHOLD = 240; // pixels de défilement avant d'afficher une flèche

export const ScrollButtons: React.FC = () => {
  const [showUp, setShowUp] = useState(false);
  const [showDown, setShowDown] = useState(false);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const measure = () => {
      frame.current = null;
      const doc = document.documentElement;
      const top = window.scrollY || doc.scrollTop || 0;
      const max = Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0) - window.innerHeight;
      setShowUp(top > THRESHOLD);
      setShowDown(max - top > THRESHOLD);
    };
    const schedule = () => {
      if (frame.current === null) frame.current = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    // la hauteur de la page change (nouvel onglet, fiche ouverte, liste qui s'allonge) sans que la fenêtre ne bouge
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(schedule);
      observer.observe(document.body);
    }
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (observer) observer.disconnect();
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    };
  }, []);

  const go = (toBottom: boolean) => {
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const top = toBottom ? Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) : 0;
    window.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' });
  };

  if (!showUp && !showDown) return null;

  const base =
    'w-12 h-12 rounded-full bg-blue-900 hover:bg-blue-950 text-white shadow-xl ring-2 ring-white/80 inline-flex items-center justify-center cursor-pointer focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-400';

  return (
    <div
      className="fixed right-4 z-30 flex flex-col gap-3 print:hidden"
      style={{ bottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}
      data-testid="scroll-buttons"
    >
      {showUp && (
        <button type="button" onClick={() => go(false)} className={base} aria-label="Aller tout en haut de la page" title="Tout en haut" data-testid="scroll-up">
          <ArrowUp className="w-6 h-6" strokeWidth={2.75} />
        </button>
      )}
      {showDown && (
        <button type="button" onClick={() => go(true)} className={base} aria-label="Aller tout en bas de la page" title="Tout en bas" data-testid="scroll-down">
          <ArrowDown className="w-6 h-6" strokeWidth={2.75} />
        </button>
      )}
    </div>
  );
};
SCREOF_X

# --- 3. Montage dans l'application ------------------------------------------------
echo ">>> Modification de src/main.tsx ..."
cat > "$TMP/e1_old.txt" << 'SCREOF_X'
import App from './App.tsx';
SCREOF_X
cat > "$TMP/e1_new.txt" << 'SCREOF_X'
import App from './App.tsx';
import { ScrollButtons } from './components/ScrollButtons';
SCREOF_X
replace_once "$MAIN" "$(cat "$TMP/e1_old.txt")" "$(cat "$TMP/e1_new.txt")"

cat > "$TMP/e2_old.txt" << 'SCREOF_X'
      <App />
SCREOF_X
cat > "$TMP/e2_new.txt" << 'SCREOF_X'
      <App />
      <ScrollButtons />
SCREOF_X
replace_once "$MAIN" "$(cat "$TMP/e2_old.txt")" "$(cat "$TMP/e2_new.txt")"

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
  echo "!!! Pour revenir en arriere : cp -a $BACKUP_DIR/src $APP_DIR/ && rm -f $APP_DIR/src/components/ScrollButtons.tsx"
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
 - Fleches rondes "haut" / "bas" en bas a droite de chaque page.
 Retour arriere possible : copie dans $BACKUP_DIR
 IMPORTANT : videz le cache du navigateur (Ctrl+F5).
 Console navigateur : "[fichesanitaire] build scroll-arrows-20261006"
============================================================
MSG
