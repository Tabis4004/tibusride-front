import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useNativeApp } from "@/hooks/use-native-app";
import { MobileShell } from "@/components/mobile/MobileShell";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Car, Compass, LayoutDashboard, LifeBuoy, LogOut, Settings, ShieldCheck, Sparkles, Inbox } from "lucide-react";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Use getSession() (local storage + auto-refresh) instead of getUser()
    // to avoid spurious logouts on transient network errors during navigation.
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/auth" });
    return { user: data.session.user };
  },
  component: AppLayout,
});

function AppLayout() {
  const { roles, primaryRole, user, hasRole } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isNative = useNativeApp();

  const profileQ = useQuery({
    queryKey: ["self-profile-gate", user?.id],
    enabled: !!user && !hasRole("superadmin"),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("country, phone")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!user || hasRole("superadmin")) return;
    if (profileQ.isLoading) return;
    const incomplete = !profileQ.data?.country?.trim() || !profileQ.data?.phone?.trim();
    if (incomplete && pathname !== "/app/complete-profile") {
      navigate({ to: "/app/complete-profile", replace: true });
    }
  }, [user, hasRole, profileQ.data, profileQ.isLoading, pathname, navigate]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  if (isNative) {
    return <MobileShell><Outlet /></MobileShell>;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link to="/app"><Logo /></Link>
          <nav className="hidden gap-1 md:flex">
            {roles.includes("passenger") && (
              <Link to="/app/passenger">
                <Button variant="ghost" size="sm" className="gap-2"><Compass className="h-4 w-4" />Commander</Button>
              </Link>
            )}
            {roles.includes("driver") && (
              <Link to="/app/driver">
                <Button variant="ghost" size="sm" className="gap-2"><Car className="h-4 w-4" />Conduire</Button>
              </Link>
            )}
            {(roles.includes("admin") || roles.includes("superadmin")) && (
              <Link to="/app/admin">
                <Button variant="ghost" size="sm" className="gap-2"><ShieldCheck className="h-4 w-4" />Admin</Button>
              </Link>
            )}
            {(roles.includes("support") || roles.includes("admin") || roles.includes("superadmin")) && (
              <Link to="/app/support-inbox">
                <Button variant="ghost" size="sm" className="gap-2"><Inbox className="h-4 w-4" />Support</Button>
              </Link>
            )}
            <Link to="/app/rides">
              <Button variant="ghost" size="sm" className="gap-2"><LayoutDashboard className="h-4 w-4" />Mes courses</Button>
            </Link>
            <Link to="/app/rewards">
              <Button variant="ghost" size="sm" className="gap-2"><Sparkles className="h-4 w-4" />Récompenses</Button>
            </Link>
            <Link to="/app/support">
              <Button variant="ghost" size="sm" className="gap-2"><LifeBuoy className="h-4 w-4" />Aide</Button>
            </Link>
            <Link to="/app/settings">
              <Button variant="ghost" size="sm" className="gap-2"><Settings className="h-4 w-4" />Paramètres</Button>
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-xs text-muted-foreground capitalize">{primaryRole}</div>
              <div className="text-sm font-medium truncate max-w-[150px]">{user?.email}</div>
            </div>
            <Button variant="ghost" size="icon" onClick={handleSignOut} title="Déconnexion">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {/* Mobile nav */}
        <nav className="flex gap-1 overflow-x-auto border-t border-border px-2 py-2 md:hidden">
          {roles.includes("passenger") && (
            <Link to="/app/passenger"><Button variant="ghost" size="sm">Commander</Button></Link>
          )}
          {roles.includes("driver") && (
            <Link to="/app/driver"><Button variant="ghost" size="sm">Conduire</Button></Link>
          )}
          {(roles.includes("admin") || roles.includes("superadmin")) && (
            <Link to="/app/admin"><Button variant="ghost" size="sm">Admin</Button></Link>
          )}
          {(roles.includes("support") || roles.includes("admin") || roles.includes("superadmin")) && (
            <Link to="/app/support-inbox"><Button variant="ghost" size="sm">Inbox</Button></Link>
          )}
          <Link to="/app/rides"><Button variant="ghost" size="sm">Courses</Button></Link>
          <Link to="/app/rewards"><Button variant="ghost" size="sm">Récompenses</Button></Link>
          <Link to="/app/support"><Button variant="ghost" size="sm">Aide</Button></Link>
          <Link to="/app/settings"><Button variant="ghost" size="sm">Réglages</Button></Link>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
