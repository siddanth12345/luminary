-- The Luminary: accounts. Run once in the Supabase SQL editor of the project you put in src/net/config.js.
-- Also turn OFF "Confirm email" (Authentication > Providers > Email) because players sign up with just a
-- username and password. Safe to run in the same project as other games: it only adds its own table/function
-- and no trigger on auth.users.

create table if not exists public.luminary_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  email text,
  settings jsonb not null default '{}'::jsonb,   -- saved controls + win/loss record
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists luminary_profiles_username_lower on public.luminary_profiles (lower(username));

grant select, insert, update on public.luminary_profiles to authenticated;
alter table public.luminary_profiles enable row level security;
drop policy if exists "lum own read" on public.luminary_profiles;
drop policy if exists "lum own insert" on public.luminary_profiles;
drop policy if exists "lum own update" on public.luminary_profiles;
create policy "lum own read" on public.luminary_profiles for select to authenticated using (auth.uid() = id);
create policy "lum own insert" on public.luminary_profiles for insert to authenticated with check (auth.uid() = id);
create policy "lum own update" on public.luminary_profiles for update to authenticated using (auth.uid() = id);

create or replace function public.luminary_username_exists(_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.luminary_profiles where lower(username) = lower(_name));
$$;
grant execute on function public.luminary_username_exists(text) to anon, authenticated;
