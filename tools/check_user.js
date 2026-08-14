const db = require('../database');
const ids = [8,4,2];
ids.forEach(id => {
  db.get('SELECT id, username, fullname, residence, role FROM users WHERE id = ?', [id], (err, row) => {
    if (err) return console.error('DB err', err);
    console.log('user', id, '=>', row);
  });
});
setTimeout(()=>process.exit(0),500);
