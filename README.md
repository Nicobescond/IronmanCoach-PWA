# IronmanCoach PWA

Application web installable sur téléphone (iPhone et Android) qui affiche :
- **Aujourd'hui** : les séances du jour, détaillées étape par étape (durées, cibles FC, watts ou allure, récupérations), l'objectif, la charge d'entraînement et la récupération ;
- **Planning** : la semaine jour par jour, avec la possibilité de **déplacer une séance**.

Démonstration avec des données fictives : ajoutez `?demo` à l'adresse.

## Fonctionnement
```
PC (IronmanCoach) ──envoie──▶ Supabase : mobile_snapshots ──lit──▶ PWA (téléphone)
       ▲                                                            │
       └──applique── Supabase : mobile_commands ◀──« Déplacer »─────┘
```
- Le PC envoie automatiquement une « photo » de ses données toutes les 2 minutes, tant qu'IronmanCoach est ouvert et connecté (bouton **Mobile / iPhone**).
- Un déplacement fait sur le téléphone est appliqué par le PC à la synchronisation suivante.
- Chaque athlète a son propre compte et ne voit que ses données : les règles RLS de Supabase l'imposent.
- Ce dépôt est **public**. Il ne contient aucune donnée personnelle : seulement le code, et l'URL et la clé *publishable* de Supabase, qui sont publiques par conception.

## Mise en place (une seule fois)

### 1. Supabase
1. Créez un projet gratuit sur https://supabase.com (**New project**, région *West EU*).
2. Ouvrez **SQL Editor**, puis **New query**. Collez le contenu de [`supabase/schema.sql`](supabase/schema.sql) et cliquez sur **Run**.
3. Allez dans **Authentication**, puis **Sign In / Providers**, et désactivez **Allow new users to sign up**, pour que personne ne puisse créer de compte.
4. Pour chaque athlète, allez dans **Authentication**, puis **Users**, puis **Add user** : saisissez son e-mail et un mot de passe, et cochez **Auto Confirm User**.
5. Allez dans **Project Settings** et notez deux valeurs :
   - l'**URL du projet** (`https://xxxx.supabase.co`) ;
   - la **Publishable key** (`sb_publishable_...`).

   Ne copiez **jamais** la clé *secret* ni la clé *service_role*.

### 2. Relier la PWA
Renseignez les deux valeurs dans [`config.js`](config.js), puis faites un commit et un push.

### 3. Publier sur GitHub Pages
Dans le dépôt GitHub, allez dans **Settings**, puis **Pages** :
- **Source** : *Deploy from a branch* ;
- **Branch** : `main`, dossier `/ (root)` ;
- cliquez sur **Save**.

Une à deux minutes plus tard, l'application est en ligne à l'adresse `https://<pseudo>.github.io/IronmanCoach-PWA/`.

### 4. Relier le PC de chaque athlète
Dans IronmanCoach :
1. Cliquez sur le bouton **Mobile / iPhone**.
2. Saisissez l'URL Supabase, la clé publishable, puis l'e-mail et le mot de passe **de l'athlète**.
3. L'indicateur doit afficher « Mobile : ✓ connecté ».

### 5. Installer sur le téléphone
- **iPhone** (Safari) : ouvrez l'adresse, touchez **Partager**, puis **Sur l'écran d'accueil**.
- **Android** (Chrome) : ouvrez l'adresse, puis le menu **⋮** et **Installer l'application**.

## Mettre à jour la PWA
Modifiez les fichiers, puis augmentez `VERSION` dans [`sw.js`](sw.js) : sans cela, les téléphones peuvent garder l'ancienne version en cache. Faites ensuite un commit et un push. GitHub Pages republie tout seul.

## Fichiers
| Fichier | Rôle |
|---|---|
| `index.html`, `styles.css`, `app.js` | L'application (sans dépendance externe) |
| `demo.js` | Données fictives du mode démo |
| `config.js` | URL et clé publique Supabase |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installation sur l'écran d'accueil et ouverture hors ligne |
| `supabase/schema.sql` | Tables et règles de sécurité Supabase |
