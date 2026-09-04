-- ELMEKINA — clamp the streak timezone offset to real-world values.
--
-- The streak functions trust the client's offset to find its local midnight. Unclamped, a client
-- could send +2880 minutes and be "two days ahead", which is enough to walk the streak forward a
-- day at a time without playing. Earth's offsets run from -12h to +14h; anything past that is a
-- lie, and lying now only moves midnight a few hours, as the original comment promised.
create or replace function public._local_day(p_tz_offset_min integer)
returns date language sql stable as
$$ select ((now() at time zone 'utc') + make_interval(mins => greatest(-720, least(840, coalesce(p_tz_offset_min, 0)))))::date $$;
