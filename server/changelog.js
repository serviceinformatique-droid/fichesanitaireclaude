'use strict';
// ============================================================================
// Journal des mises à jour (build changelog-20261007)
//  - GET /api/changelog : liste des mises à jour (server/changelog.json). Cette route n'est PAS dans la liste des routes
//    ouvertes de server/auth.js : le serveur la refuse donc à tout autre rôle que l'administration (401 sans compte).
//  - notify() : au démarrage, la cloche de l'administration reçoit une notification pour chaque mise à jour installée
//    depuis la dernière fois (une seule notification de présentation lors de la première mise en service).
// Pour ajouter une mise à jour : ajouter une entrée à la fin de server/changelog.json puis redémarrer l'application.
// ============================================================================
const fs = require('fs');
const path = require('path');

console.log('[fichesanitaire] build changelog-20261007');

const FILE = path.join(__dirname, 'changelog.json');
const K_NOTIFS = 'cerfa_notifications_v1';
const K_SEEN = 'cerfa_changelog_notified_v1'; // clé privée : jamais renvoyée par /api/data (liste blanche de auth.js)

function readEntries() {
  try {
    const list = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(list) ? list.filter((e) => e && e.id && e.title) : [];
  } catch (e) {
    console.error('[changelog] Lecture impossible :', e.message);
    return [];
  }
}

function install(app, deps) {
  const { readKv, writeKv } = deps;

  app.get('/api/changelog', (req, res) => {
    res.json({ entries: readEntries() });
  });

  async function notify() {
    try {
      const entries = readEntries();
      if (!entries.length) return;
      const last = entries[entries.length - 1];
      const seen = await readKv(K_SEEN);
      if (seen === last.id) return;
      const idx = entries.findIndex((e) => e.id === seen);
      const stamp = new Date().toISOString(); // la cloche affiche la date avec toLocaleDateString : format ISO obligatoire
      const fresh =
        idx === -1
          ? [
              {
                id: 'upd-intro',
                title: 'Journal des mises à jour',
                message: `Toutes les mises à jour sont désormais listées dans Administration > Mises à jour (dernière : ${last.title}).`,
              },
            ]
          : entries.slice(idx + 1).map((e) => ({ id: 'upd-' + e.id, title: 'Mise à jour installée', message: `${e.title} — détails dans Administration > Mises à jour.` }));
      const list = (await readKv(K_NOTIFS)) || [];
      const have = new Set(list.map((n) => n && n.id));
      fresh.forEach((n) => {
        if (!have.has(n.id)) list.push({ id: n.id, targetRole: 'admin', title: n.title, message: n.message, date: stamp, read: false, type: 'info' });
      });
      // on ne garde que les 30 notifications de mise à jour les plus récentes (les autres notifications sont conservées)
      const upd = list.filter((n) => n && String(n.id).startsWith('upd-'));
      const drop = new Set(upd.slice(0, Math.max(0, upd.length - 30)).map((n) => n.id));
      await writeKv(K_NOTIFS, list.filter((n) => !drop.has(n && n.id)));
      await writeKv(K_SEEN, last.id);
      console.log(`[changelog] ${fresh.length} notification(s) de mise à jour envoyée(s) à l'administration (dernière : ${last.id}).`);
    } catch (e) {
      console.error('[changelog] Notification impossible :', e.message);
    }
  }

  return { notify };
}

module.exports = { install };
