begin;

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'member'))
);

create table if not exists public.academy_settings (
  id boolean primary key default true check (id),
  revision bigint not null default 0 check (revision >= 0),
  manager_photo text not null default '' check (char_length(manager_photo) <= 40000),
  admin_whatsapp text not null default '' check (char_length(admin_whatsapp) <= 25)
);
insert into public.academy_settings (id) values (true) on conflict do nothing;

create table if not exists public.members (
  id bigint primary key check (id between 1 and 9007199254740991),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  phone text not null check (char_length(phone) between 7 and 25),
  photo text not null default '' check (char_length(photo) <= 40000)
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  member_id bigint not null references public.members(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  package_type text not null check (package_type in ('p5','p8','p12','p24','g1','g3','g6','g12','custom')),
  total_price numeric(12,2) not null check (total_price between 0 and 10000000),
  debt_carried numeric(12,2) not null default 0 check (debt_carried between 0 and 10000000),
  paid numeric(12,2) not null default 0 check (paid >= 0),
  total_sessions integer not null check (total_sessions between 1 and 1000),
  remaining_sessions integer not null check (remaining_sessions >= 0),
  is_current boolean not null default true,
  constraint subscription_dates check (end_date - start_date between 1 and 3650),
  constraint subscription_amount check (paid <= total_price + debt_carried),
  constraint subscription_sessions check (remaining_sessions <= total_sessions)
);
create unique index if not exists subscriptions_current_member on public.subscriptions (member_id) where is_current;
create index if not exists subscriptions_member_date on public.subscriptions (member_id, start_date desc);

create table if not exists public.expenses (
  id bigint primary key check (id between 1 and 9007199254740991),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  amount numeric(12,2) not null check (amount between 0.01 and 10000000),
  expense_date date,
  legacy_date text check (char_length(legacy_date) <= 40),
  constraint expense_has_date check (expense_date is not null or nullif(btrim(legacy_date), '') is not null)
);
create index if not exists expenses_month on public.expenses (expense_date);

-- Keep historical receipts if the manager later deletes the member.
create table if not exists public.payments (
  id bigint primary key check (id between 1 and 9007199254740991),
  member_id bigint not null check (member_id between 1 and 9007199254740991),
  amount numeric(12,2) not null check (amount between -20000000 and 20000000),
  paid_on date not null,
  kind text not null check (char_length(btrim(kind)) between 1 and 30)
);
create index if not exists payments_month on public.payments (paid_on);

create table if not exists public.academy_audit (
  id text primary key check (char_length(id) between 1 and 50),
  action text not null check (char_length(btrim(action)) between 1 and 80),
  subject text not null default '' check (char_length(subject) <= 100),
  occurred_at timestamptz not null
);

create table if not exists public.academy_backups (
  id text primary key,
  kind text not null check (kind in ('daily', 'manual', 'before-restore')),
  revision bigint not null,
  created_at timestamptz not null default now(),
  data jsonb not null
);

-- Only editorial content is placed here. No account, contact-list, or financial records.
create table if not exists public.site_content (
  id boolean primary key default true check (id),
  revision bigint not null default 1 check (revision > 0),
  content jsonb not null check (
    jsonb_typeof(content) = 'object'
    and content->>'version' = '1'
    and octet_length(content::text) <= 300000
  ),
  updated_at timestamptz not null default now()
);

create or replace function public.is_academy_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role = 'admin'
  );
$$;
revoke all on function public.is_academy_admin() from public, anon, authenticated;
grant execute on function public.is_academy_admin() to authenticated;

alter table public.user_roles enable row level security;
alter table public.academy_settings enable row level security;
alter table public.members enable row level security;
alter table public.subscriptions enable row level security;
alter table public.expenses enable row level security;
alter table public.payments enable row level security;
alter table public.academy_audit enable row level security;
alter table public.academy_backups enable row level security;
alter table public.site_content enable row level security;

revoke all on public.user_roles, public.academy_settings, public.members, public.subscriptions,
  public.expenses, public.payments, public.academy_audit, public.academy_backups, public.site_content
  from public, anon, authenticated;
grant select, insert, update, delete on public.user_roles, public.academy_settings, public.members,
  public.subscriptions, public.expenses, public.payments, public.academy_audit,
  public.academy_backups, public.site_content to authenticated;
grant select on public.site_content to anon;

