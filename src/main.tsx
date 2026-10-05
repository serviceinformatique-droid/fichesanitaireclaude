import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { bootstrapFromServer } from './utils/storage';
import { AnonymousPopups } from './components/AnonymousPopups';

async function start() {
  // Un visiteur arrivant via un lien direct à jeton (?ficheToken=...) ne doit
  // jamais recevoir la synchronisation complète de la base (tous les élèves).
  const isMagicLinkAccess = new URLSearchParams(window.location.search).has('ficheToken');
  if (!isMagicLinkAccess) {
    await bootstrapFromServer();
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
      {isMagicLinkAccess && <AnonymousPopups />}
    </StrictMode>,
  );
}

start();
