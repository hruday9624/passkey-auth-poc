-- Passkey proof of concept (2026-10-31). See ../../../passkey-poc-scope-2026-10-31.md.
--
-- Three tables, every one with row-level security ON, no policies and no direct privileges for anyone.
-- The app reaches them only through the SECURITY DEFINER functions below (search_path = '', explicit grants):
--
--   admins       who may add members and issue links
--   members      who may reach the protected page (admins are members too)
--   setup_links  one-time setup links; only a keyed HMAC of each token is stored, never the token itself
--
-- WRITES THAT AN ADMIN CAUSES are SERVICE ROLE ONLY and take the acting admin's id (p_actor). Each one checks
-- inside the database that p_actor really is in admins. Why not "any admin token may call them": a session
-- token can be read by page script, so a stolen token could otherwise call the function directly and mint a
-- link that signs in as any member. The app's server passes p_actor only after it has verified a PASSKEY session.
--
--   bootstrap_admin     service role; works only while there is no admin (used once, by scripts/bootstrap-admin.mjs)
--   admin_add_member    service role; p_actor must be an admin
--   issue_setup_link    service role; p_actor must be an admin; replaces the member's older unused link
--   consume_setup_link  service role; the member pressed Continue; there is no session yet
--   issue_admin_link    service role; break-glass for a lost admin phone (scripts/admin-link.mjs); admins only
--
-- READS stay on the signed-in user's token and decide from auth.uid(), never from a parameter:
--   is_admin, current_member, list_members (admin only)

create table public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.members (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text not null check (char_length(display_name) between 1 and 80),
  created_by   uuid,  -- no foreign key on purpose: the history survives deleting an admin
  created_at   timestamptz not null default now()
);
create unique index members_email_idx on public.members (lower(email));

create table public.setup_links (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  token_hmac text not null,
  issued_by  uuid,
  issued_at  timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);
create unique index setup_links_hmac_idx on public.setup_links (token_hmac);
create index setup_links_user_idx on public.setup_links (user_id, issued_at desc);

alter table public.admins      enable row level security;
alter table public.members     enable row level security;
alter table public.setup_links enable row level security;
revoke all on public.admins      from anon, authenticated, service_role;
revoke all on public.members     from anon, authenticated, service_role;
revoke all on public.setup_links from anon, authenticated, service_role;

-- Is the signed-in user an admin? Identity comes from the verified token, not from a parameter.
create function public.is_admin()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;

-- The signed-in user's own member row (none if they are not a member).
create function public.current_member()
returns table (display_name text, email text, is_admin boolean)
language sql
security definer
set search_path = ''
stable
as $$
  select m.display_name, m.email, exists (select 1 from public.admins a where a.user_id = m.user_id)
  from public.members m
  where m.user_id = (select auth.uid());
$$;

