import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  SERVICE_COUNTRIES,
  assertServiceCountry,
  countriesMatch,
  normalizeCountry,
} from "@/lib/countries";

export { SERVICE_COUNTRIES as ADMIN_COUNTRIES };

async function assertAdmin(supabase: any, userId: string) {
  const { data: isSuper, error: superErr } = await supabase.rpc("is_superadmin", { _uid: userId });
  if (superErr) throw new Error(superErr.message);
  if (isSuper) return;

  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

async function requireAdminScope(
  supabase: any,
  userId: string,
): Promise<{ country: string | null; isSuper: boolean }> {
  await assertAdmin(supabase, userId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: prof }, { data: superRow }] = await Promise.all([
    supabaseAdmin.from("profiles").select("country").eq("id", userId).maybeSingle(),
    supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("user_id", userId)
      .eq("role", "superadmin")
      .maybeSingle(),
  ]);
  const country = ((prof as any)?.country ?? null) as string | null;
  const isSuper = !!superRow;
  if (!isSuper && !country) {
    throw new Error(
      "Votre compte admin n'a pas de pays attribué. Demandez à un superadmin de vous assigner un pays.",
    );
  }
  return { country: isSuper ? null : country, isSuper };
}

async function assertUserInScope(actorCountry: string | null, targetUserId: string) {
  if (!actorCountry) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("country")
    .eq("id", targetUserId)
    .maybeSingle();
  const c = ((data as any)?.country ?? null) as string | null;
  if (!countriesMatch(c, actorCountry)) {
    throw new Error(`Action limitée aux utilisateurs du pays « ${actorCountry} ».`);
  }
}

async function assertCorporateInScope(actorCountry: string | null, corporateId: string) {
  if (!actorCountry) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("corporate_accounts")
    .select("country")
    .eq("id", corporateId)
    .maybeSingle();
  const c = ((data as any)?.country ?? null) as string | null;
  if (c !== actorCountry) {
    throw new Error(`Entité hors de votre périmètre pays (« ${actorCountry} »).`);
  }
}

async function assertInvoiceInScope(actorCountry: string | null, invoiceId: string) {
  if (!actorCountry) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("invoices")
    .select("corporate:corporate_accounts(country)")
    .eq("id", invoiceId)
    .maybeSingle();
  const c = ((data as any)?.corporate?.country ?? null) as string | null;
  if (c !== actorCountry) {
    throw new Error(`Facture hors de votre périmètre pays (« ${actorCountry} »).`);
  }
}

async function logAudit(
  actor: { id: string; email: string | null },
  entry: { action: string; target_type?: string; target_id?: string; target_label?: string; details?: any },
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("audit_logs").insert({
    actor_id: actor.id,
    actor_email: actor.email,
    action: entry.action,
    target_type: entry.target_type ?? null,
    target_id: entry.target_id ?? null,
    target_label: entry.target_label ?? null,
    details: entry.details ?? null,
  });
}

async function getActor(context: any): Promise<{ id: string; email: string | null }> {
  return { id: context.userId, email: context.claims?.email ?? null };
}

// Comme assertAdmin, mais ouvert aussi au rôle "support" — utilisé par les
// fonctions agent (ex. création de ticket pour un utilisateur) accessibles
// depuis l'Inbox Support, qui n'exige pas le rôle admin complet.
async function assertAgent(supabase: any, userId: string) {
  const { data: isSuper, error: superErr } = await supabase.rpc("is_superadmin", { _uid: userId });
  if (superErr) throw new Error(superErr.message);
  if (isSuper) return;

  const { data: isAdmin, error: adminErr } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (adminErr) throw new Error(adminErr.message);
  if (isAdmin) return;

  const { data: isSupport, error: supportErr } = await supabase.rpc("has_role", { _user_id: userId, _role: "support" });
  if (supportErr) throw new Error(supportErr.message);
  if (!isSupport) throw new Error("Forbidden: support or admin role required");
}


export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const scope = await requireAdminScope(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (authErr) throw new Error(authErr.message);

    let ids = authData.users.map((u) => u.id);
    const [{ data: profiles }, { data: roles }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name, phone, city, country").in("id", ids),
      supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids),
    ]);
    const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    const roleMap = new Map<string, string[]>();
    (roles ?? []).forEach((r: any) => {
      const list = roleMap.get(r.user_id) ?? [];
      list.push(r.role);
      roleMap.set(r.user_id, list);
    });

    let users = authData.users.map((u) => ({
      id: u.id,
      email: u.email ?? null,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
      banned_until: (u as any).banned_until ?? null,
      profile: profileMap.get(u.id) ?? null,
      roles: roleMap.get(u.id) ?? [],
    }));

    if (!scope.isSuper) {
      users = users.filter((u: any) => countriesMatch(u.profile?.country ?? null, scope.country));
    }
    return users;
  });


export const setUserBanned = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ userId: z.string().uuid(), banned: z.boolean(), reason: z.string().max(500).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const scope = await requireAdminScope(context.supabase, context.userId);
    await assertUserInScope(scope.country, data.userId);
    if (data.userId === context.userId) throw new Error("Vous ne pouvez pas vous bloquer vous-même.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: target } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      ban_duration: data.banned ? "876000h" : "none",
    } as any);
    if (error) throw new Error(error.message);
    await logAudit(await getActor(context), {
      action: data.banned ? "user.ban" : "user.unban",
      target_type: "user",
      target_id: data.userId,
      target_label: target?.user?.email ?? undefined,
      details: data.reason ? { reason: data.reason } : null,
    });

    return { ok: true };
  });

