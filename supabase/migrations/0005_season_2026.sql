create table if not exists epa_2026 (
  team_number integer primary key,
  team_name text,
  epa jsonb,
  auto_epa jsonb,
  teleop_epa jsonb,
  current_epa double precision,
  current_auto_epa double precision,
  current_teleop_epa double precision,
  rank_epa integer,
  rank_auto_epa integer,
  rank_teleop_epa integer
);

alter table epa_2026 enable row level security;
drop policy if exists anon_select on epa_2026;
create policy anon_select on epa_2026 for select to anon using (true);
revoke all on epa_2026 from anon, authenticated;
grant select on epa_2026 to anon, authenticated;

insert into seasons (season, game_name, mean, a, p, mean_auto, a_auto, p_auto, params_refit_until) values
  (2026, 'BIOBUZZ', 23.3716, 0.3549, 1.0704, 6.5280, 2.2855, 0.5558, '2026-12-01')
on conflict (season) do nothing;
