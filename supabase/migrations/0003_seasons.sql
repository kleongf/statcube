create table if not exists seasons (
  season int primary key,
  game_name text not null,
  mean double precision not null,
  a double precision not null,
  p double precision not null,
  mean_auto double precision not null,
  a_auto double precision not null,
  p_auto double precision not null,
  params_refit_until date
);

alter table seasons enable row level security;
drop policy if exists anon_select on seasons;
create policy anon_select on seasons for select to anon using (true);
revoke all on seasons from anon, authenticated;
grant select on seasons to anon, authenticated;

insert into seasons (season, game_name, mean, a, p, mean_auto, a_auto, p_auto) values
  (2022, 'POWERPLAY',    60.25 / 2,  5.0015, 0.4623, 19.70 / 2, 5.0384, 0.3443),
  (2023, 'CENTERSTAGE',  72.08 / 2,  3.4415, 0.5729, 21.38 / 2, 4.1423, 0.4741),
  (2024, 'INTO THE DEEP', 86.08 / 2, 3.5888, 0.5686, 13.37 / 2, 2.2793, 0.6143),
  (2025, 'DECODE',      113.30 / 2,  2.1482, 0.6543, 25.33 / 2, 2.4555, 0.5535)
on conflict (season) do nothing;
