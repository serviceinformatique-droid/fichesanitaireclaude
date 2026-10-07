import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ScrollButtons } from './components/ScrollButtons';
import './index.css';
import { bootstrapFromServer } from './utils/storage';
import { installAuthFetch, validateStoredSession, setMagicToken } from './utils/auth';
import { AnonymousPopups } from './components/AnonymousPopups';

async function start() {
  // Un visiteur arrivant via un lien direct à jeton (?ficheToken=...) ne doit
  // jamais recevoir la synchronisation complète de la base (tous les élèves).
  const isMagicLinkAccess = new URLSearchParams(window.location.search).has('ficheToken');
  installAuthFetch(); // joint le jeton de session à chaque requête /api (build auth-20261006)
  if (isMagicLinkAccess) setMagicToken(new URLSearchParams(window.location.search).get('ficheToken'));
  if (!isMagicLinkAccess) {
    await validateStoredSession();
    await bootstrapFromServer();
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
      <ScrollButtons />
      {isMagicLinkAccess && <AnonymousPopups />}
    </StrictMode>,
  );
}

start();
