import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Logo } from "@/components/Logo";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";

const searchSchema = z.object({
  mode: z.enum(["signin", "signup", "driver"]).optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: "Connexion — Tibus Ride" }] }),
  component: AuthPage,
});

function AuthPage() {
  const { mode } = Route.useSearch();
  const initial = mode === "signin" ? "signin" : "signup";
  const defaultDriver = mode === "driver";
  const navigate = useNavigate();
  const { user, primaryRole, loading } = useAuth();

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

          <Tabs defaultValue={initial} className="mt-6">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signup">Créer un compte</TabsTrigger>
              <TabsTrigger value="signin">Se connecter</TabsTrigger>
            </TabsList>
            <TabsContent value="signup">
              <SignUpForm defaultDriver={defaultDriver} />
            </TabsContent>
            <TabsContent value="signin">
              <SignInForm />
            </TabsContent>
          </Tabs>

          <GoogleButton />
        </div>
      </div>
    </div>
  );
}

function GoogleButton() {
  const [loading, setLoading] = useState(false);
  const handle = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/app` },
    });
    if (error) toast.error(error.message || "Connexion Google impossible");
    setLoading(false);
  };
  return (
    <>
      <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" /> ou <div className="h-px flex-1 bg-border" />
      </div>
      <Button variant="outline" className="w-full" onClick={handle} disabled={loading}>
        <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>
        {loading ? "Redirection…" : "Continuer avec Google"}
      </Button>
    </>
  );
}

const COUNTRIES = [
  "Senegal", "Côte d'Ivoire", "Togo", "Benin", "Niger",
  "Nigeria", "Mali", "Burkina Faso", "Ghana", "Guinée",
] as const;

function SignUpForm({ defaultDriver }: { defaultDriver: boolean }) {
  const [loading, setLoading] = useState(false);
  const [isDriver, setIsDriver] = useState(defaultDriver);
  const [country, setCountry] = useState<string>("");

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
      country: z.enum(COUNTRIES as unknown as [string, ...string[]], { message: "Pays requis" }),
    });
    const parsed = schema.safeParse({ email, password, full_name, phone, country });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email, password,
      options: {
        emailRedirectTo: `${window.location.origin}/app`,
        data: { full_name, phone, country, role: isDriver ? "driver" : "passenger" },
      },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Compte créé ! Connexion en cours…");
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
        <Label htmlFor="country">Pays</Label>
        <select
          id="country"
          name="country"
          required
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <option value="" disabled>Sélectionnez votre pays</option>
          {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <p className="mt-1 text-xs text-muted-foreground">Vous ne verrez que les trajets de ce pays.</p>
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

function SignInForm() {
  const [loading, setLoading] = useState(false);
  const handle = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: String(fd.get("email")),
      password: String(fd.get("password")),
    });
    setLoading(false);
    if (error) return toast.error(error.message || "Identifiants incorrects");
    toast.success("Bienvenue !");
  };
  return (
    <form onSubmit={handle} className="mt-6 space-y-4">
      <div>
        <Label htmlFor="email-in">Email</Label>
        <Input id="email-in" name="email" type="email" required />
      </div>
      <div>
        <Label htmlFor="password-in">Mot de passe</Label>
        <Input id="password-in" name="password" type="password" required />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Connexion…" : "Se connecter"}
      </Button>
      <ForgotPasswordLink />
    </form>
  );
}

function ForgotPasswordLink() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const handle = async () => {
    const parsed = z.string().email().safeParse(email);
    if (!parsed.success) return toast.error("Email invalide");
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Email de réinitialisation envoyé. Vérifiez votre boîte.");
    setOpen(false);
  };
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="block w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline">
        Mot de passe oublié ?
      </button>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border border-border bg-secondary/40 p-3">
      <Label htmlFor="reset-email" className="text-xs">Recevoir un lien de réinitialisation</Label>
      <Input id="reset-email" type="email" placeholder="vous@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={loading}>Annuler</Button>
        <Button type="button" size="sm" className="flex-1" onClick={handle} disabled={loading}>
          {loading ? "Envoi…" : "Envoyer le lien"}
        </Button>
      </div>
    </div>
  );
}
