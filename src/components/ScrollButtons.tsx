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
