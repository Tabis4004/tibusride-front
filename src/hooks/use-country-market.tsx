import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  marketProgramsQueryKey,
  marketProgramPaymentsQueryKey,
  fetchMarketPrograms,
  fetchProgramPaymentProviders,
  resolveUserCountry,
  type MarketProgramConfig,
  type CountryPaymentOption,
} from "@/lib/country-market";
import { useAuth } from "@/hooks/use-auth";

type CountryMarketCtx = {
  country: string;
  /** Programme actif (sélectionné par l'utilisateur, sinon le défaut du pays). */
  config: MarketProgramConfig | null;
  /** Tous les programmes actifs disponibles pour ce pays (ex. Sénégal en a 2). */
  programs: MarketProgramConfig[];
  payments: CountryPaymentOption[];
  loading: boolean;
  setCountryOverride: (country: string | null) => void;
  /** Permet à l'utilisateur de basculer explicitement entre les programmes d'un même pays. */
  setProgramId: (programId: string | null) => void;
};

const Ctx = createContext<CountryMarketCtx | undefined>(undefined);

export function CountryMarketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [profileCountry, setProfileCountry] = useState<string | null>(null);
  const [countryOverride, setCountryOverride] = useState<string | null>(null);
  const [programId, setProgramId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setProfileCountry(null);
      return;
    }
    supabase
      .from("profiles")
      .select("country")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => setProfileCountry(data?.country ?? null));
  }, [user?.id]);

  const country = useMemo(
    () => resolveUserCountry(countryOverride ?? profileCountry),
    [countryOverride, profileCountry],
  );

  // Réinitialise le choix de programme quand le pays change.
  useEffect(() => {
    setProgramId(null);
  }, [country]);

  const programsQ = useQuery({
    queryKey: marketProgramsQueryKey(country),
    queryFn: () => fetchMarketPrograms(country),
    staleTime: 5 * 60 * 1000,
  });

  const programs = programsQ.data ?? [];

  const activeProgram = useMemo(() => {
    if (!programs.length) return null;
    if (programId) {
      const found = programs.find((p) => p.programId === programId);
      if (found) return found;
    }
    return programs.find((p) => p.isDefault) ?? programs[0];
  }, [programs, programId]);

  const paymentsQ = useQuery({
    queryKey: marketProgramPaymentsQueryKey(activeProgram?.programId ?? "none"),
    queryFn: () => fetchProgramPaymentProviders(activeProgram!),
    enabled: !!activeProgram,
    staleTime: 5 * 60 * 1000,
  });

  const value: CountryMarketCtx = {
    country,
    config: activeProgram,
    programs,
    payments: paymentsQ.data ?? [],
    loading: programsQ.isLoading || paymentsQ.isLoading,
    setCountryOverride,
    setProgramId,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCountryMarket() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCountryMarket must be used inside CountryMarketProvider");
  return ctx;
}

/** Safe access outside authenticated routes (landing, auth). */
export function useCountryMarketOptional() {
  return useContext(Ctx);
}
