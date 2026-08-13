const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));


// --- REST API ROUTES ---

// Login / Join Community
app.post('/api/login', (req, res) => {
  const { fullname, role, password, residence } = req.body;
  if (!fullname || !residence) {
    return res.status(400).json({ error: 'Full Name and Residence are required.' });
  }

  const userRole = role === 'admin' ? 'admin' : 'resident';
  const normalizedFullname = fullname.trim();
  const normalizedResidence = residence.trim();
  const generatedUsername = `${normalizedFullname.toLowerCase().replace(/[^a-z0-9]+/g, '')}_${normalizedResidence.toLowerCase().replace(/[^a-z0-9]+/g, '')}`;

  if (userRole === 'admin') {
    const expectedAdminUsername = 'kgolaganopoo';
    db.get(`SELECT * FROM users WHERE username = ?`, [expectedAdminUsername], (err, adminUser) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!adminUser) {
        return res.status(401).json({ error: 'Admin account not found.' });
      }
      if (adminUser.password !== password) {
        return res.status(401).json({ error: 'Invalid password.' });
      }
      return res.json({ user: { id: adminUser.id, username: adminUser.username, fullname: adminUser.fullname, residence: adminUser.residence || normalizedResidence, role: adminUser.role } });
    });
    return;
  }

  db.get(`SELECT * FROM users WHERE fullname = ? AND residence = ? AND role = ?`, [normalizedFullname, normalizedResidence, 'resident'], (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error' });

    if (user) {
      return res.json({ user: { id: user.id, username: user.username, fullname: user.fullname, residence: user.residence, role: user.role } });
    }

    db.run(
      `INSERT INTO users (username, fullname, residence, password, role) VALUES (?, ?, ?, ?, ?)`,
      [generatedUsername, normalizedFullname, normalizedResidence, null, 'resident'],
      function (insertErr) {
        if (insertErr) return res.status(500).json({ error: 'Failed to create user' });
        res.json({
          user: { id: this.lastID, username: generatedUsername, fullname: normalizedFullname, residence: normalizedResidence, role: 'resident' }
        });
      }
    );
  });
});

