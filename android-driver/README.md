# Tibus Ride — Application Android

Application native Android (Capacitor) qui charge l'interface web optimisée mobile depuis la production Vercel.

## Prérequis

- Node.js 20+
- [Android Studio](https://developer.android.com/studio) (SDK 34+, build-tools)
- Variable `ANDROID_HOME` ou Android SDK installé via Android Studio
- JDK 17+

## Installation

```bash
cd tibusride-front
npm install
npm run cap:sync
```

## Développement local (émulateur ou appareil)

1. Brancher un téléphone Android (mode développeur + débogage USB) ou lancer un émulateur.
2. Synchroniser le projet :

```bash
npm run cap:sync
```

3. Ouvrir dans Android Studio :

```bash
npm run cap:open:android
```

4. Dans Android Studio : **Run** ▶ sur l'appareil cible.

L'app charge par défaut `https://tibusride-front.vercel.app` (voir `capacitor.config.ts`).

Pour pointer vers un autre serveur (ex. tunnel ngrok) :

```bash
CAPACITOR_SERVER_URL=https://votre-tunnel.ngrok-free.app npm run cap:sync
```

## Build APK de test

Dans Android Studio : **Build → Build Bundle(s) / APK(s) → Build APK(s)**.

L'APK se trouve dans `android/app/build/outputs/apk/debug/`.

## Build release (Play Store)

1. Créer un keystore :

```bash
keytool -genkey -v -keystore tibus-release.keystore -alias tibus -keyalg RSA -keysize 2048 -validity 10000
```

2. Configurer `android/app/build.gradle` (signingConfigs) avec vos identifiants.
3. **Build → Generate Signed Bundle / APK** → Android App Bundle (AAB).

## Interface mobile

En mode app native (Capacitor) :

- Barre de navigation inférieure (Commander, Courses, Bonus, Aide, Réglages)
- Écran passager type Yango : accordéons, adresses récentes, pubs livraison
- Barre d'action fixe en bas avec tarif et bouton Commander
- Géolocalisation via plugin Capacitor Geolocation

## Permissions Android

Déjà configurées par Capacitor :

- `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` (point de départ GPS)
- Internet (chargement de l'app web)

## Mise à jour de l'UI

L'app charge l'URL distante : **aucune republication Play Store** n'est nécessaire pour les changements UI web. Republiez l'APK/AAB uniquement si vous modifiez les plugins natifs, permissions ou `appId`.
