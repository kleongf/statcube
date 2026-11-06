create table if not exists epa_2022 (
  team_number integer primary key,
  team_name text,
  epa jsonb,
  auto_epa jsonb,
  teleop_epa jsonb,
  current_epa double precision,
  current_auto_epa double precision,
  current_teleop_epa double precision
);

create table if not exists epa_2023 (
  team_number integer primary key,
  team_name text,
  epa jsonb,
  auto_epa jsonb,
  teleop_epa jsonb,
  current_epa double precision,
  current_auto_epa double precision,
  current_teleop_epa double precision
);

create table if not exists epa_2024 (
  team_number integer primary key,
  team_name text,
  epa jsonb,
  auto_epa jsonb,
  teleop_epa jsonb,
  current_epa double precision,
  current_auto_epa double precision,
  current_teleop_epa double precision
);

create table if not exists epa_2025 (
  team_number integer primary key,
  team_name text,
  epa jsonb,
  auto_epa jsonb,
  teleop_epa jsonb,
  current_epa double precision,
  current_auto_epa double precision,
  current_teleop_epa double precision
);
