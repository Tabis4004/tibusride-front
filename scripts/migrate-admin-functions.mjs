import fs from "node:fs";

const out = `import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "@/integrations/vercel/auth-middleware";
import { z } from "zod";
import { assertAdmin, actorFrom, logAudit, queryOne, queryRows, serviceQuery } from "@/integrations/vercel/admin-helpers";

const VEHICLE_CATEGORIES = ["taxi", "eco", "confort", "confort_plus", "vip"] as const;

export const listUsers = createServerFn({ method: "GET" }).middleware([requireAuth]).handler(async ({ context }) => {
  await assertAdmin(context.userId);
  const users = await serviceQuery<{ id: string; email: string; created_at: string; raw_user_meta_data: Record<string, unknown> }>(
    \`SELECT id, email, created_at, raw_user_meta_data FROM auth.users ORDER BY created_at DESC LIMIT 200\`, []);
  const profiles = await queryRows(context.userId, \`SELECT id, full_name, phone, city FROM public.profiles\`, []);
  const roles = await queryRows(context.userId, \`SELECT user_id, role FROM public.user_roles\`, []);
  const profileMap = new Map(profiles.map((p) => [(p as { id: string }).id, p]));
  const roleMap = new Map<string, string[]>();
  roles.forEach((r) => {
    const row = r as { user_id: string; role: string };
    const list = roleMap.get(row.user_id) ?? [];
    list.push(row.role);
    roleMap.set(row.user_id, list);
  });
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    created_at: u.created_at,
    last_sign_in_at: null,
    banned_until: (u.raw_user_meta_data?.banned as boolean) ? "banned" : null,
    profile: profileMap.get(u.id) ?? null,
    roles: roleMap.get(u.id) ?? [],
  }));
});

export const setUserBanned = createServerFn({ method: "POST" }).middleware([requireAuth]).inputValidator((input: unknown) =>
  z.object({ userId: z.string().uuid(), banned: z.boolean(), reason: z.string().max(500).optional() }).parse(input),
).handler(async ({ data, context }) => {
  await assertAdmin(context.userId);
  if (data.userId === context.userId) throw new Error("Vous ne pouvez pas vous bloquer vous-même.");
  const target = await serviceOne<{ email: string }>(\`SELECT email FROM auth.users WHERE id = $1\`, [data.userId]);
  await serviceQuery(
    \`UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data || $2::jsonb, updated_at = now() WHERE id = $1\`,
    [data.userId, JSON.stringify({ banned: data.banned, ban_reason: data.reason ?? null })],
  );
  await logAudit(actorFrom(context), { action: data.banned ? "user.ban" : "user.unban", target_type: "user", target_id: data.userId, target_label: target?.email, details: data.reason ? { reason: data.reason } : null });
  return { ok: true };
});

export const setUserRole = createServerFn({ method: "POST" }).middleware([requireAuth]).inputValidator((input: unknown) =>
  z.object({ userId: z.string().uuid(), role: z.enum(["admin", "driver", "passenger", "support"]), grant: z.boolean() }).parse(input),
).handler(async ({ data, context }) => {
  await assertAdmin(context.userId);
  if (data.grant) {
    await queryRows(context.userId, \`INSERT INTO public.user_roles (user_id, role) VALUES ($1, $2::public.app_role) ON CONFLICT DO NOTHING\`, [data.userId, data.role]);
  } else {
    if (data.userId === context.userId && data.role === "admin") throw new Error("Vous ne pouvez pas retirer votre propre rôle admin.");
    await queryRows(context.userId, \`DELETE FROM public.user_roles WHERE user_id = $1 AND role = $2::public.app_role\`, [data.userId, data.role]);
  }
  const target = await serviceOne<{ email: string }>(\`SELECT email FROM auth.users WHERE id = $1\`, [data.userId]);
  await logAudit(actorFrom(context), { action: data.grant ? "role.grant" : "role.revoke", target_type: "user", target_id: data.userId, target_label: target?.email, details: { role: data.role } });
  return { ok: true };
});

export const updateDriverStatus = createServerFn({ method: "POST" }).middleware([requireAuth]).inputValidator((input: unknown) =>
  z.object({ userId: z.string().uuid(), status: z.enum(["pending", "under_review", "approved", "rejected", "suspended"]), reason: z.string().max(500).optional() }).parse(input),
).handler(async ({ data, context }) => {
  await assertAdmin(context.userId);
  await queryRows(context.userId,
    \`UPDATE public.driver_profiles SET status = $2::public.driver_status, status_updated_at = now(), status_updated_by = $3,
      rejection_reason = CASE WHEN $2 IN ('rejected','suspended') THEN $4 ELSE NULL END, updated_at = now() WHERE user_id = $1\`,
    [data.userId, data.status, context.userId, data.reason ?? null]);
  const target = await serviceOne<{ email: string }>(\`SELECT email FROM auth.users WHERE id = $1\`, [data.userId]);
  await logAudit(actorFrom(context), { action: \`driver.status.\${data.status}\`, target_type: "driver", target_id: data.userId, target_label: target?.email, details: { status: data.status, reason: data.reason } });
  return { ok: true };
});

export const uploadDriverDocument = createServerFn({ method: "POST" }).middleware([requireAuth]).inputValidator((input: unknown) =>
  z.object({ userId: z.string().uuid(), kind: z.enum(["id", "license", "vehicle"]), filename: z.string().max(200), contentType: z.string().max(100), base64: z.string().max(8_000_000) }).parse(input),
).handler(async ({ data, context }) => {
  await assertAdmin(context.userId);
  const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  if (!allowed.includes(data.contentType)) throw new Error("Format non supporté (JPG, PNG, WEBP ou PDF).");
  const buf = Buffer.from(data.base64, "base64");
  if (buf.byteLength > 5 * 1024 * 1024) throw new Error("Fichier trop volumineux (max 5 Mo).");
  const blobUrl = \`data:\${data.contentType};base64,\${data.base64}\`;
  await queryRows(context.userId,
    \`INSERT INTO public.driver_documents (driver_id, doc_type, blob_url, file_name, mime_type) VALUES ($1, $2, $3, $4, $5)\`,
    [data.userId, data.kind, blobUrl, data.filename, data.contentType]);
  const col = data.kind === "id" ? "id_document_url" : data.kind === "license" ? "license_document_url" : "vehicle_document_url";
  await queryRows(context.userId, \`UPDATE public.driver_profiles SET \${col} = $2, updated_at = now() WHERE user_id = $1\`, [data.userId, blobUrl]);
  await logAudit(actorFrom(context), { action: "driver.document.upload", target_type: "driver", target_id: data.userId, details: { kind: data.kind, size: buf.byteLength } });
  return { ok: true, path: blobUrl };
});

export const getDocumentSignedUrl = createServerFn({ method: "POST" }).middleware([requireAuth]).inputValidator((input: unknown) => z.object({ path: z.string().min(1).max(5000000) }).parse(input)).handler(async ({ data, context }) => {
  await assertAdmin(context.userId);
  return { url: data.path };
});

export const listAuditLogs = createServerFn({ method: "GET" }).middleware([requireAuth]).handler(async ({ context }) => {
  await assertAdmin(context.userId);
  return queryRows(context.userId, \`SELECT * FROM public.audit_logs ORDER BY created_at DESC LIMIT 500\`, []);
});

export const listPricingSettings = createServerFn({ method: "GET" }).middleware([requireAuth]).handler(async ({ context }) => {
  await assertAdmin(context.userId);
  return queryRows(context.userId, \`SELECT * FROM public.pricing_settings ORDER BY category\`, []);
});

export const updatePricingSetting = createServerFn({ method: "POST" }).middleware([requireAuth]).inputValidator((d: unknown) =>
  z.object({ id: z.string().uuid(), base_fare_xof: z.number().int().min(0), per_km_xof: z.number().int().min(0), per_min_xof: z.number().int().min(0), min_fare_xof: z.number().int().min(0), commission_type: z.enum(["percent", "flat"]), commission_rate: z.number().min(0).max(100), commission_flat_xof: z.number().int().min(0), active: z.boolean() }).parse(d),
).handler(async ({ data, context }) => {
  await assertAdmin(context.userId);
  const rows = await queryRows(context.userId,
    \`UPDATE public.pricing_settings SET base_fare_xof=$2, per_km_xof=$3, per_min_xof=$4, min_fare_xof=$5, commission_type=$6::public.commission_kind, commission_rate=$7, commission_flat_xof=$8, active=$9, updated_by=$10, updated_at=now() WHERE id=$1 RETURNING *\`,
    [data.id, data.base_fare_xof, data.per_km_xof, data.per_min_xof, data.min_fare_xof, data.commission_type, data.commission_rate, data.commission_flat_xof, data.active, context.userId]);
  await logAudit(actorFrom(context), { action: "pricing.update", target_type: "pricing_settings", target_id: data.id, details: data });
  return rows[0];
});

export const listCommissionSchedules = createServerFn({ method: "GET" }).middleware([requireAuth]).handler(async ({ context }) => {
  await assertAdmin(context.userId);
  return queryRows(context.userId, \`SELECT * FROM public.commission_schedules ORDER BY category, priority DESC, starts_at DESC\`, []);
});

const scheduleInput = z.object({ category: z.enum(VEHICLE_CATEGORIES), commission_type: z.enum(["percent", "flat"]), commission_rate: z.number().min(0).max(100), commission_flat_xof: z.number().int().min(0), starts_at: z.string(), ends_at: z.string().nullable().optional(), priority: z.number().int().min(0).default(0), active: z.boolean().default(true), notes: z.string().nullable().optional() });

export const createCommissionSchedule = createServerFn({ method: "POST" }).middleware([requireAuth]).inputValidator((d: unknown) => scheduleInput.parse(d)).handler(async ({ data, context }) => {
  await assertAdmin(context.userId);
  const rows = await queryRows(context.userId,
    \`INSERT INTO public.commission_schedules (category, commission_type, commission_rate, commission_flat_xof, starts_at, ends_at, priority, active, notes, created_by)
     VALUES ($1::public.vehicle_category,$2::public.commission_kind,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *\`,
    [data.category, data.commission_type, data.commission_rate, data.commission_flat_xof, data.starts_at, data.ends_at ?? null, data.priority, data.active, data.notes ?? null, context.userId]);
  return rows[0];
});

export const updateCommissionSchedule = createServerFn({ method: "POST" }).middleware([requireAuth]).inputValidator((d: unknown) => scheduleInput.partial().extend({ id: z.string().uuid() }).parse(d)).handler(async ({ data, context }) => {
  await assertAdmin(context.userId);
  const { id, ...patch } = data;
  const rows = await queryRows(context.userId,
    \`UPDATE public.commission_schedules SET category=COALESCE($2::public.vehicle_category,category), commission_type=COALESCE($3::public.commission_kind,commission_type),
      commission_rate=COALESCE($4,commission_rate), commission_flat_xof=COALESCE($5,commission_flat_xof), starts_at=COALESCE($6,starts_at), ends_at=$7, priority=COALESCE($8,priority), active=COALESCE($9,active), notes=COALESCE($10,notes), updated_at=now() WHERE id=$1 RETURNING *\`,
    [id, patch.category ?? null, patch.commission_type ?? null, patch.commission_rate ?? null, patch.commission_flat_xof ?? null, patch.starts_at ?? null, patch.ends_at ?? null, patch.priority ?? null, patch.active ?? null, patch.notes ?? null]);
  return rows[0];
});

export const deleteCommissionSchedule = createServerFn({ method: "POST" }).middleware([requireAuth]).inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d)).handler(async ({ data, context }) => {
  await assertAdmin(context.userId);
  await queryRows(context.userId, \`DELETE FROM public.commission_schedules WHERE id = $1\`, [data.id]);
  return { ok: true };
});

async function resolveCommissionFor(userId: string, category: string, at: string) {
  const sched = await queryOne(userId,
    \`SELECT * FROM public.commission_schedules WHERE category=$1::public.vehicle_category AND active=true AND starts_at <= $2 AND (ends_at IS NULL OR ends_at > $2) ORDER BY priority DESC, starts_at DESC LIMIT 1\`,
    [category, at]);
  if (sched) return { source: "schedule", schedule_id: (sched as { id: string }).id, notes: (sched as { notes: string | null }).notes, commission_type: (sched as { commission_type: string }).commission_type, commission_rate: Number((sched as { commission_rate: number }).commission_rate), commission_flat_xof: Number((sched as { commission_flat_xof: number }).commission_flat_xof) };
  const def = await queryOne(userId, \`SELECT * FROM public.pricing_settings WHERE category=$1::public.vehicle_category AND active=true LIMIT 1\`, [category]);
  if (def) return { source: "default", schedule_id: null, notes: null, commission_type: (def as { commission_type: string }).commission_type, commission_rate: Number((def as { commission_rate: number }).commission_rate), commission_flat_xof: Number((def as { commission_flat_xof: number }).commission_flat_xof) };
  return { source: "none", schedule_id: null, notes: null, commission_type: "percent", commission_rate: 0, commission_flat_xof: 0 };
}

function applyCommission(price: number, r: { commission_type: string; commission_rate: number; commission_flat_xof: number }) {
  const safePrice = Math.max(0, Math.round(price));
  const amount = r.commission_type === "flat" ? Math.min(r.commission_flat_xof, safePrice) : Math.round((safePrice * r.commission_rate) / 100);
  return { commission_xof: amount, driver_earnings_xof: Math.max(safePrice - amount, 0) };
}

export const previewCommission = createServerFn({ method: "POST" }).middleware([requireAuth]).inputValidator((d: unknown) =>
  z.object({ category: z.enum(VEHICLE_CATEGORIES), starts_at: z.string(), ends_at: z.string().nullable().optional(), sample_price_xof: z.number().int().min(0).default(5000) }).parse(d),
).handler(async ({ data, context }) => {
  await assertAdmin(context.userId);
  const atStart = await resolveCommissionFor(context.userId, data.category, data.starts_at);
  const atEnd = data.ends_at ? await resolveCommissionFor(context.userId, data.category, data.ends_at) : null;
  return { at_start: { ...atStart, ...applyCommission(data.sample_price_xof, atStart) }, at_end: atEnd ? { ...atEnd, ...applyCommission(data.sample_price_xof, atEnd) } : null, sample_price_xof: data.sample_price_xof };
});

export const detectScheduleConflicts = createServerFn({ method: "GET" }).middleware([requireAuth]).handler(async ({ context }) => {
  await assertAdmin(context.userId);
  const rows = await queryRows(context.userId, \`SELECT * FROM public.commission_schedules WHERE active = true\`, []);
  const conflicts: unknown[] = [];
  const byCat = new Map<string, unknown[]>();
  rows.forEach((r) => { const list = byCat.get((r as { category: string }).category) ?? []; list.push(r); byCat.set((r as { category: string }).category, list); });
  for (const [cat, list] of byCat) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i] as { id: string; starts_at: string; ends_at: string | null; priority: number };
      const b = list[j] as { id: string; starts_at: string; ends_at: string | null; priority: number };
      const aEnd = a.ends_at ? new Date(a.ends_at).getTime() : Infinity;
      const bEnd = b.ends_at ? new Date(b.ends_at).getTime() : Infinity;
      if (new Date(a.starts_at).getTime() < bEnd && new Date(b.starts_at).getTime() < aEnd) conflicts.push({ category: cat, a, b, same_priority: a.priority === b.priority, winner_id: a.priority === b.priority ? null : a.priority > b.priority ? a.id : b.id });
    }
  }
  return conflicts;
});

export const getRideCommissionDetail = createServerFn({ method: "POST" }).middleware([requireAuth]).inputValidator((d: unknown) => z.object({ ride_id: z.string().uuid() }).parse(d)).handler(async ({ data, context }) => {
  await assertAdmin(context.userId);
  const ride = await queryOne(context.userId, \`SELECT * FROM public.rides WHERE id = $1\`, [data.ride_id]);
  if (!ride) throw new Error("Course introuvable");
  const at = (ride as { completed_at?: string; updated_at?: string }).completed_at ?? (ride as { updated_at?: string }).updated_at ?? new Date().toISOString();
  const resolved = await resolveCommissionFor(context.userId, (ride as { category: string }).category, at);
  const wtx = await queryRows(context.userId, \`SELECT * FROM public.wallet_transactions WHERE ride_id = $1 ORDER BY created_at DESC\`, [data.ride_id]);
  return { ride, resolved, wallet_tx: wtx };
});

export const commissionReport = createServerFn({ method: "POST" }).middleware([requireAuth]).inputValidator((d: unknown) =>
  z.object({ from: z.string(), to: z.string(), category: z.enum(VEHICLE_CATEGORIES).nullable().optional(), driver_id: z.string().uuid().nullable().optional() }).parse(d),
).handler(async ({ data, context }) => {
  await assertAdmin(context.userId);
  const params: unknown[] = [data.from, data.to];
  let sql = \`SELECT id, completed_at, category, driver_id, passenger_id, price_xof, commission_xof, commission_rate, driver_earnings_xof, city, pickup_address, dropoff_address FROM public.rides WHERE status='completed' AND completed_at >= $1 AND completed_at <= $2\`;
  if (data.category) { params.push(data.category); sql += \` AND category = $\${params.length}::public.vehicle_category\`; }
  if (data.driver_id) { params.push(data.driver_id); sql += \` AND driver_id = $\${params.length}::uuid\`; }
  sql += \` ORDER BY completed_at DESC LIMIT 5000\`;
  const rides = await queryRows(context.userId, sql, params);
  const driverIds = [...new Set(rides.map((r) => (r as { driver_id?: string }).driver_id).filter(Boolean))];
  let driverMap = new Map<string, string>();
  if (driverIds.length) {
    const profs = await queryRows(context.userId, \`SELECT id, full_name FROM public.profiles WHERE id = ANY($1::uuid[])\`, [driverIds]);
    driverMap = new Map(profs.map((p) => [(p as { id: string }).id, (p as { full_name: string }).full_name]));
  }
  const rows = rides.map((r) => ({ ...r, driver_name: (r as { driver_id?: string }).driver_id ? driverMap.get((r as { driver_id: string }).driver_id) ?? null : null }));
  const totals = { rides: rows.length, revenue_xof: rows.reduce((s, r) => s + ((r as { price_xof?: number }).price_xof ?? 0), 0), commission_xof: rows.reduce((s, r) => s + ((r as { commission_xof?: number }).commission_xof ?? 0), 0), driver_earnings_xof: rows.reduce((s, r) => s + ((r as { driver_earnings_xof?: number }).driver_earnings_xof ?? 0), 0) };
  return { rows, totals, byCategory: [], byDriver: [] };
});

export const listCorporates = createServerFn({ method: "GET" }).middleware([requireAuth]).handler(async ({ context }) => {
  await assertAdmin(context.userId);
  return queryRows(context.userId, \`SELECT * FROM public.corporate_accounts ORDER BY name\`, []);
});

export const createCorporate = createServerFn({ method: "POST" }).middleware([requireAuth]).inputValidator((d: unknown) =>
  z.object({ name: z.string().trim().min(1).max(200), contact_name: z.string().trim().max(200).optional().nullable(), email: z.string().trim().email().max(255).optional().nullable(), phone: z.string().trim().max(50).optional().nullable(), address: z.string().trim().max(500).optional().nullable(), city: z.string().trim().max(100).optional().nullable(), tax_id: z.string().trim().max(100).optional().nullable() }).parse(d),
).handler(async ({ data, context }) => {
  await assertAdmin(context.userId);
  const rows = await queryRows(context.userId,
    \`INSERT INTO public.corporate_accounts (name, contact_name, email, phone, address, city, tax_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *\`,
    [data.name, data.contact_name ?? null, data.email ?? null, data.phone ?? null, data.address ?? null, data.city ?? null, data.tax_id ?? null]);
  return rows[0];
});

export const listInvoices = createServerFn({ method: "GET" }).middleware([requireAuth]).handler(async ({ context }) => {
  await assertAdmin(context.userId);
  return queryRows(context.userId,
    \`SELECT i.*, json_build_object('id', c.id, 'name', c.name) AS corporate FROM public.invoices i JOIN public.corporate_accounts c ON c.id = i.corporate_id ORDER BY i.created_at DESC LIMIT 500\`, []);
});

export const createInvoice = createServerFn({ method: "POST" }).middleware([requireAuth]).inputValidator((d: unknown) =>
  z.object({ corporate_id: z.string().uuid(), period_start: z.string().optional().nullable(), period_end: z.string().optional().nullable(), due_date: z.string().optional().nullable(), notes: z.string().max(2000).optional().nullable(), items: z.array(z.object({ description: z.string().min(1).max(500), quantity: z.number().min(0.01), unit_price_xof: z.number().int().min(0) })).min(1) }).parse(d),
).handler(async ({ data, context }) => {
  await assertAdmin(context.userId);
  const subtotal = data.items.reduce((s, it) => s + Math.round(it.quantity * it.unit_price_xof), 0);
  const vat = Math.round(subtotal * 0.18);
  const total = subtotal + vat;
  const invRows = await queryRows(context.userId,
    \`INSERT INTO public.invoices (corporate_id, period_start, period_end, due_date, notes, subtotal_xof, vat_rate, vat_xof, total_xof, created_by) VALUES ($1,$2,$3,$4,$5,$6,18,$7,$8,$9) RETURNING *\`,
    [data.corporate_id, data.period_start ?? null, data.period_end ?? null, data.due_date ?? null, data.notes ?? null, subtotal, vat, total, context.userId]);
  const inv = invRows[0] as { id: string };
  for (const it of data.items) {
    await queryRows(context.userId, \`INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price_xof, total_xof) VALUES ($1,$2,$3,$4,$5)\`, [inv.id, it.description, it.quantity, it.unit_price_xof, Math.round(it.quantity * it.unit_price_xof)]);
  }
  return invRows[0];
});

export const updateInvoiceStatus = createServerFn({ method: "POST" }).middleware([requireAuth]).inputValidator((d: unknown) => z.object({ invoice_id: z.string().uuid(), status: z.enum(["draft", "issued", "paid", "cancelled"]) }).parse(d)).handler(async ({ data, context }) => {
  await assertAdmin(context.userId);
  const rows = await queryRows(context.userId,
    \`UPDATE public.invoices SET status=$2::public.invoice_status, issued_at=CASE WHEN $2='issued' THEN now() ELSE issued_at END, paid_at=CASE WHEN $2='paid' THEN now() ELSE paid_at END, cancelled_at=CASE WHEN $2='cancelled' THEN now() ELSE cancelled_at END, updated_at=now() WHERE id=$1 RETURNING number, status\`,
    [data.invoice_id, data.status]);
  return rows[0];
});

export const recordInvoicePayment = createServerFn({ method: "POST" }).middleware([requireAuth]).inputValidator((d: unknown) =>
  z.object({ invoice_id: z.string().uuid(), amount_xof: z.number().int().min(1), method: z.enum(["bank_transfer","mobile_money","cash","card","other"]), reference: z.string().max(200).optional().nullable(), paid_on: z.string().optional().nullable(), notes: z.string().max(1000).optional().nullable() }).parse(d),
).handler(async ({ data, context }) => {
  await assertAdmin(context.userId);
  const payRows = await queryRows(context.userId,
    \`INSERT INTO public.invoice_payments (invoice_id, amount_xof, method, reference, paid_on, notes, recorded_by) VALUES ($1,$2,$3::public.payment_method_type,$4,COALESCE($5,current_date),$6,$7) RETURNING *\`,
    [data.invoice_id, data.amount_xof, data.method, data.reference ?? null, data.paid_on ?? null, data.notes ?? null, context.userId]);
  const payments = await queryRows(context.userId, \`SELECT amount_xof FROM public.invoice_payments WHERE invoice_id = $1\`, [data.invoice_id]);
  const paidTotal = payments.reduce((s, p) => s + Number((p as { amount_xof: number }).amount_xof), 0);
  const inv = await queryOne<{ total_xof: number; status: string }>(context.userId, \`SELECT total_xof, status FROM public.invoices WHERE id = $1\`, [data.invoice_id]);
  if (inv && paidTotal >= inv.total_xof) await queryRows(context.userId, \`UPDATE public.invoices SET paid_xof=$2, status='paid', paid_at=now() WHERE id=$1\`, [data.invoice_id, paidTotal]);
  else await queryRows(context.userId, \`UPDATE public.invoices SET paid_xof=$2 WHERE id=$1\`, [data.invoice_id, paidTotal]);
  return { payment: payRows[0], paid_total: paidTotal };
});

export const listInvoicePayments = createServerFn({ method: "GET" }).middleware([requireAuth]).inputValidator((d: unknown) => z.object({ invoice_id: z.string().uuid() }).parse(d)).handler(async ({ data, context }) => {
  await assertAdmin(context.userId);
  return queryRows(context.userId, \`SELECT * FROM public.invoice_payments WHERE invoice_id = $1 ORDER BY paid_on DESC\`, [data.invoice_id]);
});
`;

fs.writeFileSync("src/lib/admin.functions.ts", out);
console.log("wrote admin.functions.ts", out.length);
