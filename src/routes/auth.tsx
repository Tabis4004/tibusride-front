import { createFileRoute, useNavigate, Link, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { signIn, signUp, requestPasswordReset } from "@/lib/auth.functions";
import {
  buildLocalGoogleAuthUrl,
  isSupabaseAuthConfigured,
  shouldUseLocalGoogleOAuth,
} from "@/lib/google-oauth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Logo } from "@/components/Logo";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { getAuthUserFromRequest } from "@/lib/auth.functions";

const searchSchema = z.object({
  mode: z.enum(["signin", "signup", "driver"]).optional(),
  error: z.string().optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: "Connexion — Tibus Ride" }] }),
  beforeLoad: async () => {
    const user = await getAuthUserFromRequest();
    if (user) throw redirect({ to: "/app" });
  },
  component: AuthPage,
});

function AuthPage() {
  const { mode, error } = Route.useSearch();
  const initial = mode === "signin" ? "signin" : "signup";
  const defaultDriver = mode === "driver";
  const navigate = useNavigate();
  const { user, primaryRole, loading, refreshRoles } = useAuth();

  useEffect(() => {
    if (error) {
      toast.error(decodeURIComponent(error));
    }
  }, [error]);

  useEffect(() => {
    if (!loading && user && primaryRole) {
      navigate({ to: "/app" });
    }
  }, [user, primaryRole, loading, navigate]);

  return (
    <div className="min-h-screen bg-sunset">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-4 py-8">
        <Link to="/" className="self-start"><Logo /></Link>
        <div className="my-auto rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-soft)]">
          <h1 className="font-display text-2xl font-bold">Bienvenue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Connectez-vous ou créez votre compte en quelques secondes.
          </p>

          <GoogleSignInButton />

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">ou</span>
            </div>
          </div>

          <Tabs defaultValue={initial} className="mt-2">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signup">Créer un compte</TabsTrigger>
              <TabsTrigger value="signin">Se connecter</TabsTrigger>
            </TabsList>
            <TabsContent value="signup">
              <SignUpForm defaultDriver={defaultDriver} onDone={refreshRoles} />
            </TabsContent>
            <TabsContent value="signin">
              <SignInForm onDone={refreshRoles} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

function GoogleSignInButton() {
  const [loading, setLoading] = useState(false);

  const handle = async () => {
    setLoading(true);
    try {
      const redirectTo = `${window.location.origin}/auth/callback`;

      if (shouldUseLocalGoogleOAuth()) {
        window.location.href = buildLocalGoogleAuthUrl(redirectTo);
        return;
      }

      if (isSupabaseAuthConfigured()) {
        const { supabase } = await import("@/integrations/supabase/client");
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo },
        });
        if (error) throw error;
        return;
      }

      throw new Error(
        "Google : ajoutez VITE_GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET dans .env",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connexion Google impossible");
      setLoading(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      className="mt-6 w-full gap-2"
      onClick={handle}
      disabled={loading}
    >
      <GoogleIcon />
      {loading ? "Redirection…" : "Continuer avec Google"}
    </Button>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function SignUpForm({ defaultDriver, onDone }: { defaultDriver: boolean; onDone: () => Promise<void> }) {
  const [loading, setLoading] = useState(false);
  const [isDriver, setIsDriver] = useState(defaultDriver);
  const signUpServer = useServerFn(signUp);

  const handle = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email"));
    const password = String(fd.get("password"));
    const full_name = String(fd.get("full_name"));
    const phone = String(fd.get("phone"));

    const schema = z.object({
      email: z.string().email("Email invalide"),
      password: z.string().min(8, "Mot de passe : 8 caractères minimum"),
      full_name: z.string().trim().min(2, "Nom requis").max(80),
      phone: z.string().trim().min(8, "Téléphone requis").max(20),
    });
    const parsed = schema.safeParse({ email, password, full_name, phone });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }

    setLoading(true);
    try {
      const result = await signUpServer({
        data: { email, password, full_name, phone, role: isDriver ? "driver" : "passenger" },
      });
      if (result.redirectUrl) {
        window.location.href = result.redirectUrl;
        return;
      }
      await onDone();
      toast.success("Compte créé !");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Inscription impossible");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handle} className="mt-6 space-y-4">
      <div>
        <Label htmlFor="full_name">Nom complet</Label>
        <Input id="full_name" name="full_name" placeholder="Awa Diop" required />
      </div>
      <div>
        <Label htmlFor="phone">Téléphone</Label>
        <Input id="phone" name="phone" type="tel" placeholder="+221 77 123 45 67" required />
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" placeholder="vous@email.com" required />
      </div>
      <div>
        <Label htmlFor="password">Mot de passe</Label>
        <Input id="password" name="password" type="password" minLength={8} required />
      </div>
      <label className="flex items-start gap-2 rounded-lg border border-border bg-secondary/40 p-3 text-sm">
        <input
          type="checkbox"
          checked={isDriver}
          onChange={(e) => setIsDriver(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-primary"
        />
        <span>
          <span className="font-medium">Je veux conduire avec Tibus Ride</span>
          <span className="block text-xs text-muted-foreground">Compte chauffeur — validation requise après inscription.</span>
        </span>
      </label>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Création…" : "Créer mon compte"}
      </Button>
    </form>
  );
}

function SignInForm({ onDone }: { onDone: () => Promise<void> }) {
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const signInServer = useServerFn(signIn);

  const handle = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setLoading(true);
    try {
      const result = await signInServer({
        data: { email: String(fd.get("email")), password: String(fd.get("password")) },
      });
      if (result.redirectUrl) {
        window.location.href = result.redirectUrl;
        return;
      }
      await onDone();
      toast.success("Bienvenue !");
    } catch {
      toast.error("Identifiants incorrects");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <form onSubmit={handle} className="mt-6 space-y-4">
        <div>
          <Label htmlFor="email-in">Email</Label>
          <Input id="email-in" name="email" type="email" required />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <Label htmlFor="password-in">Mot de passe</Label>
            <button
              type="button"
              onClick={() => setForgotOpen(true)}
              className="text-xs text-primary hover:underline"
            >
              Mot de passe oublié ?
            </button>
          </div>
          <Input id="password-in" name="password" type="password" required />
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Connexion…" : "Se connecter"}
        </Button>
      </form>
      <ForgotPasswordDialog open={forgotOpen} onOpenChange={setForgotOpen} />
    </>
  );
}

function ForgotPasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const requestReset = useServerFn(requestPasswordReset);

  const handle = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email"));
    const parsed = z.string().email("Email invalide").safeParse(email);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }

    setLoading(true);
    setResetUrl(null);
    try {
      const result = await requestReset({
        data: { email, origin: window.location.origin },
      });
      toast.success(result.message);
      if (result.resetUrl) {
        setResetUrl(result.resetUrl);
      } else if (result.emailConfigured === false) {
        toast.info("Ajoutez RESEND_API_KEY dans .env pour envoyer des emails.");
      } else {
        onOpenChange(false);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Envoi impossible");
    } finally {
      setLoading(false);
    }
  };

  const copyLink = async () => {
    if (!resetUrl) return;
    await navigator.clipboard.writeText(resetUrl);
    toast.success("Lien copié");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setResetUrl(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mot de passe oublié</DialogTitle>
          <DialogDescription>
            {resetUrl
              ? "Service email non configuré — utilisez ce lien (valide 1 h) :"
              : "Entrez votre email. Vous recevrez un lien pour choisir un nouveau mot de passe."}
          </DialogDescription>
        </DialogHeader>
        {resetUrl ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-secondary/30 p-3 text-xs break-all">
              {resetUrl}
            </div>
            <div className="flex gap-2">
              <Button type="button" className="flex-1" onClick={copyLink}>
                Copier le lien
              </Button>
              <Button type="button" variant="outline" className="flex-1" asChild>
                <a href={resetUrl}>Ouvrir</a>
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handle} className="space-y-4">
            <div>
              <Label htmlFor="forgot-email">Email</Label>
              <Input
                id="forgot-email"
                name="email"
                type="email"
                placeholder="vous@email.com"
                required
                autoFocus
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Envoi…" : "Envoyer le lien"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
