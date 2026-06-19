import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getSession, signOut as signOutFn } from "@/lib/auth.functions";

type Role = "passenger" | "driver" | "admin" | "support";

export type AuthUser = {
  id: string;
  email: string;
};

type AuthCtx = {
  user: AuthUser | null;
  roles: Role[];
  loading: boolean;
  hasRole: (r: Role) => boolean;
  primaryRole: Role | null;
  refreshRoles: () => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const getSessionServer = useServerFn(getSession);
  const signOutServer = useServerFn(signOutFn);

  const loadSession = async () => {
    const data = await getSessionServer();
    setUser(data.user);
    setRoles((data.roles ?? []) as Role[]);
  };

  useEffect(() => {
    loadSession().finally(() => setLoading(false));
  }, []);

  const value: AuthCtx = {
    user,
    roles,
    loading,
    hasRole: (r) => roles.includes(r),
    primaryRole: roles.includes("admin")
      ? "admin"
      : roles.includes("support")
        ? "support"
        : roles.includes("driver")
          ? "driver"
          : roles.includes("passenger")
            ? "passenger"
            : null,
    refreshRoles: loadSession,
    signOut: async () => {
      await signOutServer();
      setUser(null);
      setRoles([]);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used inside AuthProvider");
  return c;
}
