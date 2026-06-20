import { createFileRoute, Outlet, redirect, Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Car, Compass, LayoutDashboard, LifeBuoy, LogOut, ShieldCheck, Sparkles, Inbox } from "lucide-react";

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
  const { roles, primaryRole, user } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

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
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
