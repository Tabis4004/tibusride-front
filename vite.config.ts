// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  vite: {
    server: {
      // Autorise les tunnels ngrok pour les tests clients à distance
      allowedHosts: [".ngrok-free.dev", ".ngrok-free.app", ".ngrok.io"],
    },
    // Expose les variables serveur (.env) au SSR / routes API
    envPrefix: ["VITE_", "POSTGRES_", "DATABASE_", "AUTH_", "GOOGLE_", "RESEND_", "EMAIL_", "SUPABASE_"],
  },
  tanstackStart: {
    server: { entry: "server" },
  },
  nitro: {
    preset: "vercel",
  },
});
