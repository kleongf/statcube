-- Rank columns the pipeline writes and PR-7 reads. Nullable so existing rows
-- stay valid until the first refresh fills them.
alter table epa_2022 add column if not exists rank_epa integer, add column if not exists rank_auto_epa integer, add column if not exists rank_teleop_epa integer;
alter table epa_2023 add column if not exists rank_epa integer, add column if not exists rank_auto_epa integer, add column if not exists rank_teleop_epa integer;
alter table epa_2024 add column if not exists rank_epa integer, add column if not exists rank_auto_epa integer, add column if not exists rank_teleop_epa integer;
alter table epa_2025 add column if not exists rank_epa integer, add column if not exists rank_auto_epa integer, add column if not exists rank_teleop_epa integer;