export const setUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ userId: z.string().uuid(), password: z.string().min(8).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const scope = await requireAdminScope(context.supabase, context.userId);
    if (!scope.isSuper) {
      throw new Error("Seul un superadmin peut réinitialiser un mot de passe.");
    }
    await assertUserInScope(scope.country, data.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: target } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.password,
    });
    if (error) {
      throw new Error(
        error.message.includes("service_role")
          ? "Clé SUPABASE_SERVICE_ROLE_KEY manquante côté serveur (Vercel)."
          : error.message,
      );
    }
    await logAudit(await getActor(context), {
      action: "user.password.reset",
      target_type: "user",
      target_id: data.userId,
      target_label: target?.user?.email ?? undefined,
      details: null,
    });
    return { ok: true };
  });

export const setUserCountry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        country: z.string().min(1).max(80).nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const scope = await requireAdminScope(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const normalizedCountry = data.country === null ? null : assertServiceCountry(data.country);

    if (normalizedCountry !== null && !(SERVICE_COUNTRIES as readonly string[]).includes(normalizedCountry)) {
      throw new Error(`Pays « ${data.country} » non autorisé.`);
    }

    if (!scope.isSuper) {
      await assertUserInScope(scope.country, data.userId);
      if (normalizedCountry !== null && !countriesMatch(normalizedCountry, scope.country)) {
        throw new Error(`Vous ne pouvez assigner que le pays « ${scope.country} ».`);
      }
    }

    const { data: rolesRows } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.userId);
    const roles = (rolesRows ?? []).map((r: any) => r.role as string);
    const isSuperTarget = roles.includes("superadmin");
    if (normalizedCountry !== null && isSuperTarget) {
      throw new Error("Un superadmin est global et ne peut pas être rattaché à un pays.");
    }
    // profiles.country = pays du profil (passager, chauffeur, admin). Tout compte peut en avoir un.

    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ country: normalizedCountry })
      .eq("id", data.userId);
    if (error) throw new Error(error.message);
    const { data: target } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    await logAudit(await getActor(context), {
      action: "user.country.set",
      target_type: "user",
      target_id: data.userId,
      target_label: target?.user?.email ?? undefined,
      details: { country: normalizedCountry, roles },
    });
    return { ok: true };
  });

/** Superadmin : promouvoir admin + assigner un pays en une seule opération. */
export const promoteCountryAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      userId: z.string().uuid(),
      country: z.string().min(1).max(80),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const scope = await requireAdminScope(context.supabase, context.userId);
    if (!scope.isSuper) {
      throw new Error("Seul un superadmin peut nommer un admin pays.");
    }
    if (data.userId === context.userId) {
      throw new Error("Vous ne pouvez pas vous promouvoir vous-même.");
    }
    const country = assertServiceCountry(data.country);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rolesRows } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.userId);
    const roles = (rolesRows ?? []).map((r: any) => r.role as string);
    if (roles.includes("superadmin")) {
      throw new Error("Un superadmin ne peut pas devenir admin pays.");
    }

    const { error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: data.userId, role: "admin" }, { onConflict: "user_id,role" });
    if (roleErr) throw new Error(roleErr.message);

    const { error: profErr } = await supabaseAdmin
      .from("profiles")
      .update({ country })
      .eq("id", data.userId);
    if (profErr) throw new Error(profErr.message);

    const { data: target } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    await logAudit(await getActor(context), {
      action: "role.country_admin.grant",
      target_type: "user",
      target_id: data.userId,
      target_label: target?.user?.email ?? undefined,
      details: { country, role: "admin" },
    });
    return { ok: true, country };
  });

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        role: z.enum(["superadmin", "admin", "driver", "passenger", "support", "insurer"]),
        grant: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const scope = await requireAdminScope(context.supabase, context.userId);
    if (data.role === "superadmin") {
      if (!scope.isSuper) throw new Error("Seul un superadmin peut gérer le rôle superadmin.");
      if (!data.grant && data.userId === context.userId) {
        throw new Error("Vous ne pouvez pas retirer votre propre rôle superadmin.");
      }
    } else {
      await assertUserInScope(scope.country, data.userId);
      if (!scope.isSuper && data.role === "admin" && data.grant) {
        throw new Error("Seul un superadmin peut promouvoir un compte au rôle admin.");
      }
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.grant) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: data.userId, role: data.role }, { onConflict: "user_id,role" });
      if (error) throw new Error(error.message);
    } else {
      if (data.userId === context.userId && data.role === "admin")
        throw new Error("Vous ne pouvez pas retirer votre propre rôle admin.");
      const { error } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .eq("role", data.role);
      if (error) throw new Error(error.message);
    }
    const { data: target } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    await logAudit(await getActor(context), {
      action: data.grant ? "role.grant" : "role.revoke",
      target_type: "user",
      target_id: data.userId,
      target_label: target?.user?.email ?? undefined,
      details: { role: data.role },
    });
    return { ok: true };
  });

