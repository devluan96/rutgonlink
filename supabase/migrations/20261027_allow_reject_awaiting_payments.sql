-- Let admins close abandoned payment requests before the user submits proof.

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
  v_previous_status TEXT;
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
  IF v_action = 'approved' AND v_request.status <> 'submitted' THEN
    RAISE EXCEPTION 'PAYMENT_REQUEST_ALREADY_REVIEWED';
  END IF;
  IF v_action = 'rejected'
     AND v_request.status NOT IN ('awaiting_payment', 'submitted') THEN
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

  v_previous_status := v_request.status;
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
    AND status = v_previous_status
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
    v_previous_status, v_action, v_previous_plan,
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
