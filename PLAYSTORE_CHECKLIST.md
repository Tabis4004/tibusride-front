# Checklist mise en ligne Play Store — Tibus Ride (Chauffeur + Voyageur)

Deux apps = deux fiches Play Console séparées (`com.tibus.ride.driver` et
`com.tibus.ride.passenger`), chacune avec son propre cycle de test/validation.
Tout ce qui suit est à faire pour CHACUNE, sauf indication contraire.

## 0. Compte développeur

- [ ] Créer/avoir un compte Google Play Console (frais unique 25 $US).
- [ ] Si compte **personnel créé récemment** : Google impose un test fermé
      avec **12 testeurs pendant 14 jours consécutifs** avant d'autoriser la
      publication en production, et ce **par app**. Compter ce délai dans le
      planning — démarrer le test fermé dès que l'AAB est prêt, même avant
      d'avoir fini les fiches store. (Ne s'applique pas aux comptes
      "organisation".)
- [ ] Accepter le Developer Distribution Agreement.

## 1. Avant de builder

- [x] **Cible API obligatoire** : à partir du **31 août 2026**, toute
      nouvelle app ou mise à jour doit cibler **Android 16 (API 36)**.
      Fait : `compileSdkVersion`/`targetSdkVersion` passés à 36 (driver +
      passenger), AGP monté à 8.9.1 (minimum requis pour compileSdk 36,
      compatible avec le Gradle wrapper 8.11.1 déjà présent).
      → **Avant le premier build**, Android Studio/le SDK manager devra
      télécharger la plateforme SDK 36 si elle n'est pas déjà installée sur
      ta machine (se fait automatiquement au premier `gradle sync`).
- [ ] Générer **une clé de signature par app** (gardée précieusement — non
      récupérable en cas de perte, sauf via le processus Play App Signing) :
      voir `android-driver/keystore.properties.example` et
      `android-passenger/keystore.properties.example` pour la commande
      `keytool` et le format attendu. Copier en `keystore.properties` (non
      commité) une fois rempli.

## 2. Build

```bash
npm run android:version:bump        # incrémente versionCode des deux apps
npm run android:build:all           # AAB + APK signés, driver + passenger
```

Artefacts produits :
- `android-driver/app/build/outputs/bundle/release/app-release.aab`
- `android-passenger/app/build/outputs/bundle/release/app-release.aab`

C'est l'**AAB** (pas l'APK) qu'il faut uploader sur la Play Console.

## 3. Fiche store (par app)

- [ ] Icône 512×512 px (PNG, pas de transparence pour l'icône store).
- [ ] Image "feature graphic" 1024×500 px.
- [ ] Captures d'écran téléphone : minimum 2, recommandé 4-8 (déjà des
      captures admin/chauffeur existantes dans le projet — à réutiliser/
      retailler si pertinent).
- [ ] Titre, description courte (80 car.) et longue (4000 car.) — à
      différencier clairement entre Chauffeur ("Tibus Ride Driver") et
      Voyageur ("Tibus Ride").
- [x] Catégorie (Transport/Maps & navigation ou équivalent local), email de
      contact, site web.
      Email : `tabistibus@gmail.com`. WhatsApp : `+225 01 72 96 00 00`.
- [x] **Page de contact (URL publique, exigée par Play Store)** :
      Fait : page créée sur `/contact` (email + WhatsApp), liée depuis
      `/confidentialite`. URL à utiliser dans les fiches Play Console :
      `https://<ton-domaine-vercel>/contact`.
- [x] **Politique de confidentialité (URL publique, obligatoire)** :
      doit décrire la collecte caméra (photo de profil chauffeur),
      localisation précise (chauffeur : aussi en arrière-plan), numéro de
      téléphone, et le sous-traitant hébergeur (Supabase).
      Fait : page créée sur `/confidentialite` (couvre les 8 points requis +
      la disclosure "position"/"arrière-plan"/"même quand l'app est fermée"
      exigée par le formulaire background location), email de contact mis à
      jour vers `tabistibus@gmail.com`. URL à utiliser dans les deux fiches
      Play Console une fois déployée : `https://<ton-domaine-vercel>/confidentialite`.

## 4. Questionnaires obligatoires (Play Console)

- [ ] **Content rating** (questionnaire IARC).
- [ ] **Data safety form** — déclarer pour chaque app :
  - Caméra : collectée (photo de profil chauffeur), finalité "identification
    de l'utilisateur", pas de partage avec des tiers publicitaires.
  - Localisation précise : collectée ; app chauffeur = aussi en arrière-plan.
  - Numéro de téléphone : collecté (mise en contact chauffeur/voyageur).
  - Préciser le chiffrement en transit et la possibilité de suppression de
    compte/données.
- [ ] **Formulaire dédié "Background location"** (app chauffeur uniquement,
      apparaît automatiquement dans la Play Console dès que
      `ACCESS_BACKGROUND_LOCATION` est détecté dans le manifest) :
  - Expliquer la fonctionnalité cœur qui nécessite le suivi en arrière-plan
    (rester localisable pendant une course même écran éteint/app en
    arrière-plan).
  - Fournir une **vidéo de démo (~30 s max)** montrant le déclenchement de la
    permission runtime, précédé d'un message de "prominent disclosure" dans
    l'app qui mentionne explicitement les mots "position", "arrière-plan" et
    "même quand l'app est fermée" — **à vérifier si ce message existe déjà
    dans l'UI driver, sinon je peux l'ajouter avant l'enregistrement de la
    vidéo.**

## 5. Publication

- [ ] Créer la release en **test fermé** (closed testing) d'abord — surtout
      nécessaire si compte personnel récent (voir §0).
- [ ] Une fois les 12 testeurs / 14 jours validés (ou si compte déjà éligible
      production), promouvoir vers **Production**.
- [ ] Répéter `npm run android:version:bump` + rebuild avant chaque nouvel
      upload (la Play Console refuse un `versionCode` déjà utilisé).

## Notes spécifiques au projet

- Les deux apps chargent le site en direct (`server.url` dans
  `capacitor.driver.config.ts` / `capacitor.passenger.config.ts`) : un
  changement purement web (Vercel) n'exige **pas** de nouvel AAB. Seuls les
  changements natifs (permissions, plugins Capacitor, icônes, splash screen,
  signing) demandent un nouveau build + upload.
- Le bug caméra déjà corrigé (`ddf5c18`) montre bien que les deux apps ne
  sont pas interchangeables : permissions différentes par design (driver =
  caméra + localisation arrière-plan, passenger = localisation premier plan
  uniquement).
