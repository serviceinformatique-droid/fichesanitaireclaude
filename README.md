# Portail Fiche Sanitaire de Liaison — Voyages Scolaires

**Ensemble Scolaire Notre Dame des Missions** — dématérialisation de la fiche sanitaire de liaison officielle (CERFA n°10008*02) pour les voyages et séjours scolaires. Application hébergée sur un LXC Proxmox (Debian 12, Docker), `https://fichesanitaire.ndmissions.fr`.

Ce document est **généré automatiquement** par `maj-portail.sh` (dans `/opt/readme/README.md`) à chaque mise à jour. Il est **auto-suffisant** : état réel de l'installation, documentation, toutes les commandes d'exploitation et **tous les scripts** (code source complet du projet tel qu'il est installé sur le serveur, correctifs, outils, script de mise à jour). Il est destiné à être **réinjecté tel quel dans une nouvelle conversation Claude** pour reprendre le projet sans aucun historique, ou à réinstaller l'application sur un LXC neuf.

> Document généré automatiquement par `maj-portail.sh` le 06/10/2026 (lot `2026-10-05-9d03cc33`). Ce dépôt est un **miroir** de l'installation du serveur : ne pas y modifier de fichiers à la main (ils seraient écrasés à la prochaine mise à jour). Le README complet (état du serveur + tous les scripts) est généré sur le serveur dans `/opt/readme/README.md` et n'est pas publié.

**Contenu du dépôt :** la racine contient le code de l'application (`server/`, `src/`, `Dockerfile`, `docker-compose.yml`…) ; `scripts/` contient les correctifs `patch-*.sh`, les outils (`rattacher-fiche.sh`, `restaurer-sauvegarde.sh`) et la logique de mise à jour (`maj-portail.head.sh`).

## 0. Conventions de travail avec Claude (à respecter dans toute nouvelle conversation)

- Répondre en **français**.
- Livrer des **scripts complets** (`cat`/`sh`), jamais des extraits ni des modifications manuelles ; indiquer **systématiquement le répertoire** où déposer le fichier avec **FileZilla** (ex. `/root/`) et la commande pour l'exécuter (`chmod +x … && …`).
- Livrer l'ensemble des fichiers/scripts d'un projet **dans une seule archive zip**.
- Tous les projets doivent pouvoir **fonctionner en iframe** (le serveur n'envoie volontairement aucun en-tête `X-Frame-Options` / `frame-ancestors`).
- Marqueurs de version : tag de build + `console.log('[fichesanitaire] build …')` pour vérifier le cache navigateur.
- **Push GitHub AUTOMATIQUE** : chaque `bash /root/maj-portail.sh --appliquer` (ou `--push`) met à jour le dépôt miroir `https://github.com/serviceinformatique-droid/fichesanitaireclaude` (code + scripts + documentation ; JAMAIS `.env`, PDF, sauvegardes ni donnée de santé). Le jeton GitHub est dans `/root/.github-token` (chmod 600), enregistré une fois par `bash /root/maj-portail.sh --github` ; il n'est JAMAIS écrit dans un script, un README, l'URL du dépôt ni la configuration git. **Ne jamais coller un jeton dans une conversation** (le révoquer immédiatement si c'est arrivé). Le dépôt est un miroir : ne pas y modifier de fichiers à la main.
- Les scripts de correctif suivent un modèle sûr : sauvegarde `backup-avant-<build>/`, détection d'état partiel, **restauration automatique en cas d'erreur**, idempotence (relance sans effet), reconstruction Docker puis test `/health`. `SKIP_BUILD=1` permet d'enchaîner plusieurs scripts avec une seule reconstruction à la fin.
- - Mises à jour du serveur : **un seul fichier `maj-portail.sh`** à déposer dans `/root/` avec FileZilla (mode binaire), lancé avec `bash /root/maj-portail.sh --etat | --outils | --appliquer`. Il régénère ce README dans `/opt/readme/`.
- Tester avant de livrer : compilation `tsc` + `vite build`, vrai serveur Node + PostgreSQL, vrai navigateur (Chromium headless) quand l'interface est concernée. **Docker n'est pas disponible dans l'environnement de test de Claude** : le premier `docker compose up --build` reste à vérifier sur le LXC.

## 1. Vue d'ensemble

- **Stack** : React 19 + Vite 6 + TypeScript + Tailwind CSS v4 (frontend) · Node.js/Express 4 (backend API + fichiers statiques) · PostgreSQL 16 (stockage clé/valeur JSONB) · Docker Compose (images `node:20-alpine`).
- **PDF** : génération vectorielle pure via `jsPDF` (fonction `generateCerfaPdf`) pour l'**archivage automatique sur le serveur**, et rendu `html2canvas-pro` (jamais `html2canvas` standard, incompatible avec `oklch()` de Tailwind v4) pour le téléchargement interactif depuis la fiche officielle.
- **Archivage des PDF** : chaque fiche complète est enregistrée sur le serveur dans `/opt/fichesanitaire-voyages/fiches-pdf/<Classe>/<NOM_Prenom>.pdf` (plus aucun envoi par e-mail).
- **Messagerie interne et popups** : bouton « Messagerie » en bas à gauche pour tous les comptes connectés ; l'administration écrit à un ou plusieurs parents et publie des popups visibles tout de suite (section 7bis).
- **Relances** : `node-cron`, relances hebdomadaires automatiques + relances manuelles individuelles ou en masse (seule fonctionnalité qui utilise encore le SMTP).
- **Sauvegarde** : extraction horaire automatique de toute la base vers un volume Docker dédié, en plus des sauvegardes Proxmox quotidiennes.
- **Chargement des données** : à l'ouverture, chaque navigateur télécharge TOUTE la base (`GET /api/data`) et la copie dans son stockage local, avec repli en mémoire si le quota (~5 Mo) est dépassé (voir 8quater).
- **Déploiement** : LXC Debian 12, répertoire `/opt/fichesanitaire-voyages/`, exposé en interne sur le port défini par `APP_PORT` (`8099` par défaut), reverse-proxy via Nginx Proxy Manager.

## 2. Architecture des fichiers

```
fichesanitaire-voyages/
├── Dockerfile                  # build multi-étage (Vite build -> Node 20 alpine runtime)
├── docker-compose.yml          # services db (postgres:16-alpine) + app (node) ; monte ./fiches-pdf
├── .env.example                # modèle de configuration (copier en .env)
├── .gitignore / .dockerignore  # fiches-pdf/, backup-avant-*/, .env* exclus (git ET image Docker)
├── package.json / package-lock.json / tsconfig.json / vite.config.ts / index.html
├── fiches-pdf/                 # (hors git) PDF archivés : <Classe>/<NOM_Prenom>.pdf
├── backup-avant-<build>/       # (hors git) copies de sécurité créées par chaque correctif
├── server/index.js             # API Express complète (section 6)
└── src/
    ├── main.tsx                 # point d'entrée ; détecte ?ficheToken= ; AnonymousPopups pour le lien direct
    ├── App.tsx                  # état global, handlers CRUD, CommunicationCenter, mémorisation de l'admin d'origine
    ├── types.ts / mockData.ts / index.css   # types ; données de DÉMONSTRATION (jamais ré-écrites vers le serveur) ; styles (tableau « Suivi global » sans défilement horizontal)
    ├── components/
    │   ├── StartupAuthGate.tsx   # connexion, inscription parent, mot de passe oublié
    │   ├── Header.tsx            # navigation ; sélecteur de comptes (admin) trié par groupes ; bouton « Revenir à <admin> »
    │   ├── LoginModal.tsx        # fenêtre « Sélection du profil » (liste triée)
    │   ├── ParentSpace.tsx       # espace famille, « Ajouter un enfant » (anti-doublons en direct)
    │   ├── OrganizerSpace.tsx / TripHealthListModal.tsx
    │   ├── AdminSpace.tsx        # administration (3600+ lignes) : Suivi global, Établissement, Voyages, Comptes & Rôles, Classes, Corbeille, Journal & RGPD
    │   ├── CerfaEditor.tsx       # formulaire CERFA en 5 rubriques ; pièces jointes (compression) ; import de signature (admin)
    │   ├── CerfaOfficialView.tsx # vue officielle + PDF ; filigrane BROUILLON et bandeau si fiche non finalisée
    │   ├── MagicLinkAccess.tsx   # lien direct sans connexion, avec contrôle de version
    │   ├── SignaturePad.tsx
    │   ├── CommunicationCenter.tsx / PopupModal.tsx / AnonymousPopups.tsx / WelcomeSettings.tsx   # messagerie, popups, message d'accueil
    └── utils/
        ├── storage.ts            # bootstrap, cache navigateur tolérant au quota (kvStorage), enregistrements avec contrôle de version
        ├── cerfaValidation.ts / pdfGenerator.ts / documentViewer.ts
        ├── messaging.ts          # client API messagerie / popups / accueil (COMM_POLL_MS = 15 s)
        ├── signatureImage.ts     # nettoyage d'une image de signature importée (PNG 1300 x 200)
        ├── attachments.ts        # contrôle + réduction des pièces jointes (photos 1600 px JPEG, PDF <= 1,5 Mo)
        └── sortUsers.ts          # tri alphabétique des comptes (sans titre de civilité, sans accents)
```

La liste exacte et la taille des fichiers installés sur le serveur figurent dans la section « État de l'installation » ci-dessus et dans le script `install-from-scratch.sh` (section Scripts).

## 3. Installation, mise à jour et extraction des scripts

**Extraire tous les scripts de ce document** (à exécuter à côté de `README.md`, dans un dossier vide) :

```bash
for n in $(grep -o '^<!-- SCRIPT-START:[^ ]* -->' README.md | sed 's/.*START:\(.*\) -->/\1/'); do
  sed -n "/^<!-- SCRIPT-START:$n -->\$/,/^<!-- SCRIPT-END:$n -->\$/p" README.md | sed '1,2d' | head -n -2 > "$n"
done
chmod +x *.sh && ls -la
```

**Installation complète sur un LXC neuf** (Debian 12 + Docker + plugin Compose) :
1. Extraire `install-from-scratch.sh` (boucle ci-dessus, ou `sed -n '/^<!-- SCRIPT-START:install-from-scratch.sh -->$/,/^<!-- SCRIPT-END:install-from-scratch.sh -->$/p' README.md | sed '1,2d' | head -n -2 > install-from-scratch.sh`).
2. Le déposer sur le LXC (FileZilla, ex. `/root/`) puis : `chmod +x install-from-scratch.sh && ./install-from-scratch.sh`. Il crée `/opt/fichesanitaire-voyages/` (dont `fiches-pdf/`), écrit tous les fichiers, copie `.env.example` vers `.env`, puis lance `docker compose up -d --build`. Variables : `APP_DIR=/autre/chemin`, `SKIP_DOCKER=1` (écrit les fichiers sans Docker).
3. **Éditer immédiatement `/opt/fichesanitaire-voyages/.env`** (mot de passe PostgreSQL, SMTP, port, `PORTAL_URL`…), puis `cd /opt/fichesanitaire-voyages && docker compose up -d --build`.
4. Configurer Nginx Proxy Manager vers `192.168.x.x:<APP_PORT>` ; vérifier `curl http://localhost:<APP_PORT>/health` -> `{"status":"ok"}`.
5. Le nom de l'établissement s'enregistre avec la commande de la section 14.2 (valeur par défaut du code : « Ensemble Scolaire Notre Dame des Missions »).

**Mise à jour d'une installation existante** : déposer `maj-portail.sh` dans `/root/` (en écrasant l'ancien, mode binaire) puis `bash /root/maj-portail.sh --etat`, `--outils`, `--appliquer [--oui]`, `--readme`. Les correctifs sont indépendants, idempotents et se restaurent seuls en cas d'erreur ; une seule reconstruction Docker est faite à la fin. Un README à jour est écrit dans `/opt/readme/`. Le projet est aussi poussé sur GitHub (dépôt miroir `fichesanitaireclaude`) ; première configuration : `bash /root/maj-portail.sh --github`.

> Sur une installation neuve, les correctifs sont déjà intégrés dans les sources : aucun `patch-*.sh` à lancer.

## 4. Variables d'environnement (`.env`)

| Variable | Rôle | Valeur par défaut |
|---|---|---|
| `DB_PASSWORD` | Mot de passe PostgreSQL (db + app) | *(à définir)* |
| `APP_PORT` | Port exposé sur l'hôte LXC | `8099` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | Relais SMTP pour les **relances** (plus utilisé pour les PDF) | *(vide = relances par mail désactivées)* |
| `PORTAL_URL` | URL publique utilisée dans les liens des e-mails | `https://fichesanitaire.ndmissions.fr` |
| `CRON_SCHEDULE` | Planification des relances hebdomadaires (syntaxe cron) | `0 8 * * 1` (lundi 8h) |
| `CRON_TIMEZONE` | Fuseau horaire des tâches planifiées | `Europe/Paris` |
| `TRASH_RETENTION_DAYS` | Rétention des fiches supprimées (corbeille) avant purge définitive | `30` |
| `BACKUP_RETENTION_HOURS` | Rétention des sauvegardes horaires automatiques | `336` (14 jours) |

Variable fixée dans `docker-compose.yml` (pas dans `.env`) : `PDF_ARCHIVE_DIR=/app/fiches-pdf`, dossier du conteneur monté sur `./fiches-pdf` de l'hôte.

**Variables manquantes dans un ancien `.env`** : `docker compose` affiche des avertissements (`The "CRON_SCHEDULE" variable is not set`…) et le serveur retombe sur ses valeurs par défaut (relances le lundi à 8h Europe/Paris, corbeille 30 jours). Seul `PORTAL_URL` vide pose problème : les liens des relances automatiques n'ont plus d'adresse de site. Voir la commande de correction (section 14).

## 5. Comptes de démonstration

| Rôle | Email | Mot de passe |
|---|---|---|
| Admin | admin.sanitaire@jeanmoulin.fr | admin123 |
| Organisateur | t.vasseur@ac-paris.fr | prof123 |
| Parent | famille.dupont@email.fr | parent123 |

## 6. API — routes principales (`server/index.js`)

Les middlewares de protection sont déclarés juste après `express.json` (ordre : peu importe, chaque garde est indépendante).

- `GET /api/data` — bootstrap initial (toutes les clés kv_store **sauf** `cerfa_messages*` et `cerfa_popups*`, jamais renvoyées). `GET/PUT /api/data/:key` répondent **403** pour ces clés privées.
- `PUT /api/data/:key` — écriture brute d'une clé entière (réservé aux ressources **bulk** rares : voyages, classes, établissement — jamais pour les élèves/comptes individuels)
- `POST /api/students/upsert` — **fusion serveur** d'UN SEUL élève. Corps : `{ student, checkDuplicate?, baseUpdatedAt? }`. Gardes successives :
  - **parent-guard** : une NOUVELLE fiche sans `parentId` est refusée (**400 `parent-required`**) ; un enregistrement dont le `parentId` est absent ou vide **conserve** le parent déjà enregistré (journal : `[parent-guard]`).
  - **studentVersionGuard** : verrou global d'écriture de fiches + `baseUpdatedAt` différent de la version stockée → **409 `conflict`** (voir 8bis) ; conserve `pdfSentAt`.
  - **attachmentSizeGuard** : une NOUVELLE pièce jointe (`cerfa.documents[].dataUrl`) de plus de 3 000 000 caractères (~2,2 Mo) est refusée (**413 `document-too-large`**, journal `[pieces-jointes]`) ; une pièce déjà enregistrée reste modifiable.
  - `checkDuplicate: true` (création par un parent) → **409 `duplicate`** si une fiche existe déjà pour ce prénom + nom.
- `POST /api/students/remove` — suppression définitive d'UN SEUL élève
- `POST /api/students/check-duplicate` — `{ firstName, lastName, parentId?, excludeStudentId? }` → `{ duplicate, sameAccount }` (aucune donnée personnelle ; comparaison sans accents, sans casse, insensible à l'ordre nom/prénom ; corbeille ignorée)
- `POST /api/students/send-pdf` — **archive** le PDF d'une fiche complète : `{ studentId, pdfBase64, studentName, schoolClass }` → `fiches-pdf/<Classe>/<NOM_Prenom>.pdf` (accents/espaces retirés, vrai PDF vérifié par `%PDF-`, écriture atomique, ancien fichier supprimé si changement de classe/nom, homonymes suffixés, index `.index.json`), enregistre `pdfSentAt`, répond `{ ok, sentAt, path }`
- `POST /api/users/upsert` / `POST /api/users/remove` — un seul compte ; **verrou** d'écriture des comptes (avant : 5 comptes conservés sur 15 créations simultanées) ; la création d'un NOUVEAU compte parent dépose son **message d'accueil** dans la messagerie.
- `POST /api/magic-link/generate` / `GET /api/magic-link/:token` / `PUT /api/magic-link/:token` — lien direct sans connexion, réutilisable ; le `PUT` accepte `baseUpdatedAt` (409 `conflict`) et passe par parent-guard.
- `POST /api/magic-link/revoke` — révocation manuelle d'un lien direct
- `POST /api/reminders/send` / `POST /api/reminders/run-auto-now` — relances
- `GET /api/backups` / `GET /api/backups/:name` — liste et téléchargement des sauvegardes horaires
- **Messagerie** (`userId` = compte connecté ; le serveur lit son rôle dans `cerfa_users_v1`) :
  - `POST /api/comm/poll` → `{ unreadMessages, popups[] }` (appelé toutes les 15 s par `CommunicationCenter`)
  - `POST /api/messages/list|send|read|delete|broadcast` (`delete` et `broadcast` : administrateur seulement)
  - `POST /api/messages/welcome/get|save|send-existing` (administrateur seulement) — message d'accueil par défaut
- **Popups** : `POST /api/popups/send|list|deactivate|delete` (administrateur), `POST /api/popups/ack` (tout compte), `GET /api/popups/public` (popups « tous les parents », sans compte)
- `GET /health` — vérification de disponibilité

## 7. Fonctionnalités principales

- Formulaire CERFA en 5 rubriques, blocage d'enregistrement tant que la fiche n'est pas complète (tous rôles), sauvegarde de brouillon à tout moment (automatique à chaque changement de page).
- Filtrage des voyages par classe éligible (tableau de bord parent + rubrique Signature).
- Lien direct sans connexion, révocable, réutilisable, accessible même après complétion (bascule en consultation).
- Corbeille avec restauration (30 jours par défaut) avant purge automatique quotidienne (3h).
- Relances : modèle de message éditable avec jetons (`{prenom}`, `{nom}`, `{classe}`, `{lien}`, `{etablissement}`, `{manquants}`, `{pourcentage}`), individuelle ou en masse, automatiques hebdomadaires.
- Export « prêt à coller » pour ÉcoleDirecte.
- **Archivage automatique du PDF complet sur le serveur** dès qu'une fiche atteint 100 %. *(Les fiches complètes avant le 01/10/2026 n'ont pas de PDF archivé tant qu'elles ne sont pas réenregistrées.)*
- **Anti-doublons** : dans « Ajouter un enfant », alerte rouge et bouton bloqué si prénom + nom correspondent à une fiche existante ; contrôle identique côté serveur ; badge « Doublon possible » dans Suivi global (aucune fusion automatique).
- **Brouillon explicite** : tant qu'une fiche n'est pas finalisée, aperçu / impression / PDF portent le filigrane « BROUILLON – NON SIGNÉE – NON VALABLE » (fichier `BROUILLON_CERFA_…pdf`) ; bandeau rouge non imprimé avec les points manquants et « Aller à la signature ».
- **Anti-écrasement** entre responsables / appareils (section 8bis).
- **Import de signature (administration uniquement)** : dans la rubrique 5, bloc « Importer une signature » (PNG / JPEG / WebP, 5 Mo max). L'image est nettoyée (fond clair rendu transparent, marges rognées, centrée sans déformation dans 1300 x 200 px = proportions de la zone du PDF). Tracée dans l'historique (« Signature importée par l'administration (nom) »), `signature.method = 'uploaded'`, `signature.uploadedBy`, mention dans la vue officielle et le PDF (« Signature importée (admin) »). Jamais proposé aux parents ni via le lien direct. Contrôle **côté navigateur uniquement** (voir section 12).
- **Vue d'ensemble sans barre de défilement horizontale** : tableau « Suivi global » compact au-dessus de 1024 px ; sous 1024 px chaque élève devient une carte empilée (étiquettes ajoutées en CSS). Mesuré sans débordement de 320 à 1920 px.
- **Pièces jointes** (ordonnances, PAI, justificatifs) : types PDF / image uniquement ; les photos sont réduites avant enregistrement (1600 px, JPEG) ; les PDF de plus de 1,5 Mo sont refusés avec un message ; le message de refus s'affiche en rouge.
- **Deux PDF différents** : (1) le **PDF archivé** sur le serveur (`fiches-pdf/…`) est généré par `generateCerfaPdf` (jsPDF, vectoriel, mise en page soignée) ; (2) le **PDF que le parent imprime/télécharge** vient de la **vue officielle** `CerfaOfficialView` (impression du navigateur ou capture `html2canvas`, `exportSinglePagePdf`). Ils ne sont pas identiques : `patch-pdf-sante.sh` met le régime alimentaire et la santé en grand dans le PDF archivé, comme dans la vue officielle ; à refaire pour les PDF existants avec le bouton « Régénérer les PDF de toutes les fiches complètes ». Un régime « aucun » n'est pas un régime particulier ; la validation d'une fiche complète exige un régime (`standard`, `sans_porc`…).
- **Fiche sur une page** : `generateCerfaPdf(student, trips, name, asBase64, fitOptions?)` ; sans `fitOptions` elle orchestre : `fits(1)`, puis `fits(0.72)`, puis 6 dichotomies ; `{ fit, measure, noBreaks }` : `FX = 1/fit`, `pageWidth = 210*FX`, `margin = 6*FX`, matrice `[fit 0 0 fit 0 297*sf*(1-fit)]` (origine PDF en bas à gauche) ; `ensureSpace` est neutre quand `noBreaks` ; la passe `measure` renvoie `y + 25` (bloc signature) sans enregistrer. Mesuré sur 36 fiches (textes de 0 à 140 mots, 0 à 3 voyages) : 33 tiennent sur une page, 3 (≥ 108 mots d'allergie + traitement…) gardent leur mise en page normale ; échelle appliquée 100 % (fiche sans allergie) à ≈ 73 % ; régénération de 36 fiches ≈ 11 s.
- **Audit des scripts (06/10/2026)** : contrôles réalisés : syntaxe de tous les scripts, ShellCheck, TypeScript en mode strict, démarrage du serveur sous Node 20 avec les paquets installés comme le Dockerfile, construction du frontend à partir d'une installation propre, rejeu complet des tests, balayage de 36 PDF (textes de 0 à 140 mots, 0 à 3 voyages), compatibilité des outils avec les variables du conteneur. Corrigé : `patch-corrections.sh` (ci-dessus), prérequis de `patch-fin-annee.sh` (contrôle anti-écrasement requis), garde-fous du dossier de travail GitHub (`GIT_STAGING` doit avoir au moins 3 niveaux et ne pas contenir le dossier de l'application ; `stage_tree` ne vide qu'un dépôt Git). Non corrigé car sans effet : imports inutilisés signalés par `tsc --noUnusedLocals` (la plupart d'origine).
- **Flèches de défilement** : `ScrollButtons` (`src/components/ScrollButtons.tsx`, monté dans `main.tsx` après `<App />`, donc aussi sur le lien direct) : flèche du haut visible quand on a défilé de plus de 240 px, flèche du bas tant qu'il reste plus de 240 px ; `window.scrollTo` (iframe compris) ; `z-30` (sous la messagerie et les fenêtres) ; `print:hidden`.
- **Fin d'année scolaire** : `YEAR_END_KEY = cerfa_year_end_v1` (réglage `{enabled, month, day}`, dernière opération `last`, `autoYear`). Tâche planifiée `10 4 * * *` (fuseau `CRON_TIMEZONE`) + rattrapage 45 s après le démarrage : n'agit que dans les 14 jours suivant la date réglée (échéance de l'année en cours ou de la précédente), une seule fois par échéance, et seulement si activée. Elle vide `registeredTripIds` de tous les élèves (corbeille comprise), ajoute une ligne d'historique (« Désinscription des voyages (fin d'année scolaire) », auteur « Système (automatique) » ou le nom de l'administrateur), change `updatedAt` (une page restée ouverte reçoit un 409 au lieu de réinscrire l'élève) et écrit `desinscription-voyages_<date>.json` dans le dossier des sauvegardes (annulation possible : `POST /api/year-end/undo` ne rétablit que les élèves non réinscrits depuis). Variables **réservées aux tests** : `YEAR_END_FAKE_TODAY=AAAA-MM-JJ`, `YEAR_END_STARTUP_DELAY_MS`.
- **Onglet RGPD (parents)** : `RgpdPanel` (texte statique + récapitulatif calculé à partir des données du compte + `GET /api/year-end/public` pour la date de désinscription annuelle) ; deux onglets dans `ParentSpace` (« Mes enfants & voyages » / « Mes données (RGPD) »). Le texte décrit les données réellement collectées ; la formulation juridique (responsable de traitement, durées, mentions) est à faire valider par la direction / le DPO ; aucune garantie de sécurité n'y est promise (le serveur n'a pas d'authentification, voir section 12).
- **Accusé de lecture (messagerie)** : chaque message envoyé affiche « Lu par … · date » ou « pas encore lu » ; `readAt` = première lecture par le destinataire (enregistrée par `POST /api/messages/read`) ; pour les anciens messages sans `readAt`, il est déduit de `userReadAt` / `adminReadAt` ; la conversation affichée à l'écran est marquée lue automatiquement ; filtre administrateur « Envoyés, pas encore lus par le parent ».
- **PDF des organisateurs** : `generateTripHealthListPdf` et `generateOrganizerReportPdf` (`src/utils/organizerPdf.ts`, jsPDF vectoriel, paysage A4, en-tête de colonnes répété à chaque page, lignes jamais coupées, pied de page numéroté) remplacent `exportToPdf` (copie d'écran `html2canvas`) pour la liste sanitaire et le relevé ; le bouton « Télécharger PDF » d'une fiche utilise `generateCerfaPdf` (vectoriel). `exportToPdf` / `exportSinglePagePdf` (captures) restent dans `pdfGenerator.ts` mais ne sont plus appelés. « Imprimer » = impression du navigateur.
- **Messagerie (administration)** : suppression d'un message précis (bouton « Supprimer » sur chaque bulle) ou d'une conversation entière (corbeille de la liste ou de l'en-tête) ; réservé aux administrateurs, journal `[messagerie] message … supprimé`.
- **Messagerie** : bouton en bas à gauche agrandi ; le nombre de nouveaux messages est une grosse pastille rouge qui clignote (rouge/jaune) avec un halo pulsant autour du bouton tant qu'il y a des messages non lus (`patch-messagerie-icone.sh`, animations CSS `commBadgeBlink` / `commButtonOutline` dans `src/index.css`, désactivées si l'appareil demande moins de mouvement).
- **Comptes (administration)** : le sélecteur de comptes de l'en-tête est trié par groupes (Administrateurs / Professeurs / Parents), sans accents ni casse, en ignorant « Mme », « M. »… ; après avoir consulté un professeur ou un parent, le bouton « Revenir à <administrateur> » ramène sans reconnexion (mémorisé par onglet : `sessionStorage`, effacé à la déconnexion).
- **Sauvegarde automatique horaire** de toute la base vers un volume Docker persistant.

## 7bis. Messagerie interne, popups et message d'accueil

**Données (côté serveur uniquement, jamais en bloc depuis le navigateur)** : clés `cerfa_messages_v1` (conversations), `cerfa_popups_v1` (popups), `cerfa_messages_welcome_v1` (réglage du message d'accueil). Préfixes `cerfa_messages*` / `cerfa_popups*` **privés** : exclus de `GET /api/data`, 403 sur `/api/data/:key`. Incluses dans les sauvegardes horaires.

**Messagerie** : une conversation = un parent (ou accompagnateur) face à l'établissement. Champs d'une conversation : `id, parentId, parentName, subject, studentLabel?, kind? ('welcome'), createdAt, lastMessageAt, lastFromRole ('user'|'admin'), userReadAt?, adminReadAt?, messages[{id, fromRole, fromUserId, fromName, body, createdAt, kind?}]`. Limites : objet 150, message 5000 caractères. Un parent ne voit que ses conversations ; tout administrateur voit tout. Un message collectif (tous les parents / classes / parents précis) crée **une conversation personnelle par destinataire**. Écritures sérialisées par un verrou (`withCommLock`).

**Popups** : niveaux Information / Important / Urgent (l'urgent exige toujours « J'ai lu et compris »), ciblage `all_parents` | `class` (parents ayant un enfant dans les classes données) | `users`, durée 1 h / 24 h / 7 jours / illimitée, désactivation / suppression, suivi « n / N ont vu ce message ». Affichage : rafraîchissement toutes les 15 s (`COMM_POLL_MS`) et à chaque retour sur l'onglet ; fenêtre plein écran (`z-[100]`) qui ne se ferme qu'avec le bouton (lecture enregistrée via `ack`). Titre 120 / texte 2000 caractères. Un **nouveau parent** qui s'inscrit pendant qu'un popup « tous les parents » est actif le voit dès son arrivée (testé) ; un popup « classe » ne l'atteint pas tant qu'il n'a aucun enfant. Le lien direct affiche les popups « tous les parents » (lecture mémorisée dans `localStorage`, clé `fiche_popups_seen_v1`).

**Message d'accueil** : à la création d'un compte parent, une conversation `kind: 'welcome'` est déposée (une seule par compte, jamais de doublon, prête avant la première connexion : badge « 1 »). Texte par défaut : « Merci de créer un compte par enfant… la signature d'un seul responsable légal suffit… utilisez une adresse e-mail différente pour chaque compte… ». Modifiable par l'administration (Messagerie > « Message d'accueil » : jetons `{prenom}` / `{nom}`, activation, rétablir le texte, « Envoyer aussi aux parents déjà inscrits »). Côté administration, un message d'accueil **sans réponse** n'encombre pas la boîte de réception. *Point de vigilance* : l'application permet aussi d'ajouter plusieurs enfants à un seul compte ; le texte par défaut demande « un compte par enfant » à la demande de l'établissement.

**Identification** : le serveur ne connaît l'utilisateur que par le `userId` envoyé et lit son rôle dans `cerfa_users_v1` ; il n'y a **aucune authentification** (section 12).

## 8. Incident majeur du 01/10/2026 et correctifs — À LIRE IMPÉRATIVEMENT avant toute modification future

Un incident de perte de données s'est produit le 1er octobre 2026 : un navigateur resté ouvert plusieurs jours (état périmé en mémoire) a écrasé la base de données en enregistrant une action, remplaçant la liste complète et à jour des élèves par sa propre version figée, ancienne. 9 familles ont dû ressaisir la fiche de leur enfant. Restauration effectuée à partir d'une sauvegarde Proxmox + fusion manuelle des ajouts intermédiaires (65 élèves récupérés).

**Cause racine** : l'architecture envoyait **toute la liste** des élèves/comptes depuis le navigateur à chaque sauvegarde (`PUT /api/data/:key` avec le tableau entier), au lieu de ne transmettre que l'élément modifié. Un client avec un état local périmé écrasait alors tout ce que d'autres avaient ajouté entre-temps.

**Trois correctifs appliqués, dans cet ordre, tous en production** :
1. Les fonctions `saveStored*` dans `storage.ts` sont devenues asynchrones et **attendent réellement** la confirmation serveur avant de considérer une sauvegarde terminée.
2. Suppression du repli dangereux : si le cache local du navigateur est vide, l'application affichait des données de démonstration **et les ré-enregistrait automatiquement vers le serveur**. Ce ré-enregistrement a été supprimé : le repli reste purement local et temporaire.
3. **Fusion côté serveur** : toute opération ne touchant qu'UN SEUL élève ou compte passe par `POST /api/students/upsert`, `/api/students/remove`, `/api/users/upsert`, `/api/users/remove` plutôt que par l'envoi de la liste complète.

**Opérations qui envoient encore une liste complète (risque résiduel accepté, actions d'admin rares)** : suppression d'un voyage (retire son ID des élèves inscrits), renommage de l'établissement appliqué à tous les élèves, attribution d'organisateur(s) à un voyage. Si une nouvelle fonctionnalité doit modifier plusieurs élèves/comptes à la fois, ajouter un endpoint de fusion dédié plutôt que de revenir au modèle « liste complète ».

### 8bis. Anti-écrasement ENTRE deux enregistrements d'une même fiche (build `anti-overwrite-20261001`)

Deux personnes qui éditent la **même fiche** (les deux responsables via le même lien direct, deux appareils, un parent et l'administration) s'écrasaient : le dernier à enregistrer gagnait, avec son état périmé.

- Chaque fiche porte `updatedAt` ; le client envoie `baseUpdatedAt` = la version sur laquelle il s'appuie.
- Le middleware serveur `studentVersionGuard` (sur `POST /api/students/upsert` et `PUT /api/magic-link/:token`) prend un **verrou global d'écriture de fiches** (libéré automatiquement après 20 s), relit la fiche stockée et compare par **égalité stricte** (`stored.updatedAt !== baseUpdatedAt` → **409 `conflict`**, rien n'est écrit). L'égalité (et non « plus récent ») est volontaire : les `updatedAt` viennent de l'horloge de chaque appareil.
- Sans `baseUpdatedAt` (fiche sans historique, flux comme l'inscription à un voyage), aucun contrôle. Le serveur conserve `pdfSentAt`.
- Côté navigateur (`storage.ts`) : `saveStudentChecked` (portail connecté) et `saveStudentViaLink` (lien direct) exécutent les enregistrements **l'un après l'autre** (file d'attente) pour éviter les faux conflits.
- En cas de conflit : message « Cette fiche vient d'être modifiée par quelqu'un d'autre… » ; **OK** recharge la dernière version, **Annuler** laisse la page. Erreur réseau/serveur : message explicite (auparavant « enregistré » s'affichait même en cas d'échec).
- Journal : `docker compose logs app | grep anti-ecrasement`.

Un administrateur dont la page est ouverte depuis longtemps verra un conflit s'il enregistre une fiche qu'un parent a modifiée entre-temps : c'est voulu.

### 8ter. Fiches « orphelines » (sans parent rattaché) — incident du 01–02/10/2026

**Constat (02/10/2026, 84 fiches)** : 12 fiches ne se rattachaient à aucun compte : 11 sans aucun `parentId` (créées entre le 01/10 à 18h54 et le 02/10 à 09h32, heure du serveur) et 1 portant l'identifiant d'un compte perdu lors de créations simultanées (défaut corrigé par le verrou sur les comptes). Le parent ne voyait pas la fiche dans « Mes enfants » et le portail refusait de la recréer (« une fiche existe déjà »). Les comptes étaient sains (111 comptes, 0 anormal, 0 doublon).

**Signature** : première entrée d'historique générique (« Création de la fiche… | Parent (Parent) »), suivantes avec auteur **« ? »** et rôle « Direction / Administration » -> la session qui créait la fiche n'avait ni identifiant, ni nom, ni rôle valide. Fuite constatée dans l'ancien code : `ParentSpace` filtrait `s.parentId === currentUser.id` ; deux valeurs absentes étant égales, une session sans identifiant voyait TOUTES les fiches orphelines (corrigé : `Boolean(currentUser.id) &&`).

**Cause d'origine : NON ÉTABLIE.** Non reproduit avec le code actuel (inscription -> ajout d'enfant -> brouillon -> enregistrement admin, vrai navigateur ; stockage navigateur bloqué, saturé ou en mémoire). Les premières fiches orphelines précèdent les correctifs de cette série. **Observation** : dans les cas examinés (GUERIN Lucie, HAMMA Lina, CANOT Victoria), la fiche orpheline a été créée 1 à 10 minutes après l'inscription du compte, puis **la même fiche a été recréée correctement** par le parent -> une première session juste après l'inscription semble avoir été défectueuse (hypothèse, non prouvée). Aucune nouvelle fiche orpheline n'est apparue depuis le 02/10 (contrôle : `rattacher-fiche.sh --orphelines`).

**Protection (`patch-parent-guard.sh`)** : le serveur refuse une nouvelle fiche sans parent (400 `parent-required`), ne laisse jamais un enregistrement effacer le parent existant (y compris via le lien direct) ; le navigateur refuse « Ajouter un enfant » sans identifiant ; une session sans identité ne voit plus les fiches orphelines. Journal : `[parent-guard]`.

**Réparation (`rattacher-fiche.sh`, section Scripts)** :
- `--orphelines` : fiches sans parent valide, comptes anormaux/doublons, comptes candidats par e-mail du responsable ou par heure de création, et **« DOUBLON PROBABLE de… »**.
- `--doublons` : tous les enfants ayant plusieurs fiches, avec la fiche « à garder » probable (complète, signée, PDF archivé, % de complétude, parent). Ne supprime rien.
- `--auto [--apply]` : rattache uniquement si l'e-mail du responsable saisi sur la fiche est exactement celui d'UN compte parent ET que ce compte n'a pas déjà cet enfant.
- `<identifiant|numéro|nom> <email> [--apply] [--force]` : rattachement d'une fiche ; refus de créer un doublon dans le même compte sans `--force`.
- Chaque rattachement : ligne d'historique, `updatedAt` mis à jour (un onglet resté ouvert est refusé en 409), copie `/app/backups/rattachement*_<date>.json`.

**Enseignement important** : une fiche orpheline est très souvent la **première tentative abandonnée** d'un parent qui l'a recréée ensuite. Ne jamais rattacher sans avoir vérifié (`--doublons`, requête des enfants du compte) : sinon on crée un doublon dans le même compte (cas réel : CANOT Victoria E-2026-182 / E-2026-829, créé par la première version de `--auto`, corrigée). Les fiches orphelines vides sont à mettre à la corbeille (Suivi global, restaurable 30 jours) ; le parent peut recréer.

### 8quater. Panne du 04/10/2026 : « Jean Moulin », mot de passe refusé, « tout autre portail »

**Symptômes** (tous les visiteurs, nouveaux navigateurs compris) : écran de connexion avec « Collège & Lycée Jean Moulin », comptes et mots de passe réels refusés (« Identifiant ou mot de passe incorrect »), données de démonstration. **La base du serveur était intacte** (163 comptes, 139 fiches, 62 conversations).

**Cause (reproduite dans un vrai navigateur)** : `bootstrapFromServer` copie toutes les clés de `GET /api/data` dans `localStorage` (limite ~5 Mo), **fiches en premier** (`STORAGE_KEYS` : STUDENTS d'abord). Dès que la base a dépassé le quota (de 3,3 à 8,9 Mo le 04/10 à 19h UTC), `setItem` a levé `QuotaExceededError` sur les fiches et la boucle s'est arrêtée : comptes, nom de l'établissement, classes, voyages n'ont jamais été copiés -> valeurs de démonstration. Déclencheur : **une seule fiche (MENDES RIOTTE) avec un PDF de PAI de 5,4 Mo** ajouté le 04/10 à 18h50 (aucune limite de taille, aucune compression des pièces jointes).

**Corrections** :
- `patch-stockage.sh` (build `storage-fallback-20261004`) : clés enregistrées de la plus petite à la plus grande ; wrapper `kvStorage` qui garde en MÉMOIRE ce qui ne tient pas dans `localStorage` (testé à 9, 25 Mo). Le cache local n'est plus une condition de fonctionnement.
- `patch-pieces-jointes.sh` (build `attachments-limit-20261004`) : photos réduites (1600 px JPEG), PDF <= 1,5 Mo, serveur 413 sur toute nouvelle pièce > ~2,2 Mo, message de refus rouge.
- `restaurer-sauvegarde.sh` : diagnostic (`--etat`) et restauration des sauvegardes horaires (non nécessaire ici, la base était saine).

**Reste à faire / à retenir** : la fiche de 5,4 Mo reste lourde tant que sa pièce jointe n'est pas remplacée (sauvegarde du PDF puis suppression dans l'éditeur : commande en section 14). Chaque visiteur télécharge toute la base (y compris sur l'écran de connexion) : à terme, charger les pièces jointes à la demande et filtrer les données par utilisateur (nécessite une authentification serveur). **Piège** : la sauvegarde horaire est écrite aussi à chaque redémarrage de l'application, sous le nom de l'heure en cours : après un incident, copier `/app/backups` AVANT tout redémarrage (`docker cp`).

## 9. Règles métier : signature et complétude

- **Une seule fiche par élève, une seule signature** : la signature électronique d'**un seul** responsable légal suffit (`signature.signedByName` + `signatureDataUrl`). Il n'existe pas de « 2ᵉ signature ». Le modèle ne stocke qu'une signature (tracée à l'écran, ou image importée par l'administration).
- Une fiche est **`complete`** uniquement si `computeCerfaCompleteness` (dans `cerfaValidation.ts`) ne signale **aucun** manque : identité, vaccins, médical, régime, responsable légal (nom, téléphone, adresse), **déclaration sur l'honneur cochée**, **signature** présente. Sinon `status = 'incomplete'`, pourcentage plafonné à 95 %.
- Les **brouillons** sont enregistrés à tout moment, toujours en `incomplete` tant que la rubrique 5 n'est pas finalisée. Le bouton « Enregistrer » de la fiche reste bloqué tant que la fiche est incomplète.
- Cas réel (Maxime, 29/09–01/10/2026) : un parent avait rempli les rubriques 1 à 4 et imprimé le PDF depuis « Aperçu » sans finaliser la signature ; l'autre responsable a ensuite signé → `complete`. Cause de la confusion : le PDF d'une fiche incomplète était imprimable sans avertissement → corrigé par le filigrane + bandeau.
- **Doublons** : une fiche supplémentaire pour le même enfant (mêmes prénom + nom) est bloquée à la création ; en revanche des doublons peuvent exister (fiches orphelines abandonnées, rattachements) : `rattacher-fiche.sh --doublons`.
- **Rattachement** : une fiche appartient à un compte par `parentId` (= `id` du compte parent). « Mes enfants » n'affiche que les fiches dont `parentId` est l'identifiant du compte connecté. Le numéro `E-2026-xxx` (`internalId`) est **tiré au hasard** (100–999) : **il peut exister en double** ; l'identifiant technique `s-<horodatage>` est le seul unique.

## 10. Dépannage courant

- **Le portail affiche « Jean Moulin » et refuse les mots de passe** -> `bash /root/maj-portail.sh --etat` : `patch-stockage` installé ? Sinon base > 5 Mo (8quater). Vérifier d'abord l'état de la base (`restaurer-sauvegarde.sh --etat`) : si elle est saine, c'est le navigateur ; si elle est vide, restaurer. **Ne pas redémarrer l'application avant d'avoir copié `/app/backups`.**
- **`/health` en échec après déploiement** -> `docker logs fichesanitaire_app --tail 50`.
- **PDF non archivé** -> `docker compose logs app | grep fiches-pdf` ; test d'écriture `docker exec fichesanitaire_app sh -c 'touch /app/fiches-pdf/.test && rm /app/fiches-pdf/.test'` ; vérifier `./fiches-pdf:/app/fiches-pdf` dans `docker-compose.yml`.
- **Un parent ne voit pas la fiche de son enfant / « une fiche existe déjà »** -> `rattacher-fiche.sh --doublons` puis `--orphelines` ; si la fiche est une première tentative abandonnée, la mettre à la corbeille ; sinon la rattacher (`<identifiant> <email-du-compte> --apply`).
- **« Ajouter un enfant » bloqué** -> la fiche existe (même prénom + nom, accents/ordre ignorés) ; vrai homonyme : créer depuis l'administration. Journal `grep dup-guard`.
- **« Fiche modifiée par quelqu'un d'autre »** -> anti-écrasement normal ; recharger. Journal `grep anti-ecrasement`.
- **Création de fiche refusée** -> `grep parent-guard` : session sans identifiant ; se déconnecter/reconnecter.
- **Pièce jointe refusée** -> PDF > 1,5 Mo ou format non accepté ; message rouge dans le formulaire. Journal serveur `grep pieces-jointes`.
- **L'administrateur est bloqué sur le compte d'un professeur** -> bouton « Revenir à … » en haut à droite ; sinon déconnexion/reconnexion.
- **PDF imprimé avec « BROUILLON »** -> fiche non finalisée (bandeau rouge : points manquants).
- **Relances sans effet** -> `SMTP_HOST` dans `.env` ; liens sans adresse -> `PORTAL_URL` vide.
- **Messagerie / popups** -> `docker compose logs app | grep messagerie` ; un popup invisible est peut-être expiré, désactivé, déjà acquitté ou ciblé sur une classe alors que le parent n'a pas encore d'enfant.
- **Perte de données suspectée** -> `restaurer-sauvegarde.sh --etat` et `--liste`, sauvegardes Proxmox du LXC.
- **Retour arrière d'un correctif** -> `cp -a /opt/fichesanitaire-voyages/backup-avant-<build>/. /opt/fichesanitaire-voyages/` puis `docker compose up -d --build` (et supprimer les fichiers créés par ce correctif) ; ou, après `--appliquer`, l'archive `/root/avant-maj_<date>.tar.gz`.

**Où sont stockées les données**
- **PDF des fiches complètes** : `/opt/fichesanitaire-voyages/fiches-pdf/<Classe>/<NOM_Prenom>.pdf` (visible avec FileZilla).
- **Base** : volume `fichesanitaire-voyages_fichesanitaire_pgdata`, table `kv_store` (clé/valeur JSONB).
- **Sauvegardes horaires** : volume `fichesanitaire-voyages_fichesanitaire_backups`, monté sur `/app/backups` ; `backup_AAAA-MM-JJ_HHh00.json` (liste `{key, value, updated_at}`, heure du nom probablement en UTC), 14 jours ; même volume : `rattachement*_<date>.json`, `avant-restauration_<date>.json` (jamais purgés). Disque du LXC : `/var/lib/docker/volumes/<volume>/_data/`.
- **Copies de sécurité des scripts** : `/opt/fichesanitaire-voyages/backup-avant-<build>/` ; avant chaque `--appliquer` : `/root/avant-maj_<date>.tar.gz`.
- **README** : `/opt/readme/README.md` (+ `/opt/readme/archive/`, 10 versions).
- La sauvegarde Proxmox du LXC reste la vraie protection : copier de temps en temps `fiches-pdf/` et les `backup_*.json` hors du LXC.

## 11. Historique des correctifs (scripts `patch-*.sh`, intégrés aux sources et au script d'installation)

| Ordre | Build | Script | Effet |
|---|---|---|---|
| 1 | `pdf-archive-20261001` | `patch-pdf-archive.sh` | Archivage serveur des PDF `fiches-pdf/<Classe>/<NOM_Prenom>.pdf` (volume monté, `.gitignore`) |
| 2 | `dup-guard-20261001` | `patch-doublons.sh` | Anti-doublons (formulaire + serveur) + badge admin ; `.dockerignore` |
| 3 | `draft-watermark-20261001` | `patch-brouillon.sh` | Filigrane BROUILLON, bandeau des points manquants, « Aller à la signature » |
| 4 | `anti-overwrite-20261001` | `patch-anti-ecrasement.sh` | Contrôle de version + verrou d'écriture (409 `conflict`) |
| 5 | `messagerie-20261001` | `patch-messagerie.sh` | Messagerie interne + popups ; clés privées protégées |
| 6 | `accueil-20261001` | `patch-accueil.sh` | Message d'accueil ; verrou sur les créations de comptes (exige le n° 5) |
| 7 | `ui-signature-20261001` | `patch-ui-signature.sh` | Import de signature (admin) ; vue d'ensemble sans défilement horizontal |
| 8 | `parent-guard-20261002` | `patch-parent-guard.sh` | Plus de fiche sans parent ; parent jamais effacé |
| 9 | `switch-admin-20261002` | `patch-comptes.sh` | Liste des comptes triée ; retour à l'administrateur sans reconnexion |
| 10 | `storage-fallback-20261004` | `patch-stockage.sh` | Chargement fiable même si la base dépasse 5 Mo |
| 11 | `attachments-limit-20261004` | `patch-pieces-jointes.sh` | Photos réduites, PDF limités, serveur 413 |
| 12 | `etablissement-20261005` | `patch-etablissement.sh` | Le nom ENREGISTRÉ de l'établissement s'affiche sur toutes les fiches (rubrique 1), les PDF et la liste officielle des inscrits ; valeurs par défaut du code = Notre Dame des Missions ; « Changer l'établissement » ne réécrit plus toute la liste des élèves |
| 13 | `pdf-regeneration-20261005` | `patch-regeneration-pdf.sh` | Bouton « Régénérer les PDF de toutes les fiches complètes » (Administration > Établissement scolaire) : remplace les PDF archivés par des PDF au nom d'établissement enregistré, crée les PDF manquants, sans modifier aucune fiche |
| 14 | `comm-badge-20261005` | `patch-messagerie-icone.sh` | Messagerie : bouton plus grand (icône 32 px, >= 64 px de haut), pastille du nombre de messages non lus grosse, rouge et clignotante (rouge/jaune), halo pulsant autour du bouton ; animations coupées avec « mouvement réduit » ; « 99+ » au-delà de 99 |
| 15 | `pdf-sante-20261006` | `patch-pdf-sante.sh` | PDF archivé sur le serveur : régime alimentaire et santé EN GRAND (bandeau orange « RÉGIME OU ALLERGIE ACTIVE », grandes cartes régime / allergie alimentaire, traitement, PAI, 4 cases d'allergies, cause et conduite à tenir, antécédents, difficultés de santé) ; textes à la ligne (plus de coupure), saut de page automatique, pages numérotées |
| 16 | `comm-delete-20261006` | `patch-messagerie-suppression.sh` | Messagerie (admin) : bouton « Supprimer » sur chaque message (confirmation avec aperçu), corbeille sur chaque conversation de la liste ; route `POST /api/messages/delete-message` réservée aux administrateurs |
| 17 | `comm-read-20261006` | `patch-messagerie-lecture.sh` | Messagerie : accusé de lecture — « ✓✓ Lu par le parent · date » / « ✓ Envoyé · pas encore lu » sous chaque message envoyé, étiquette Lu / Non lu dans la liste, filtre « Envoyés, pas encore lus par le parent (N) » ; le serveur enregistre la date de première lecture de chaque message (`readAt`) ; une conversation ouverte à l'écran est marquée lue à l'arrivée d'un message |
| 18 | `pdf-organisateurs-20261006` | `patch-pdf-organisateurs.sh` | VRAIS PDF vectoriels (texte sélectionnable, paginés) à la place des copies d'écran : liste d'émargement & suivi sanitaire du séjour, relevé sanitaire de l'espace organisateur, fiche individuelle « Télécharger PDF » (tous rôles) avec téléphone de l'enfant, n° de sécurité sociale, n° d'élève et filigrane BROUILLON si non finalisée ; nouveau fichier `src/utils/organizerPdf.ts` |
| 19 | `year-end-20261006` | `patch-fin-annee.sh` | Fin d'année scolaire : désinscription de TOUS les élèves de TOUS les voyages — automatique (réglable, défaut 15 juillet, fenêtre de 14 jours, une fois par an, jamais en cours d'année), manuelle (bouton avec confirmation) et annulable ; historique de chaque fiche, copie de sécurité `desinscription-voyages_*.json` ; panneau dans Administration > Voyages ; routes `POST /api/year-end/get|save|run|undo` (admin) et `GET /api/year-end/public` |
| 20 | `rgpd-20261006` | `patch-rgpd.sh` | Onglet « Mes données (RGPD) » dans l'espace parent (données collectées, finalités, destinataires, conservation, droits, récapitulatif réel du compte, téléchargement JSON) ; le PDF archivé est supprimé avec la fiche (`deleteArchivedPdf`) ; polices Google Fonts retirées de `index.html` |
| 21 | `scroll-arrows-20261006` | `patch-fleches.sh` | Flèches rondes « tout en haut » / « tout en bas » en bas à droite de toutes les pages (composant `ScrollButtons`, monté dans `main.tsx`) : apparition selon la position, défilement doux (immédiat si mouvement réduit), fonctionne dans un iframe, non imprimées, sous les fenêtres modales |
| 22 | `audit-fixes-20261006` | `patch-corrections.sh` | Corrections issues de l'audit complet des scripts (à appliquer en dernier) : PDF de la fiche — bloc « Séjours & voyages » (chevauchement du nom et de la destination, 2 voyages sur 3 seulement, symbole ✈ non imprimable) réécrit, symbole ✓ de la signature retiré, symboles hors police (émoji, flèches, caractères chinois ou arabes) remplacés par « ? », mots sans espace de plus de 36 caractères coupés (`src/utils/pdfSafe.ts`) ; PDF organisateurs — mêmes protections et garde-fou de 40 lignes par cellule ; onglet RGPD — formulation exacte (« le portail n'affiche à une famille que ses propres enfants… », plus de « ne voit jamais ») |
| 23 | `parent-password-20261006` | `patch-mot-de-passe-parent.sh` | Espace Famille : bouton bleu clair « Changer mon mot de passe » sous « + Ajouter un enfant » ; fenêtre `ParentPasswordModal` (mot de passe actuel exact, nouveau de 6 caractères au moins et différent, confirmation, afficher/masquer, Échap) ; enregistrement par `handleUpdateUserPassword` (comme l'espace organisateur) ; rendue dans `document.body` (portail React) |
| 24 | `onepage-20261006` | `patch-fiche-une-page.sh` | Le PDF de la fiche sanitaire (téléchargement, copie archivée, envoi par e-mail) tient sur UNE page A4 : `generateCerfaPdf` mesure la hauteur nécessaire (passe `measure`), cherche par dichotomie la plus grande échelle (≥ 72 %) qui tient, puis dessine le tout sous une matrice de transformation (mise en page élargie de 1/échelle : les positions horizontales `margin + N` sont multipliées par `FX`) ; pied de page, filigrane et bandeau « non valable » restent à l'échelle réelle ; si la fiche est trop longue pour rester lisible, mise en page normale sur plusieurs pages (aucune information coupée) |
| outils | — | `rattacher-fiche.sh`, `restaurer-sauvegarde.sh` | Rattachement/doublons ; diagnostic et restauration de la base |
| mise à jour | — | `maj-portail.sh` | État / outils / application des correctifs en attente / génération de ce README |

Les scripts sont indépendants (sauf le n° 6) et idempotents ; testés ensemble dans plusieurs ordres (compilation `tsc` + `vite build`, vrai serveur Node + PostgreSQL, vrai navigateur Chromium headless, tests jsdom). **Docker n'est pas disponible dans l'environnement de test de Claude** : seules les étapes `docker compose` restent à vérifier sur le LXC.

## 12. Points d'attention et pistes

**Sécurité (point le plus sensible)**
- **Aucune authentification côté serveur** : toutes les routes `/api/*` répondent sans identification. `GET /api/data` renvoie **les élèves (données de santé) et tous les comptes, mots de passe compris** : les mots de passe sont enregistrés tels que saisis et vérifiés **dans le navigateur** (`StartupAuthGate`). Les sauvegardes (`/api/backups/:name`) sont téléchargeables sans identification. Un administrateur n'est reconnu (messagerie, popups, diffusion) que par le `userId` envoyé, que `GET /api/data` expose. Si l'URL est publique via Nginx Proxy Manager, ces données sont lisibles et ces actions exécutables par quiconque connaît le point d'accès. Pistes : liste d'accès / filtre IP dans NPM sur `/api/data` et `/api/backups`, puis authentification serveur (sessions ou jetons, mots de passe hachés).
- Contrôles « administration » (import de signature, accès aux espaces, retour administrateur) **côté navigateur seulement**.
- Mots de passe de démonstration documentés en section 5 : à supprimer en production (« purger les comptes de démonstration »).

**Données et exploitation**
- **Poids de la base** : tout est téléchargé à chaque ouverture (y compris la page de connexion). Pistes : pièces jointes à la demande, filtrage par utilisateur (après authentification), compression HTTP.
- **Nom de l'établissement** (corrigé par `patch-etablissement.sh`) : chaque fiche gardait une COPIE du nom à sa création (`schoolEstablishment`) que la vue officielle affichait en priorité ; désormais la fiche, le pied de page, les PDF et la liste officielle des inscrits (`TripHealthListModal`, qui avait « Collège & Lycée Jean Moulin — Académie de Paris » en dur) lisent le nom ENREGISTRÉ (`cerfa_establishment_name_v1`, commande en section 14.2). Les copies stockées dans les fiches restent inchangées mais ne sont plus affichées. Les PDF DÉJÀ archivés gardent l'ancien nom jusqu'à ce qu'ils soient régénérés : bouton « Régénérer les PDF de toutes les fiches complètes » (Administration > Établissement scolaire, `patch-regeneration-pdf.sh`), à relancer après chaque changement de nom. Le bouton « Changer l'établissement » n'écrit plus que le nom (plus de réécriture de toute la liste des élèves). Valeur par défaut du code : « Ensemble Scolaire Notre Dame des Missions ».
- **Origine des fiches orphelines non établie** (8ter) ; **doublons** à résorber (`--doublons`).
- **Fiches complètes sans PDF archivé** (avant le 01/10) : créées par le bouton « Régénérer les PDF de toutes les fiches complètes ».
- **Numéros `E-2026-xxx` aléatoires** (100–999) : doublons possibles ; l'identifiant technique `s-<horodatage>` est le seul unique.
- **Popups** : rafraîchissement toutes les 15 s, pas de notification par e-mail ; un popup « classe » n'atteint pas un nouveau parent sans enfant.
- **Sauvegarde de démarrage** : sur une base vide, la première sauvegarde horaire échoue (« relation kv_store does not exist »), sans conséquence.
- **PDF orphelins** : avant `patch-rgpd.sh`, un PDF archivé n'était jamais supprimé avec sa fiche : les PDF de fiches déjà purgées restent dans `fiches-pdf/` (commande de recensement en 14.8, suppression manuelle après vérification). Rien n'est supprimé automatiquement en masse (risque en cas de base partiellement restaurée).
- **Conservation des fiches** : aucune suppression automatique des fiches d'élèves ayant quitté l'établissement n'existe (seule la corbeille purge à 30 jours) ; le texte RGPD dit « supprimées par l'établissement ou sur demande » : prévoir une règle annuelle si nécessaire.
- **Fusion de deux fiches** : non disponible (seule la corbeille).
- **Tableau « Suivi global » entre 1024 et 1199 px** : liste « Pension » tronquée.
- **Comparaison de version par égalité** (`updatedAt`) : un changement serveur qui ne modifie pas `updatedAt` (ex. `pdfSentAt`) n'est pas un conflit — voulu.
- **Message d'accueil** : demande « un compte par enfant » (adresse e-mail différente par compte) alors que l'application permet plusieurs enfants par compte : texte modifiable (Messagerie > Message d'accueil).

## 13. Glossaire et identifiants techniques

- **Clés de la table `kv_store`** (PostgreSQL, valeur JSONB) : `cerfa_students_v11` (fiches), `cerfa_users_v1` (comptes), `cerfa_trips_v2` (voyages), `cerfa_classes_v1`, `cerfa_notifications_v1`, `cerfa_establishment_name_v1` (chaîne), `cerfa_logo_v1`, `cerfa_reminder_template_v1`, `cerfa_magic_links_v1` (objet), et les clés **privées** (jamais renvoyées par `/api/data`) `cerfa_messages_v1`, `cerfa_popups_v1`, `cerfa_messages_welcome_v1`.
- **Navigateur** : cache `localStorage` des clés ci-dessus (avec repli mémoire `kvStorage`) ; `cerfa_current_user_id_v1` (session) ; `fiche_popups_seen_v1` (popups lus via lien direct) ; `sessionStorage` `cerfa_origin_admin_id` (administrateur d'origine pendant une consultation).
- **Identifiants** : comptes parents `parent-<Date.now()>` ; fiches `s-<Date.now()>` (unique) ; numéro affiché `E-2026-<100..999>` (**aléatoire, doublons possibles**) ; pièces jointes `doc-<ms>` ; messagerie `t-…` (conversation), `m-…` (message), `p-…` (popup).
- **Rôles** : `admin` (Direction / Administration), `organizer` (professeur / accompagnateur, lecture seule), `parent`. Auteur d'historique : « Parent / Responsable » ou « Direction / Administration » (selon le rôle de la session) ; « ? » = session sans nom.
- **Statuts de fiche** : `complete` (aucun manque, déclaration cochée, signature présente) ou `incomplete` (pourcentage plafonné à 95 %).
- **Marqueurs de build** (console du navigateur après Ctrl+F5) : `pdf-archive`, `dup-guard`, `draft-watermark`, `anti-overwrite`, `messagerie`, `accueil`, `ui-signature`, `switch-admin`, `storage-fallback`, `attachments-limit` (le correctif `parent-guard` n'écrit que dans le journal serveur).
- **Préfixes des journaux serveur** (`docker compose logs app | grep …`) : `[fiches-pdf]`, `[dup-guard]`, `[anti-ecrasement]`, `[parent-guard]`, `[messagerie]`, `[pieces-jointes]`, `[sauvegarde horaire]`, `[relances hebdomadaires]`, `[corbeille]`.
- **Docker** : conteneurs `fichesanitaire_app`, `fichesanitaire_db` ; volumes `fichesanitaire-voyages_fichesanitaire_pgdata`, `…_backups` ; port interne de l'application `3000`, exposé sur `APP_PORT` (8099 par défaut).

## 14. Commandes d'exploitation (référence exacte)

Conteneurs : `fichesanitaire_app` (Node), `fichesanitaire_db` (PostgreSQL 16, utilisateur et base `fichesanitaire`). Dossier : `/opt/fichesanitaire-voyages`. Volumes : `fichesanitaire-voyages_fichesanitaire_pgdata`, `fichesanitaire-voyages_fichesanitaire_backups`.

### 14.1 Mise à jour et outils (`maj-portail.sh`, à déposer dans `/root/` avec FileZilla, mode binaire)

```bash
bash /root/maj-portail.sh --etat           # correctifs installés / en attente, état des outils
bash /root/maj-portail.sh --outils         # installe ou met à jour rattacher-fiche.sh et restaurer-sauvegarde.sh dans /root (sans reconstruction)
bash /root/maj-portail.sh --appliquer      # applique les correctifs en attente, reconstruit UNE fois, vérifie /health, régénère le README
bash /root/maj-portail.sh --appliquer --oui   # idem sans confirmation
bash /root/maj-portail.sh --readme         # régénère seulement /opt/readme/README.md
```
Avant `--appliquer` : snapshot Proxmox du LXC. Retour arrière : `tar xzf /root/avant-maj_<date>.tar.gz -C /opt/fichesanitaire-voyages && cd /opt/fichesanitaire-voyages && docker compose up -d --build`.

### 14.2 Application

```bash
cd /opt/fichesanitaire-voyages
docker compose up -d --build                         # reconstruire et redémarrer (ATTENTION : écrit la sauvegarde horaire de l'heure en cours)
docker compose ps
docker ps -a --format '{{.Names}} {{.Status}}'
curl -s http://localhost:$(grep ^APP_PORT .env | cut -d= -f2)/health          # {"status":"ok"}
docker logs fichesanitaire_app --tail 50
docker compose logs app --tail 200 | grep -E "fiches-pdf|dup-guard|anti-ecrasement|parent-guard|messagerie|pieces-jointes|Message d'accueil"
```

Variables manquantes du `.env` (supprime les avertissements `docker compose`, corrige les liens des relances) :
```bash
cd /opt/fichesanitaire-voyages
grep -q '^PORTAL_URL=' .env || echo 'PORTAL_URL=https://fichesanitaire.ndmissions.fr' >> .env
grep -q '^CRON_SCHEDULE=' .env || echo 'CRON_SCHEDULE=0 8 * * 1' >> .env
grep -q '^CRON_TIMEZONE=' .env || echo 'CRON_TIMEZONE=Europe/Paris' >> .env
grep -q '^TRASH_RETENTION_DAYS=' .env || echo 'TRASH_RETENTION_DAYS=30' >> .env
docker compose up -d
```

Nom de l'établissement (une seule écriture, sans toucher aux fiches ; les fiches existantes gardent l'ancien nom) :
```bash
docker exec fichesanitaire_app node -e "fetch('http://localhost:3000/api/data/cerfa_establishment_name_v1',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:'Ensemble Scolaire Notre Dame des Missions'})}).then(r=>console.log('HTTP',r.status))"
```

Régénérer les PDF archivés (après un changement de nom d'établissement, ou pour créer les PDF manquants) : **Administration > « Établissement scolaire » > « PDF archivés sur le serveur » > « Régénérer les PDF de toutes les fiches complètes »** (barre de progression, bouton Arrêter, liste des échecs, relançable ; aucune fiche modifiée). Vérification d'un PDF : `grep -c "Notre Dame des Missions" /opt/fichesanitaire-voyages/fiches-pdf/<Classe>/<NOM_Prenom>.pdf`.

### 14.3 Base de données (lecture seule)

État par clé (taille, nombre d'éléments, dernière modification) — une base saine montre `cerfa_users_v1`, `cerfa_students_v11`, etc. ; « 0 rows » = base vide :
```bash
docker exec fichesanitaire_db psql -U fichesanitaire -d fichesanitaire -c "select key, jsonb_typeof(value) as type, case when jsonb_typeof(value)='array' then jsonb_array_length(value) end as n, pg_column_size(value)/1024 as ko, updated_at from kv_store order by key;"
```
Les fiches les plus lourdes :
```bash
docker exec fichesanitaire_db psql -U fichesanitaire -d fichesanitaire -c "select e->'cerfa'->'identity'->>'lastName' as nom, e->>'internalId' as num, length(e::text)/1024 as ko from kv_store, jsonb_array_elements(value) e where key='cerfa_students_v11' order by 3 desc limit 10;"
```
Pièces jointes d'une fiche (remplacer le nom) :
```bash
docker exec fichesanitaire_db psql -U fichesanitaire -d fichesanitaire -c "select d->>'name' as fichier, d->>'type' as type, d->>'uploadDate' as ajoute, length(d->>'dataUrl')/1024 as ko from kv_store, jsonb_array_elements(value) e, jsonb_array_elements(e->'cerfa'->'documents') d where key='cerfa_students_v11' and e->'cerfa'->'identity'->>'lastName'='MENDES RIOTTE' order by 4 desc;"
```
Sauvegarder un PDF de pièce jointe sur le LXC (à faire AVANT de le supprimer d'une fiche) :
```bash
docker exec fichesanitaire_db psql -U fichesanitaire -d fichesanitaire -At -c "select substring(d->>'dataUrl' from position(',' in d->>'dataUrl')+1) from kv_store, jsonb_array_elements(value) e, jsonb_array_elements(e->'cerfa'->'documents') d where key='cerfa_students_v11' and e->'cerfa'->'identity'->>'lastName'='MENDES RIOTTE' and d->>'type'='pai' limit 1;" | base64 -d > /root/PAI-Manon-Mendes-Riotte.pdf
```
Enfants déjà rattachés à des comptes (remplacer les e-mails) — pour vérifier un rattachement avant de le faire :
```bash
docker exec fichesanitaire_db psql -U fichesanitaire -d fichesanitaire -c "select e->>'internalId' as num, e->'cerfa'->'identity'->>'lastName' as nom, e->'cerfa'->'identity'->>'firstName' as prenom, e->>'schoolClass' as classe, e->'cerfa'->'legalGuardian'->>'fullName' as responsable, e->'cerfa'->'legalGuardian'->>'email' as email_resp, (select u->>'email' from kv_store k3, jsonb_array_elements(k3.value) u where k3.key='cerfa_users_v1' and u->>'id'=e->>'parentId') as compte from kv_store, jsonb_array_elements(value) e where key='cerfa_students_v11' and e->>'parentId' in (select u->>'id' from kv_store k2, jsonb_array_elements(k2.value) u where k2.key='cerfa_users_v1' and u->>'email' in ('parent1@exemple.fr','parent2@exemple.fr')) order by compte, num;"
```

### 14.4 Sauvegardes et restauration

```bash
docker cp fichesanitaire_app:/app/backups /root/backups-secours       # À FAIRE EN PREMIER en cas d'incident, avant tout redémarrage
docker exec fichesanitaire_app ls -la /app/backups
docker volume ls | grep fichesanitaire
docker volume inspect fichesanitaire-voyages_fichesanitaire_backups | grep Mountpoint

/root/restaurer-sauvegarde.sh --etat                                   # état actuel de la base (lecture seule)
/root/restaurer-sauvegarde.sh --liste [--tout]                         # sauvegardes disponibles (comptes / fiches de chacune)
/root/restaurer-sauvegarde.sh backup_AAAA-MM-JJ_HHh00.json             # simulation
/root/restaurer-sauvegarde.sh backup_AAAA-MM-JJ_HHh00.json --apply     # restauration (copie de sécurité avant-restauration_*.json créée avant)
/root/restaurer-sauvegarde.sh backup_AAAA-MM-JJ_HHh00.json --cles=cerfa_users_v1,cerfa_establishment_name_v1 --apply   # seulement certaines clés
```
Refus automatiques : sauvegarde vide, ou moins de comptes/fiches que la base actuelle (sans `--force`).

### 14.5 Fiches, comptes, doublons (`rattacher-fiche.sh`)

```bash
/root/rattacher-fiche.sh --orphelines                    # fiches sans parent, comptes anormaux/doublons, candidats, « DOUBLON PROBABLE »
/root/rattacher-fiche.sh --doublons                      # enfants ayant plusieurs fiches (fiche à garder probable)
/root/rattacher-fiche.sh --auto                          # simulation du rattachement automatique (e-mail du responsable = e-mail d'un compte)
/root/rattacher-fiche.sh --auto --apply
/root/rattacher-fiche.sh <identifiant|numéro|nom> <email-du-compte>            # simulation
/root/rattacher-fiche.sh <identifiant|numéro|nom> <email-du-compte> --apply [--force]
```
Les fiches en trop se mettent à la corbeille depuis le Suivi global (restaurable 30 jours). Le numéro `E-2026-xxx` peut exister en double : utiliser l'identifiant `s-…` affiché par le script.

### 14.6 Fichiers

```bash
ls -la /opt/fichesanitaire-voyages/fiches-pdf/ ; find /opt/fichesanitaire-voyages/fiches-pdf -name '*.pdf' | wc -l ; du -sh /opt/fichesanitaire-voyages/fiches-pdf
ls -ld --time-style=long-iso /opt/fichesanitaire-voyages/backup-avant-*          # heures d'installation des correctifs
```
`fiches-pdf/`, `backup-avant-*/` et `.env*` ne sont jamais publiés sur GitHub (données de santé).

### 14.7 GitHub (push automatique)

Dépôt miroir : `https://github.com/serviceinformatique-droid/fichesanitaireclaude` (branche `main`). Contenu poussé : le code de l'application, `scripts/` (correctifs, outils, logique de `maj-portail.sh`) et un `README.md` de documentation. **Jamais** : `.env`, `fiches-pdf/`, sauvegardes, `node_modules`, PDF, jeton.

```bash
bash /root/maj-portail.sh --github                 # UNE fois : enregistre le jeton (saisie masquée) dans /root/.github-token et teste la connexion
bash /root/maj-portail.sh --push                   # pousse maintenant (sinon : automatiquement à chaque --appliquer)
NO_PUSH=1 bash /root/maj-portail.sh --appliquer    # mise à jour sans push
ls -l /root/.github-token                          # doit afficher -rw------- (600), propriétaire root
git -C /opt/readme/git log --oneline | head        # historique du miroir (dossier de travail, ne pas modifier)
```
Le jeton doit être un jeton **fine-grained** limité à ce seul dépôt, permission « Contents : Read and write ». S'il a été exposé : le révoquer sur GitHub (Settings > Developer settings > Personal access tokens), en créer un nouveau, puis relancer `--github`. Le push ne fait jamais échouer une mise à jour : en cas de refus, un message indique la cause.

### 14.8 Fin d'année, RGPD

- **Désinscription de fin d'année** : Administration > « Voyages scolaires » > panneau « Fin d'année scolaire » (activer/désactiver, date, bouton « Désinscrire maintenant », « Annuler la dernière désinscription »). Journal : `docker compose logs app | grep fin-annee`. Copies de sécurité : `docker exec fichesanitaire_app ls -la /app/backups | grep desinscription`.
- **Onglet RGPD des parents** : Espace Famille > « Mes données (RGPD) ». Journal des PDF supprimés avec leur fiche : `docker compose logs app | grep rgpd`.
- **PDF orphelins** (fiches supprimées AVANT le correctif RGPD) — liste seule, rien n'est supprimé :
```bash
docker exec fichesanitaire_app node -e "const fs=require('fs');const idx=JSON.parse(fs.readFileSync('/app/fiches-pdf/.index.json','utf8'));fetch('http://localhost:3000/api/data/cerfa_students_v11').then(r=>r.json()).then(j=>{const a=Array.isArray(j)?j:j.value;const ids=new Set(a.map(s=>s.id));const o=Object.entries(idx).filter(([id])=>!ids.has(id));console.log(o.length+' PDF orphelin(s) (fiche supprimée) :');o.forEach(([id,p])=>console.log('  /opt/fichesanitaire-voyages/fiches-pdf/'+p));})"
```
  Après vérification, supprimer les fichiers listés (`rm`), puis retirer leur entrée de `fiches-pdf/.index.json` ou relancer « Régénérer les PDF » ne recrée que les fiches complètes existantes.