// Fetch approved messages for public feed
app.get('/api/messages/approved', (req, res) => {
  const { residence } = req.query;
  let sql = `SELECT messages.id, messages.content, messages.likes, messages.dislikes, messages.created_at, users.fullname, users.residence, users.role 
     FROM messages 
     JOIN users ON messages.user_id = users.id 
     WHERE messages.status = 'approved'`;
  const params = [];
  if (residence) {
    sql += ` AND users.residence = ?`;
    params.push(residence);
  }
  sql += ` ORDER BY messages.created_at ASC`;

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Fetch pending messages for Admin Panel
app.get('/api/messages/pending', (req, res) => {
  const { residence } = req.query;
  let sql = `SELECT messages.id, messages.content, messages.likes, messages.dislikes, messages.created_at, users.fullname, users.residence, users.username, users.role 
     FROM messages 
     JOIN users ON messages.user_id = users.id 
     WHERE messages.status = 'pending'`;
  const params = [];
  if (residence) {
    sql += ` AND users.residence = ?`;
    params.push(residence);
  }
  sql += ` ORDER BY messages.created_at ASC`;

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// --- SOCKET.IO REAL-TIME EVENTS ---

io.on('connection', (socket) => {
  console.log(`[Socket] New connection: ${socket.id}`);

  // Allow clients to join a residence room so events are scoped
  socket.on('joinResidence', (residence) => {
    if (!residence) return;
    socket.join(residence);
    console.log(`[Socket] ${socket.id} joined residence room: ${residence}`);
  });

  // User submits a new message
  socket.on('sendMessage', (data) => {
    const { userId, content } = data;
    if (!content || !userId) return;

    db.run(
      `INSERT INTO messages (user_id, content, status) VALUES (?, ?, 'pending')`,
      [userId, content],
      function (err) {
        if (err) return console.error(err);

        const messageId = this.lastID;

        // Fetch user info for admin preview
        db.get(
          `SELECT messages.id, messages.content, messages.likes, messages.dislikes, messages.created_at, users.fullname, users.residence, users.username, users.role 
           FROM messages JOIN users ON messages.user_id = users.id 
           WHERE messages.id = ?`,
          [messageId],
          (err, msgData) => {
            if (msgData) {
              // Notify admins in the same residence about a new pending message
              if (msgData.residence) {
                io.to(msgData.residence).emit('newPendingMessage', msgData);
              } else {
                io.emit('newPendingMessage', msgData);
              }

              // Notify the sender that message was submitted for approval
              socket.emit('messageSubmitted', {
                message: 'Your update has been submitted for Admin approval.',
                id: messageId
              });
            }
          }
        );
      }
    );
  });

  // Admin approves a message
  socket.on('approveMessage', (messageId) => {
    db.run(
      `UPDATE messages SET status = 'approved' WHERE id = ?`,
      [messageId],
      function (err) {
        if (err) return console.error(err);

        // Fetch approved message with sender profile
        db.get(
          `SELECT messages.id, messages.content, messages.likes, messages.dislikes, messages.created_at, users.fullname, users.residence, users.role 
           FROM messages JOIN users ON messages.user_id = users.id 
           WHERE messages.id = ?`,
          [messageId],
          (err, approvedMsg) => {
            if (approvedMsg) {
              // Broadcast only to the residence room
              if (approvedMsg.residence) {
                io.to(approvedMsg.residence).emit('messageApproved', approvedMsg);
                io.to(approvedMsg.residence).emit('removePendingMessage', messageId);
              } else {
                io.emit('messageApproved', approvedMsg);
                io.emit('removePendingMessage', messageId);
              }
            }
          }
        );
      }
    );
  });

  // Admin rejects a message
  socket.on('rejectMessage', (messageId) => {
    db.run(`UPDATE messages SET status = 'rejected' WHERE id = ?`, [messageId], (err) => {
      if (err) return console.error(err);
      // find residence for this message and emit to that room
      db.get(`SELECT users.residence FROM messages JOIN users ON messages.user_id = users.id WHERE messages.id = ?`, [messageId], (getErr, row) => {
        if (getErr) return console.error(getErr);
        if (row && row.residence) {
          io.to(row.residence).emit('removePendingMessage', messageId);
        } else {
          io.emit('removePendingMessage', messageId);
        }
      });
    });
  });

  // Admin deletes a community member message
  socket.on('deleteMessage', (data) => {
    const { messageId, role } = data || {};
    if (role !== 'admin' || !messageId) return;

    // fetch residence then delete so we can scope the deletion event
    db.get(`SELECT users.residence FROM messages JOIN users ON messages.user_id = users.id WHERE messages.id = ?`, [messageId], (getErr, row) => {
      if (getErr) return console.error(getErr);
      const residence = row && row.residence;
      db.run(`UPDATE messages SET status = 'deleted' WHERE id = ?`, [messageId], (err) => {
        if (err) return console.error(err);
        if (residence) {
          io.to(residence).emit('messageDeleted', messageId);
          io.to(residence).emit('removePendingMessage', messageId);
        } else {
          io.emit('messageDeleted', messageId);
          io.emit('removePendingMessage', messageId);
        }
      });
    });
  });

  socket.on('reactToMessage', (data) => {
    const { messageId, userId, reaction } = data || {};
    if (!messageId || !userId || !['like', 'dislike'].includes(reaction)) return;

    db.get(`SELECT * FROM message_reactions WHERE message_id = ? AND user_id = ?`, [messageId, userId], (err, existing) => {
      if (err) return console.error(err);

      if (existing) {
        if (existing.reaction === reaction) return;

        const previousReaction = existing.reaction;
        db.run(`UPDATE message_reactions SET reaction = ? WHERE id = ?`, [reaction, existing.id], (updateErr) => {
          if (updateErr) return console.error(updateErr);

          const adjustReaction = (delta, column) => {
            db.run(`UPDATE messages SET ${column} = ${column} + ? WHERE id = ?`, [delta, messageId], (deltaErr) => {
              if (deltaErr) return console.error(deltaErr);
            });
          };

          if (previousReaction === 'like' && reaction === 'dislike') {
            adjustReaction(-1, 'likes');
            adjustReaction(1, 'dislikes');
          } else if (previousReaction === 'dislike' && reaction === 'like') {
            adjustReaction(1, 'likes');
            adjustReaction(-1, 'dislikes');
          }

          db.get(`SELECT likes, dislikes, users.residence FROM messages JOIN users ON messages.user_id = users.id WHERE messages.id = ?`, [messageId], (countErr, counts) => {
            if (countErr) return console.error(countErr);
            const payload = { id: messageId, likes: counts?.likes || 0, dislikes: counts?.dislikes || 0 };
            if (counts && counts.residence) {
              io.to(counts.residence).emit('messageReactionUpdated', payload);
            } else {
              io.emit('messageReactionUpdated', payload);
            }
          });
        });
        return;
      }

      db.run(`INSERT INTO message_reactions (message_id, user_id, reaction) VALUES (?, ?, ?)`, [messageId, userId, reaction], (insertErr) => {
        if (insertErr) return console.error(insertErr);
        db.run(
          reaction === 'like'
            ? `UPDATE messages SET likes = likes + 1 WHERE id = ?`
            : `UPDATE messages SET dislikes = dislikes + 1 WHERE id = ?`,
          [messageId],
          (updateErr) => {
            if (updateErr) return console.error(updateErr);
            db.get(`SELECT likes, dislikes, users.residence FROM messages JOIN users ON messages.user_id = users.id WHERE messages.id = ?`, [messageId], (countErr, counts) => {
              if (countErr) return console.error(countErr);
              const payload = { id: messageId, likes: counts?.likes || 0, dislikes: counts?.dislikes || 0 };
              if (counts && counts.residence) {
                io.to(counts.residence).emit('messageReactionUpdated', payload);
              } else {
                io.emit('messageReactionUpdated', payload);
              }
            });
          }
        );
      });
    });
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`🚀 Modisha Community App running at http://localhost:${PORT}`);
  console.log(`=================================================`);
});