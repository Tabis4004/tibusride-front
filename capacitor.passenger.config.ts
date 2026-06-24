import type { CapacitorConfig } from "@capacitor/cli";

// App passager — pas de suivi GPS en arrière-plan, app légère.
const serverUrl = process.env.CAPACITOR_SERVER_URL ?? "https://tibusride-front.vercel.app/app/passenger";

const config: CapacitorConfig = {
  appId: "com.tibus.ride.passenger",
  appName: "Eco Tibus",
  webDir: "capacitor-shell",
  androidDir: "android-passenger",
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
