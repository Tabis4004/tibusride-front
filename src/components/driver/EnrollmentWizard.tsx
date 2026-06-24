import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { defaultCityForCountry } from "@/lib/pricing";
import {
  DOC_COLUMN,
  ENROLLMENT_DOCS,
  PARTNER_TYPES,
  VEHICLE_TYPES,
  enrollmentProgress,
  type EnrollmentDocKind,
  type PartnerType,
  type VehicleType,
} from "@/lib/driver-enrollment";
import {
  getMyDocumentSignedUrl,
  submitEnrollmentForReview,
  updateMyEnrollment,
  uploadMyDriverDocument,
} from "@/lib/driver-enrollment.functions";
import { toast } from "sonner";
import { CheckCircle2, ChevronRight, FileUp, Loader2, ShieldCheck, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

type Profile = {
  partner_type?: string | null;
  vehicle_type?: string | null;
  city?: string | null;
  license_number?: string | null;
  vehicle_plate?: string | null;
  vehicle_model?: string | null;
  vehicle_color?: string | null;
  license_document_url?: string | null;
  vehicle_document_url?: string | null;
  vehicle_condition_url?: string | null;
  insurance_document_url?: string | null;
  status?: string;
  rejection_reason?: string | null;
  enrollment_submitted_at?: string | null;
};

/** Lit l'URL/chemin du document `kind` sur un profil, via la colonne mappée. */
function docPath(profile: Profile, kind: EnrollmentDocKind): string | null | undefined {
  return (profile as Record<string, string | null | undefined>)[DOC_COLUMN[kind]];
}

export function EnrollmentWizard({
  profile,
  country,
  onRefresh,
}: {
  profile: Profile;
  /** Pays choisi par le chauffeur/livreur à l'inscription — seule donnée requise ici. */
  country?: string | null;
  onRefresh: () => void;
}) {
  const [step, setStep] = useState(0);
  const [partnerType, setPartnerType] = useState<PartnerType>((profile.partner_type as PartnerType) ?? "ride");
  const [vehicleType, setVehicleType] = useState<VehicleType>((profile.vehicle_type as VehicleType) ?? "car");
  // La ville n'est plus choisie manuellement : elle découle uniquement du
  // pays sélectionné à l'inscription (aucune liste de villes à l'enrôlement).
  const city = defaultCityForCountry(country) ?? profile.city ?? "";
  const [license, setLicense] = useState(profile.license_number ?? "");
  const [plate, setPlate] = useState(profile.vehicle_plate ?? "");
  const [model, setVehicleModel] = useState(profile.vehicle_model ?? "");
  const [color, setVehicleColor] = useState(profile.vehicle_color ?? "");

  const progress = enrollmentProgress({
    ...profile,
    partner_type: partnerType,
    vehicle_type: vehicleType,
    city,
    license_number: license,
  });
  const isUnderReview = profile.status === "under_review";
  const isRejected = profile.status === "rejected";

  const updateFn = useServerFn(updateMyEnrollment);
  const submitFn = useServerFn(submitEnrollmentForReview);

  const saveStep1 = useMutation({
    mutationFn: () => updateFn({
      data: {
        partner_type: partnerType,
        vehicle_type: vehicleType,
        city,
        license_number: license,
        vehicle_plate: plate || undefined,
        vehicle_model: model || undefined,
        vehicle_color: color || undefined,
      },
    }),
    onSuccess: () => { toast.success("Informations enregistrées"); onRefresh(); setStep(1); },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = useMutation({
    mutationFn: () => submitFn(),
    onSuccess: () => {
      toast.success("Dossier soumis — vérification physique en cours");
      onRefresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const vehicleOptions = VEHICLE_TYPES.filter((v) => v.forPartner.includes(partnerType));
  const steps = ["Profil", "Documents", "Soumission"];

  if (isUnderReview) {
    return (
      <div className="mx-auto max-w-xl rounded-3xl border border-primary/30 bg-primary/5 p-8 text-center">
        <ShieldCheck className="mx-auto h-10 w-10 text-primary" />
        <h2 className="mt-4 font-display text-xl font-bold">Dossier en cours de vérification</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Nos équipes vérifient votre permis, carte grise et l'état de votre véhicule.
          Un contrôle physique sera réalisé avant de vous classer dans une catégorie.
        </p>
        {profile.enrollment_submitted_at && (
          <p className="mt-2 text-xs text-muted-foreground">
            Soumis le {new Date(profile.enrollment_submitted_at).toLocaleString("fr-FR")}
          </p>
        )}
        <DocChecklist profile={profile} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="rounded-3xl border border-border bg-card p-6">
        <h2 className="font-display text-xl font-bold">Enrôlement chauffeur / livreur</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Soumettez votre permis, carte grise et photos du véhicule. Validation après contrôle physique.
        </p>

        {isRejected && profile.rejection_reason && (
          <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Dossier refusé : {profile.rejection_reason}
          </div>
        )}

        <div className="mt-4 flex gap-2">
          {steps.map((s, i) => (
            <button
              key={s}
              type="button"
              onClick={() => setStep(i)}
              className={cn(
                "flex-1 rounded-xl border px-2 py-2 text-xs font-medium transition-colors",
                step === i ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground",
              )}
            >
              {i + 1}. {s}
            </button>
          ))}
        </div>

        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
          />
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">{progress.done}/{progress.total} éléments complétés</p>
      </div>

      {step === 0 && (
        <section className="space-y-4 rounded-3xl border border-border bg-card p-6">
          <div>
            <Label className="text-sm font-medium">Je m'inscris comme</Label>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {PARTNER_TYPES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => { setPartnerType(p.value); setVehicleType(p.value === "delivery" ? "two_wheel" : "car"); }}
                  className={cn(
                    "rounded-2xl border p-4 text-left transition-all",
                    partnerType === p.value ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border",
                  )}
                >
                  <div className="font-semibold">{p.label}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{p.description}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-sm font-medium">Véhicule</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {vehicleOptions.map((v) => (
                <button
                  key={v.value}
                  type="button"
                  onClick={() => setVehicleType(v.value)}
                  className={cn(
                    "rounded-xl border px-4 py-2 text-sm font-medium",
                    vehicleType === v.value ? "border-primary bg-primary/5" : "border-border",
                  )}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Ville d'activité</Label>
              <p className="mt-1 rounded-md border border-input bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                {city
                  ? `${city} — déterminée automatiquement par votre pays`
                  : "Renseignez votre pays dans votre profil pour déterminer votre ville d'activité"}
              </p>
            </div>
            <div>
              <Label>N° permis</Label>
              <Input className="mt-1" value={license} onChange={(e) => setLicense(e.target.value)} maxLength={50} />
            </div>
            <div>
              <Label>N° plaque</Label>
              <Input className="mt-1" value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="ex. DK-1234-AB" maxLength={30} />
            </div>
            <div>
              <Label>Marque / modèle</Label>
              <Input className="mt-1" value={model} onChange={(e) => setVehicleModel(e.target.value)} placeholder="ex. Toyota Corolla" maxLength={80} />
            </div>
            <div className="sm:col-span-2">
              <Label>Couleur</Label>
              <Input className="mt-1" value={color} onChange={(e) => setVehicleColor(e.target.value)} placeholder="ex. blanche, grise, rouge…" maxLength={40} />
            </div>
          </div>

          <Button
            className="w-full"
            disabled={!city || !license.trim() || saveStep1.isPending}
            onClick={() => saveStep1.mutate()}
          >
            {saveStep1.isPending ? "Enregistrement…" : "Continuer vers les documents"}
            <ChevronRight className="ml-2 h-4 w-4" />
          </Button>
        </section>
      )}

      {step === 1 && (
        <section className="space-y-3 rounded-3xl border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">
            Formats acceptés : JPG, PNG, WEBP ou PDF — max 5 Mo par fichier.
          </p>
          {ENROLLMENT_DOCS.map((doc) => (
            <EnrollmentDocUpload
              key={doc.kind}
              kind={doc.kind}
              label={doc.label}
              hint={doc.hint}
              pathOrUrl={docPath(profile, doc.kind)}
              onUploaded={onRefresh}
            />
          ))}
          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => setStep(0)}>Retour</Button>
            <Button className="flex-1" onClick={() => setStep(2)} disabled={!progress.complete}>
              Vérifier et soumettre
            </Button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-4 rounded-3xl border border-border bg-card p-6">
          <h3 className="font-semibold">Récapitulatif</h3>
          <DocChecklist profile={profile} />
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li>• Un agent vérifiera physiquement votre véhicule ou moto</li>
            <li>• Vous serez classé dans une catégorie après contrôle</li>
            <li>• Délai habituel : sous 72 h ouvrées</li>
          </ul>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(1)}>Retour</Button>
            <Button
              className="flex-1"
              disabled={!progress.complete || submit.isPending}
              onClick={() => submit.mutate()}
            >
              {submit.isPending ? "Envoi…" : "Soumettre pour vérification"}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function DocChecklist({ profile }: { profile: Profile }) {
  return (
    <ul className="mt-4 space-y-2 text-left text-sm">
      {ENROLLMENT_DOCS.map((doc) => {
        const ok = !!docPath(profile, doc.kind);
        return (
          <li key={doc.kind} className="flex items-center gap-2">
            {ok ? <CheckCircle2 className="h-4 w-4 text-success" /> : <FileUp className="h-4 w-4 text-muted-foreground" />}
            <span className={ok ? "text-foreground" : "text-muted-foreground"}>{doc.label}</span>
          </li>
        );
      })}
      <li className="pt-2 text-xs text-muted-foreground">
        Type : {PARTNER_TYPES.find((p) => p.value === profile.partner_type)?.label ?? "—"}
        {" · "}
        Véhicule : {VEHICLE_TYPES.find((v) => v.value === profile.vehicle_type)?.label ?? "—"}
        {" · "}
        {profile.city ?? "Ville non définie"}
      </li>
    </ul>
  );
}

function EnrollmentDocUpload({
  kind,
  label,
  hint,
  pathOrUrl,
  onUploaded,
}: {
  kind: EnrollmentDocKind;
  label: string;
  hint: string;
  pathOrUrl: string | null | undefined;
  onUploaded: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadFn = useServerFn(uploadMyDriverDocument);
  const signFn = useServerFn(getMyDocumentSignedUrl);
  const [busy, setBusy] = useState(false);

  const onPick = async (file: File) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowed.includes(file.type)) {
      toast.error("Format non supporté.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Max 5 Mo.");
      return;
    }
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      let bin = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
      await uploadFn({
        data: { kind, filename: file.name, contentType: file.type, base64: btoa(bin) },
      });
      toast.success(`${label} enregistré`);
      onUploaded();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erreur envoi");
    } finally {
      setBusy(false);
    }
  };

  const view = async () => {
    if (!pathOrUrl) return;
    try {
      const { url } = await signFn({ data: { path: pathOrUrl } });
      window.open(url, "_blank", "noopener");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Impossible d'ouvrir");
    }
  };

  return (
    <div className="rounded-2xl border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-medium">
            {pathOrUrl ? <CheckCircle2 className="h-4 w-4 text-success" /> : null}
            {label}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          {pathOrUrl && (
            <Button type="button" size="sm" variant="outline" onClick={view}>Voir</Button>
          )}
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            <span className="ml-1">{pathOrUrl ? "Remplacer" : "Ajouter"}</span>
          </Button>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
