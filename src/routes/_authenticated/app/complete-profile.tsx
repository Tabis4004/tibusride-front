import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SERVICE_COUNTRIES } from "@/lib/countries";
import { completeMyProfile } from "@/lib/tracking.functions";
import { toast } from "sonner";
import { UserCircle2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/complete-profile")({
  head: () => ({ meta: [{ title: "Compléter votre profil — Tibus Ride" }] }),
  component: CompleteProfilePage,
});

function CompleteProfilePage() {
  const { user, hasRole, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const completeFn = useServerFn(completeMyProfile);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");

  useEffect(() => {
    if (!user) return;
    const meta = user.user_metadata ?? {};
    if (meta.full_name) setFullName(String(meta.full_name));
    if (meta.phone) setPhone(String(meta.phone));
    if (meta.country) setCountry(String(meta.country));
    supabase.from("profiles").select("full_name, phone, country").eq("id", user.id).maybeSingle()
      .then(({ data }) => {
        if (data?.full_name) setFullName(data.full_name);
        if (data?.phone) setPhone(data.phone);
        if (data?.country) setCountry(data.country);
      });
  }, [user]);

  useEffect(() => {
    if (authLoading || !user) return;
    if (hasRole("superadmin")) {
      navigate({ to: "/app/admin", replace: true });
    }
  }, [authLoading, user, hasRole, navigate]);

  const save = useMutation({
    mutationFn: () => completeFn({
      data: { full_name: fullName.trim(), phone: phone.trim(), country },
    }),
    onSuccess: () => {
      toast.success("Profil complété — bienvenue sur Tibus Ride !");
      navigate({ to: "/app", replace: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-3xl border border-border bg-card p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
            <UserCircle2 className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold">Complétez votre profil</h1>
            <p className="text-sm text-muted-foreground">
              Quelques informations pour activer votre compte{user?.email ? ` (${user.email})` : ""}.
            </p>
          </div>
        </div>

        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div>
            <Label htmlFor="full_name">Nom complet</Label>
            <Input id="full_name" value={fullName} onChange={(e) => setFullName(e.target.value)} required maxLength={80} />
          </div>
          <div>
            <Label htmlFor="phone">Téléphone</Label>
            <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+225 07 …" required maxLength={20} />
          </div>
          <div>
            <Label htmlFor="country">Pays</Label>
            <select
              id="country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              required
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="" disabled>Sélectionnez votre pays</option>
              {SERVICE_COUNTRIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">Détermine les courses visibles dans votre pays.</p>
          </div>
          <Button type="submit" className="w-full" size="lg" disabled={save.isPending || !country}>
            {save.isPending ? "Enregistrement…" : "Continuer"}
          </Button>
        </form>
      </div>
    </div>
  );
}
