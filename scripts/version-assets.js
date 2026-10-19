#!/usr/bin/env node
// Автоматическое обновление версии кэша (?v=...) для статических файлов в webapp/index.html
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.resolve(__dirname, '../webapp/index.html');

function getVersion() {
  try {
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (sha) return sha;
  } catch {}

  // Fallback: MD5-хеш от style.css и app.js
  try {
    const css = fs.readFileSync(path.resolve(__dirname, '../webapp/style.css'), 'utf8');
    const app = fs.readFileSync(path.resolve(__dirname, '../webapp/app.js'), 'utf8');
    return crypto.createHash('md5').update(css + app).digest('hex').slice(0, 8);
  } catch {
    return Date.now().toString(36);
  }
}

function updateIndexHtml() {
  const version = getVersion();
  let content = fs.readFileSync(indexPath, 'utf8');

  // Заменяем все ?v=... в тегах link и script для локальных файлов
  const updated = content.replace(/(href|src)="(\/[^"?]+\.(?:css|js))(?:\?v=[^"]*)?"/g, `$1="$2?v=${version}"`);

  if (content !== updated) {
    fs.writeFileSync(indexPath, updated, 'utf8');
    console.log(`[version-assets] Обновлена версия статики в index.html: ?v=${version}`);
  } else {
    console.log(`[version-assets] Версия статики уже актуальна: ?v=${version}`);
  }
}

updateIndexHtml();
