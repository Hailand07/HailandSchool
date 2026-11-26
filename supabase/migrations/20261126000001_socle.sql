-- Hailand School — socle du MVP
-- Plan d'attaque, lots 1.2 (schéma), 1.3 (isolation par école), 1.4 (protocole de synchronisation).
--
-- Principes :
--  * toute table synchronisée porte school_id, server_seq, field_clock, created_by,
--    created_at, updated_at, deleted_at (ajoutés par public.make_synced) ;
--  * server_seq vient d'une séquence unique ; les écritures d'une même école sont
--    sérialisées par un verrou consultatif, donc les numéros d'une école sont validés
--    dans l'ordre et le curseur de lecture ne saute jamais une ligne ;
--  * les clients n'écrivent que par apply_operations, qui applique la sécurité par ligne
--    (fonction SECURITY INVOKER) et la liste blanche de colonnes de sync_tables ;
--  * rien ne s'efface : aucune suppression n'est accordée aux clients.

-- ---------------------------------------------------------------------------
-- Séquence et registre de synchronisation
-- ---------------------------------------------------------------------------

-- Sur Supabase, tout nouvel objet du schéma public est ouvert par défaut à anon et authenticated :
-- chaque table, séquence et fonction ci-dessous retire ces droits puis n'accorde que le nécessaire.

create sequence public.sync_seq as bigint;

create table public.sync_tables (
  table_name text primary key,
  mode text not null check (mode in ('lww', 'append_only')),
  -- Colonnes que le client peut écrire. Vide : table en lecture seule pour les clients.
  writable_columns text[] not null default '{}'
);

comment on table public.sync_tables is
  'Tables synchronisées avec les appareils. lww : dernière écriture gagnante champ par champ. append_only : ajout seul, jamais de modification par le client.';

-- ---------------------------------------------------------------------------
-- Organisations, écoles, profils, adhésions, appareils
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  plan text not null default 'essentiel' check (plan in ('essentiel', 'complet')),
  status text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  -- Égal à id : permet de traiter l'école comme toute autre table synchronisée.
  school_id uuid not null,
  organization_id uuid not null references public.organizations (id),
  name text not null check (btrim(name) <> ''),
  school_type text not null default 'generale' check (school_type in ('generale', 'franco_arabe')),
  address text,
  commune text,
  dpe_dce text,
  phone text,
  logo_url text,
  receipt_header text,
  -- Barèmes, formule de moyenne, moyenne de passage (HYP-01 à HYP-05).
  grading_config jsonb not null default '{}'::jsonb,
  -- Compteur interne pour attribuer les préfixes de reçu des appareils.
  next_device_index integer not null default 0,
  constraint schools_school_id_is_id check (school_id = id)
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  phone text not null unique check (phone ~ '^\+[0-9]{8,15}$'),
  full_name text not null check (btrim(full_name) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Identité d''un utilisateur. Le code à 4 chiffres reste sur l''appareil et n''est jamais envoyé au serveur (HYP-11).';

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id),
  user_id uuid not null references public.profiles (id),
  role text not null check (role in (
    'fondateur', 'direction', 'comptable', 'secretariat', 'enseignant', 'surveillant', 'parent', 'eleve'
  )),
  status text not null default 'active' check (status in ('active', 'revoked')),
  -- Copie du profil pour l'annuaire de l'école sur les appareils.
  full_name text not null,
  phone text not null,
  unique (school_id, user_id, role)
);

create table public.devices (
  id uuid primary key,
  school_id uuid not null references public.schools (id),
  user_id uuid not null references public.profiles (id),
  label text not null default '',
  receipt_prefix text not null,
  last_sync_at timestamptz,
  revoked_at timestamptz,
  unique (school_id, receipt_prefix)
);

-- ---------------------------------------------------------------------------
-- Journal d'audit et journal des opérations
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id bigint generated always as identity primary key,
  school_id uuid not null,
  user_id uuid,
  device_id uuid,
  action text not null,
  table_name text not null,
  row_id uuid not null,
  before jsonb,
  after jsonb,
  happened_at timestamptz not null default now()
);

