import { hasRole } from "@/integrations/vercel/auth";
import { queryOne, queryRows, serviceQuery } from "@/integrations/vercel/db";

export async function assertAdmin(userId: string) {
  if (!(await hasRole(userId, "admin"))) throw new Error("Forbidden: admin role required");
}

export async function logAudit(
  actor: { id: string; email: string | null },
  entry: { action: string; target_type?: string; target_id?: string; target_label?: string; details?: unknown },
) {
  await serviceQuery(
    `INSERT INTO public.audit_logs (actor_id, actor_email, action, target_type, target_id, target_label, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      actor.id,
      actor.email,
      entry.action,
      entry.target_type ?? null,
      entry.target_id ?? null,
      entry.target_label ?? null,
      entry.details ? JSON.stringify(entry.details) : null,
    ],
  );
}

export function actorFrom(context: { userId: string; email?: string | null }) {
  return { id: context.userId, email: context.email ?? null };
}

export { queryOne, queryRows, serviceQuery };
export { queryOne as serviceOne } from "@/integrations/vercel/db";
