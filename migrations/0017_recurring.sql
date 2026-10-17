-- 0017: повторяющиеся записи.
--  series_id — общий идентификатор серии («вторник и четверг на 8 недель»); у одиночных записей NULL.
--  У каждого участника сплита / группы своя серия, поэтому удаление одной серии не задевает остальных.

ALTER TABLE appointments ADD COLUMN series_id TEXT;
CREATE INDEX IF NOT EXISTS idx_appt_series ON appointments(user_id, series_id);

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0017_recurring');
