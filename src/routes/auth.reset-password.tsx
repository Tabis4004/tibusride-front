import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getAuthUserFromRequest, resetPassword } from "@/lib/auth.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/Logo";
import { toast } from "sonner";

const searchSchema = z.object({
  token: z.string().optional(),
});

export const Route = createFileRoute("/auth/reset-password")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: "Nouveau mot de passe — Tibus Ride" }] }),
  beforeLoad: async () => {
    const user = await getAuthUserFromRequest();
    if (user) throw redirect({ to: "/app" });
  },
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const resetPasswordServer = useServerFn(resetPassword);

  if (!token) {
    return (
      <div className="min-h-screen bg-sunset">
        <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 py-8 text-center">
          <Link to="/auth" search={{ mode: "signin" }} className="mb-8 self-start">
            <Logo />
          </Link>
          <div className="rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-soft)]">
            <h1 className="font-display text-xl font-bold">Lien invalide</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Ce lien de réinitialisation est incomplet ou expiré.
            </p>
            <Button asChild className="mt-6 w-full">
              <Link to="/auth" search={{ mode: "signin" }}>
                Retour à la connexion
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const handle = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get("password"));
    const confirm = String(fd.get("confirm"));

    const schema = z.object({
      password: z.string().min(8, "Mot de passe : 8 caractères minimum"),
      confirm: z.string(),
    });
    const parsed = schema.safeParse({ password, confirm });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    if (password !== confirm) {
      toast.error("Les mots de passe ne correspondent pas");
      return;
    }

    setLoading(true);
    try {
      await resetPasswordServer({ data: { token, password } });
      toast.success("Mot de passe mis à jour !");
      navigate({ to: "/auth", search: { mode: "signin" } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Réinitialisation impossible");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-sunset">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-4 py-8">
        <Link to="/auth" search={{ mode: "signin" }} className="self-start">
          <Logo />
        </Link>
        <div className="my-auto rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-soft)]">
          <h1 className="font-display text-2xl font-bold">Nouveau mot de passe</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Choisissez un mot de passe d&apos;au moins 8 caractères.
          </p>
          <form onSubmit={handle} className="mt-6 space-y-4">
            <div>
              <Label htmlFor="password">Nouveau mot de passe</Label>
              <Input id="password" name="password" type="password" minLength={8} required autoFocus />
            </div>
            <div>
              <Label htmlFor="confirm">Confirmer le mot de passe</Label>
              <Input id="confirm" name="confirm" type="password" minLength={8} required />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
