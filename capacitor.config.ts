import type { CapacitorConfig } from "@capacitor/cli";

// App passager — pas de suivi GPS en arrière-plan, app légère.
const serverUrl = process.env.CAPACITOR_SERVER_URL ?? "https://tibusride-front.vercel.app/app/passenger";

const config: CapacitorConfig = {
  appId: "com.tibus.ride.passenger",
  appName: "Tibus Ride",
  webDir: "capacitor-shell",
  server: {
    url: serverUrl,
    androidScheme: "https",
    cleartext: false,
  },
  android: {
    path: "android-passenger",
    allowMixedContent: false,
  },
  ios: {
    path: "ios-passenger",
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
