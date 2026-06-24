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

/**
 * Message vocal court (ex. "Vous avez une commande").
 *
 * Constat (cause du silence observé sur Android) : `window.speechSynthesis`
 * du WebView Android Chromium délègue au moteur TTS système, qui (a) doit
 * avoir un pack de voix fr-FR installé, et (b) n'expose ses voix qu'après
 * l'event `voiceschanged` — un `speak()` appelé avant que les voix soient
 * chargées est silencieusement ignoré (aucune erreur JS, le `try/catch`
 * masquait tout). De plus, les politiques "autoplay" de Chrome/WebView
 * bloquent parfois `speak()` tant qu'aucun geste utilisateur n'a eu lieu
 * dans la session — d'où `primeSpeechSynthesis()` ci-dessous, à appeler
 * sur un geste connu (ex. toggle "En ligne").
 *
 * Si un plugin Capacitor TTS natif est présent (ex.
 * @capacitor-community/text-to-speech, après `npm install` + `npx cap
 * sync`), on l'utilise en priorité — il passe directement par l'API
 * Android TextToSpeech, plus fiable que le WebView. Pas d'import statique
 * (même pattern que LocalNotifications plus haut) : on lit le registre
 * runtime `window.Capacitor.Plugins.TextToSpeech` pour rester fonctionnel
 * (et typecheck-able) même sans le plugin installé.
 */
interface TextToSpeechPlugin {
  speak(opts: { text: string; lang?: string; rate?: number; volume?: number; category?: string }): Promise<unknown>;
}

function getTtsPlugin(): TextToSpeechPlugin | undefined {
  const cap = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  return cap?.Plugins?.TextToSpeech as TextToSpeechPlugin | undefined;
}

let speechPrimed = false;

/**
 * À appeler une fois, sur un geste utilisateur certain (ex. clic sur le
 * toggle "En ligne") : prononce un son quasi inaudible pour lever le verrou
 * "autoplay" de certains WebView avant qu'une vraie annonce soit nécessaire.
 * Sans effet si un plugin natif est dispo (pas concerné par cette politique).
 */
export function primeSpeechSynthesis(): void {
  if (speechPrimed) return;
  speechPrimed = true;
  try {
    if (getTtsPlugin()) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const utter = new SpeechSynthesisUtterance(" ");
    utter.volume = 0;
    window.speechSynthesis.speak(utter);
  } catch {
    // Non bloquant.
  }
}

function speakWithWebApi(text: string): void {
  const synth = window.speechSynthesis;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "fr-FR";
  utter.rate = 1;
  utter.volume = 1;
  const voices = synth.getVoices();
  if (voices.length > 0) {
    const frVoice = voices.find((v) => v.lang?.toLowerCase().startsWith("fr"));
    if (frVoice) utter.voice = frVoice;
    synth.cancel();
    synth.speak(utter);
    return;
  }
  // Voix pas encore chargées (race condition fréquente au démarrage de
  // l'app) : on attend `voiceschanged` une seule fois avant de parler,
  // avec un filet de sécurité si l'event ne se déclenche jamais.
  let spoken = false;
  const trySpeak = () => {
    if (spoken) return;
    spoken = true;
    synth.cancel();
    synth.speak(utter);
  };
  const onVoices = () => {
    synth.removeEventListener("voiceschanged", onVoices);
    trySpeak();
  };
  synth.addEventListener("voiceschanged", onVoices);
  setTimeout(trySpeak, 800);
}

export function speakAnnouncement(text: string): void {
  try {
    const plugin = getTtsPlugin();
    if (plugin) {
      plugin.speak({ text, lang: "fr-FR", rate: 1, volume: 1, category: "ambient" }).catch(() => {});
      return;
    }
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    speakWithWebApi(text);
  } catch {
    // Non bloquant : une voix manquée ne doit jamais casser le reste de l'UI.
  }
}
