import React from 'react';
import { AlertTriangle, Info, BellRing, X } from 'lucide-react';
import { PopupItem } from '../utils/messaging';

interface PopupModalProps {
  popups: PopupItem[];
  onAck: (popup: PopupItem) => void | Promise<void>;
}

const STYLES: Record<string, { box: string; head: string; btn: string; label: string }> = {
  info: {
    box: 'border-blue-300',
    head: 'bg-blue-900 text-white',
    btn: 'bg-blue-900 hover:bg-blue-950',
    label: 'Information',
  },
  important: {
    box: 'border-amber-400',
    head: 'bg-amber-500 text-slate-900',
    btn: 'bg-amber-600 hover:bg-amber-700',
    label: 'Important',
  },
  urgent: {
    box: 'border-red-500',
    head: 'bg-red-600 text-white',
    btn: 'bg-red-600 hover:bg-red-700',
    label: 'URGENT',
  },
};

// Affiche, par-dessus tout le reste, le premier message de la file. Impossible à ignorer :
// il se ferme uniquement avec le bouton (qui l'enregistre comme lu).
export const PopupModal: React.FC<PopupModalProps> = ({ popups, onAck }) => {
  if (popups.length === 0) return null;
  const popup = popups[0];
  const s = STYLES[popup.level] || STYLES.info;
  const Icon = popup.level === 'info' ? Info : popup.level === 'urgent' ? AlertTriangle : BellRing;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="popup-title"
      data-testid="popup-modal"
    >
      <div className={`bg-white w-full max-w-lg rounded-2xl shadow-2xl border-4 ${s.box} overflow-hidden`}>
        <div className={`${s.head} px-5 py-3 flex items-center gap-2.5`}>
          <Icon className="w-5 h-5 shrink-0" />
          <span className="text-xs font-bold uppercase tracking-wide">{s.label}</span>
          {popups.length > 1 && (
            <span className="ml-auto text-[11px] font-semibold opacity-90">
              Message 1 sur {popups.length}
            </span>
          )}
        </div>
        <div className="p-5 space-y-3">
          <h2 id="popup-title" className="text-lg font-bold text-slate-900 leading-snug">
            {popup.title}
          </h2>
          <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed max-h-[50vh] overflow-y-auto">
            {popup.body}
          </p>
        </div>
        <div className="px-5 pb-5 flex justify-end">
          <button
            type="button"
            onClick={() => onAck(popup)}
            className={`${s.btn} text-white font-semibold text-sm px-5 py-2.5 rounded-lg shadow-xs cursor-pointer inline-flex items-center gap-2`}
            autoFocus
          >
            {popup.requireAck ? (
              "J'ai lu et compris"
            ) : (
              <>
                <X className="w-4 h-4" /> Fermer
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
