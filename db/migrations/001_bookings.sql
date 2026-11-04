create table if not exists bookings (
  id bigserial primary key,
  reference text not null unique,
  idempotency_key text not null unique,
  status text not null check (status in ('confirmed','cancelled')),
  job_type text not null,
  urgency text not null check (urgency in ('standard','emergency')),
  engineer_id text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  postcode text not null,
  address_line1 text not null,
  customer_name text not null,
  customer_phone text not null,
  customer_email text,
  problem_description text not null,
  quote jsonb not null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);

create unique index if not exists bookings_engineer_window_confirmed
  on bookings (engineer_id, window_start) where status = 'confirmed';
