-- Run this whole file in Supabase > SQL Editor.

create table ticket_tiers (
  id serial primary key,
  name text not null,
  description text,
  price_kes int not null check (price_kes >= 0),
  capacity int not null check (capacity >= 0),
  sort_order int default 0
);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  reference text unique not null,
  tier_id int not null references ticket_tiers(id),
  quantity int not null check (quantity between 1 and 6),
  full_name text not null,
  phone text not null,
  email text,
  mpesa_code text not null,
  status text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  created_at timestamptz default now()
);
-- one M-Pesa code can only be used once
create unique index bookings_mpesa_code_uq on bookings (upper(mpesa_code));

create table admins (user_id uuid primary key references auth.users(id));

create function is_admin() returns boolean
language sql security definer stable as
$$ select exists (select 1 from admins where user_id = auth.uid()) $$;

-- Public view: tiers with remaining stock (pending + confirmed hold stock)
create view tier_availability as
select t.*, t.capacity - coalesce((
  select sum(quantity) from bookings b
  where b.tier_id = t.id and b.status in ('pending','confirmed')), 0) as remaining
from ticket_tiers t;

-- Create a booking safely (checks stock, returns reference)
create function create_booking(p_tier int, p_qty int, p_name text, p_phone text, p_email text, p_code text)
returns text language plpgsql security definer as $$
declare ref text; v_remaining int;
begin
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

-- Let a buyer look up their booking with reference + phone
create function lookup_booking(p_ref text, p_phone text)
returns table (reference text, full_name text, tier_name text, quantity int, total_kes int, status text)
language sql security definer as $$
  select b.reference, b.full_name, t.name, b.quantity, b.quantity * t.price_kes, b.status
  from bookings b join ticket_tiers t on t.id = b.tier_id
  where b.reference = upper(trim(p_ref)) and b.phone = trim(p_phone)
$$;

alter table ticket_tiers enable row level security;
alter table bookings enable row level security;
alter table admins enable row level security;

create policy "admins manage tiers" on ticket_tiers for all using (is_admin()) with check (is_admin());
create policy "admins read bookings" on bookings for select using (is_admin());
create policy "admins update bookings" on bookings for update using (is_admin());

grant select on tier_availability to anon, authenticated;
grant execute on function create_booking, lookup_booking to anon, authenticated;

-- Sample tiers. EDIT names, prices and capacities to match the official ones.
insert into ticket_tiers (name, description, price_kes, capacity, sort_order) values
 ('Regular', 'General seating', 1000, 5000, 1),
 ('VIP', 'Premium seating', 5000, 800, 2),
 ('VVIP', 'Hospitality area', 15000, 150, 3);

-- After you sign up in Supabase Auth, make yourself admin:
-- insert into admins (user_id) select id from auth.users where email = 'YOUR_EMAIL';