export const updateDriverStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        status: z.enum(["pending", "under_review", "approved", "rejected", "suspended"]),
        reason: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const scope = await requireAdminScope(context.supabase, context.userId);
    await assertUserInScope(scope.country, data.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const update: any = {
      status: data.status,
      status_updated_at: new Date().toISOString(),
      status_updated_by: context.userId,
    };
    if (data.status === "rejected" || data.status === "suspended") {
      update.rejection_reason = data.reason ?? null;
    } else {
      update.rejection_reason = null;
    }
    if (data.status === "approved") {
      const { data: prof, error: profErr } = await supabaseAdmin
        .from("driver_profiles")
        .select("license_document_url, vehicle_document_url, vehicle_condition_url, physical_verified_at, assigned_category")
        .eq("user_id", data.userId)
        .maybeSingle();
      if (profErr) throw new Error(profErr.message);
      if (!prof?.license_document_url || !prof?.vehicle_document_url || !prof?.vehicle_condition_url) {
        throw new Error("Validation impossible : permis, carte grise et photos véhicule requis.");
      }
      if (!prof.physical_verified_at) {
        throw new Error("Validation impossible : marquez d'abord la vérification physique.");
      }
      if (!prof.assigned_category?.trim()) {
        throw new Error("Validation impossible : assignez une catégorie (taxi, éco, livraison…).");
      }
    }
    const { error } = await supabaseAdmin.from("driver_profiles").update(update).eq("user_id", data.userId);
    if (error) throw new Error(error.message);

    const { data: target } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    await logAudit(await getActor(context), {
      action: `driver.status.${data.status}`,
      target_type: "driver",
      target_id: data.userId,
      target_label: target?.user?.email ?? undefined,
      details: data.reason ? { status: data.status, reason: data.reason } : { status: data.status },
    });
    return { ok: true };
  });

export const uploadDriverDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        kind: z.enum(["id", "license", "vehicle", "vehicle_condition", "insurance"]),
        filename: z.string().max(200),
        contentType: z.string().max(100),
        // base64-encoded file content
        base64: z.string().max(8_000_000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const scope = await requireAdminScope(context.supabase, context.userId);
    await assertUserInScope(scope.country, data.userId);
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowed.includes(data.contentType)) {
      throw new Error("Format non supporté (JPG, PNG, WEBP ou PDF).");
    }
    const buf = Buffer.from(data.base64, "base64");
    if (buf.byteLength > 5 * 1024 * 1024) throw new Error("Fichier trop volumineux (max 5 Mo).");

    const ext = data.filename.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
    const path = `${data.userId}/${data.kind}-${Date.now()}.${ext}`;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: upErr } = await supabaseAdmin.storage
      .from("driver-documents")
      .upload(path, buf, { contentType: data.contentType, upsert: true });
    if (upErr) throw new Error(upErr.message);

    const col =
      data.kind === "id" ? "id_document_url"
      : data.kind === "license" ? "license_document_url"
      : data.kind === "vehicle_condition" ? "vehicle_condition_url"
      : data.kind === "insurance" ? "insurance_document_url"
      : "vehicle_document_url";
    const { error: updErr } = await supabaseAdmin
      .from("driver_profiles")
      .update({ [col]: path } as any)
      .eq("user_id", data.userId);
    if (updErr) throw new Error(updErr.message);

    await logAudit(await getActor(context), {
      action: "driver.document.upload",
      target_type: "driver",
      target_id: data.userId,
      details: { kind: data.kind, path, size: buf.byteLength },
    });
    return { ok: true, path };
  });

/** Admin : vérification physique + catégorie avant approbation. */
export const assignDriverEnrollment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      userId: z.string().uuid(),
      assigned_category: z.string().trim().min(1).max(40).optional(),
      physical_verified: z.boolean().optional(),
      enrollment_notes: z.string().max(1000).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const scope = await requireAdminScope(context.supabase, context.userId);
    await assertUserInScope(scope.country, data.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.assigned_category !== undefined) update.assigned_category = data.assigned_category;
    if (data.enrollment_notes !== undefined) update.enrollment_notes = data.enrollment_notes;
    if (data.physical_verified === true) {
      update.physical_verified_at = new Date().toISOString();
      update.physical_verified_by = context.userId;
    } else if (data.physical_verified === false) {
      update.physical_verified_at = null;
      update.physical_verified_by = null;
    }
    const { error } = await supabaseAdmin.from("driver_profiles").update(update).eq("user_id", data.userId);
    if (error) throw new Error(error.message);

    const { data: target } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    await logAudit(await getActor(context), {
      action: "driver.enrollment.assign",
      target_type: "driver",
      target_id: data.userId,
      target_label: target?.user?.email ?? undefined,
      details: { assigned_category: data.assigned_category, physical_verified: data.physical_verified },
    });
    return { ok: true };
  });

export const getDocumentSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ path: z.string().min(1).max(500) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error } = await supabaseAdmin.storage
      .from("driver-documents")
      .createSignedUrl(data.path, 60 * 10);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });

export const listAuditLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const scope = await requireAdminScope(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    const rows = data ?? [];

    if (scope.isSuper) return rows;

    // Country admin: keep only rows that touch users / actors of the same country.
    const userIds = new Set<string>();
    rows.forEach((r: any) => {
      if (r.actor_id) userIds.add(r.actor_id);
      if (r.target_type === "user" || r.target_type === "driver") {
        if (r.target_id) userIds.add(r.target_id);
      }
    });
    let sameCountry = new Set<string>();
    if (userIds.size > 0) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, country")
        .in("id", Array.from(userIds));
      (profs ?? []).forEach((p: any) => {
        if (p.country === scope.country) sameCountry.add(p.id);
      });
    }
    return rows.filter((r: any) => {
      if (r.actor_id && sameCountry.has(r.actor_id)) return true;
      if ((r.target_type === "user" || r.target_type === "driver") && r.target_id && sameCountry.has(r.target_id)) return true;
      // Country-tagged events from details
      const detailsCountry = r.details && typeof r.details === "object" ? (r.details as any).country : null;
      if (detailsCountry && detailsCountry === scope.country) return true;
      return false;
    });
  });

