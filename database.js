const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Allow overriding the DB directory via env var (useful for hosting with persistent disk)
const dbDir = process.env.DB_DIR ? path.resolve(process.env.DB_DIR) : __dirname;
const dbPath = path.resolve(dbDir, 'modisha_community.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // Users Table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      fullname TEXT NOT NULL,
      residence TEXT,
      password TEXT,
      role TEXT DEFAULT 'resident', -- 'admin' or 'resident'
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Messages Table
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      image_url TEXT,
      likes INTEGER DEFAULT 0,
      dislikes INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS message_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      reaction TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(message_id, user_id)
    )
  `);

  db.all(`PRAGMA table_info(users)`, [], (err, columns) => {
    if (err) {
      console.error('Failed to inspect users table:', err);
      return;
    }

    const columnNames = new Set((columns || []).map((column) => column.name));
    const pendingMigrations = [];

    if (!columnNames.has('password')) {
      pendingMigrations.push(`ALTER TABLE users ADD COLUMN password TEXT`);
    }

    if (!columnNames.has('residence')) {
      pendingMigrations.push(`ALTER TABLE users ADD COLUMN residence TEXT`);
    }

    const messageColumns = [];
    db.all(`PRAGMA table_info(messages)`, [], (messageErr, messageColumnRows) => {
      if (!messageErr) {
        const existingMessageColumns = new Set((messageColumnRows || []).map((column) => column.name));
        if (!existingMessageColumns.has('image_url')) {
          pendingMigrations.push(`ALTER TABLE messages ADD COLUMN image_url TEXT`);
        }
        if (!existingMessageColumns.has('likes')) {
          pendingMigrations.push(`ALTER TABLE messages ADD COLUMN likes INTEGER DEFAULT 0`);
        }
        if (!existingMessageColumns.has('dislikes')) {
          pendingMigrations.push(`ALTER TABLE messages ADD COLUMN dislikes INTEGER DEFAULT 0`);
        }
      }

      const applyNextMigration = () => {
        if (pendingMigrations.length === 0) {
          seedAdminUser();
          return;
        }

        const migration = pendingMigrations.shift();
        db.run(migration, (alterErr) => {
          if (alterErr) {
            console.error('Failed to apply schema migration:', alterErr);
          }
          applyNextMigration();
        });
      };

      applyNextMigration();
    });

  });

  function seedAdminUser() {
    db.get(`SELECT * FROM users WHERE username = ?`, ['kgolaganopoo'], (err, row) => {
      if (err) return console.error('Failed to check admin account:', err);

      if (row) {
        db.run(
          `UPDATE users SET fullname = ?, password = ?, role = ? WHERE username = ?`,
          ['Kgolagano Poo', 'Kx9#mP7$vL2!wQ4%', 'admin', 'kgolaganopoo'],
          (updateErr) => {
            if (updateErr) {
              console.error('Failed to update admin account:', updateErr);
            } else {
              console.log('✅ Admin account updated: "kgolaganopoo"');
            }
          }
        );
      } else {
        db.run(
          `INSERT INTO users (username, fullname, password, role) VALUES (?, ?, ?, ?)`,
          ['kgolaganopoo', 'Kgolagano Poo', 'Kx9#mP7$vL2!wQ4%', 'admin'],
          (insertErr) => {
            if (insertErr) {
              console.error('Failed to create admin account:', insertErr);
            } else {
              console.log('✅ Default admin account created: "kgolaganopoo"');
            }
          }
        );
      }
    });
  }
});

module.exports = db;