/**
 * Notifications "système" multiplateforme.
 *
 * Sur le web, on utilise l'API `Notification` du navigateur. Mais le
 * WebView Android utilisé par l'app Capacitor ne l'implémente PAS
 * ("Notifications non supportées par ce navigateur" côté chauffeur) —
 * il faut passer par le plugin natif @capacitor/local-notifications.
 *
 * Pas d'import statique du plugin ici : il n'existe côté JS qu'après
 * `npm install @capacitor/local-notifications` + `npx cap sync`
 * (autolinking natif). On l'appelle donc via le registre runtime
 * `window.Capacitor.Plugins.LocalNotifications`, exposé uniquement
 * quand le plugin natif a bien été synchronisé dans l'app — ce qui
 * permet aussi à ce fichier de typechecker même avant l'installation
 * de la dépendance.
 */
import { isNativePlatform } from "@/hooks/use-native-app";

export type NotifyPermission = "granted" | "denied" | "default";

interface LocalNotificationsPlugin {
  checkPermissions(): Promise<{ display: string }>;
  requestPermissions(): Promise<{ display: string }>;
  schedule(opts: { notifications: Array<{ id: number; title: string; body: string; schedule?: { at: Date } }> }): Promise<unknown>;
}

function getPlugin(): LocalNotificationsPlugin | undefined {
  const cap = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  return cap?.Plugins?.LocalNotifications as LocalNotificationsPlugin | undefined;
}

function toPermission(display: string | undefined): NotifyPermission {
  if (display === "granted") return "granted";
  if (display === "denied") return "denied";
  return "default";
}

let nextNotifId = 1;

/** L'app peut-elle afficher des notifications système sur cette plateforme/build ? */
export function isNotifySupported(): boolean {
  if (isNativePlatform()) return !!getPlugin();
  return typeof Notification !== "undefined";
}

export async function getNotifyPermission(): Promise<NotifyPermission> {
  if (isNativePlatform()) {
    const plugin = getPlugin();
    if (!plugin) return "default";
    try {
      const res = await plugin.checkPermissions();
      return toPermission(res?.display);
    } catch {
      return "default";
    }
  }
  if (typeof Notification === "undefined") return "default";
  return Notification.permission as NotifyPermission;
}

export async function requestNotifyPermission(): Promise<NotifyPermission> {
  if (isNativePlatform()) {
    const plugin = getPlugin();
    if (!plugin) return "default";
    try {
      const res = await plugin.requestPermissions();
      return toPermission(res?.display);
    } catch {
      return "default";
    }
  }
  if (typeof Notification === "undefined") return "default";
  return (await Notification.requestPermission()) as NotifyPermission;
}

/** Affiche une notification système si la permission est déjà accordée (silencieux sinon). */
export async function showLocalNotification(title: string, body: string): Promise<void> {
  if (isNativePlatform()) {
    const plugin = getPlugin();
    if (!plugin) return;
    try {
      await plugin.schedule({
        notifications: [{ id: nextNotifId++, title, body, schedule: { at: new Date(Date.now() + 100) } }],
      });
    } catch {
      // Non bloquant : une notif manquée ne doit jamais casser le reste de l'UI.
    }
    return;
  }
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/favicon.ico" });
  } catch {
    // idem
  }
}
