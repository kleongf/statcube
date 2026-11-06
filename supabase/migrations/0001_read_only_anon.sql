do $$
declare
  season int;
  pol text;
begin
  foreach season in array array[2022, 2023, 2024, 2025] loop
    execute format('alter table %I enable row level security', 'epa_' || season);
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'epa_' || season loop
      execute format('drop policy %I on %I', pol, 'epa_' || season);
    end loop;
    execute format('create policy anon_select on %I for select to anon using (true)', 'epa_' || season);
    execute format('revoke all on %I from anon, authenticated', 'epa_' || season);
    execute format('grant select on %I to anon, authenticated', 'epa_' || season);
  end loop;
end $$;
