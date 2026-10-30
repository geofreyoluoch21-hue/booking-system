-- Run in Supabase SQL Editor (safe to run once on your existing database)
alter table bookings add column if not exists email_sent_at timestamptz;

create or replace function create_booking(p_tier int, p_qty int, p_name text, p_phone text, p_email text, p_code text)
returns text language plpgsql security definer as $$
declare ref text; v_remaining int;
begin
  if p_email is null or position('@' in p_email) < 2 then
    raise exception 'A valid email is required';
  end if;
  perform 1 from ticket_tiers where id = p_tier for update;
  select t.remaining into v_remaining from tier_availability t where t.id = p_tier;
  if v_remaining is null or v_remaining < p_qty then
    raise exception 'Not enough tickets left in this category';
  end if;
  ref := 'BVA-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  insert into bookings (reference, tier_id, quantity, full_name, phone, email, mpesa_code)
  values (ref, p_tier, p_qty, trim(p_name), trim(p_phone), trim(p_email), upper(trim(p_code)));
  return ref;
end $$;
