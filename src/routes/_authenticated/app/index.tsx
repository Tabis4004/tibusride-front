import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/app/")({
  component: AppHome,
});

function AppHome() {
  const { primaryRole, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (primaryRole === "superadmin") navigate({ to: "/app/admin", replace: true });
    else if (primaryRole === "admin") navigate({ to: "/app/admin", replace: true });
    else if (primaryRole === "support") navigate({ to: "/app/support-inbox", replace: true });
    else if (primaryRole === "driver") navigate({ to: "/app/driver", replace: true });
    else navigate({ to: "/app/passenger", replace: true });
  }, [primaryRole, loading, navigate]);

  return (
    <div className="flex h-[50vh] items-center justify-center text-muted-foreground">
      Chargement…
    </div>
  );
}
