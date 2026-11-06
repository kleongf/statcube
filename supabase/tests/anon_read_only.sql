\set ON_ERROR_STOP on

begin;

do $$
declare
  t text;
  policies text[];
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'epa\_%' loop
    if not (select relrowsecurity from pg_class where oid = format('public.%I', t)::regclass) then
      raise exception '%: row level security is off', t;
    end if;
    select array_agg(policyname order by policyname) into policies from pg_policies where schemaname = 'public' and tablename = t;
    if policies is distinct from array['anon_select']::text[] then
      raise exception '%: policies are %, expected only anon_select', t, policies;
    end if;
    execute format('insert into %I (team_number, team_name) values (99999, %L)', t, 'seed');
  end loop;
end $$;

do $$
declare
  r text;
  t text;
  n bigint;
begin
  foreach r in array array['anon', 'authenticated'] loop
    execute format('set local role %I', r);
    for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'epa\_%' loop
      if r = 'anon' then
        execute format('select count(*) from %I where team_number = 99999', t) into n;
        if n <> 1 then
          raise exception '%: anon select saw % rows of the seeded row, expected 1', t, n;
        end if;
      end if;

      begin
        execute format('insert into %I (team_number, team_name) values (99998, %L)', t, r);
        raise exception '%: % insert succeeded', t, r;
      exception when insufficient_privilege then
        null;
      end;

      n := 0;
      begin
        execute format('update %I set team_name = %L where team_number = 99999', t, 'hacked');
        get diagnostics n = row_count;
      exception when insufficient_privilege then
        null;
      end;
      if n <> 0 then
        raise exception '%: % update changed % rows', t, r, n;
      end if;

      n := 0;
      begin
        execute format('delete from %I where team_number = 99999', t);
        get diagnostics n = row_count;
      exception when insufficient_privilege then
        null;
      end;
      if n <> 0 then
        raise exception '%: % delete removed % rows', t, r, n;
      end if;

      begin
        execute format('truncate %I', t);
        raise exception '%: % truncate succeeded', t, r;
      exception when insufficient_privilege then
        null;
      end;
    end loop;
    reset role;
  end loop;
end $$;

rollback;

select 'anon_read_only: ok' as result;
