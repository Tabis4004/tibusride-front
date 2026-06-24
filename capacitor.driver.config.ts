import type { CapacitorConfig } from "@capacitor/cli";

// App conducteur/livreur — suivi GPS continu requis (background location).
const serverUrl = process.env.CAPACITOR_SERVER_URL ?? "https://tibusride-front.vercel.app/app/driver";

const config: CapacitorConfig = {
  appId: "com.tibus.ride.driver",
  appName: "Eco Tibus Chauffeur",
  // Voir capacitor-shell/index.html : ne PAS utiliser "public" comme webDir
  // (conflit avec le publicDir Vite, voir incident résolu précédemment).
  webDir: "capacitor-shell",
  androidDir: "android-driver",
  server: {
    url: serverUrl,
    androidScheme: "https",
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1800,
      launchAutoHide: true,
      backgroundColor: "#1e3a8a",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#ffffff",
    },
  },
};

export default config;
