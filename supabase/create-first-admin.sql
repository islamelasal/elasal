-- Replace the example address with the confirmed Auth user's exact email.
do $$
declare
  administrator_email text := 'admin@example.com';
  administrator_id uuid;
begin
  if administrator_email = 'admin@example.com' then
    raise exception 'Replace the example email address before running this script.';
  end if;
  select id into strict administrator_id
  from auth.users
  where lower(email) = lower(btrim(administrator_email)) and email_confirmed_at is not null;

  insert into public.user_roles (user_id, role)
  values (administrator_id, 'admin')
  on conflict (user_id) do update set role = 'admin';
exception
  when no_data_found then raise exception 'Create and confirm this email in Authentication > Users first.';
  when too_many_rows then raise exception 'More than one confirmed Auth user matches this email.';
end;
$$;
