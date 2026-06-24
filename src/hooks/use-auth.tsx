import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type Role = "passenger" | "driver" | "admin" | "support" | "superadmin" | "insurer";

type AuthCtx = {
  user: User | null;
  session: Session | null;
  roles: Role[];
  loading: boolean;
  hasRole: (r: Role) => boolean;
  primaryRole: Role | null;
  refreshRoles: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRoles = async (uid: string | undefined) => {
    if (!uid) return setRoles([]);
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", uid);
    setRoles(((data ?? []) as { role: Role }[]).map((r) => r.role));
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      // Defer to avoid deadlock in callback
      setTimeout(() => loadRoles(s?.user?.id), 0);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      loadRoles(data.session?.user?.id).finally(() => setLoading(false));
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value: AuthCtx = {
    user, session, roles, loading,
    hasRole: (r) => {
      if (r === "admin") return roles.includes("admin") || roles.includes("superadmin");
      return roles.includes(r);
    },
    primaryRole: roles.includes("superadmin") ? "superadmin" : roles.includes("admin") ? "admin" : roles.includes("support") ? "support" : roles.includes("insurer") ? "insurer" : roles.includes("driver") ? "driver" : roles.includes("passenger") ? "passenger" : null,
    refreshRoles: () => loadRoles(user?.id),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used inside AuthProvider");
  return c;
}
