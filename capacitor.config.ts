import type { CapacitorConfig } from "@capacitor/cli";

// App conducteur/livreur — suivi GPS continu requis (background location).
const serverUrl = process.env.CAPACITOR_SERVER_URL ?? "https://tibusride-front.vercel.app/app/driver";

const config: CapacitorConfig = {
  appId: "com.tibus.ride.driver",
  appName: "Tibus Ride Driver",
  // Voir capacitor-shell/index.html : ne PAS utiliser "public" comme webDir
  // (conflit avec le publicDir Vite, voir incident résolu précédemment).
  webDir: "capacitor-shell",
  server: {
    url: serverUrl,
    androidScheme: "https",
    cleartext: false,
  },
  android: {
    // "androidDir" n'existe pas dans le schéma Capacitor — la bonne clé pour
    // personnaliser le dossier du projet natif est android.path.
    path: "android-driver",
    allowMixedContent: false,
  },
  ios: {
    // Suivi GPS en arrière-plan : nécessitera NSLocationAlwaysAndWhenInUseUsageDescription
    // + le mode "Background Modes > Location updates" dans Xcode (Signing & Capabilities).
    path: "ios-driver",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1800,
      launchAutoHide: true,
      backgroundColor: "#00452f",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#ffffff",
    },
  },
};

export default config;
