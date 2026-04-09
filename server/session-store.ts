import session from "express-session";
import mysql from "mysql2/promise";

/**
 * Creates a MariaDB-backed session store when DB credentials are present.
 * Falls back to null (caller should use MemoryStore instead).
 * Sessions persist across Node process restarts.
 */
export function createDbSessionStore(): session.Store | null {
  if (!process.env.DB_NAME || !process.env.DB_USER) return null;

  const pool = mysql.createPool({
    host:     process.env.DB_HOST     || "localhost",
    port:     parseInt(process.env.DB_PORT || "3306", 10),
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
  });

  // Create sessions table (idempotent)
  pool.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id VARCHAR(128) NOT NULL PRIMARY KEY,
      expires    BIGINT       NOT NULL,
      data       MEDIUMTEXT   NOT NULL,
      INDEX idx_expires (expires)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `).catch((e) => console.error("[session-store] table init error:", e));

  class DbSessionStore extends session.Store {
    get(sid: string, cb: (err: any, sess?: session.SessionData | null) => void) {
      pool
        .execute<any[]>(
          "SELECT data FROM sessions WHERE session_id = ? AND expires > ?",
          [sid, Date.now()]
        )
        .then(([rows]) => {
          if (!rows.length) return cb(null, null);
          try { cb(null, JSON.parse(rows[0].data)); }
          catch (e) { cb(e); }
        })
        .catch(cb);
    }

    set(sid: string, sess: session.SessionData, cb?: (err?: any) => void) {
      const expires = sess.cookie?.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 7 * 24 * 60 * 60 * 1000;
      const data = JSON.stringify(sess);
      pool
        .execute(
          `INSERT INTO sessions (session_id, expires, data) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE expires = ?, data = ?`,
          [sid, expires, data, expires, data]
        )
        .then(() => cb?.())
        .catch((e) => { console.error("[session-store] set error:", e?.message); cb?.(e); });
    }

    destroy(sid: string, cb?: (err?: any) => void) {
      pool
        .execute("DELETE FROM sessions WHERE session_id = ?", [sid])
        .then(() => cb?.())
        .catch(cb);
    }

    touch(sid: string, sess: session.SessionData, cb?: () => void) {
      const expires = sess.cookie?.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 7 * 24 * 60 * 60 * 1000;
      pool
        .execute("UPDATE sessions SET expires = ? WHERE session_id = ?", [expires, sid])
        .then(() => cb?.())
        .catch(() => cb?.());
    }
  }

  return new DbSessionStore();
}