export const listPricingSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("pricing_settings")
      .select("*")
      .order("category");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const updatePricingSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        base_fare_xof: z.number().int().min(0),
        per_km_xof: z.number().int().min(0),
        per_min_xof: z.number().int().min(0),
        min_fare_xof: z.number().int().min(0),
        commission_type: z.enum(["percent", "flat"]),
        commission_rate: z.number().min(0).max(100),
        commission_flat_xof: z.number().int().min(0),
        active: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { id, ...patch } = data;
    const { data: updated, error } = await context.supabase
      .from("pricing_settings")
      .update({ ...patch, updated_by: context.userId })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    await logAudit(await getActor(context), {
      action: "pricing.update",
      target_type: "pricing_settings",
      target_id: id,
      target_label: updated?.category ?? null,
      details: patch,
    });
    return updated;
  });

/**
 * Tarifs livraison (deux-roues, moto, tricycle, voiture, fourgon) — table
 * séparée de pricing_settings car les véhicules de livraison ne font pas
 * partie de l'enum vehicle_category. Voir
 * supabase/migrations/20260624170000_delivery_pricing_settings.sql.
 */
export const listDeliveryPricingSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("delivery_pricing_settings")
      .select("*")
      .order("vehicle");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const updateDeliveryPricingSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        base_fare_xof: z.number().int().min(0),
        per_km_xof: z.number().int().min(0),
        per_min_xof: z.number().int().min(0),
        min_fare_xof: z.number().int().min(0),
        commission_type: z.enum(["percent", "flat"]),
        commission_rate: z.number().min(0).max(100),
        commission_flat_xof: z.number().int().min(0),
        active: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { id, ...patch } = data;
    const { data: updated, error } = await context.supabase
      .from("delivery_pricing_settings")
      .update({ ...patch, updated_by: context.userId })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    await logAudit(await getActor(context), {
      action: "delivery_pricing.update",
      target_type: "delivery_pricing_settings",
      target_id: id,
      target_label: updated?.vehicle ?? null,
      details: patch,
    });
    return updated;
  });

/**
 * Multiplicateurs par type de colis (documents, petit/moyen/grand colis,
 * repas, fragile) — voir supabase/migrations/20260624190000_delivery_package_extras_pricing.sql.
 * Remplace les constantes PACKAGE_TYPES.multiplier codées en dur.
 */
export const listDeliveryPackagePricing = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("delivery_package_pricing")
      .select("*")
      .order("package_type");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const updateDeliveryPackagePricing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        multiplier: z.number().min(1).max(5),
        active: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { id, ...patch } = data;
    const { data: updated, error } = await context.supabase
      .from("delivery_package_pricing")
      .update({ ...patch, updated_by: context.userId })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    await logAudit(await getActor(context), {
      action: "delivery_package_pricing.update",
      target_type: "delivery_package_pricing",
      target_id: id,
      target_label: updated?.package_type ?? null,
      details: patch,
    });
    return updated;
  });

/**
 * Frais supplémentaires livraison (urgence, sac isotherme) — voir
 * supabase/migrations/20260624190000_delivery_package_extras_pricing.sql.
 * Remplace les constantes DELIVERY_EXTRAS codées en dur.
 */
export const listDeliveryExtrasPricing = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("delivery_extras_pricing")
      .select("*")
      .order("extra_key");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const updateDeliveryExtrasPricing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        fee_xof: z.number().int().min(0),
        percent_extra: z.number().min(0).max(200),
        active: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { id, ...patch } = data;
    const { data: updated, error } = await context.supabase
      .from("delivery_extras_pricing")
      .update({ ...patch, updated_by: context.userId })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    await logAudit(await getActor(context), {
      action: "delivery_extras_pricing.update",
      target_type: "delivery_extras_pricing",
      target_id: id,
      target_label: updated?.extra_key ?? null,
      details: patch,
    });
    return updated;
  });

/* ====================== Tarif dynamique (trafic + météo) ====================== */

/**
 * Coefficients de "tarif dynamique" (trafic + météo), scoped par programme
 * avec fallback global — voir supabase/migrations/20260630000000_dynamic_pricing_settings.sql.
 * Remplace les constantes codées en dur de dynamic-pricing.ts / delivery-pricing.ts.
 */
export const listDynamicPricingSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("dynamic_pricing_settings")
      .select("*, market_programs:program_id(display_name, country)")
      .order("program_id", { nullsFirst: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const updateDynamicPricingSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        traffic_coefficient: z.number().min(0).max(2),
        traffic_ratio_cap: z.number().min(1).max(3),
        weather_rainy_multiplier: z.number().min(1).max(2),
        weather_cloudy_multiplier: z.number().min(1).max(2),
        weather_sunny_multiplier: z.number().min(1).max(2),
        rounding_increment_xof: z.number().int().min(1).max(1000),
        active: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { id, ...patch } = data;
    const { data: updated, error } = await context.supabase
      .from("dynamic_pricing_settings")
      .update({ ...patch, updated_by: context.userId })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    await logAudit(await getActor(context), {
      action: "dynamic_pricing.update",
      target_type: "dynamic_pricing_settings",
      target_id: id,
      target_label: updated?.program_id ?? "global",
      details: patch,
    });
    return updated;
  });

export const createDynamicPricingSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ programId: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: created, error } = await context.supabase
      .from("dynamic_pricing_settings")
      .insert({ program_id: data.programId, updated_by: context.userId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await logAudit(await getActor(context), {
      action: "dynamic_pricing.create",
      target_type: "dynamic_pricing_settings",
      target_id: created.id,
      target_label: data.programId,
      details: {},
    });
    return created;
  });

