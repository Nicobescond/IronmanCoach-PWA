-- =====================================================================
-- IronmanCoach PWA : tables Supabase
-- A coller UNE FOIS dans Supabase > SQL Editor > New query > Run.
-- Le script peut etre relance sans risque (idempotent).
--
-- Fonctionnement :
--   PC (IronmanCoach)  --upsert-->  mobile_snapshots   --lecture-->  PWA
--   PC  <--traitement--  mobile_commands  <--insertion--  PWA
-- Chaque athlete ne voit et ne modifie QUE ses propres lignes (RLS).
-- =====================================================================

-- 1) Photo des donnees envoyee par le PC (une ligne par athlete)
create table if not exists public.mobile_snapshots (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  app_version text,
  payload     jsonb not null,
  updated_at  timestamptz not null default now()
);

-- 2) Commandes envoyees par le telephone, executees par le PC
create table if not exists public.mobile_commands (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  command_type text not null check (command_type in (
                 'move_session', 'save_session_feedback', 'save_session_nutrition',
                 'coach_question', 'apply_coach_proposal')),
  payload      jsonb not null default '{}'::jsonb,
  status       text not null default 'pending' check (status in ('pending', 'done', 'error')),
  result       jsonb,
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists mobile_commands_user_status_idx
  on public.mobile_commands (user_id, status, created_at);

-- 3) Securite : RLS active, chacun limite a ses propres lignes
alter table public.mobile_snapshots enable row level security;
alter table public.mobile_commands  enable row level security;

revoke all on public.mobile_snapshots from anon;
revoke all on public.mobile_commands  from anon;
grant select, insert, update on public.mobile_snapshots to authenticated;
grant select, insert, update on public.mobile_commands  to authenticated;

drop policy if exists snapshots_select_own on public.mobile_snapshots;
drop policy if exists snapshots_insert_own on public.mobile_snapshots;
drop policy if exists snapshots_update_own on public.mobile_snapshots;
create policy snapshots_select_own on public.mobile_snapshots
  for select to authenticated using ((select auth.uid()) = user_id);
create policy snapshots_insert_own on public.mobile_snapshots
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy snapshots_update_own on public.mobile_snapshots
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists commands_select_own on public.mobile_commands;
drop policy if exists commands_insert_own on public.mobile_commands;
drop policy if exists commands_update_own on public.mobile_commands;
create policy commands_select_own on public.mobile_commands
  for select to authenticated using ((select auth.uid()) = user_id);
-- Le telephone ne peut creer que des commandes "pending" a son nom
create policy commands_insert_own on public.mobile_commands
  for insert to authenticated
  with check ((select auth.uid()) = user_id and status = 'pending' and result is null);
create policy commands_update_own on public.mobile_commands
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
