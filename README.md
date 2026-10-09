# Print & Secrétariat

Plateforme web de commande d'impressions et de services de secrétariat pour le marché camerounais : téléversement de documents, comptage automatique des pages, tarification en temps réel calculée par le serveur, commandes multi-documents, commandes groupées de délégués de classe, paiement Fapshi (Mobile Money / Orange Money), suivi, production et administration.

```
.
├── backend/    API REST Express + TypeScript + Prisma + PostgreSQL (déployable sur Railway)
├── frontend/   Next.js (App Router) + Tailwind CSS + composants shadcn/ui (déployable sur Vercel)
├── .env.example
└── README.md
```

Les deux applications sont indépendantes. Le frontend relaie `/api/*` vers l'API (rewrites Next.js), ce qui garde le cookie de session « first-party » sur le domaine du site.

---

## 1. Fonctionnalités

**Client**
- Inscription par téléphone (et email facultatif), connexion par téléphone ou email, réinitialisation du mot de passe.
- Parcours de commande en 4 étapes : Documents → Impression → Retrait ou livraison → Récapitulatif et paiement.
- Plusieurs fichiers à la fois (sélection multiple, glisser-déposer, ajouts progressifs, réutilisation de « Mes documents »). La limite est configurable (100 fichiers et 50 Mo par fichier par défaut), sans plafond fixe de 15.
- Analyse asynchrone de chaque fichier :
  - PDF : nombre réel de pages ;
  - DOC/DOCX : conversion LibreOffice isolée, puis comptage ;
  - images : 1 page ;
  - fichier illisible : message explicite, puis déclaration par le client (vérifiée avant impression) ou nouvelle tentative. Aucun nombre n'est inventé.
- Paramètres communs avec « Appliquer à tous », personnalisation d'un document, duplication de ses paramètres vers les autres, suppression, prix par document et total du lot.
- Retrait gratuit au **Centre de santé de Mvam-essakoe** (points de retrait configurables) ou livraison (nom, téléphone, quartier, indications). Frais par zone, tarif par défaut ou « À confirmer » : dans ce dernier cas le paiement reste bloqué jusqu'à la validation par l'équipe. Aucun supplément express automatique.
- Paiement Fapshi, retour de paiement avec revérification serveur, reçu PDF, code de retrait à 6 chiffres.
- Tableau de bord, commandes en cours et historique, annulation avant paiement, « Recommander » sans ressaisie.
- Lien de suivi public sécurisé : statut et étapes uniquement, sans document, données personnelles ni paiement.
- Notifications dans l'espace client, et par email si SMTP est configuré.
- Bouton WhatsApp flottant ; messages préremplis incluant la référence de commande.

