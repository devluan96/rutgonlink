-- Keep redirect analytics to one database round trip while preserving the
-- five-minute duplicate window used by the application.
create or replace function public.record_link_click(
  p_link_id bigint,
  p_ip text,
  p_user_agent text,
  p_referrer text,
  p_country_code text default null,
  p_country_name text default null,
  p_city text default null
)
returns table(counted boolean, deduped boolean)
language plpgsql
as $$
declare
  is_duplicate boolean := false;
begin
  if p_link_id is null then
    raise exception 'link_id is required';
  end if;

  if coalesce(trim(p_ip), '') <> '' and coalesce(trim(p_user_agent), '') <> '' then
    select exists (
      select 1
      from public.clicks
      where link_id = p_link_id
        and ip = trim(p_ip)
        and user_agent = trim(p_user_agent)
        and clicked_at >= now() - interval '5 minutes'
    )
    into is_duplicate;
  end if;

  if is_duplicate then
    return query select false, true;
    return;
  end if;

  update public.links
  set clicks = coalesce(clicks, 0) + 1
  where id = p_link_id;

  insert into public.clicks (
    link_id,
    ip,
    user_agent,
    referrer,
    country_code,
    country_name,
    city
  ) values (
    p_link_id,
    coalesce(trim(p_ip), ''),
    coalesce(trim(p_user_agent), ''),
    coalesce(p_referrer, ''),
    nullif(trim(p_country_code), ''),
    nullif(trim(p_country_name), ''),
    nullif(trim(p_city), '')
  );

  return query select true, false;
end;
$$;
