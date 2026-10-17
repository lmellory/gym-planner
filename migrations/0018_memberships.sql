-- 0018: абонементы клиентов («10 тренировок за 8000, действует до …»).
--  Клиент связан по имени (как записи): при переименовании клиента имя меняется и здесь,
--  а при восстановлении из копии (где ID клиентов новые) абонементы остаются на месте.
--  Занятия списываются по факту: проведённая тренировка клиента (живая запись, время начала прошло)
--  с датой от start_date и не позже expires_on уменьшает остаток самого раннего абонемента, где есть занятия.
--  price — сколько заплатил клиент; в доход попадает в день start_date (дата продажи).

CREATE TABLE IF NOT EXISTS memberships (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  client_name TEXT    NOT NULL,
  sessions    INTEGER NOT NULL CHECK (sessions > 0 AND sessions <= 1000),
  price       INTEGER CHECK (price IS NULL OR (price >= 0 AND price <= 10000000)),
  start_date  TEXT    NOT NULL,   -- YYYY-MM-DD: дата продажи, с неё идёт списание
  expires_on  TEXT,               -- YYYY-MM-DD: последний день действия; NULL — бессрочный
  note        TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_memberships_user_client ON memberships(user_id, client_name);
CREATE INDEX IF NOT EXISTS idx_memberships_user_start ON memberships(user_id, start_date);

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0018_memberships');
