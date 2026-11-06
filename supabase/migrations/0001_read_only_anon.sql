do $$
declare
  season int;
begin
  foreach season in array array[2022, 2023, 2024, 2025] loop
    execute format('alter table %I enable row level security', 'epa_' || season);
    execute format('drop policy if exists anon_select on %I', 'epa_' || season);
    execute format('create policy anon_select on %I for select to anon using (true)', 'epa_' || season);
  end loop;
end $$;
