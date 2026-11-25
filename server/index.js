require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const multer = require('multer');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

let db;

async function initDB() {
  db = await open({
    filename: './groupchat.db',
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS Users (
      user_id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS Groups (
      group_id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_name TEXT NOT NULL,
      description TEXT,
      invite_code TEXT UNIQUE NOT NULL,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES Users(user_id)
    );

    CREATE TABLE IF NOT EXISTS Group_Members (
      membership_id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER,
      user_id INTEGER,
      role TEXT DEFAULT 'member',
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES Groups(group_id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS Messages (
      message_id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER,
      sender_id INTEGER,
      message_text TEXT,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES Groups(group_id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES Users(user_id)
    );

    CREATE TABLE IF NOT EXISTS Attachments (
      attachment_id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER,
      file_name TEXT,
      file_path TEXT,
      file_type TEXT,
      FOREIGN KEY (message_id) REFERENCES Messages(message_id) ON DELETE CASCADE
    );
  `);
  console.log('Database initialized successfully.');
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const hash = await bcrypt.hash(password, 10);
    const result = await db.run(
      'INSERT INTO Users (name, email, password_hash) VALUES (?, ?, ?)',
      [name, email, hash]
    );
    res.json({ message: 'Registered successfully', user_id: result.lastID });
  } catch (err) {
    res.status(400).json({ error: 'Email already exists or invalid data' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await db.get('SELECT * FROM Users WHERE email = ?', [email]);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = jwt.sign({ user_id: user.user_id, name: user.name }, process.env.JWT_SECRET);
  res.json({ token, user: { user_id: user.user_id, name: user.name, email: user.email } });
});

app.post('/api/groups', authenticateToken, async (req, res) => {
  const { group_name, description } = req.body;
  const invite_code = Math.random().toString(36).substring(2, 8).toUpperCase();
  const result = await db.run(
    'INSERT INTO Groups (group_name, description, invite_code, created_by) VALUES (?, ?, ?, ?)',
    [group_name, description, invite_code, req.user.user_id]
  );
  const group_id = result.lastID;
  await db.run(
    'INSERT INTO Group_Members (group_id, user_id, role) VALUES (?, ?, ?)',
    [group_id, req.user.user_id, 'admin']
  );
  res.json({ group_id, group_name, description, invite_code, role: 'admin' });
});

app.post('/api/groups/join', authenticateToken, async (req, res) => {
  const { invite_code } = req.body;
  const group = await db.get('SELECT * FROM Groups WHERE invite_code = ?', [invite_code.toUpperCase()]);
  if (!group) return res.status(404).json({ error: 'Invalid invite code' });

  const existing = await db.get(
    'SELECT * FROM Group_Members WHERE group_id = ? AND user_id = ?',
    [group.group_id, req.user.user_id]
  );
  if (existing) return res.status(400).json({ error: 'Already a member' });

  await db.run(
    'INSERT INTO Group_Members (group_id, user_id, role) VALUES (?, ?, ?)',
    [group.group_id, req.user.user_id, 'member']
  );
  res.json({ message: 'Joined group', group });
});

app.get('/api/groups', authenticateToken, async (req, res) => {
  const groups = await db.all(`
    SELECT g.*, gm.role 
    FROM Groups g
    JOIN Group_Members gm ON g.group_id = gm.group_id
    WHERE gm.user_id = ?
  `, [req.user.user_id]);
  res.json(groups);
});

app.get('/api/groups/:groupId/details', authenticateToken, async (req, res) => {
  const { groupId } = req.params;
  const membership = await db.get(
    'SELECT * FROM Group_Members WHERE group_id = ? AND user_id = ?',
    [groupId, req.user.user_id]
  );
  if (!membership) return res.status(403).json({ error: 'Access denied' });

  const messages = await db.all(`
    SELECT m.*, u.name AS sender_name, a.file_name, a.file_path, a.file_type
    FROM Messages m
    JOIN Users u ON m.sender_id = u.user_id
    LEFT JOIN Attachments a ON m.message_id = a.message_id
    WHERE m.group_id = ?
    ORDER BY m.sent_at ASC
  `, [groupId]);

  const members = await db.all(`
    SELECT u.user_id, u.name, u.email, gm.role
    FROM Group_Members gm
    JOIN Users u ON gm.user_id = u.user_id
    WHERE gm.group_id = ?
  `, [groupId]);

  res.json({ messages, members, myRole: membership.role });
});

app.delete('/api/groups/:groupId/members/:userId', authenticateToken, async (req, res) => {
  const { groupId, userId } = req.params;
  const adminCheck = await db.get(
    'SELECT * FROM Group_Members WHERE group_id = ? AND user_id = ? AND role = "admin"',
    [groupId, req.user.user_id]
  );
  if (!adminCheck) return res.status(403).json({ error: 'Admin privileges required' });

  await db.run('DELETE FROM Group_Members WHERE group_id = ? AND user_id = ?', [groupId, userId]);
  io.to(`group_${groupId}`).emit('member_removed', { userId: Number(userId) });
  res.json({ message: 'Member removed' });
});

app.post('/api/groups/:groupId/leave', authenticateToken, async (req, res) => {
  const { groupId } = req.params;
  await db.run('DELETE FROM Group_Members WHERE group_id = ? AND user_id = ?', [groupId, req.user.user_id]);
  res.json({ message: 'Left group' });
});

app.post('/api/upload', authenticateToken, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({
    file_name: req.file.originalname,
    file_path: `/uploads/${req.file.filename}`,
    file_type: req.file.mimetype
  });
});

io.on('connection', (socket) => {
  socket.on('join_group', (groupId) => {
    socket.join(`group_${groupId}`);
  });

  socket.on('send_message', async (data) => {
    const { group_id, sender_id, sender_name, message_text, attachment } = data;
    const result = await db.run(
      'INSERT INTO Messages (group_id, sender_id, message_text) VALUES (?, ?, ?)',
      [group_id, sender_id, message_text || '']
    );
    const message_id = result.lastID;

    if (attachment) {
      await db.run(
        'INSERT INTO Attachments (message_id, file_name, file_path, file_type) VALUES (?, ?, ?, ?)',
        [message_id, attachment.file_name, attachment.file_path, attachment.file_type]
      );
    }

    const fullMessage = {
      message_id,
      group_id,
      sender_id,
      sender_name,
      message_text: message_text || '',
      sent_at: new Date().toISOString(),
      file_name: attachment?.file_name || null,
      file_path: attachment?.file_path || null,
      file_type: attachment?.file_type || null
    };

    io.to(`group_${group_id}`).emit('receive_message', fullMessage);
  });
});

initDB().then(() => {
  server.listen(process.env.PORT, () => {
    console.log(`Server running on http://localhost:${process.env.PORT}`);
  });
});
