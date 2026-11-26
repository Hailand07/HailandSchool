-- Corrections après le contrôle de sécurité du projet Supabase (26/11/2026).

-- Supabase active la sécurité par ligne sur toute nouvelle table. Le registre doit rester
-- lisible par les utilisateurs connectés : apply_operations et pull_changes le lisent avec leurs droits.
alter table public.sync_tables enable row level security;
drop policy if exists sync_tables_select on public.sync_tables;
create policy sync_tables_select on public.sync_tables for select to authenticated using (true);

-- Chemin de recherche figé pour toutes les fonctions.
alter function public.device_prefix(integer) set search_path = public;
alter function public.make_synced(text, text, text[], boolean) set search_path = public;