do $$
declare name text;
begin
  foreach name in array array['user_roles', 'academy_settings', 'members', 'subscriptions', 'expenses',
    'payments', 'academy_audit', 'academy_backups', 'site_content']
  loop
    execute format('drop policy if exists academy_admin_all on public.%I', name);
    execute format('create policy academy_admin_all on public.%I for all to authenticated using ((select public.is_academy_admin())) with check ((select public.is_academy_admin()))', name);
  end loop;
end;
$$;

drop policy if exists academy_role_self on public.user_roles;
create policy academy_role_self on public.user_roles for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists academy_member_self on public.members;
create policy academy_member_self on public.members for select to authenticated
using (auth_user_id = (select auth.uid()));

drop policy if exists academy_subscriptions_self on public.subscriptions;
create policy academy_subscriptions_self on public.subscriptions for select to authenticated
using (exists (
  select 1 from public.members m
  where m.id = subscriptions.member_id and m.auth_user_id = (select auth.uid())
));

drop policy if exists academy_public_site on public.site_content;
create policy academy_public_site on public.site_content for select to anon, authenticated
using (id = true);

-- Serialize edits made through the RPC and edits made directly by an administrator.
create or replace function public.touch_academy_revision()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  update public.academy_settings set revision = revision + 1 where id = true;
  return null;
end;
$$;
revoke all on function public.touch_academy_revision() from public, anon, authenticated;

do $$
declare name text;
begin
  foreach name in array array['members','subscriptions','expenses','payments','academy_audit']
  loop
    execute format('drop trigger if exists academy_data_revision on public.%I', name);
    execute format('create trigger academy_data_revision after insert or update or delete on public.%I for each statement execute function public.touch_academy_revision()', name);
  end loop;
end;
$$;

create or replace function public.admin_academy_state()
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
begin
  if not public.is_academy_admin() then raise exception 'Admin role required' using errcode = '42501'; end if;
  return (
    select jsonb_build_object('revision', settings.revision, 'state', jsonb_build_object(
      'schemaVersion', 2, 'managerPhoto', settings.manager_photo, 'adminWhatsApp', settings.admin_whatsapp,
      'members', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', m.id, 'name', m.name, 'phone', m.phone, 'photo', m.photo, 'linked', m.auth_user_id is not null,
          'subscriptionId', s.id, 'startDate', to_char(s.start_date, 'YYYY-MM-DD'), 'endDate', to_char(s.end_date, 'YYYY-MM-DD'),
          'validityDays', s.end_date - s.start_date, 'packageType', s.package_type, 'totalPrice', s.total_price,
          'paid', s.paid, 'debtCarried', s.debt_carried, 'totalSessions', s.total_sessions, 'remainingSessions', s.remaining_sessions
        ) order by m.id desc)
        from public.members m join public.subscriptions s on s.member_id = m.id and s.is_current
      ), '[]'::jsonb),
      'expenses', coalesce((
        select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'amount', e.amount,
          'date', coalesce(to_char(e.expense_date, 'YYYY-MM-DD'), e.legacy_date)) order by e.id desc)
        from public.expenses e
      ), '[]'::jsonb),
      'payments', coalesce((
        select jsonb_agg(jsonb_build_object('id', p.id, 'memberId', p.member_id, 'amount', p.amount,
          'date', to_char(p.paid_on, 'YYYY-MM-DD'), 'kind', p.kind) order by p.id)
        from public.payments p
      ), '[]'::jsonb),
      'audit', coalesce((
        select jsonb_agg(jsonb_build_object('id', a.id, 'action', a.action, 'subject', a.subject,
          'at', to_char(a.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by a.occurred_at)
        from public.academy_audit a
      ), '[]'::jsonb)
    )) from public.academy_settings settings where settings.id = true
  );
end;
$$;

create or replace function public.admin_save_academy_backup(p_kind text)
returns void language plpgsql security invoker set search_path = ''
as $$
declare
  snapshot jsonb;
  revision_number bigint;
  backup_id text;
