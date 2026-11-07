create table if not exists refresh_runs (
  id bigint generated always as identity primary key,
  season int not null references seasons (season),
  kind text not null default 'refresh' check (kind in ('refresh', 'refit')),
  matches int not null,
  events int not null,
  finished_at timestamptz not null default now()
);

create index if not exists refresh_runs_season_kind_finished_at on refresh_runs (season, kind, finished_at desc);

alter table refresh_runs enable row level security;
drop policy if exists anon_select on refresh_runs;
create policy anon_select on refresh_runs for select to anon using (true);
revoke all on refresh_runs from anon, authenticated;
grant select on refresh_runs to anon, authenticated;
