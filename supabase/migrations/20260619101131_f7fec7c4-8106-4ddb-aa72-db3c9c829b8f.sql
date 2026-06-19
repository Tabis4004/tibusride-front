DO $$ BEGIN
  CREATE TYPE public.ticket_status AS ENUM ('open','pending','resolved','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.ticket_priority AS ENUM ('low','normal','high','urgent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.ticket_category AS ENUM ('account','payment','ride','driver','passenger','technical','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ride_id UUID REFERENCES public.rides(id) ON DELETE SET NULL,
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 3 AND 200),
  category public.ticket_category NOT NULL DEFAULT 'other',
  priority public.ticket_priority NOT NULL DEFAULT 'normal',
  status public.ticket_status NOT NULL DEFAULT 'open',
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.support_tickets TO authenticated;
GRANT ALL ON public.support_tickets TO service_role;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ticket visible to owner, support, admin"
ON public.support_tickets FOR SELECT TO authenticated
USING (
  auth.uid() = created_by
  OR public.has_role(auth.uid(),'support')
  OR public.has_role(auth.uid(),'admin')
);

CREATE POLICY "Authenticated users open their own tickets"
ON public.support_tickets FOR INSERT TO authenticated
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Support and admin update tickets"
ON public.support_tickets FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(),'support') OR public.has_role(auth.uid(),'admin'))
WITH CHECK (public.has_role(auth.uid(),'support') OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "Owner updates own ticket"
ON public.support_tickets FOR UPDATE TO authenticated
USING (auth.uid() = created_by)
WITH CHECK (auth.uid() = created_by);

CREATE TRIGGER tg_support_tickets_touch
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_ticket_owner_cols()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RETURN NEW; END IF;
  IF public.has_role(uid,'support') OR public.has_role(uid,'admin') THEN RETURN NEW; END IF;
  IF uid = OLD.created_by THEN
    IF NEW.created_by  IS DISTINCT FROM OLD.created_by
       OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
       OR NEW.priority   IS DISTINCT FROM OLD.priority
       OR NEW.category   IS DISTINCT FROM OLD.category
       OR (NEW.status   IS DISTINCT FROM OLD.status AND NEW.status NOT IN ('closed','open'))
    THEN
      RAISE EXCEPTION 'Owners cannot modify these ticket fields';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tg_support_tickets_enforce
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.enforce_ticket_owner_cols();

CREATE INDEX IF NOT EXISTS idx_support_tickets_owner ON public.support_tickets(created_by, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON public.support_tickets(status, last_message_at DESC);

CREATE TABLE IF NOT EXISTS public.ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  is_internal BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.ticket_messages TO authenticated;
GRANT ALL ON public.ticket_messages TO service_role;
ALTER TABLE public.ticket_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read ticket messages"
ON public.ticket_messages FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.support_tickets t
    WHERE t.id = ticket_messages.ticket_id
      AND (
        t.created_by = auth.uid()
        OR public.has_role(auth.uid(),'support')
        OR public.has_role(auth.uid(),'admin')
      )
  )
  AND (
    is_internal = false
    OR public.has_role(auth.uid(),'support')
    OR public.has_role(auth.uid(),'admin')
  )
);

CREATE POLICY "Post ticket messages"
ON public.ticket_messages FOR INSERT TO authenticated
WITH CHECK (
  author_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.support_tickets t
    WHERE t.id = ticket_messages.ticket_id
      AND t.status <> 'closed'
      AND (
        t.created_by = auth.uid()
        OR public.has_role(auth.uid(),'support')
        OR public.has_role(auth.uid(),'admin')
      )
  )
  AND (
    is_internal = false
    OR public.has_role(auth.uid(),'support')
    OR public.has_role(auth.uid(),'admin')
  )
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON public.ticket_messages(ticket_id, created_at);

CREATE OR REPLACE FUNCTION public.bump_ticket_last_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.support_tickets
    SET last_message_at = NEW.created_at,
        updated_at = now(),
        status = CASE
          WHEN status = 'closed' THEN status
          WHEN NEW.author_id = created_by THEN 'open'
          ELSE 'pending'
        END
  WHERE id = NEW.ticket_id;
  RETURN NEW;
END $$;

CREATE TRIGGER tg_ticket_messages_bump
  AFTER INSERT ON public.ticket_messages
  FOR EACH ROW EXECUTE FUNCTION public.bump_ticket_last_message();