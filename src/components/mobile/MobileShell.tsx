import { Link, useRouterState } from "@tanstack/react-router";
import { Car, Compass, LayoutDashboard, LifeBuoy, Settings, Sparkles } from "lucide-react";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

// Le tableau de bord conducteur (/app/driver) — qui contient le toggle
// "En ligne", le bandeau d'offre et la liste "Courses disponibles" —
// n'avait aucune entrée dans la barre d'onglets native. Un chauffeur qui
// quittait cette page (ex. via "Voir détails" sur une course) n'avait alors
// plus aucun moyen d'y revenir depuis l'app native.
const TABS = [
  { to: "/app/passenger" as const, label: "Commander", icon: Compass, roles: ["passenger"] },
  { to: "/app/driver" as const, label: "Conduire", icon: Car, roles: ["driver"] },
  { to: "/app/rides" as const, label: "Courses", icon: LayoutDashboard, roles: null },
  { to: "/app/rewards" as const, label: "Bonus", icon: Sparkles, roles: null },
  { to: "/app/support" as const, label: "Aide", icon: LifeBuoy, roles: null },
  { to: "/app/settings" as const, label: "Réglages", icon: Settings, roles: null },
] as const;

export function MobileShell({ children }: { children: React.ReactNode }) {
  const { roles } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const visibleTabs = TABS.filter((t) => {
    if (!t.roles) return true;
    return t.roles.some((r) => roles.includes(r));
  });

  return (
    <div className="native-shell flex min-h-[100dvh] flex-col bg-background">
      <header className="native-header sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-3">
          {/* "/app" redirige automatiquement vers la page d'accueil du rôle
              (driver -> /app/driver, passenger -> /app/passenger, etc.) —
              avant ce lien renvoyait toujours vers /app/passenger, ce qui
              empêchait un chauffeur de revenir à son tableau de bord via le
              logo. */}
          <Link to="/app"><Logo compact /></Link>
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Tibus Ride</span>
        </div>
      </header>

      <main className="native-main flex-1 overflow-y-auto px-3 py-4 pb-28">{children}</main>

      <nav className="native-tabbar fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-stretch justify-around px-1 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {visibleTabs.map(({ to, label, icon: Icon }) => {
            const active = pathname === to || ((to === "/app/passenger" || to === "/app/driver") && pathname.startsWith(to));
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-[10px] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className={cn("h-5 w-5", active && "text-primary")} />
                <span className="truncate">{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
