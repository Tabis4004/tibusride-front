import { useEffect, useState } from "react";

/** Détecte l'app Capacitor Android/iOS (WebView native). */
export function useNativeApp(): boolean {
  const [native, setNative] = useState(false);

  useEffect(() => {
    const cap = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    setNative(!!cap?.isNativePlatform?.());
    document.documentElement.classList.toggle("native-app", !!cap?.isNativePlatform?.());
  }, []);

  return native;
}

export function isNativePlatform(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}
