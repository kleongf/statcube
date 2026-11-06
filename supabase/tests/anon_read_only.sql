\set ON_ERROR_STOP on

begin;

do $$
declare
  t text;
begin
  foreach t in array array['epa_2022', 'epa_2023', 'epa_2024', 'epa_2025', 'epa_2026'] loop
    execute format('insert into %I (team_number, team_name) values (99999, %L)', t, 'seed');
  end loop;
end $$;

set local role anon;

do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array['epa_2022', 'epa_2023', 'epa_2024', 'epa_2025', 'epa_2026'] loop
    execute format('select count(*) from %I where team_number = 99999', t) into n;
    if n <> 1 then
      raise exception '%: anon select saw % rows of the seeded row, expected 1', t, n;
    end if;

    begin
      execute format('insert into %I (team_number, team_name) values (99998, %L)', t, 'anon');
      raise exception '%: anon insert succeeded', t;
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
      raise exception '%: anon update changed % rows', t, n;
    end if;

    n := 0;
    begin
      execute format('delete from %I where team_number = 99999', t);
      get diagnostics n = row_count;
    exception when insufficient_privilege then
      null;
    end;
    if n <> 0 then
      raise exception '%: anon delete removed % rows', t, n;
    end if;
  end loop;
end $$;

rollback;

select 'anon_read_only: ok' as result;