begin
  if not public.is_academy_admin() then raise exception 'Admin role required' using errcode = '42501'; end if;
  if p_kind not in ('daily', 'manual', 'before-restore') or p_kind is null then
    raise exception 'Invalid backup type' using errcode = '22023';
  end if;
  perform 1 from public.academy_settings where id = true for update;
  snapshot := public.admin_academy_state();
  revision_number := (snapshot->>'revision')::bigint;
  backup_id := p_kind || ':' || (now() at time zone 'Africa/Cairo')::date::text
    || case when p_kind = 'before-restore' then ':' || revision_number::text else '' end;
  insert into public.academy_backups (id, kind, revision, data)
  values (backup_id, p_kind, revision_number, snapshot->'state')
  on conflict (id) do update set data = excluded.data, revision = excluded.revision, created_at = now()
  where public.academy_backups.revision < excluded.revision;
  delete from public.academy_backups where created_at < now() - interval '30 days';
end;
$$;

create or replace function public.admin_write_academy_state(p_state jsonb, p_revision bigint, p_restore boolean default false)
returns bigint language plpgsql security invoker set search_path = ''
as $$
declare
  saved_revision bigint;
  item jsonb;
  label_date text;
  parsed_date date;
begin
  if not public.is_academy_admin() then raise exception 'Admin role required' using errcode = '42501'; end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' or p_state->>'schemaVersion' is distinct from '2'
    or octet_length(p_state::text) > 2000000
    or jsonb_typeof(p_state->'members') is distinct from 'array'
    or jsonb_typeof(p_state->'expenses') is distinct from 'array'
    or jsonb_typeof(p_state->'payments') is distinct from 'array'
    or jsonb_typeof(p_state->'audit') is distinct from 'array' then
    raise exception 'Invalid academy data' using errcode = '22023';
  end if;
  if jsonb_array_length(p_state->'members') > 1500
    or jsonb_array_length(p_state->'expenses') > 10000
    or jsonb_array_length(p_state->'payments') > 10000
    or jsonb_array_length(p_state->'audit') > 10000 then
    raise exception 'Too many records' using errcode = '22023';
  end if;
  select revision into saved_revision from public.academy_settings where id = true for update;
  if p_revision is distinct from saved_revision then
    raise exception 'Academy data was updated by another session' using errcode = '40001';
  end if;
  if p_restore then perform public.admin_save_academy_backup('before-restore'); end if;

  -- Withdraw removed records before upserting the remaining ones. Auth links on retained records survive imports.
  delete from public.members existing where not exists (
    select 1 from jsonb_array_elements(p_state->'members') incoming where (incoming->>'id')::bigint = existing.id
  );

  insert into public.members (id, name, phone, photo)
  select (v->>'id')::bigint, v->>'name', v->>'phone', coalesce(v->>'photo','')
  from jsonb_array_elements(p_state->'members') v
  on conflict (id) do update set name = excluded.name, phone = excluded.phone, photo = excluded.photo
  where (members.name, members.phone, members.photo) is distinct from (excluded.name, excluded.phone, excluded.photo);

  if exists (
    select 1 from jsonb_array_elements(p_state->'members') v
    join public.subscriptions s on s.id = nullif(v->>'subscriptionId','')::uuid
    where s.member_id <> (v->>'id')::bigint
  ) then raise exception 'Subscription belongs to another member' using errcode = '22023'; end if;

  update public.subscriptions s set is_current = false
  from jsonb_array_elements(p_state->'members') v
  where s.member_id = (v->>'id')::bigint and s.is_current
    and s.id <> nullif(v->>'subscriptionId','')::uuid;

  insert into public.subscriptions (id, member_id, start_date, end_date, package_type, total_price,
    debt_carried, paid, total_sessions, remaining_sessions, is_current)
  select coalesce(nullif(v->>'subscriptionId', '')::uuid, current_sub.id, gen_random_uuid()),
    (v->>'id')::bigint, (v->>'startDate')::date,
    coalesce(nullif(v->>'endDate', '')::date, (v->>'startDate')::date + coalesce((v->>'validityDays')::integer, 30)),
    v->>'packageType', (v->>'totalPrice')::numeric, (v->>'debtCarried')::numeric, (v->>'paid')::numeric,
    (v->>'totalSessions')::integer, (v->>'remainingSessions')::integer, true
  from jsonb_array_elements(p_state->'members') v
  left join public.subscriptions current_sub on current_sub.member_id = (v->>'id')::bigint and current_sub.is_current
  on conflict (id) do update set start_date = excluded.start_date, end_date = excluded.end_date,
    package_type = excluded.package_type, total_price = excluded.total_price, debt_carried = excluded.debt_carried,
    paid = excluded.paid, total_sessions = excluded.total_sessions, remaining_sessions = excluded.remaining_sessions, is_current = true;

  delete from public.expenses existing where not exists (
    select 1 from jsonb_array_elements(p_state->'expenses') incoming where (incoming->>'id')::bigint = existing.id
  );
  for item in select value from jsonb_array_elements(p_state->'expenses')
  loop
    label_date := item->>'date';
    parsed_date := null;
    if label_date ~ '^\d{4}-\d{2}-\d{2}$' then parsed_date := label_date::date; end if;
    insert into public.expenses (id, title, amount, expense_date, legacy_date)
    values ((item->>'id')::bigint, item->>'title', (item->>'amount')::numeric, parsed_date,
      case when parsed_date is null then label_date end)
    on conflict (id) do update set title = excluded.title, amount = excluded.amount,
      expense_date = excluded.expense_date, legacy_date = excluded.legacy_date;
  end loop;

  delete from public.payments existing where not exists (
    select 1 from jsonb_array_elements(p_state->'payments') incoming where (incoming->>'id')::bigint = existing.id
  );
  insert into public.payments (id, member_id, amount, paid_on, kind)
  select (v->>'id')::bigint, (v->>'memberId')::bigint, (v->>'amount')::numeric, (v->>'date')::date, v->>'kind'
  from jsonb_array_elements(p_state->'payments') v
  on conflict (id) do update set member_id = excluded.member_id, amount = excluded.amount,
    paid_on = excluded.paid_on, kind = excluded.kind;

  insert into public.academy_audit (id, action, subject, occurred_at)
  select v->>'id', v->>'action', coalesce(v->>'subject',''), (v->>'at')::timestamptz
  from jsonb_array_elements(p_state->'audit') v
  on conflict (id) do nothing;

  update public.academy_settings set revision = revision + 1,
    manager_photo = coalesce(p_state->>'managerPhoto',''), admin_whatsapp = coalesce(p_state->>'adminWhatsApp','')
  where id = true returning revision into saved_revision;
  return saved_revision;
