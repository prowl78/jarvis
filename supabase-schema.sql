-- Run this in the Supabase SQL editor to create the jarvis-pt tables

create table if not exists workouts (
  id          bigserial primary key,
  date        date not null,
  exercise    text not null,
  sets        integer,
  reps        integer,
  weight_kg   numeric(6,2),
  notes       text,
  created_at  timestamptz default now()
);

create table if not exists sessions (
  id                bigserial primary key,
  date              date not null,
  total_volume_kg   numeric(10,2),
  exercises_logged  integer,
  created_at        timestamptz default now()
);

create table if not exists nutrition_logs (
  id               bigserial primary key,
  date             date not null,
  food_description text not null,
  calories         integer,
  protein_g        numeric(6,1),
  carbs_g          numeric(6,1),
  fat_g            numeric(6,1),
  created_at       timestamptz default now()
);

-- Indexes for date-range queries
create index if not exists workouts_date_idx       on workouts (date);
create index if not exists sessions_date_idx       on sessions (date);
create index if not exists nutrition_logs_date_idx on nutrition_logs (date);