**Délégués de classe** (espace validé par l'administration)
- Lot nommé avec établissement, filière, niveau, classe, matière, instructions, date limite et paramètres d'impression communs.
- **Mode A** : le délégué rassemble les fichiers et passe une commande unique, avec des exceptions possibles par fichier.
- **Mode B** : lien de collecte partageable (jeton aléatoire régénérable). Chaque étudiant envoie ses fichiers et paie sa part ; chaque contribution est enregistrée individuellement.
- Totaux calculés à partir des commandes confirmées et des paiements réellement confirmés.
- Règle avant production : paiement intégral, ou impression des seules contributions payées (les non payées sont annulées à la clôture).
- Le délégué peut signaler un paiement en espèces ou collectif. Il reste « à vérifier » jusqu'à la confirmation par un administrateur.
- Récapitulatif PDF et CSV.
- Isolation : un délégué ne voit jamais les groupes, documents ou paiements des autres. Il voit les noms et statuts de sa classe, jamais les fichiers ni les coordonnées des étudiants.

**Secrétariat sur devis** : mise en forme, saisie, photocopies, reliure/agrafage et prestations configurables. Le client décrit son besoin et joint des fichiers ; l'administrateur établit un devis ligne par ligne ; à l'acceptation, une commande payable est créée.

**Administration et production** (rôles `ADMIN` et `OPERATOR`)
- Tableau de bord (encaissements sur 30 jours, files, alertes) et liste des commandes filtrable (date, statut, type, paiement, remise, recherche). Export CSV protégé contre l'injection de formules.
- File de production (payées ou autorisées uniquement), changements de statut contrôlés par une machine à états.
- Téléchargement des fichiers par URL temporaire de 5 minutes, journalisé.
- Remise avec preuve : code de retrait ou vérification décrite. Livraison avec réceptionnaire, échec de livraison, rappels, report de retrait, « non retirée ».
- Exception « production sans paiement » (crédit) avec motif journalisé ; dérogation de groupe.
- Encaissement en espèces au comptoir, validation des paiements déclarés, revérification Fapshi, alertes de double paiement, annulations, remboursements consignés.
- Tarifs (8 combinaisons couleur × faces × format, à la page ou à la feuille), finitions, zones de livraison, points de retrait, paramètres (limites, rappels, conservation), prestations.
- Utilisateurs : rôles, désactivation, validation des délégués, création de comptes opérateurs avec lien d'activation, liens de réinitialisation.
- Journal d'audit.
- L'opérateur accède à la production et aux fichiers des commandes payées, sans accès aux paiements, tarifs, paramètres ni journal d'audit.

---

## 2. Tarification

| Combinaison (A4)          | Tarif initial          |
| ------------------------- | ---------------------- |
| Noir et blanc, recto      | 20 FCFA / page         |
| Couleur, recto            | 25 FCFA / page         |
| Noir et blanc, recto verso | 15 FCFA / page (règle distincte) |
| Agrafage                  | 50 FCFA / exemplaire   |
| Reliure spirale           | 250 FCFA / exemplaire  |
| Reliure cartonnée rigide  | 2 000 FCFA / exemplaire |

- Chaque combinaison couleur / faces / format est une **règle distincte** : le tarif recto verso n'est jamais additionné au tarif noir & blanc ou couleur.
- **Couleur recto verso A4 et toutes les combinaisons A3 n'ont pas de tarif communiqué.** Elles sont livrées « non configurées » (affichées « Sur demande » et non commandables) jusqu'à ce que vous saisissiez leur prix dans **Administration → Tarifs**.
- Quantités distinguées : pages du fichier, faces imprimées (pages × exemplaires) et feuilles physiques (⌈pages / 2⌉ × exemplaires en recto verso). Un PDF de 20 pages en recto verso donne 10 feuilles A4.
- Le prix est **toujours calculé par le serveur**. Un montant envoyé par le navigateur est ignoré.
- À la confirmation, les montants et la grille appliquée sont **figés dans un instantané** (`pricingSnapshot`). Les commandes passées ne changent pas si les tarifs évoluent.
- Fapshi impose un paiement minimal de 100 FCFA. Une commande inférieure ne peut pas être payée en ligne et le client en est informé.

---

## 3. Prérequis

- Node.js **20.11+** (testé avec Node 22)
- PostgreSQL **14+** (testé avec PostgreSQL 16)
- LibreOffice (`soffice`) pour convertir les DOC/DOCX. Sans LibreOffice, ces fichiers passent en vérification manuelle. L'image Docker du backend l'inclut.
- Facultatif : un stockage compatible S3 (production), un serveur SMTP, ClamAV (`clamd`).

---

## 4. Installation locale

```bash
# 1. Base de données
createuser -P printer            # mot de passe : printer (exemple)
createdb -O printer printer_dev

# 2. API
cd backend
cp .env.example .env             # ajustez DATABASE_URL ; PAYMENT_PROVIDER=mock pour développer sans Fapshi
npm install
npx prisma migrate deploy        # applique les migrations (rôles et finitions inclus)
npm run db:seed                  # tarifs initiaux, point de retrait, prestations
ADMIN_FULL_NAME="Votre Nom" ADMIN_PHONE="+2376XXXXXXXX" ADMIN_EMAIL="vous@exemple.cm" npm run create-admin
npm run dev                      # http://localhost:4000 — documentation Swagger : http://localhost:4000/api/docs

# 3. Frontend (autre terminal)
cd frontend
cp .env.example .env.local       # BACKEND_URL=http://localhost:4000
npm install
npm run dev                      # http://localhost:3000
```

### Commandes utiles

| Dossier    | Commande                    | Rôle                                                    |
| ---------- | --------------------------- | ------------------------------------------------------- |
| `backend`  | `npm run dev`               | API + worker intégré (rechargement à chaud)             |
| `backend`  | `npm run build && npm start` | Build et démarrage en production                       |
| `backend`  | `npm run start:worker`      | Worker séparé (si `WORKER_INLINE=false` sur l'API)      |
| `backend`  | `npm run prisma:migrate`    | Créer une migration (développement)                     |
| `backend`  | `npm run prisma:deploy`     | Appliquer les migrations                                |
| `backend`  | `npm run typecheck` / `npm run lint` / `npm test` | Vérifications                    |
| `frontend` | `npm run build` / `npm start` | Build et démarrage en production                      |
| `frontend` | `npm run typecheck` / `npm run lint` | Vérifications                                  |
| `frontend` | `npm run test:e2e`          | Parcours Playwright (voir § 12)                         |

---

## 5. Variables d'environnement

Le fichier détaillé est `backend/.env.example` ; les principales variables sont décrites ci-dessous.

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | Chaîne de connexion PostgreSQL |
| `FRONTEND_URL` | Origine(s) du frontend, séparées par des virgules (CORS, contrôle d'origine, liens) |
| `API_PUBLIC_URL` | URL publique de l'API (liens signés du stockage local, Swagger) |
| `APP_SECRET` | ≥ 32 caractères, **obligatoire en production** (signature des liens de stockage) |
| `TRUST_PROXY` | Nombre de proxys de confiance (`1` sur Railway ; `2` si les requêtes passent par Vercel puis Railway) |
| `STORAGE_DRIVER` | `local` ou `s3` |
| `S3_*` | Bucket, région, endpoint, clés (stockage compatible S3) |
| `PAYMENT_PROVIDER` | `fapshi`, `mock` (simulateur, **refusé en production**) ou `none` |
| `FAPSHI_ENV` | `sandbox` ou `live` |
| `FAPSHI_API_USER` / `FAPSHI_API_KEY` | Identifiants fournis par Fapshi (**serveur uniquement**) |
| `FAPSHI_WEBHOOK_SECRET` | Secret de webhook défini sur le tableau de bord Fapshi (obligatoire en production) |
| `FAPSHI_DIRECT_PAY_ENABLED` | `true` seulement si Fapshi a activé le paiement direct sur votre compte |
| `SMTP_*`, `EMAIL_FROM` | Notifications par email (facultatif) |
| `LIBREOFFICE_PATH`, `CONVERSION_TIMEOUT_MS` | Conversion des documents Word |
| `CLAMAV_HOST` / `CLAMAV_PORT` | Antivirus facultatif (clamd) |
| `WORKER_INLINE`, `WORKER_CONCURRENCY` | Traitement asynchrone dans l'API ou dans un processus séparé |

Frontend : `BACKEND_URL` (défini **au moment du build**) et `NEXT_PUBLIC_SUPPORT_WHATSAPP`.

Au démarrage, l'API valide sa configuration et refuse de se lancer en production si un élément critique manque : `APP_SECRET`, secret de webhook, simulateur de paiement actif, sandbox Fapshi non autorisée.

---

## 6. Base de données et migrations

- Le schéma est dans `backend/prisma/schema.prisma`, avec les entités `User`, `Role`, `CustomerProfile`, `DelegateProfile`, `Session`, `Document`, `PrintConfiguration`, `PriceRule`, `FinishingOption`, `PickupPoint`, `DeliveryZone`, `Order`, `OrderItem`, `OrderStatusHistory`, `Delivery`, `Pickup`, `GroupOrder`, `GroupContribution`, `Payment`, `PaymentEvent`, `Refund`, `ServiceOffering`, `Quote`, `Notification`, `AuditLog`, `AppSetting` et `Job`.
- Montants : entiers en FCFA. Contraintes `CHECK` de positivité. Index sur les accès fréquents.
- Un index unique partiel garantit **un seul paiement réussi appliqué par commande**.
- Les opérations critiques (confirmation, paiement, remise, production de groupe) s'exécutent dans des transactions avec verrouillage `SELECT … FOR UPDATE`.
- La migration `roles_and_integrity` insère les rôles et les finitions de référence.
- `npm run db:seed` est idempotent et n'écrase jamais vos modifications ultérieures.

---

## 7. Compte administrateur initial

Aucun compte n'est créé par défaut et aucun mot de passe n'est écrit dans le code.

```bash
# Développement
ADMIN_FULL_NAME="Nom Prénom" ADMIN_PHONE="+2376XXXXXXXX" ADMIN_EMAIL="admin@exemple.cm" npm run create-admin
# Production (après build), par exemple dans un shell Railway
ADMIN_FULL_NAME="Nom Prénom" ADMIN_PHONE="+2376XXXXXXXX" npm run create-admin:prod
```

Sans `ADMIN_PASSWORD`, un mot de passe robuste est généré puis **affiché une seule fois** ; changez-le après la première connexion (Profil). Si le compte existe déjà, il est promu administrateur, et son mot de passe n'est remplacé qu'avec `ADMIN_RESET_PASSWORD=true`. Les comptes opérateurs se créent ensuite depuis **Administration → Utilisateurs**, avec un lien d'activation de 72 h.

---

## 8. Paiement Fapshi

L'intégration suit l'API documentée par Fapshi (https://docs.fapshi.com) :

| Usage | Appel |
| --- | --- |
| Lien de paiement (Mobile Money, Orange Money…) | `POST /initiate-pay` → `link`, `transId` |
| Paiement direct (si activé par Fapshi) | `POST /direct-pay` |
| Vérification | `GET /payment-status/:transId` (`CREATED`, `PENDING`, `SUCCESSFUL`, `FAILED`, `EXPIRED`) |
| Expiration d'un ancien lien | `POST /expire-pay` |

- Hôtes : `https://sandbox.fapshi.com` (test) et `https://live.fapshi.com` (production).
- Authentification : en-têtes `apiuser` et `apikey`, jamais exposés au navigateur.

**Configuration**
1. Créez un compte marchand Fapshi et récupérez `apiuser` et `apikey` (d'abord en sandbox).
2. Renseignez `PAYMENT_PROVIDER=fapshi`, `FAPSHI_ENV`, `FAPSHI_API_USER`, `FAPSHI_API_KEY`.
3. Sur le tableau de bord Fapshi, configurez le **webhook** :
   - URL : `https://<votre-api>/api/payments/fapshi/webhook`
   - secret : une valeur aléatoire, à reporter dans `FAPSHI_WEBHOOK_SECRET`.
4. Le paiement direct (`direct-pay`) doit être activé par le support Fapshi avant de passer `FAPSHI_DIRECT_PAY_ENABLED=true`.

**Garanties**
- La commande n'est payée qu'après **revérification du statut auprès de l'API Fapshi**, quelle que soit la source : webhook, retour du client, rapprochement ou action admin. Le corps du webhook n'est jamais cru tel quel.
- Le montant et la référence (`externalId` = identifiant de la tentative) sont contrôlés. En cas d'écart, rien n'est confirmé et les administrateurs sont alertés.
- **Idempotence** : un événement reçu deux fois est ignoré (clé de déduplication) et un paiement confirmé ne se retraite jamais. Un paiement réussi supplémentaire est marqué « doublon à rembourser ».
- Fapshi n'envoie qu'un webhook par événement ; un **rapprochement automatique** toutes les 2 minutes rattrape un webhook perdu.
- Les événements de paiement sont journalisés sans secret ni clé.
- Fapshi ne propose pas d'API de remboursement : le remboursement s'effectue hors application (transfert Mobile Money, espèces…) puis se consigne dans la commande.

**Sans identifiants Fapshi** : `PAYMENT_PROVIDER=mock` active un **simulateur de développement** clairement séparé. Un bandeau « MODE TEST » s'affiche, le résultat est choisi manuellement et les paiements sont marqués `SANDBOX`. Il est refusé en production. `PAYMENT_PROVIDER=none` désactive le paiement en ligne.

---

## 9. Stockage des documents

- Les documents sont **toujours privés**. Le navigateur téléverse directement vers le stockage via une URL signée valable 30 minutes, avec une taille maximale imposée. Les téléchargements utilisent des URL temporaires de 5 minutes.
- `STORAGE_DRIVER=local` : disque local (`STORAGE_LOCAL_DIR`), adapté au développement ou à un volume Railway. Les liens signés passent par `API_PUBLIC_URL`.
- `STORAGE_DRIVER=s3` (recommandé en production) : AWS S3, Cloudflare R2, Backblaze B2, MinIO… Le bucket doit rester **privé** et sa politique CORS doit autoriser l'envoi depuis le site :

```json
[
  {
    "AllowedOrigins": ["https://votre-site.vercel.app"],
    "AllowedMethods": ["POST"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3000
  }
]
```

- **Sécurité des fichiers**
  - liste blanche d'extensions et vérification de la signature binaire (une extension falsifiée est refusée) ;
  - DOCX : contrôle de l'archive (protection contre les « zip bomb »), refus des macros ; DOC : refus des macros ;
  - PDF : refus du JavaScript et des actions de lancement ; fichiers corrompus signalés ;
  - conversion LibreOffice dans un processus séparé, avec profil jetable, environnement minimal et délai maximal ;
  - antivirus ClamAV facultatif.
- **Conservation** : les fichiers sont supprimés automatiquement N jours après la fin de la commande (`documents.retentionDays`, 30 par défaut). Les fichiers jamais utilisés sont supprimés après 7 jours.

---

## 10. Déploiement

### Backend sur Railway
1. Créez un projet Railway avec un service **PostgreSQL**.
2. Ajoutez un service depuis ce dépôt avec **Root Directory = `backend`**. `backend/railway.json` utilise le `Dockerfile` (Node 22 + LibreOffice Writer). Le démarrage applique les migrations (`prisma migrate deploy`) puis lance l'API ; le contrôle de santé est `/api/health`.
3. Variables : `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `NODE_ENV=production`, `APP_SECRET`, `FRONTEND_URL=https://<site>.vercel.app`, `API_PUBLIC_URL=https://<api>.up.railway.app`, `TRUST_PROXY=2`, les variables `STORAGE_DRIVER`/`S3_*`, les variables Fapshi et éventuellement SMTP.
4. Initialisez une seule fois depuis un shell Railway : `npm run db:seed:prod`, puis `npm run create-admin:prod`.
5. Facultatif : un second service avec la même image et la commande `node dist/src/worker.js` pour les conversions lourdes. Dans ce cas, mettez `WORKER_INLINE=false` sur l'API.
6. Stockage local sur Railway : montez un volume sur `/app/storage`. S3 reste recommandé.

### Frontend sur Vercel
1. Importez le dépôt avec **Root Directory = `frontend`** ; Next.js est détecté automatiquement, aucun `vercel.json` n'est nécessaire.
2. Variables (définies **avant le build**) : `BACKEND_URL=https://<api>.up.railway.app` et `NEXT_PUBLIC_SUPPORT_WHATSAPP=+237694600007`.
3. Après le premier déploiement, reportez l'URL Vercel (ou votre domaine) dans `FRONTEND_URL` côté Railway.

Le cookie de session (`ps_session`, httpOnly, SameSite=Lax, Secure en production) est posé sur le domaine Vercel grâce aux rewrites `/api/*`.

### Webhooks
- Fapshi : `https://<api>/api/payments/fapshi/webhook`, avec en-tête `x-wh-secret` (cf. § 8).
- Swagger : `/api/docs` en développement. En production, il n'est servi qu'avec `ENABLE_API_DOCS=true` ; `/api/openapi.json` reste disponible.

---

## 11. Sauvegardes et exploitation

- **Base de données** : activez les sauvegardes Railway et exportez aussi régulièrement hors plateforme :
  ```bash
  pg_dump "$DATABASE_URL" --format=custom --file=print-secretariat-$(date +%F).dump
  pg_restore --clean --if-exists --dbname="$DATABASE_URL" print-secretariat-AAAA-MM-JJ.dump   # restauration
  ```
- **Fichiers** : activez le versionnement ou la réplication du bucket S3, ou sauvegardez le volume Railway. Les documents sont temporaires (politique de conservation) ; les reçus PDF sont régénérés à la demande depuis la base.
- **Journal d'audit** : il couvre les actions d'administration, les paiements manuels, les exceptions de crédit, les téléchargements de fichiers et les changements de tarifs.
- **Tâches planifiées** (worker) :
  - rapprochement des paiements (2 min) ;
  - rappels de retrait (30 min, espacés et plafonnés) ;
  - conservation des documents (6 h) ;
  - nettoyage technique.

---

## 12. Tests

```bash
# Backend : unitaires + intégration sur une vraie base PostgreSQL (printer_test)
createdb -O printer printer_test
cd backend && npm test          # TEST_DATABASE_URL permet de cibler une autre base

# Frontend : parcours E2E (API + frontend démarrés, base initialisée, admin créé)
cd backend && PAYMENT_PROVIDER=mock DISABLE_RATE_LIMIT=true npm run dev
cd frontend && npm run build && BACKEND_URL=http://localhost:4000 npm start
E2E_ADMIN_PHONE=6XXXXXXXX E2E_ADMIN_PASSWORD=... npm run test:e2e
```

Couverture backend (73 tests) :
- tarification (N&B, couleur, recto verso distinct, feuilles et faces, exemplaires, reliures, combinaisons non configurées) ;
- analyse des fichiers (multipage, images, extensions falsifiées, PDF corrompu ou avec JavaScript, DOCX avec macros, conversion LibreOffice) ;
- commandes multi-documents (30 fichiers, montants client ignorés, instantané figé, livraison à confirmer) ;
- paiements (confirmation vérifiée, webhooks dupliqués et concurrents, montant incohérent, double paiement, webhook authentifié et revérifié, adaptateur Fapshi) ;
- commandes groupées (modes A et B, isolation des délégués, paiement espèces vérifié par l'admin, règles de production) ;
- production et transitions de statut, accès aux fichiers et par rôle, suivi public, devis, rappels et conservation, authentification.

Les parcours E2E Playwright (mobile et bureau) couvrent :
- les pages publiques ;
- la commande complète (téléversement, analyse, options, prix, confirmation, paiement simulé, code de retrait) ;
- le refus de format ;
- les pages d'administration ;
- le lancement en production ;
- la validation d'un délégué et la création d'un lot avec lien de collecte.

---

## 13. Éléments externes à configurer

| Élément | Où | Statut par défaut |
| --- | --- | --- |
| Identifiants Fapshi (`apiuser`, `apikey`) et passage en `live` | Railway | Non fournis : simulateur en développement |
| Webhook Fapshi + `FAPSHI_WEBHOOK_SECRET` | Tableau de bord Fapshi + Railway | À créer |
| Activation du paiement direct | Support Fapshi | Désactivé (le lien de paiement fonctionne sans) |
| Prix couleur recto verso A4 et formats A3 | Administration → Tarifs | Non communiqués : non commandables |
| Frais de livraison (zones ou tarif par défaut) | Administration → Retrait & livraison / Paramètres | « À confirmer » |
| Horaires et adresse détaillée du point de retrait | Administration → Retrait & livraison | Nom seulement |
| Bucket S3 privé + CORS | Fournisseur S3 + Railway | Stockage local |
| SMTP (emails) | Railway | Désactivé (notifications dans l'espace client) |
| WhatsApp Business API | Point d'extension `backend/src/modules/notifications/whatsapp.ts` | Non branché : liens wa.me uniquement, aucun envoi automatique |
| Photos du site | `frontend/public/images` + `src/config/site.ts` | Illustration intégrée |
| ClamAV (facultatif) | `CLAMAV_HOST` | Désactivé |
