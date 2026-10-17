-- 0019: персонализация бота тренером.
--  coach_name   — как бот обращается к тренеру («Александр»); пусто — берём имя из Telegram
--  gym_name     — название зала/студии, попадает в приветствие и вечернее расписание
--  greeting     — свой текст приветствия на /start (пусто — стандартный текст бота)
--  button_label — подпись кнопки входа в Mini App (пусто — «🏋️ Открыть ежедневник»)
--  notify_style — 'full' (подробно, с контактами и заметкой) или 'short' (только время и имена)

ALTER TABLE users ADD COLUMN coach_name TEXT;
ALTER TABLE users ADD COLUMN gym_name TEXT;
ALTER TABLE users ADD COLUMN greeting TEXT;
ALTER TABLE users ADD COLUMN button_label TEXT;
ALTER TABLE users ADD COLUMN notify_style TEXT NOT NULL DEFAULT 'full';

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0019_personal');