export const deleteDynamicPricingSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("dynamic_pricing_settings")
      .delete()
      .eq("id", data.id)
      .not("program_id", "is", null); // jamais supprimer la ligne globale (program_id NULL)
    if (error) throw new Error(error.message);
    await logAudit(await getActor(context), {
      action: "dynamic_pricing.delete",
      target_type: "dynamic_pricing_settings",
      target_id: data.id,
      target_label: undefined,
      details: {},
    });
    return { ok: true as const };
  });

/* ====================== Programmes de marché ====================== */

/**
 * La gestion des programmes (activation/désactivation par pays) reste réservée
 * au superadmin : un admin pays doit passer par lui plutôt que de pouvoir
 * désactiver lui-même un programme de son périmètre.
 */
async function assertSuperadmin(supabase: any, userId: string) {
  const { data: isSuper, error } = await supabase.rpc("is_superadmin", { _uid: userId });
  if (error) throw new Error(error.message);
  if (!isSuper) throw new Error("Forbidden: superadmin role required");
}

export const listMarketPrograms = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperadmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("market_programs")
      .select("*")
      .order("country")
      .order("display_name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const setMarketProgramActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ programId: z.string().min(1), isActive: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertSuperadmin(context.supabase, context.userId);

    if (!data.isActive) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: target } = await supabaseAdmin
        .from("market_programs")
        .select("country, is_default")
        .eq("program_id", data.programId)
        .maybeSingle();
      if (target?.is_default) {
        throw new Error(
          "Ce programme est le programme par défaut de son pays — désignez un autre programme par défaut avant de le désactiver.",
        );
      }
      const { count } = await supabaseAdmin
        .from("market_programs")
        .select("program_id", { count: "exact", head: true })
        .eq("country", target?.country ?? "")
        .eq("is_active", true)
        .neq("program_id", data.programId);
      if (!count) {
        throw new Error("Impossible de désactiver le dernier programme actif de ce pays.");
      }
    }

    const { data: updated, error } = await context.supabase
      .from("market_programs")
      .update({ is_active: data.isActive, updated_by: context.userId })
      .eq("program_id", data.programId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    await logAudit(await getActor(context), {
      action: data.isActive ? "market_program.activate" : "market_program.deactivate",
      target_type: "market_programs",
      target_id: data.programId,
      target_label: updated?.display_name ?? null,
      details: { country: updated?.country, program_code: updated?.program_code },
    });
    return updated;
  });

export const setDefaultMarketProgram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ country: z.string().min(1), programId: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertSuperadmin(context.supabase, context.userId);
    const { data: updated, error } = await context.supabase.rpc("set_default_market_program", {
      _country: data.country,
      _program_id: data.programId,
    });
    if (error) throw new Error(error.message);
    await logAudit(await getActor(context), {
      action: "market_program.set_default",
      target_type: "market_programs",
      target_id: data.programId,
      target_label: (updated as any)?.display_name ?? null,
      details: { country: data.country },
    });
    return updated;
  });

/* ====================== Commission schedules ====================== */

const VEHICLE_CATEGORIES = ["taxi", "eco", "confort", "confort_plus", "vip"] as const;

export const listCommissionSchedules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("commission_schedules")
      .select("*")
      .order("category")
      .order("priority", { ascending: false })
      .order("starts_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const scheduleInput = z.object({
  category: z.enum(VEHICLE_CATEGORIES),
  commission_type: z.enum(["percent", "flat"]),
  commission_rate: z.number().min(0).max(100),
  commission_flat_xof: z.number().int().min(0),
  starts_at: z.string(),
  ends_at: z.string().nullable().optional(),
  priority: z.number().int().min(0).default(0),
  active: z.boolean().default(true),
  notes: z.string().nullable().optional(),
});

export const createCommissionSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => scheduleInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: created, error } = await context.supabase
      .from("commission_schedules")
      .insert({ ...data, created_by: context.userId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await logAudit(await getActor(context), {
      action: "commission_schedule.create",
      target_type: "commission_schedules",
      target_id: created?.id ?? null,
      target_label: created?.category ?? null,
      details: data,
    });
    return created;
  });

export const updateCommissionSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    scheduleInput.partial().extend({ id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { id, ...patch } = data;
    const { data: updated, error } = await context.supabase
      .from("commission_schedules")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    await logAudit(await getActor(context), {
      action: "commission_schedule.update",
      target_type: "commission_schedules",
      target_id: id,
      target_label: updated?.category ?? null,
      details: patch,
    });
    return updated;
  });

export const deleteCommissionSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("commission_schedules")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAudit(await getActor(context), {
      action: "commission_schedule.delete",
      target_type: "commission_schedules",
      target_id: data.id,
      target_label: undefined,
      details: null,
    });
    return { ok: true };
  });

/* -------------------- Commission helpers / report / preview / conflicts -------------------- */

type ResolvedCommission = {
  source: "schedule" | "default" | "none";
  schedule_id: string | null;
  notes: string | null;
  commission_type: "percent" | "flat";
  commission_rate: number;
  commission_flat_xof: number;
};