create index audit_log_school_idx on public.audit_log (school_id, happened_at desc);

create table public.sync_operations (
  op_id uuid primary key,
  school_id uuid not null references public.schools (id),
  device_id uuid not null references public.devices (id),
  user_id uuid not null,
  table_name text not null,
  row_id uuid,
  kind text not null,
  payload jsonb not null,
  client_time timestamptz,
  received_at timestamptz not null default now(),
  status text not null check (status in ('applied', 'rejected')),
  error text
);

create index sync_operations_device_idx on public.sync_operations (device_id, received_at desc);

-- ---------------------------------------------------------------------------
-- Fonctions d'appartenance et de rôle (lot 1.3)
-- ---------------------------------------------------------------------------

create function public.is_member(p_school uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.school_id = p_school and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

create function public.has_role(p_school uuid, p_roles text[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.school_id = p_school and m.user_id = auth.uid() and m.status = 'active'
      and m.role = any (p_roles)
  );
$$;

-- ---------------------------------------------------------------------------
-- Déclencheurs des tables synchronisées
-- ---------------------------------------------------------------------------

create function public.sync_touch()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Sérialise les écritures d'une école : les server_seq d'une école sont validés dans l'ordre.
  perform pg_advisory_xact_lock(hashtextextended(new.school_id::text, 42));
  new.server_seq := nextval('public.sync_seq');
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.created_by := coalesce(new.created_by, auth.uid());
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

create function public.audit_row()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.audit_log (school_id, user_id, device_id, action, table_name, row_id, before, after)
  values (
    new.school_id,
    auth.uid(),
    nullif(current_setting('app.device_id', true), '')::uuid,
    lower(tg_op),
    tg_table_name,
    new.id,
    case when tg_op = 'UPDATE' then to_jsonb(old) end,
    to_jsonb(new)
  );
  return null;
end;
$$;

-- Ajoute les colonnes de synchronisation, les déclencheurs, l'entrée du registre
-- et les droits d'écriture par colonne. À appeler pour chaque table synchronisée.
create function public.make_synced(
  p_table text,
  p_mode text,
  p_writable text[],
  p_audit boolean default true
)
returns void
language plpgsql
as $$
declare
  v_col text;
begin
  execute format($f$
    alter table public.%1$I
      add column if not exists server_seq bigint not null default 0,
      add column if not exists field_clock jsonb not null default '{}'::jsonb,
      add column if not exists created_by uuid,
      add column if not exists created_at timestamptz not null default now(),
      add column if not exists updated_at timestamptz not null default now(),
      add column if not exists deleted_at timestamptz
  $f$, p_table);

  execute format('create index if not exists %I on public.%I (school_id, server_seq)',
    p_table || '_sync_idx', p_table);

  execute format('drop trigger if exists sync_touch on public.%I', p_table);
  execute format(
    'create trigger sync_touch before insert or update on public.%I for each row execute function public.sync_touch()',
    p_table);

  execute format('drop trigger if exists audit_row on public.%I', p_table);
  if p_audit then
    execute format(
      'create trigger audit_row after insert or update on public.%I for each row execute function public.audit_row()',
      p_table);
  end if;

  execute format('alter table public.%I enable row level security', p_table);

  insert into public.sync_tables (table_name, mode, writable_columns)
  values (p_table, p_mode, coalesce(p_writable, '{}'))
  on conflict (table_name) do update
    set mode = excluded.mode, writable_columns = excluded.writable_columns;

  -- Droits par colonne : un client ne peut jamais écrire server_seq, created_by, etc.
  execute format('revoke all on public.%I from anon, authenticated', p_table);
  execute format('grant select on public.%I to authenticated', p_table);
  if cardinality(coalesce(p_writable, '{}')) > 0 then
    select string_agg(format('%I', c), ', ') into v_col from unnest(p_writable) c;
    execute format('grant insert (id, school_id, field_clock, %s) on public.%I to authenticated', v_col, p_table);
    if p_mode = 'lww' then
      execute format('grant update (field_clock, %s) on public.%I to authenticated', v_col, p_table);
    end if;
  end if;
end;
$$;

revoke all on function public.make_synced(text, text, text[], boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Déclaration des tables du socle
-- ---------------------------------------------------------------------------

select public.make_synced('schools', 'lww',
  array['name', 'school_type', 'address', 'commune', 'dpe_dce', 'phone', 'logo_url', 'receipt_header', 'grading_config']);
select public.make_synced('memberships', 'lww', '{}');
select public.make_synced('devices', 'lww', '{}', false);

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.audit_log enable row level security;
alter table public.sync_operations enable row level security;

revoke all on public.organizations, public.profiles, public.audit_log, public.sync_operations, public.sync_tables
  from anon, authenticated;
grant select on public.organizations, public.profiles, public.audit_log, public.sync_tables to authenticated;
grant select, insert on public.sync_operations to authenticated;
revoke all on sequence public.sync_seq, public.audit_log_id_seq from anon, authenticated;
grant usage on sequence public.sync_seq to authenticated;

-- ---------------------------------------------------------------------------
-- Politiques de sécurité par ligne (lot 1.3)
-- ---------------------------------------------------------------------------

create policy organizations_select on public.organizations for select to authenticated
  using (exists (select 1 from public.schools s where s.organization_id = organizations.id and public.is_member(s.id)));

create policy schools_select on public.schools for select to authenticated
  using (public.is_member(id));
create policy schools_update on public.schools for update to authenticated
  using (public.has_role(id, array['fondateur', 'direction']))
  with check (public.has_role(id, array['fondateur', 'direction']));

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid());

create policy memberships_select on public.memberships for select to authenticated
  using (public.is_member(school_id));

create policy devices_select on public.devices for select to authenticated
  using (public.is_member(school_id));

create policy audit_log_select on public.audit_log for select to authenticated
  using (public.has_role(school_id, array['fondateur']));

create policy sync_operations_select on public.sync_operations for select to authenticated
  using (user_id = auth.uid() or public.has_role(school_id, array['fondateur']));
create policy sync_operations_insert on public.sync_operations for insert to authenticated
  with check (user_id = auth.uid() and public.is_member(school_id));

-- ---------------------------------------------------------------------------
-- Appareils et préfixes de reçu (lot 1.4)
-- ---------------------------------------------------------------------------

-- 0 → A, 25 → Z, 26 → AA, 27 → AB…
create function public.device_prefix(p_index integer)
returns text
language plpgsql immutable
as $$
declare
  v_s text := '';
  v_k integer := p_index + 1;
begin
  while v_k > 0 loop
    v_s := chr(65 + (v_k - 1) % 26) || v_s;
    v_k := (v_k - 1) / 26;
  end loop;
  return v_s;
end;
$$;

create function public.register_device(p_school uuid, p_device_id uuid, p_label text default '')
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_device public.devices;
  v_index integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_member(p_school) then
    raise exception 'not_member' using errcode = '42501';
  end if;

  select * into v_device from public.devices where id = p_device_id;
  if found then
    if v_device.user_id <> auth.uid() or v_device.school_id <> p_school then
      raise exception 'device_conflict' using errcode = '42501';
    end if;
    if v_device.revoked_at is not null then
      raise exception 'device_revoked' using errcode = '42501';
    end if;
    return to_jsonb(v_device);
  end if;

  update public.schools set next_device_index = next_device_index + 1
  where id = p_school
  returning next_device_index - 1 into v_index;

  insert into public.devices (id, school_id, user_id, label, receipt_prefix)
  values (p_device_id, p_school, auth.uid(), coalesce(p_label, ''), public.device_prefix(v_index))
  returning * into v_device;

  return to_jsonb(v_device);
end;
$$;

create function public.revoke_device(p_device_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_school uuid;
begin
  select school_id into v_school from public.devices where id = p_device_id;
  if v_school is null or not public.has_role(v_school, array['fondateur']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.devices set revoked_at = now() where id = p_device_id and revoked_at is null;
end;
$$;

create function public._touch_device(p_device_id uuid)
returns void
language sql security definer set search_path = public
as $$
  update public.devices set last_sync_at = now() where id = p_device_id and user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Application des opérations (lot 1.4)
-- ---------------------------------------------------------------------------

-- Ligne courante telle que l'appelant a le droit de la voir, ou null.
create function public._sync_row(p_table text, p_id uuid)
returns jsonb
language plpgsql stable security invoker set search_path = public
as $$
declare
  v_row jsonb;
begin
  if p_id is null or not exists (select 1 from public.sync_tables where table_name = p_table) then
    return null;
  end if;
  execute format('select to_jsonb(t) from public.%I t where id = $1', p_table) into v_row using p_id;
  return v_row;
end;
$$;

create function public._apply_one(p_device public.devices, p_op jsonb)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_op_id uuid := (p_op ->> 'op_id')::uuid;
  v_table text := p_op ->> 'table';
  v_kind text := p_op ->> 'kind';
  v_fields jsonb := coalesce(p_op -> 'fields', '{}'::jsonb);
  v_row_id uuid;
  v_time timestamptz;
  v_reg public.sync_tables;
  v_bad text;
  v_cols text;
  v_rcols text;
  v_found boolean;
  v_clock jsonb;
  v_win text[];
  v_set text;
begin
  begin
    v_row_id := (p_op ->> 'row_id')::uuid;
    -- Une horloge de téléphone très en avance ne doit pas gagner pour toujours.
    v_time := least(coalesce((p_op ->> 'client_time')::timestamptz, now()), now() + interval '5 minutes');

    select * into v_reg from public.sync_tables where table_name = v_table;
    if not found or cardinality(v_reg.writable_columns) = 0 then
      raise exception 'table_not_writable: %', coalesce(v_table, '?');
    end if;
    if v_row_id is null then
      raise exception 'row_id_missing';
    end if;
    if jsonb_typeof(v_fields) <> 'object' or v_fields = '{}'::jsonb then
      raise exception 'fields_missing';
    end if;

    select string_agg(k, ', ') into v_bad
    from jsonb_object_keys(v_fields) k
    where k <> all (v_reg.writable_columns);
    if v_bad is not null then
      raise exception 'column_not_writable: %', v_bad;
    end if;

    if v_reg.mode = 'append_only' then
      if v_kind <> 'insert' then
        raise exception 'append_only: %', v_table;
      end if;
      execute format('select true from public.%I where id = $1', v_table) into v_found using v_row_id;
      if v_found then
        raise exception 'already_exists';
      end if;
      select string_agg(format('%I', k), ', '), string_agg(format('r.%I', k), ', ')
        into v_cols, v_rcols
      from jsonb_object_keys(v_fields) k;
      execute format(
        'insert into public.%1$I (id, school_id, %2$s) select $1, $2, %3$s from jsonb_populate_record(null::public.%1$I, $3) r',
        v_table, v_cols, v_rcols)
      using v_row_id, p_device.school_id, v_fields;
    else
      if v_kind <> 'upsert' then
        raise exception 'kind_must_be_upsert: %', v_table;
      end if;
      execute format('select true, field_clock from public.%I where id = $1 for update', v_table)
        into v_found, v_clock using v_row_id;

      if v_found is null then
        select string_agg(format('%I', k), ', '), string_agg(format('r.%I', k), ', ')
          into v_cols, v_rcols
        from jsonb_object_keys(v_fields) k;
        execute format(
          'insert into public.%1$I (id, school_id, field_clock, %2$s) select $1, $2, $4, %3$s from jsonb_populate_record(null::public.%1$I, $3) r',
          v_table, v_cols, v_rcols)
        using v_row_id, p_device.school_id, v_fields,
          (select jsonb_object_agg(k, v_time) from jsonb_object_keys(v_fields) k);
      else
        -- Dernière écriture gagnante, champ par champ.
        select array_agg(k) into v_win
        from jsonb_object_keys(v_fields) k
        where v_clock ->> k is null or (v_clock ->> k)::timestamptz <= v_time;

        if v_win is not null then
          select string_agg(format('%1$I = r.%1$I', k), ', ') into v_set from unnest(v_win) k;
          execute format(
            'update public.%1$I as t set %2$s, field_clock = t.field_clock || $3 from jsonb_populate_record(null::public.%1$I, $2) r where t.id = $1',
            v_table, v_set)
          using v_row_id, v_fields,
            (select jsonb_object_agg(k, v_time) from unnest(v_win) k);
        end if;
      end if;
    end if;

    return jsonb_build_object('op_id', v_op_id, 'status', 'applied', 'row', public._sync_row(v_table, v_row_id));
  exception when others then
    return jsonb_build_object(
      'op_id', v_op_id, 'status', 'rejected', 'error', sqlerrm,
      'row', public._sync_row(v_table, v_row_id));
  end;
end;
$$;

create function public.apply_operations(p_device_id uuid, p_ops jsonb)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_device public.devices;
  v_op jsonb;
  v_op_id uuid;
  v_prev public.sync_operations;
  v_res jsonb;
  v_results jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into v_device from public.devices where id = p_device_id and user_id = v_uid;
  if not found then
    raise exception 'device_unknown' using errcode = '42501';
  end if;
  if v_device.revoked_at is not null then
    raise exception 'device_revoked' using errcode = '42501';
  end if;
  if not public.is_member(v_device.school_id) then
    raise exception 'membership_revoked' using errcode = '42501';
  end if;
  if jsonb_typeof(p_ops) <> 'array' then
    raise exception 'ops_must_be_array';
  end if;

  perform set_config('app.device_id', p_device_id::text, true);

  for v_op in select value from jsonb_array_elements(p_ops) loop
    if coalesce(v_op ->> 'op_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'op_id', v_op ->> 'op_id', 'status', 'rejected', 'error', 'invalid_op_id', 'row', null));
      continue;
    end if;
    v_op_id := (v_op ->> 'op_id')::uuid;

    select * into v_prev from public.sync_operations where op_id = v_op_id;
    if found then
      -- Opération déjà reçue (renvoi après coupure) : aucun effet en double.
      v_res := jsonb_build_object('op_id', v_op_id, 'status', 'duplicate', 'error', v_prev.error,
        'row', public._sync_row(v_prev.table_name, v_prev.row_id));
    else
      v_res := public._apply_one(v_device, v_op);
      insert into public.sync_operations
        (op_id, school_id, device_id, user_id, table_name, row_id, kind, payload, client_time, status, error)
      values (
        v_op_id, v_device.school_id, p_device_id, v_uid,
        coalesce(v_op ->> 'table', ''),
        case when (v_op ->> 'row_id') ~* '^[0-9a-f-]{36}$' then (v_op ->> 'row_id')::uuid end,
        coalesce(v_op ->> 'kind', ''),
        v_op,
        case when v_res ->> 'status' = 'applied' then
          least(coalesce((v_op ->> 'client_time')::timestamptz, now()), now() + interval '5 minutes') end,
        v_res ->> 'status',
        v_res ->> 'error');
    end if;
    v_results := v_results || jsonb_build_array(v_res);
  end loop;

  perform public._touch_device(p_device_id);
  return jsonb_build_object('results', v_results, 'server_time', now());
end;
$$;

-- ---------------------------------------------------------------------------
-- Lecture des changements (lot 1.4)
-- ---------------------------------------------------------------------------

create function public.pull_changes(p_school uuid, p_cursor bigint default 0, p_limit integer default 500)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_union text;
  v_changes jsonb;
  v_max bigint;
  v_count integer;
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 2000));
begin
  if not public.is_member(p_school) then
    raise exception 'not_member' using errcode = '42501';
  end if;

  -- Attend la fin des écritures en cours de cette école : aucune ligne ne peut
  -- apparaître plus tard avec un numéro inférieur au curseur renvoyé.
  perform pg_advisory_xact_lock_shared(hashtextextended(p_school::text, 42));

  select string_agg(format(
    'select %L as tbl, x.server_seq, to_jsonb(x) as row from public.%I x where x.school_id = $1 and x.server_seq > $2',
    table_name, table_name), ' union all ')
  into v_union
  from public.sync_tables;

  execute format(
    'select coalesce(jsonb_agg(jsonb_build_object(''table'', tbl, ''row'', row) order by server_seq), ''[]''::jsonb),
            max(server_seq), count(*)
       from (select * from (%s) u order by server_seq limit $3) s',
    v_union)
  into v_changes, v_max, v_count
  using p_school, coalesce(p_cursor, 0), v_limit;

  return jsonb_build_object(
    'changes', v_changes,
    'cursor', coalesce(v_max, p_cursor, 0),
    'has_more', v_count = v_limit,
    'server_time', now());
end;
$$;

-- ---------------------------------------------------------------------------
-- Fonctions d'administration, réservées au rôle de service (lot 1.8)
-- ---------------------------------------------------------------------------

create function public.admin_upsert_profile(p_user_id uuid, p_full_name text, p_phone text)
returns void
language sql security definer set search_path = public
as $$
  insert into public.profiles (id, phone, full_name) values (p_user_id, p_phone, p_full_name)
  on conflict (id) do update set full_name = excluded.full_name, phone = excluded.phone, updated_at = now();
$$;

create function public.admin_add_member(
  p_school uuid, p_user_id uuid, p_full_name text, p_phone text, p_role text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.admin_upsert_profile(p_user_id, p_full_name, p_phone);
  insert into public.memberships (school_id, user_id, role, full_name, phone)
  values (p_school, p_user_id, p_role, p_full_name, p_phone)
  on conflict (school_id, user_id, role) do update
    set status = 'active', full_name = excluded.full_name, phone = excluded.phone
  returning id into v_id;
  return v_id;
end;
$$;

create function public.admin_create_school(
  p_organization_name text, p_school_name text,
  p_founder_id uuid, p_founder_name text, p_founder_phone text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid;
  v_school uuid := gen_random_uuid();
begin
  insert into public.organizations (name) values (p_organization_name) returning id into v_org;
  insert into public.schools (id, school_id, organization_id, name) values (v_school, v_school, v_org, p_school_name);
  perform public.admin_add_member(v_school, p_founder_id, p_founder_name, p_founder_phone, 'fondateur');
  return v_school;
end;
$$;

create function public.admin_set_membership_status(p_membership uuid, p_status text)
returns void
language sql security definer set search_path = public
as $$
  update public.memberships set status = p_status where id = p_membership;
$$;

-- ---------------------------------------------------------------------------
-- Droits d'exécution
-- ---------------------------------------------------------------------------

revoke all on function
  public.is_member(uuid), public.has_role(uuid, text[]), public.device_prefix(integer),
  public.register_device(uuid, uuid, text), public.revoke_device(uuid), public._touch_device(uuid),
  public._sync_row(text, uuid), public._apply_one(public.devices, jsonb),
  public.apply_operations(uuid, jsonb), public.pull_changes(uuid, bigint, integer),
  public.admin_upsert_profile(uuid, text, text), public.admin_add_member(uuid, uuid, text, text, text),
  public.admin_create_school(text, text, uuid, text, text), public.admin_set_membership_status(uuid, text),
  public.sync_touch(), public.audit_row()
from public, anon, authenticated;

grant execute on function
  public.is_member(uuid), public.has_role(uuid, text[]), public.device_prefix(integer),
  public.register_device(uuid, uuid, text), public.revoke_device(uuid), public._touch_device(uuid),
  public._sync_row(text, uuid), public._apply_one(public.devices, jsonb),
  public.apply_operations(uuid, jsonb), public.pull_changes(uuid, bigint, integer)
to authenticated;

grant execute on function
  public.admin_upsert_profile(uuid, text, text), public.admin_add_member(uuid, uuid, text, text, text),
  public.admin_create_school(text, text, uuid, text, text), public.admin_set_membership_status(uuid, text)
to service_role;
