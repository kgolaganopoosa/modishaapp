const db = require('../database');

db.all('SELECT id, user_id, content, status, created_at FROM messages ORDER BY created_at DESC LIMIT 20', [], (err, rows) => {
  if (err) {
    console.error('DB error:', err);
    process.exit(1);
  }
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
});