async function resolveCommissionFor(
  supabase: any,
  category: string,
  at: string,
): Promise<ResolvedCommission> {
  const { data: sched } = await supabase
    .from("commission_schedules")
    .select("*")
    .eq("category", category)
    .eq("active", true)
    .lte("starts_at", at)
    .or(`ends_at.is.null,ends_at.gt.${at}`)
    .order("priority", { ascending: false })
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (sched) {
    return {
      source: "schedule",
      schedule_id: sched.id,
      notes: sched.notes ?? null,
      commission_type: sched.commission_type,
      commission_rate: Number(sched.commission_rate ?? 0),
      commission_flat_xof: Number(sched.commission_flat_xof ?? 0),
    };
  }

  const { data: def } = await supabase
    .from("pricing_settings")
    .select("*")
    .eq("category", category)
    .eq("active", true)
    .limit(1)
    .maybeSingle();

  if (def) {
    return {
      source: "default",
      schedule_id: null,
      notes: null,
      commission_type: def.commission_type ?? "percent",
      commission_rate: Number(def.commission_rate ?? 0),
      commission_flat_xof: Number(def.commission_flat_xof ?? 0),
    };
  }
  return {
    source: "none",
    schedule_id: null,
    notes: null,
    commission_type: "percent",
    commission_rate: 0,
    commission_flat_xof: 0,
  };
}

function applyCommission(price: number, r: ResolvedCommission) {
  const safePrice = Math.max(0, Math.round(price));
  const amount =
    r.commission_type === "flat"
      ? Math.min(r.commission_flat_xof, safePrice)
      : Math.round((safePrice * r.commission_rate) / 100);
  return {
    commission_xof: amount,
    driver_earnings_xof: Math.max(safePrice - amount, 0),
  };
}

export const previewCommission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        category: z.enum(VEHICLE_CATEGORIES),
        starts_at: z.string(),
        ends_at: z.string().nullable().optional(),
        sample_price_xof: z.number().int().min(0).default(5000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const atStart = await resolveCommissionFor(context.supabase, data.category, data.starts_at);
    const atEnd = data.ends_at
      ? await resolveCommissionFor(context.supabase, data.category, data.ends_at)
      : null;
    return {
      at_start: { ...atStart, ...applyCommission(data.sample_price_xof, atStart) },
      at_end: atEnd ? { ...atEnd, ...applyCommission(data.sample_price_xof, atEnd) } : null,
      sample_price_xof: data.sample_price_xof,
    };
  });

export const detectScheduleConflicts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("commission_schedules")
      .select("*")
      .eq("active", true);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as any[];
    const conflicts: any[] = [];
    const byCat = new Map<string, any[]>();
    rows.forEach((r) => {
      const list = byCat.get(r.category) ?? [];
      list.push(r);
      byCat.set(r.category, list);
    });
    for (const [cat, list] of byCat) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          const aEnd = a.ends_at ? new Date(a.ends_at).getTime() : Infinity;
          const bEnd = b.ends_at ? new Date(b.ends_at).getTime() : Infinity;
          const aStart = new Date(a.starts_at).getTime();
          const bStart = new Date(b.starts_at).getTime();
          const overlap = aStart < bEnd && bStart < aEnd;
          if (!overlap) continue;
          conflicts.push({
            category: cat,
            a,
            b,
            same_priority: a.priority === b.priority,
            winner_id: a.priority === b.priority ? null : a.priority > b.priority ? a.id : b.id,
          });
        }
      }
    }
    return conflicts;
  });

export const getRideCommissionDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ride_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: ride, error } = await context.supabase
      .from("rides")
      .select("*")
      .eq("id", data.ride_id)
      .single();
    if (error) throw new Error(error.message);
    const at = ride.completed_at ?? ride.updated_at ?? new Date().toISOString();
    const resolved = await resolveCommissionFor(context.supabase, ride.category, at);
    const { data: wtx } = await context.supabase
      .from("wallet_transactions")
      .select("*")
      .eq("ride_id", data.ride_id)
      .order("created_at", { ascending: false });
    return { ride, resolved, wallet_tx: wtx ?? [] };
  });

export const commissionReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        from: z.string(),
        to: z.string(),
        category: z.enum(VEHICLE_CATEGORIES).nullable().optional(),
        driver_id: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    let q = context.supabase
      .from("rides")
      .select(
        "id, completed_at, category, driver_id, passenger_id, price_xof, commission_xof, commission_rate, driver_earnings_xof, city, pickup_address, dropoff_address",
      )
      .eq("status", "completed")
      .gte("completed_at", data.from)
      .lte("completed_at", data.to)
      .order("completed_at", { ascending: false })
      .limit(5000);
    if (data.category) q = q.eq("category", data.category);
    if (data.driver_id) q = q.eq("driver_id", data.driver_id);
    const { data: rides, error } = await q;
    if (error) throw new Error(error.message);

    const driverIds = Array.from(new Set((rides ?? []).map((r: any) => r.driver_id).filter(Boolean)));
    let driverMap = new Map<string, string>();
    if (driverIds.length) {
      const { data: profs } = await context.supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", driverIds);
      driverMap = new Map((profs ?? []).map((p: any) => [p.id, p.full_name]));
    }

    // Bonus par course = points reward (acceptation/complétion/parrainage) crédités
    // au chauffeur pour cette course, convertis en XOF via reward_settings.
    const rideIds = (rides ?? []).map((r: any) => r.id);
    const bonusByRide = new Map<string, number>();
    if (rideIds.length) {
      const { data: settings } = await context.supabase
        .from("reward_settings")
        .select("driver_point_value_xof")
        .eq("id", true)
        .maybeSingle();
      const pointValueXof = Number(settings?.driver_point_value_xof ?? 1);

      const { data: rewardTx } = await context.supabase
        .from("driver_reward_transactions")
        .select("ride_id, points, type")
        .in("ride_id", rideIds)
        .in("type", ["ride_accepted", "ride_completed", "referral_bonus"]);

      for (const tx of rewardTx ?? []) {
        if (!tx.ride_id) continue;
        const prev = bonusByRide.get(tx.ride_id) ?? 0;
        bonusByRide.set(tx.ride_id, prev + Math.round((tx.points ?? 0) * pointValueXof));
      }
    }

    const rows = (rides ?? []).map((r: any) => ({
      ...r,
      driver_name: r.driver_id ? driverMap.get(r.driver_id) ?? null : null,
      bonus_xof: bonusByRide.get(r.id) ?? 0,
    }));

    const totals = {
      rides: rows.length,
      revenue_xof: rows.reduce((s, r) => s + (r.price_xof ?? 0), 0),
      commission_xof: rows.reduce((s, r) => s + (r.commission_xof ?? 0), 0),
      driver_earnings_xof: rows.reduce((s, r) => s + (r.driver_earnings_xof ?? 0), 0),
      bonus_xof: rows.reduce((s, r) => s + (r.bonus_xof ?? 0), 0),
    };
    const byCategory: Record<string, any> = {};
    const byDriver: Record<string, any> = {};
    rows.forEach((r: any) => {
      const c = (byCategory[r.category] ??= { category: r.category, rides: 0, revenue_xof: 0, commission_xof: 0, bonus_xof: 0 });
      c.rides++;
      c.revenue_xof += r.price_xof ?? 0;
      c.commission_xof += r.commission_xof ?? 0;
      c.bonus_xof += r.bonus_xof ?? 0;
      if (r.driver_id) {
        const d = (byDriver[r.driver_id] ??= {
          driver_id: r.driver_id,
          driver_name: r.driver_name,
          rides: 0,
          revenue_xof: 0,
          commission_xof: 0,
          earnings_xof: 0,
          bonus_xof: 0,
        });
        d.rides++;
        d.revenue_xof += r.price_xof ?? 0;
        d.commission_xof += r.commission_xof ?? 0;
        d.earnings_xof += r.driver_earnings_xof ?? 0;
        d.bonus_xof += r.bonus_xof ?? 0;
      }
    });
    return { rows, totals, byCategory: Object.values(byCategory), byDriver: Object.values(byDriver) };
  });


