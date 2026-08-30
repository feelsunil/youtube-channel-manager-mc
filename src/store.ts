import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { decryptText, encryptText } from './crypto.js';

export class TokenStore {
  private readonly db: Database.Database;
  constructor(dataDir: string, private readonly key: Buffer) {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.db = new Database(path.join(dataDir, 'youtube-mcp.sqlite'));
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS oauth_state (
        state TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS google_token (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        encrypted_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  saveState(state: string, expiresAt: number) {
    this.db.prepare('DELETE FROM oauth_state WHERE expires_at < ?').run(Date.now());
    this.db.prepare('INSERT OR REPLACE INTO oauth_state(state, expires_at) VALUES(?, ?)')
      .run(state, expiresAt);
  }

  consumeState(state: string): boolean {
    const row = this.db.prepare('SELECT expires_at FROM oauth_state WHERE state = ?').get(state) as { expires_at: number } | undefined;
    this.db.prepare('DELETE FROM oauth_state WHERE state = ?').run(state);
    return Boolean(row && row.expires_at >= Date.now());
  }

  saveGoogleToken(token: unknown) {
    const encrypted = encryptText(JSON.stringify(token), this.key);
    this.db.prepare(`
      INSERT INTO google_token(id, encrypted_json, updated_at) VALUES(1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET encrypted_json=excluded.encrypted_json, updated_at=excluded.updated_at
    `).run(encrypted, Date.now());
  }

  getGoogleToken<T>(): T | null {
    const row = this.db.prepare('SELECT encrypted_json FROM google_token WHERE id = 1').get() as { encrypted_json: string } | undefined;
    return row ? JSON.parse(decryptText(row.encrypted_json, this.key)) as T : null;
  }

  hasGoogleToken(): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM google_token WHERE id = 1').get());
  }
}