-- The members page. Admin only; anyone else gets an error, not an empty list.
create function public.list_members()
returns table (
  user_id        uuid,
  email          text,
  display_name   text,
  is_admin       boolean,
  created_at     timestamptz,
  link_state     text,
  link_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not exists (select 1 from public.admins a where a.user_id = (select auth.uid())) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
  select m.user_id, m.email, m.display_name,
         exists (select 1 from public.admins a where a.user_id = m.user_id),
         m.created_at,
         case
           when l.id is null then 'none'
           when l.used_at is not null then 'used'
           when l.expires_at <= now() then 'expired'
           else 'pending'
         end,
         l.expires_at
  from public.members m
  left join lateral (
    select s.id, s.used_at, s.expires_at
    from public.setup_links s
    where s.user_id = m.user_id
    order by s.issued_at desc
    limit 1
  ) l on true
  order by m.created_at;
end;
$$;

-- The very first admin. Works only while no admin exists. SERVICE ROLE ONLY.
create function public.bootstrap_admin(p_user_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  if exists (select 1 from public.admins) then
    raise exception 'an admin already exists' using errcode = '42501';
  end if;
  select u.email into v_email from auth.users u where u.id = p_user_id;
  if v_email is null then
    raise exception 'unknown account';
  end if;
  insert into public.admins (user_id) values (p_user_id);
  insert into public.members (user_id, email, display_name, created_by) values (p_user_id, v_email, p_name, p_user_id);
end;
$$;

-- Put an existing account (made through the auth admin API) on the member list. SERVICE ROLE ONLY.
create function public.admin_add_member(p_actor uuid, p_user_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  if p_actor is null or not exists (select 1 from public.admins a where a.user_id = p_actor) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select u.email into v_email from auth.users u where u.id = p_user_id;
  if v_email is null then
    raise exception 'unknown account';
  end if;
  insert into public.members (user_id, email, display_name, created_by) values (p_user_id, v_email, p_name, p_actor);
end;
$$;

-- Issue a setup link for a member. SERVICE ROLE ONLY; p_actor must be an admin. The target must already be a
-- member, so a link cannot be minted for an arbitrary account. An older unused link for the same member is
-- replaced. Returns when the new one expires.
create function public.issue_setup_link(p_actor uuid, p_user_id uuid, p_hmac text, p_ttl_seconds integer)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires timestamptz;
begin
  if p_actor is null or not exists (select 1 from public.admins a where a.user_id = p_actor) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_hmac is null or length(p_hmac) < 32 then
    raise exception 'bad secret';
  end if;
  if p_ttl_seconds is null or p_ttl_seconds < 60 or p_ttl_seconds > 3600 then
    raise exception 'bad lifetime';
  end if;
  if not exists (select 1 from public.members m where m.user_id = p_user_id) then
    raise exception 'not a member';
  end if;

  delete from public.setup_links where user_id = p_user_id and used_at is null;
  delete from public.setup_links where expires_at < now() - interval '1 day';

  insert into public.setup_links (user_id, token_hmac, issued_by, expires_at)
  values (p_user_id, p_hmac, p_actor, now() + make_interval(secs => p_ttl_seconds))
  returning expires_at into v_expires;
  return v_expires;
end;
$$;

-- Spend a setup link. SERVICE ROLE ONLY (there is no session yet when the member presses Continue).
-- One atomic update: right link, not used, not expired, still a member. Returns the member, or null.
create function public.consume_setup_link(p_hmac text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  update public.setup_links s
     set used_at = now()
   where s.token_hmac = p_hmac
     and s.used_at is null
     and s.expires_at > now()
     and exists (select 1 from public.members m where m.user_id = s.user_id)
  returning s.user_id into v_user;
  return v_user;
end;
$$;

-- Break-glass: a new setup link for an EXISTING admin, issued by whoever holds the secret key (the script).
-- There is no acting admin to name, because the situation is that the admin cannot sign in. SERVICE ROLE ONLY.
create function public.issue_admin_link(p_user_id uuid, p_hmac text, p_ttl_seconds integer)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires timestamptz;
begin
  if not exists (select 1 from public.admins a where a.user_id = p_user_id) then
    raise exception 'not an admin' using errcode = '42501';
  end if;
  if p_hmac is null or length(p_hmac) < 32 then
    raise exception 'bad secret';
  end if;
  if p_ttl_seconds is null or p_ttl_seconds < 60 or p_ttl_seconds > 3600 then
    raise exception 'bad lifetime';
  end if;
  delete from public.setup_links where user_id = p_user_id and used_at is null;
  insert into public.setup_links (user_id, token_hmac, issued_by, expires_at)
  values (p_user_id, p_hmac, p_user_id, now() + make_interval(secs => p_ttl_seconds))
  returning expires_at into v_expires;
  return v_expires;
end;
$$;

revoke all on function public.is_admin()                                       from public, anon, authenticated, service_role;
revoke all on function public.current_member()                                 from public, anon, authenticated, service_role;
revoke all on function public.list_members()                                   from public, anon, authenticated, service_role;
revoke all on function public.bootstrap_admin(uuid, text)                      from public, anon, authenticated, service_role;
revoke all on function public.admin_add_member(uuid, uuid, text)               from public, anon, authenticated, service_role;
revoke all on function public.issue_setup_link(uuid, uuid, text, integer)      from public, anon, authenticated, service_role;
revoke all on function public.consume_setup_link(text)                         from public, anon, authenticated, service_role;
revoke all on function public.issue_admin_link(uuid, text, integer)            from public, anon, authenticated, service_role;

grant execute on function public.is_admin()                                    to authenticated;
grant execute on function public.current_member()                              to authenticated;
grant execute on function public.list_members()                                to authenticated;
grant execute on function public.bootstrap_admin(uuid, text)                   to service_role;
grant execute on function public.admin_add_member(uuid, uuid, text)            to service_role;
grant execute on function public.issue_setup_link(uuid, uuid, text, integer)   to service_role;
grant execute on function public.consume_setup_link(text)                      to service_role;
grant execute on function public.issue_admin_link(uuid, text, integer)         to service_role;
