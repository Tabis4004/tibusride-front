# Guide pas-à-pas — Compte Play Console + premier build/upload

## Étape 1 — Créer le compte développeur Google Play

1. Va sur https://play.google.com/console/signup
2. Connecte-toi avec le compte Google que tu veux utiliser pour gérer les
   deux apps (recommandé : un compte dédié pro, pas un compte personnel
   perso si possible — facilite la transmission/gestion future).
3. Choisis le type de compte :
   - **Personnel** : plus rapide à créer, mais Google impose un **test
     fermé de 12 testeurs pendant 14 jours consécutifs, par app**, avant
     d'autoriser la publication en production.
   - **Organisation** : nécessite un numéro D-U-N-S (Dun & Bradstreet) et
     est plus long à valider, mais n'a pas cette contrainte de test fermé.
   - Si tu es pressé, choisis Personnel et lance le test fermé dès que
     possible (voir Étape 6) — les 14 jours peuvent courir en parallèle du
     reste de la préparation (visuels, textes).
4. Paye les frais d'inscription unique (25 $US).
5. Accepte le **Developer Distribution Agreement**.
6. Complète le profil développeur (nom public, email de contact —
   `tabistibus@gmail.com`, adresse).

## Étape 2 — Générer les clés de signature (une par app)

⚠️ Ces clés ne sont **pas récupérables** en cas de perte (sauf via Play App
Signing, qui garde une copie côté Google si tu l'actives — recommandé).

Sur ta machine (pas dans ce sandbox — le `keytool` doit tourner localement) :

```bash
# App chauffeur
keytool -genkey -v -keystore tibus-driver-release.keystore \
  -alias tibus-driver -keyalg RSA -keysize 2048 -validity 10000

# App voyageur
keytool -genkey -v -keystore tibus-passenger-release.keystore \
  -alias tibus-passenger -keyalg RSA -keysize 2048 -validity 10000
```

Renseigne ensuite les chemins/mots de passe dans :
- `android-driver/keystore.properties` (copie de `keystore.properties.example`)
- `android-passenger/keystore.properties` (copie de `keystore.properties.example`)

Ces deux fichiers `keystore.properties` sont déjà dans `.gitignore` — ne les
commit jamais.

## Étape 3 — Premier build

Sur ta machine, dans le dossier du projet :

```bash
npm run android:version:bump        # incrémente versionCode (driver + passenger)
npm run android:build:all           # génère AAB + APK signés
```

Artefacts produits :
- `android-driver/app/build/outputs/bundle/release/app-release.aab`
- `android-passenger/app/build/outputs/bundle/release/app-release.aab`

C'est le fichier **.aab** (pas l'apk) qu'il faut uploader sur Play Console.

Si c'est le tout premier build, le SDK Manager peut avoir besoin de
télécharger la plateforme **Android 16 / API 36** — ça se fait
automatiquement au premier `gradle sync`, mais nécessite une connexion
internet sur ta machine (pas un problème dans ton environnement local,
contrairement au sandbox où j'ai travaillé).

## Étape 4 — Créer la fiche de l'app (par app, x2)

Dans Play Console :

1. **Toutes les applications → Créer une application**
2. Nom : "Tibus Ride" ou "Tibus Ride Driver" (voir `PLAYSTORE_LISTINGS.md`)
3. Type : Application · Gratuite
4. Déclarations : accepter les règles applicables (programme développeur,
   export US, etc. — formulaires standards Google)

## Étape 5 — Remplir la fiche store

Utilise directement `PLAYSTORE_LISTINGS.md` (titre, descriptions courte/
longue) pour le copier-coller dans **Présence sur le Store → Fiche Store
principale**.

Il manque encore (à préparer toi-même, ce sont des visuels) :
- Icône 512×512 px
- Feature graphic 1024×500 px
- Captures d'écran (2 minimum, 4-8 recommandé)

## Étape 6 — Questionnaires obligatoires

1. **Content rating (IARC)** : Présence sur le Store → Classification du
   contenu → répondre au questionnaire (catégorie "Utilitaire/Outils" ou
   "Carte et navigation" selon ce qui est proposé ; pas de contenu violent/
   adulte → classification générique attendue).
2. **Data safety form** : utilise directement `PLAYSTORE_DATA_SAFETY.md`
   pour remplir Politique → Sécurité des données.
3. **Background location form** (app chauffeur uniquement, apparaît
   automatiquement) : utilise la section dédiée de
   `PLAYSTORE_DATA_SAFETY.md`. Il faut aussi uploader la vidéo de démo
   (~30 s) — voir le script de capture dans `PLAYSTORE_CHECKLIST.md` §4.
4. **Politique de confidentialité (URL)** :
   `https://tibusride-front.vercel.app/confidentialite`
5. **Page de contact / email / site web** :
   - Email : `tabistibus@gmail.com`
   - Site web : `https://tibusride-front.vercel.app`
   - Contact : `https://tibusride-front.vercel.app/contact`

## Étape 7 — Première release (test fermé)

1. Production → onglet **Tests** → **Test fermé** → Créer une release
2. Uploader le fichier `app-release.aab`
3. Ajouter des notes de version (ex : "Première version.")
4. Ajouter les 12 testeurs requis (emails Gmail) si compte **Personnel** —
   via une liste de diffusion dans Play Console (Testeurs → créer une
   liste, coller les emails).
5. Publier la release de test → attendre que Google valide (revue
   automatique + parfois manuelle, quelques heures à quelques jours).
6. Faire courir les **14 jours consécutifs** avec au moins 12 testeurs
   actifs (ils doivent installer l'app via le lien de test, pas juste être
   invités).

## Étape 8 — Passage en production

1. Une fois les 14 jours/12 testeurs validés (ou directement si compte
   Organisation), Production → **Créer une release**.
2. Reprendre le même AAB (ou un nouveau si tu as fait des changements natifs
   depuis) et publier.
3. Répéter `npm run android:version:bump` + rebuild avant **chaque nouvel
   upload** — Play Console refuse un `versionCode` déjà utilisé.

## Rappels importants

- Les changements purement web (Vercel) ne nécessitent **pas** de nouvel
  AAB : les deux apps chargent le site en direct. Seuls les changements
  natifs (permissions, plugins Capacitor, icônes, signing) demandent un
  nouveau build.
- Je n'ai pas accès réseau à Google Play / Gradle / GitHub depuis mon
  environnement : les étapes de build, upload et `git push` doivent se
  faire depuis ta machine. Je peux préparer/modifier le code et les textes,
  mais pas exécuter ces actions à ta place.
