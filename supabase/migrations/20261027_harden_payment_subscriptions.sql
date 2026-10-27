-- Make manual payment review atomic and attach a real monthly entitlement.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS plan_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ;

ALTER TABLE public.payment_requests
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'VND',
  ADD COLUMN IF NOT EXISTS period_months INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.payment_requests ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.payment_requests
  DROP CONSTRAINT IF EXISTS payment_requests_user_id_fkey;
ALTER TABLE public.payment_requests
  ADD CONSTRAINT payment_requests_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_requests_amount_positive'
  ) THEN
    ALTER TABLE public.payment_requests
      ADD CONSTRAINT payment_requests_amount_positive CHECK (amount > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_requests_status_valid'
  ) THEN
    ALTER TABLE public.payment_requests
      ADD CONSTRAINT payment_requests_status_valid
      CHECK (status IN ('awaiting_payment', 'submitted', 'approved', 'rejected'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_requests_plan_valid'
  ) THEN
    ALTER TABLE public.payment_requests
      ADD CONSTRAINT payment_requests_plan_valid CHECK (plan IN ('pro', 'business'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_requests_currency_valid'
  ) THEN
    ALTER TABLE public.payment_requests
      ADD CONSTRAINT payment_requests_currency_valid CHECK (currency = 'VND');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_requests_period_valid'
  ) THEN
    ALTER TABLE public.payment_requests
      ADD CONSTRAINT payment_requests_period_valid CHECK (period_months BETWEEN 1 AND 12);
  END IF;
END $$;

WITH ranked_active AS (
  SELECT id,
         row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS row_rank
  FROM public.payment_requests
  WHERE user_id IS NOT NULL
    AND status IN ('awaiting_payment', 'submitted')
)
UPDATE public.payment_requests AS request
SET status = 'rejected',
    reviewed_at = COALESCE(request.reviewed_at, now()),
    admin_note = COALESCE(request.admin_note, 'Tự động đóng yêu cầu trùng khi nâng cấp schema')
FROM ranked_active
WHERE request.id = ranked_active.id
  AND ranked_active.row_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_requests_one_active_per_user
  ON public.payment_requests(user_id)
  WHERE status IN ('awaiting_payment', 'submitted');

CREATE TABLE IF NOT EXISTS public.payment_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  payment_request_id BIGINT REFERENCES public.payment_requests(id) ON DELETE SET NULL,
  user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  actor_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('approved', 'rejected')),
  previous_status TEXT NOT NULL,
  next_status TEXT NOT NULL,
  previous_plan TEXT,
  next_plan TEXT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'VND' CHECK (currency = 'VND'),
  reference_code TEXT NOT NULL,
  admin_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_audit_logs_request_id
  ON public.payment_audit_logs(payment_request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_audit_logs_actor_id
  ON public.payment_audit_logs(actor_user_id, created_at DESC);

ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_audit_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payment_requests FROM anon, authenticated;
REVOKE ALL ON TABLE public.payment_audit_logs FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.review_payment_request(
  p_request_id BIGINT,
  p_admin_user_id BIGINT,
  p_action TEXT,
  p_admin_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_request public.payment_requests%ROWTYPE;
  v_user public.users%ROWTYPE;
  v_action TEXT := lower(trim(COALESCE(p_action, '')));
  v_previous_plan TEXT;
  v_next_expiry TIMESTAMPTZ;
  v_period_months INTEGER;
BEGIN
  IF v_action NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'PAYMENT_ACTION_INVALID';
  END IF;

  SELECT * INTO v_request
  FROM public.payment_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_REQUEST_NOT_FOUND';
  END IF;
  IF v_request.status <> 'submitted' THEN
    RAISE EXCEPTION 'PAYMENT_REQUEST_ALREADY_REVIEWED';
  END IF;
  IF v_request.user_id IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_USER_NOT_FOUND';
  END IF;

  SELECT * INTO v_user
  FROM public.users
  WHERE id = v_request.user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_USER_NOT_FOUND';
  END IF;

  v_previous_plan := COALESCE(v_user.plan, 'free');
  v_period_months := GREATEST(COALESCE(v_request.period_months, 1), 1);

  IF v_action = 'approved' THEN
    IF v_previous_plan = 'admin'
       OR (v_previous_plan = 'business' AND v_request.plan = 'pro') THEN
      RAISE EXCEPTION 'PAYMENT_PLAN_DOWNGRADE_NOT_ALLOWED';
    END IF;

    IF v_previous_plan = v_request.plan
       AND v_user.plan_expires_at IS NOT NULL
       AND v_user.plan_expires_at > now() THEN
      v_next_expiry := v_user.plan_expires_at + make_interval(months => v_period_months);
    ELSE
      v_next_expiry := now() + make_interval(months => v_period_months);
    END IF;

    UPDATE public.users
    SET plan = v_request.plan,
        plan_started_at = CASE
          WHEN v_previous_plan = v_request.plan AND plan_started_at IS NOT NULL
            THEN plan_started_at
          ELSE now()
        END,
        plan_expires_at = v_next_expiry
    WHERE id = v_request.user_id;
  END IF;

  UPDATE public.payment_requests
  SET status = v_action,
      admin_note = NULLIF(trim(COALESCE(p_admin_note, '')), ''),
      reviewed_by = p_admin_user_id,
      reviewed_at = now()
  WHERE id = v_request.id
    AND status = 'submitted'
  RETURNING * INTO v_request;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_REQUEST_ALREADY_REVIEWED';
  END IF;

  INSERT INTO public.payment_audit_logs (
    payment_request_id, user_id, actor_user_id, action,
    previous_status, next_status, previous_plan, next_plan,
    amount, currency, reference_code, admin_note
  ) VALUES (
    v_request.id, v_request.user_id, p_admin_user_id, v_action,
    'submitted', v_action, v_previous_plan,
    CASE WHEN v_action = 'approved' THEN v_request.plan ELSE v_previous_plan END,
    v_request.amount, v_request.currency, v_request.reference_code, v_request.admin_note
  );

  RETURN to_jsonb(v_request) || jsonb_build_object(
    'user_previous_plan', v_previous_plan,
    'user_plan', CASE WHEN v_action = 'approved' THEN v_request.plan ELSE v_previous_plan END,
    'user_plan_expires_at', v_next_expiry
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.review_payment_request(BIGINT, BIGINT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_payment_request(BIGINT, BIGINT, TEXT, TEXT)
  TO service_role;
