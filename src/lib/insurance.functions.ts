import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Assureur/admin : liste des chauffeurs assurés (projection minimale —
 *  pas l'intégralité de driver_profiles/profiles). */
export const listInsuredDrivers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase.rpc("list_insured_drivers");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Assureur/admin : valide le dossier d'assurance d'un chauffeur (après
 *  renouvellement ou première soumission). */
export const verifyDriverInsurance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ driverId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.rpc("verify_driver_insurance", { _driver_id: data.driverId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
