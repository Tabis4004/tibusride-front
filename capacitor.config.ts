import type { CapacitorConfig } from "@capacitor/cli";

const serverUrl = process.env.CAPACITOR_SERVER_URL ?? "https://tibusride-front.vercel.app";

const config: CapacitorConfig = {
  appId: "com.tibus.ride",
  appName: "Tibus Ride",
  // Important : ne PAS utiliser "public" ici. C'est aussi le publicDir de Vite,
  // donc un index.html y présent écrase l'index.html SSR généré par le build web
  // (Vite copie le contenu de publicDir par-dessus la sortie du build), ce qui a
  // cassé tibusride-front.vercel.app (servait ce placeholder statique au lieu de
  // l'app TanStack Start). Le shell natif Capacitor a son propre dossier dédié.
  webDir: "capacitor-shell",
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