/* ============================ Billing ============================ */

export const listCorporates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const scope = await requireAdminScope(context.supabase, context.userId);
    let query = context.supabase.from("corporate_accounts").select("*").order("name");
    if (!scope.isSuper && scope.country) query = query.eq("country", scope.country);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createCorporate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      name: z.string().trim().min(1).max(200),
      contact_name: z.string().trim().max(200).optional().nullable(),
      email: z.string().trim().email().max(255).optional().nullable(),
      phone: z.string().trim().max(50).optional().nullable(),
      address: z.string().trim().max(500).optional().nullable(),
      city: z.string().trim().max(100).optional().nullable(),
      tax_id: z.string().trim().max(100).optional().nullable(),
      country: z.string().trim().max(80).optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const scope = await requireAdminScope(context.supabase, context.userId);
    const payload: any = { ...data };
    if (!scope.isSuper) {
      // Country admins can only create corporates in their own country
      if (payload.country && payload.country !== scope.country) {
        throw new Error(`Vous ne pouvez créer une entité que dans le pays « ${scope.country} ».`);
      }
      payload.country = scope.country;
    }
    const { data: row, error } = await context.supabase
      .from("corporate_accounts").insert(payload).select().single();
    if (error) throw new Error(error.message);
    await logAudit(await getActor(context), {
      action: "corporate.create", target_type: "corporate_accounts",
      target_id: row.id, target_label: row.name,
      details: { country: payload.country ?? null },
    });
    return row;
  });

export const listInvoices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const scope = await requireAdminScope(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("invoices")
      .select("*, corporate:corporate_accounts(id,name,country)")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    if (scope.isSuper) return rows;
    return rows.filter((r: any) => r.corporate?.country === scope.country);
  });

export const createInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      corporate_id: z.string().uuid(),
      period_start: z.string().optional().nullable(),
      period_end: z.string().optional().nullable(),
      due_date: z.string().optional().nullable(),
      notes: z.string().max(2000).optional().nullable(),
      items: z.array(z.object({
        description: z.string().min(1).max(500),
        quantity: z.number().min(0.01),
        unit_price_xof: z.number().int().min(0),
      })).min(1),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const scope = await requireAdminScope(context.supabase, context.userId);
    await assertCorporateInScope(scope.country, data.corporate_id);
    const subtotal = data.items.reduce(
      (s, it) => s + Math.round(it.quantity * it.unit_price_xof), 0,
    );
    const vat = Math.round(subtotal * 0.18);
    const total = subtotal + vat;
    const { data: inv, error } = await context.supabase
      .from("invoices").insert({
        corporate_id: data.corporate_id,
        period_start: data.period_start || null,
        period_end: data.period_end || null,
        due_date: data.due_date || null,
        notes: data.notes || null,
        subtotal_xof: subtotal, vat_rate: 18, vat_xof: vat, total_xof: total,
        created_by: context.userId,
      }).select().single();
    if (error) throw new Error(error.message);

    const items = data.items.map((it) => ({
      invoice_id: inv.id,
      description: it.description,
      quantity: it.quantity,
      unit_price_xof: it.unit_price_xof,
      total_xof: Math.round(it.quantity * it.unit_price_xof),
    }));
    const { error: ie } = await context.supabase.from("invoice_items").insert(items);
    if (ie) throw new Error(ie.message);

    await logAudit(await getActor(context), {
      action: "invoice.create", target_type: "invoices",
      target_id: inv.id, target_label: inv.number ?? undefined,
      details: { total_xof: total },
    });
    return inv;
  });