end;
$$;

-- Resolve only a verified Auth address, after rechecking the caller's admin role.
create or replace function public.admin_link_academy_member(p_member_id bigint, p_email text)
returns void language plpgsql security definer set search_path = ''
as $$
declare account uuid;
begin
  if not public.is_academy_admin() then raise exception 'Admin role required' using errcode = '42501'; end if;
  perform 1 from public.academy_settings where id = true for update;
  if nullif(btrim(p_email),'') is not null then
    select id into strict account from auth.users
    where lower(email) = lower(btrim(p_email)) and email_confirmed_at is not null;
    insert into public.user_roles (user_id, role) values (account, 'member') on conflict do nothing;
  end if;
  update public.members set auth_user_id = account where id = p_member_id;
  if not found then raise exception 'Member not found' using errcode = 'P0002'; end if;
exception
  when no_data_found then raise exception 'Confirm the subscriber email in Supabase Auth first' using errcode = 'P0002';
  when too_many_rows then raise exception 'More than one Auth account has this address' using errcode = '22023';
end;
$$;

revoke all on function public.admin_academy_state(), public.admin_save_academy_backup(text),
  public.admin_write_academy_state(jsonb,bigint,boolean), public.admin_link_academy_member(bigint,text)
  from public, anon, authenticated;
grant execute on function public.admin_academy_state(), public.admin_save_academy_backup(text),
  public.admin_write_academy_state(jsonb,bigint,boolean), public.admin_link_academy_member(bigint,text)
  to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('academy-media', 'academy-media', true, 3000000, array['image/webp'])
on conflict (id) do nothing;

drop policy if exists academy_public_media_upload on storage.objects;
create policy academy_public_media_upload on storage.objects for insert to authenticated
with check (bucket_id = 'academy-media' and (select public.is_academy_admin()));

drop policy if exists academy_admin_media_select on storage.objects;
create policy academy_admin_media_select on storage.objects for select to authenticated
using (bucket_id = 'academy-media' and (select public.is_academy_admin()));

drop policy if exists academy_admin_media_delete on storage.objects;
create policy academy_admin_media_delete on storage.objects for delete to authenticated
using (bucket_id = 'academy-media' and (select public.is_academy_admin()));

commit;
