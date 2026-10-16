-- 0015: переход с маникюра на тренировки.
--  Убираем из appointments колонки покрытий (manicure_coating, pedicure_coating): у занятий их нет.
--  Колонка service остаётся строкой без CHECK; допустимые значения проверяются в коде (src/lib/services.ts):
--  personal | split | group | trial | consultation | online.
--  Таблица пересоздаётся (SQLite не умеет убирать колонку с CHECK через ALTER); все остальные данные копируются без изменений.
--  Миграция идёт одной транзакцией, при сбое база остаётся как была.

BEGIN;

CREATE TABLE appointments_new (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL,
  date               TEXT    NOT NULL,   -- YYYY-MM-DD
  start_time         TEXT    NOT NULL,   -- HH:MM
  end_time           TEXT,               -- HH:MM
  client_name        TEXT    NOT NULL,
  who                TEXT,               -- «кто это, откуда пришёл», для группы и сплита можно перечислить участников
  service            TEXT    NOT NULL,   -- вид занятия, см. src/lib/services.ts
  comment            TEXT,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  price              INTEGER CHECK (price IS NULL OR (price >= 0 AND price <= 10000000)),
  status             TEXT    NOT NULL DEFAULT 'scheduled',
  CHECK (end_time IS NULL OR end_time > start_time)
);

INSERT INTO appointments_new
  (id, user_id, date, start_time, end_time, client_name, who, service,
   comment, created_at, updated_at, price, status)
  SELECT id, user_id, date, start_time, end_time, client_name, who, service,
         comment, created_at, updated_at, price, status
  FROM appointments;

DROP TABLE appointments;
ALTER TABLE appointments_new RENAME TO appointments;
CREATE INDEX IF NOT EXISTS idx_appt_user_date ON appointments(user_id, date);

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0015_gym_sessions');

COMMIT;