export const updateInvoiceStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      invoice_id: z.string().uuid(),
      status: z.enum(["draft", "issued", "paid", "cancelled"]),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const scope = await requireAdminScope(context.supabase, context.userId);
    await assertInvoiceInScope(scope.country, data.invoice_id);
    const patch: any = { status: data.status };
    const now = new Date().toISOString();
    if (data.status === "issued") patch.issued_at = now;
    if (data.status === "paid") patch.paid_at = now;
    if (data.status === "cancelled") patch.cancelled_at = now;

    const { data: row, error } = await context.supabase
      .from("invoices").update(patch).eq("id", data.invoice_id)
      .select("number, status").single();
    if (error) throw new Error(error.message);

    await logAudit(await getActor(context), {
      action: "invoice.status", target_type: "invoices",
      target_id: data.invoice_id, target_label: row.number ?? undefined,
      details: { status: data.status },
    });
    return row;
  });

export const recordInvoicePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      invoice_id: z.string().uuid(),
      amount_xof: z.number().int().min(1),
      method: z.enum(["bank_transfer","mobile_money","cash","card","other"]),
      reference: z.string().max(200).optional().nullable(),
      paid_on: z.string().optional().nullable(),
      notes: z.string().max(1000).optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const scope = await requireAdminScope(context.supabase, context.userId);
    await assertInvoiceInScope(scope.country, data.invoice_id);

    const { data: pay, error } = await context.supabase
      .from("invoice_payments").insert({
        invoice_id: data.invoice_id,
        amount_xof: data.amount_xof,
        method: data.method,
        reference: data.reference || null,
        paid_on: data.paid_on || new Date().toISOString().slice(0,10),
        notes: data.notes || null,
        recorded_by: context.userId,
      }).select().single();
    if (error) throw new Error(error.message);

    // Recompute paid_xof and auto-set status to 'paid' if fully paid
    const { data: payments } = await context.supabase
      .from("invoice_payments").select("amount_xof").eq("invoice_id", data.invoice_id);
    const paidTotal = (payments ?? []).reduce((s: number, p: any) => s + p.amount_xof, 0);

    const { data: inv } = await context.supabase
      .from("invoices").select("total_xof, status").eq("id", data.invoice_id).single();

    const patch: any = { paid_xof: paidTotal };
    if (inv && paidTotal >= inv.total_xof && inv.status !== "paid") {
      patch.status = "paid";
      patch.paid_at = new Date().toISOString();
    }
    await context.supabase.from("invoices").update(patch).eq("id", data.invoice_id);

    await logAudit(await getActor(context), {
      action: "invoice.payment", target_type: "invoices",
      target_id: data.invoice_id,
      details: { amount_xof: data.amount_xof, method: data.method, reference: data.reference },
    });
    return { payment: pay, paid_total: paidTotal };
  });

export const listInvoicePayments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ invoice_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const scope = await requireAdminScope(context.supabase, context.userId);
    await assertInvoiceInScope(scope.country, data.invoice_id);
    const { data: rows, error } = await context.supabase
      .from("invoice_payments").select("*")
      .eq("invoice_id", data.invoice_id)
      .order("paid_on", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// Recherche d'utilisateurs pour l'agent support — utilisée par le bouton
// « Nouveau ticket » de l'Inbox Support, qui n'existait pas auparavant
// (un agent n'avait aucun moyen d'ouvrir un ticket pour un appelant). Le
// rôle "support" seul n'a pas accès à listUsers (réservé à admin/superadmin),
// d'où cette variante allégée avec assertAgent.
export const searchAgentUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ query: z.string().trim().min(1).max(100) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAgent(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (authErr) throw new Error(authErr.message);

    const ids = authData.users.map((u) => u.id);
    const { data: profiles } = await supabaseAdmin
      .from("profiles").select("id, full_name, phone").in("id", ids);
    const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

    const needle = data.query.toLowerCase();
    return authData.users
      .map((u) => ({
        id: u.id,
        email: u.email ?? null,
        full_name: profileMap.get(u.id)?.full_name ?? null,
        phone: profileMap.get(u.id)?.phone ?? null,
      }))
      .filter((u) =>
        (u.email ?? "").toLowerCase().includes(needle) ||
        (u.full_name ?? "").toLowerCase().includes(needle) ||
        (u.phone ?? "").toLowerCase().includes(needle),
      )
      .slice(0, 20);
  });

// Création d'un ticket par un agent (support/admin/superadmin) pour le compte
// d'un utilisateur — ex. appel téléphonique, signalement en personne. La
// policy RLS d'INSERT sur support_tickets exige `created_by = auth.uid()`,
// ce qui empêche un agent d'ouvrir un ticket pour un tiers : on passe donc
// par supabaseAdmin (service role) ici.
export const createTicketAsAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      userId: z.string().uuid(),
      subject: z.string().trim().min(3).max(200),
      category: z.enum(["account", "payment", "ride", "driver", "passenger", "technical", "other"]),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
      body: z.string().trim().min(5).max(4000),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAgent(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: ticket, error } = await supabaseAdmin
      .from("support_tickets")
      .insert({
        created_by: data.userId,
        subject: data.subject,
        category: data.category,
        priority: data.priority ?? "normal",
        status: "pending",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    const { error: msgErr } = await supabaseAdmin
      .from("ticket_messages")
      .insert({ ticket_id: ticket.id, author_id: context.userId, body: data.body });
    if (msgErr) throw new Error(msgErr.message);

    const { data: target } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    await logAudit(await getActor(context), {
      action: "ticket.create_for_user",
      target_type: "support_tickets",
      target_id: ticket.id,
      target_label: target?.user?.email ?? undefined,
    });

    return ticket;
  });
