-- 0016: дополнительные настройки тренера.
--  notify_note      — дублировать заметку дня в чат Telegram (по умолчанию выкл: тренер и так видит её в приложении).
--  currency         — подпись валюты в приложении («руб.», «лей», «$»…); NULL — подпись по умолчанию из приложения.
--  birthday_time    — во сколько утром присылать поздравление с днём рождения клиента.
--  backup_time      — во сколько по воскресеньям присылать резервную копию.
--  notify_summary   — присылать ли воскресную сводку недели (по умолчанию да).
--  last_summary_date — дата воскресенья, за которое сводка уже отправлена (защита от дублей).

ALTER TABLE users ADD COLUMN notify_note INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN currency TEXT;
ALTER TABLE users ADD COLUMN birthday_time TEXT NOT NULL DEFAULT '10:00';
ALTER TABLE users ADD COLUMN backup_time TEXT NOT NULL DEFAULT '21:00';
ALTER TABLE users ADD COLUMN notify_summary INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN last_summary_date TEXT;

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0016_settings_extra');
