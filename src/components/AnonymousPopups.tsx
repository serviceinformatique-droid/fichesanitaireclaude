import React, { useEffect, useState } from 'react';
import { PopupModal } from './PopupModal';
import { COMM_POLL_MS, fetchPublicPopups, PopupItem } from '../utils/messaging';

const SEEN_KEY = 'fiche_popups_seen_v1';

function readSeen(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
  } catch {
    return [];
  }
}

// Popups « tous les parents » pour les personnes qui arrivent par un lien direct (sans compte).
// La lecture est mémorisée sur l'appareil.
export const AnonymousPopups: React.FC = () => {
  const [popups, setPopups] = useState<PopupItem[]>([]);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetchPublicPopups();
        if (stop) return;
        const seen = readSeen();
        setPopups(r.popups.filter((p) => !seen.includes(p.id)));
      } catch {
        /* serveur injoignable : on réessaiera */
      }
    };
    tick();
    const timer = setInterval(tick, COMM_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stop = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const handleAck = (popup: PopupItem) => {
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify([...readSeen(), popup.id].slice(-200)));
    } catch {
      /* stockage indisponible */
    }
    setPopups((prev) => prev.filter((p) => p.id !== popup.id));
  };

  return <PopupModal popups={popups} onAck={handleAck} />;
};
