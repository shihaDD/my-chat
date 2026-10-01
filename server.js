const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ──────────────────────────────────────────────
// Хранилище данных (in-memory)
// ──────────────────────────────────────────────
const users = new Map();        // userId -> { id, login, name, passwordHash, avatar, bio, email, role, muted, muteUntil, muteReason, verified, friends: [], friendRequests: [], sentRequests: [] }
const sessions = new Map();     // token -> userId
const chats = new Map();        // chatId -> { id, type, participants: [], messages: [], pinned: null }
const groups = new Map();       // groupId -> { id, name, avatar, isClosed, owner, members: [], roles: {}, channels: { text: [], voice: [] }, description, verified, joinRequests: [] }
const groupMessages = new Map(); // channelId -> [{ id, senderId, text, edited, timestamp, attachments: [] }]
const news = new Map();         // newsId -> { id, authorId, text, media, timestamp }
const violations = new Map();   // violationId -> { id, reporterId, targetId, reason, timestamp, resolved }
const verificationRequests = new Map(); // requestId -> { id, groupId, requestedBy, timestamp, status }
const radioStations = [
  { id: 'r1', name: 'Радио Дача', url: 'http://ic7.101.ru:8000/c18_2' },
  { id: 'r2', name: 'Авторадио', url: 'http://icecast-authoradio.adtf.ru:8000/authoradio' },
  { id: 'r3', name: 'Европа Плюс', url: 'http://icecast-europeplus.cdnvideo.ru:8000/europeplus128' },
  { id: 'r4', name: 'Радио Шансон', url: 'http://chanson.hostingradio.ru:8041/chanson128.mp3' },
  { id: 'r5', name: 'Радио Maximum', url: 'http://icecast.maximum.cdnvideo.ru:8000/maximum' },
  { id: 'r6', name: 'Дорожное Радио', url: 'http://icecast-dorognoe.cdnvideo.ru:8000/dorognoe' },
  { id: 'r7', name: 'Радио Рекорд', url: 'http://icecast-record.cdnvideo.ru:8000/record128' },
  { id: 'r8', name: 'Наше Радио', url: 'http://icecast-nashe.cdnvideo.ru:8000/nashe' },
];

const wsClients = new Map(); // userId -> Set<ws>

// ──────────────────────────────────────────────
// Утилиты
// ──────────────────────────────────────────────
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

function findUserByLogin(login) {
  for (const user of users.values()) {
    if (user.login === login) return user;
  }
  return null;
}

function getUserSafe(user) {
  if (!user) return null;
  return {
    id: user.id,
    login: user.login,
    name: user.name,
    avatar: user.avatar,
    bio: user.bio,
    email: user.email,
    role: user.role,
    muted: user.muted,
    muteUntil: user.muteUntil,
    muteReason: user.muteReason,
    verified: user.verified,
  };
}

function sendToUser(userId, data) {
  const clients = wsClients.get(userId);
  if (clients) {
    clients.forEach(ws => {
      if (ws.readyState === 1) ws.send(JSON.stringify(data));
    });
  }
}

function broadcastToChat(chatId, data) {
  const chat = chats.get(chatId);
  if (!chat) return;
  chat.participants.forEach(uid => sendToUser(uid, data));
}

function broadcastToGroup(groupId, data) {
  const group = groups.get(groupId);
  if (!group) return;
  group.members.forEach(m => sendToUser(m.userId, data));
}

// ──────────────────────────────────────────────
// Middleware: аутентификация
// ──────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Не авторизован' });

  const userId = sessions.get(token);
  if (!userId) return res.status(401).json({ error: 'Сессия истекла' });

  req.userId = userId;
  req.token = token;
  req.user = users.get(userId);
  next();
}

// Проверка мута
function checkMute(req, res, next) {
  const user = req.user;
  if (user.muted && user.muteUntil > Date.now()) {
    return res.status(403).json({ error: `Вы в муте до ${new Date(user.muteUntil).toLocaleString('ru-RU')}. Причина: ${user.muteReason}` });
  }
  if (user.muted && user.muteUntil <= Date.now()) {
    user.muted = false;
    user.muteUntil = 0;
    user.muteReason = '';
  }
  next();
}

// ──────────────────────────────────────────────
// AUTH
// ──────────────────────────────────────────────
app.post('/api/register', (req, res) => {
  const { login, name, password, confirmPassword, avatar } = req.body;

  if (!login || !name || !password) return res.status(400).json({ error: 'Заполните все поля' });
  if (password !== confirmPassword) return res.status(400).json({ error: 'Пароли не совпадают' });
  if (findUserByLogin(login)) return res.status(409).json({ error: 'Логин занят' });
  if (login.length < 3) return res.status(400).json({ error: 'Логин слишком короткий' });

  const userId = generateId();
  const user = {
    id: userId,
    login,
    name,
    passwordHash: hashPassword(password),
    avatar: avatar || '',
    bio: '',
    email: '',
    role: 'user',
    muted: false,
    muteUntil: 0,
    muteReason: '',
    verified: false,
    friends: [],
    friendRequests: [],
    sentRequests: [],
  };

  users.set(userId, user);
  const token = generateToken();
  sessions.set(token, userId);

  res.json({ token, user: getUserSafe(user) });
});

app.post('/api/login', (req, res) => {
  const { login, password } = req.body;
  const user = findUserByLogin(login);

  if (!user || user.passwordHash !== hashPassword(password)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }

  const token = generateToken();
  sessions.set(token, user.id);

  res.json({ token, user: getUserSafe(user) });
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ user: getUserSafe(req.user) });
});

app.post('/api/logout', authMiddleware, (req, res) => {
  sessions.delete(req.token);
  res.json({ ok: true });
});

// ──────────────────────────────────────────────
// PROFILE
// ──────────────────────────────────────────────
app.put('/api/profile', authMiddleware, (req, res) => {
  const { name, avatar, bio, email, newPassword, confirmPassword } = req.body;
  const user = req.user;

  if (name) user.name = name;
  if (avatar !== undefined) user.avatar = avatar;
  if (bio !== undefined) user.bio = bio;
  if (email !== undefined) user.email = email;

  if (newPassword) {
    if (newPassword !== confirmPassword) return res.status(400).json({ error: 'Пароли не совпадают' });
    user.passwordHash = hashPassword(newPassword);
  }

  res.json({ user: getUserSafe(user) });
});

app.get('/api/user/:userId', authMiddleware, (req, res) => {
  const user = users.get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json({ user: getUserSafe(user) });
});

// ──────────────────────────────────────────────
// FRIENDS
// ──────────────────────────────────────────────
app.post('/api/friends/request', authMiddleware, (req, res) => {
  const { login } = req.body;
  const targetUser = findUserByLogin(login);

  if (!targetUser) return res.status(404).json({ error: 'Пользователь не найден' });
  if (targetUser.id === req.userId) return res.status(400).json({ error: 'Нельзя добавить себя' });
  if (req.user.friends.includes(targetUser.id)) return res.status(400).json({ error: 'Уже в друзьях' });
  if (req.user.sentRequests.includes(targetUser.id)) return res.status(400).json({ error: 'Заявка уже отправлена' });

  req.user.sentRequests.push(targetUser.id);
  targetUser.friendRequests.push(req.userId);

  sendToUser(targetUser.id, { type: 'friend_request', from: getUserSafe(req.user) });
  res.json({ ok: true });
});

app.post('/api/friends/accept', authMiddleware, (req, res) => {
  const { userId } = req.body;
  const fromUser = users.get(userId);
  if (!fromUser) return res.status(404).json({ error: 'Пользователь не найден' });

  const idx = req.user.friendRequests.indexOf(userId);
  if (idx === -1) return res.status(400).json({ error: 'Нет такой заявки' });

  req.user.friendRequests.splice(idx, 1);
  req.user.friends.push(userId);

  const sentIdx = fromUser.sentRequests.indexOf(req.userId);
  if (sentIdx !== -1) fromUser.sentRequests.splice(sentIdx, 1);
  fromUser.friends.push(req.userId);

  // Создаём личный чат
  const chatId = generateId();
  chats.set(chatId, {
    id: chatId,
    type: 'private',
    participants: [req.userId, userId],
    messages: [],
    pinned: null,
  });

  sendToUser(userId, { type: 'friend_accepted', by: getUserSafe(req.user), chatId });
  res.json({ ok: true, chatId });
});

app.post('/api/friends/reject', authMiddleware, (req, res) => {
  const { userId } = req.body;
  const idx = req.user.friendRequests.indexOf(userId);
  if (idx !== -1) req.user.friendRequests.splice(idx, 1);

  const fromUser = users.get(userId);
  if (fromUser) {
    const sentIdx = fromUser.sentRequests.indexOf(req.userId);
    if (sentIdx !== -1) fromUser.sentRequests.splice(sentIdx, 1);
  }

  res.json({ ok: true });
});

app.delete('/api/friends/:userId', authMiddleware, (req, res) => {
  const targetId = req.params.userId;
  const idx = req.user.friends.indexOf(targetId);
  if (idx !== -1) req.user.friends.splice(idx, 1);

  const target = users.get(targetId);
  if (target) {
    const tIdx = target.friends.indexOf(req.userId);
    if (tIdx !== -1) target.friends.splice(tIdx, 1);
  }

  res.json({ ok: true });
});

app.get('/api/friends', authMiddleware, (req, res) => {
  const friendsList = req.user.friends.map(id => getUserSafe(users.get(id))).filter(Boolean);
  const incoming = req.user.friendRequests.map(id => getUserSafe(users.get(id))).filter(Boolean);
  const outgoing = req.user.sentRequests.map(id => getUserSafe(users.get(id))).filter(Boolean);
  res.json({ friends: friendsList, incoming, outgoing });
});

// ──────────────────────────────────────────────
// CHATS
// ──────────────────────────────────────────────
app.get('/api/chats', authMiddleware, (req, res) => {
  const userChats = [];
  for (const chat of chats.values()) {
    if (chat.participants.includes(req.userId)) {
      const otherId = chat.participants.find(id => id !== req.userId);
      const otherUser = otherId ? users.get(otherId) : null;
      userChats.push({
        id: chat.id,
        type: chat.type,
        otherUser: otherUser ? getUserSafe(otherUser) : null,
        lastMessage: chat.messages[chat.messages.length - 1] || null,
        messageCount: chat.messages.length,
        pinned: chat.pinned,
      });
    }
  }
  userChats.sort((a, b) => {
    const aTime = a.lastMessage?.timestamp || 0;
    const bTime = b.lastMessage?.timestamp || 0;
    return bTime - aTime;
  });
  res.json({ chats: userChats });
});

app.get('/api/chats/:chatId/messages', authMiddleware, (req, res) => {
  const chat = chats.get(req.params.chatId);
  if (!chat) return res.status(404).json({ error: 'Чат не найден' });
  if (!chat.participants.includes(req.userId)) return res.status(403).json({ error: 'Нет доступа' });

  const messagesWithUsers = chat.messages.map(m => ({
    ...m,
    sender: getUserSafe(users.get(m.senderId)),
  }));

  res.json({ messages: messagesWithUsers, pinned: chat.pinned });
});

app.post('/api/chats/:chatId/messages', authMiddleware, checkMute, (req, res) => {
  const { text, attachments } = req.body;
  const chat = chats.get(req.params.chatId);
  if (!chat) return res.status(404).json({ error: 'Чат не найден' });
  if (!chat.participants.includes(req.userId)) return res.status(403).json({ error: 'Нет доступа' });

  const message = {
    id: generateId(),
    senderId: req.userId,
    text,
    attachments: attachments || [],
    edited: false,
    timestamp: Date.now(),
  };

  chat.messages.push(message);

  const msgData = { type: 'chat_message', chatId: chat.id, message: { ...message, sender: getUserSafe(req.user) } };
  broadcastToChat(chat.id, msgData);

  res.json({ message });
});

app.put('/api/chats/:chatId/messages/:msgId', authMiddleware, (req, res) => {
  const { text } = req.body;
  const chat = chats.get(req.params.chatId);
  if (!chat) return res.status(404).json({ error: 'Чат не найден' });

  const msg = chat.messages.find(m => m.id === req.params.msgId);
  if (!msg) return res.status(404).json({ error: 'Сообщение не найдено' });
  if (msg.senderId !== req.userId) return res.status(403).json({ error: 'Нельзя редактировать чужое сообщение' });

  msg.text = text;
  msg.edited = true;

  broadcastToChat(chat.id, { type: 'chat_message_edited', chatId: chat.id, message: msg });
  res.json({ message: msg });
});

app.delete('/api/chats/:chatId/messages/:msgId', authMiddleware, (req, res) => {
  const chat = chats.get(req.params.chatId);
  if (!chat) return res.status(404).json({ error: 'Чат не найден' });

  const idx = chat.messages.findIndex(m => m.id === req.params.msgId);
  if (idx === -1) return res.status(404).json({ error: 'Сообщение не найдено' });
  const msg = chat.messages[idx];
  if (msg.senderId !== req.userId && req.user.role !== 'moderator' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Нет прав' });
  }

  chat.messages.splice(idx, 1);
  broadcastToChat(chat.id, { type: 'chat_message_deleted', chatId: chat.id, messageId: req.params.msgId });
  res.json({ ok: true });
});

app.post('/api/chats/:chatId/pin', authMiddleware, (req, res) => {
  const { messageId } = req.body;
  const chat = chats.get(req.params.chatId);
  if (!chat) return res.status(404).json({ error: 'Чат не найден' });
  if (!chat.participants.includes(req.userId)) return res.status(403).json({ error: 'Нет доступа' });

  const msg = chat.messages.find(m => m.id === messageId);
  if (!msg) return res.status(404).json({ error: 'Сообщение не найдено' });

  chat.pinned = msg;
  broadcastToChat(chat.id, { type: 'chat_pinned', chatId: chat.id, message: msg });
  res.json({ ok: true, pinned: msg });
});

app.post('/api/chats/:chatId/unpin', authMiddleware, (req, res) => {
  const chat = chats.get(req.params.chatId);
  if (!chat) return res.status(404).json({ error: 'Чат не найден' });
  chat.pinned = null;
  broadcastToChat(chat.id, { type: 'chat_unpinned', chatId: chat.id });
  res.json({ ok: true });
});

// ──────────────────────────────────────────────
// GROUPS
// ──────────────────────────────────────────────
app.post('/api/groups', authMiddleware, (req, res) => {
  const { name, avatar, isClosed, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Укажите название' });

  const groupId = generateId();
  const defaultRole = { name: 'Участник', permissions: { post: true, delete: false, duplicate: false, voiceMute: false } };
  const ownerRole = { name: 'Владелец', permissions: { post: true, delete: true, duplicate: true, voiceMute: true, manage: true } };

  const group = {
    id: groupId,
    name,
    avatar: avatar || '',
    isClosed: !!isClosed,
    description: description || '',
    owner: req.userId,
    members: [{ userId: req.userId, role: 'owner' }],
    roles: { owner: ownerRole, member: defaultRole },
    channels: { text: [], voice: [] },
    verified: false,
    joinRequests: [],
  };

  // Канал по умолчанию
  const defaultChannelId = generateId();
  group.channels.text.push({ id: defaultChannelId, name: 'общий', accessRole: 'member' });
  groupMessages.set(defaultChannelId, []);

  groups.set(groupId, group);
  res.json({ group });
});

app.get('/api/groups', authMiddleware, (req, res) => {
  const allGroups = [];
  for (const g of groups.values()) {
    const isMember = g.members.some(m => m.userId === req.userId);
    if (!g.isClosed || isMember || req.user.role === 'moderator' || req.user.role === 'admin') {
      allGroups.push({
        id: g.id,
        name: g.name,
        avatar: g.avatar,
        isClosed: g.isClosed,
        memberCount: g.members.length,
        verified: g.verified,
        isMember,
      });
    }
  }
  res.json({ groups: allGroups });
});

app.get('/api/groups/:groupId', authMiddleware, (req, res) => {
  const group = groups.get(req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Группа не найдена' });

  const isMember = group.members.some(m => m.userId === req.userId);
  if (group.isClosed && !isMember && req.user.role !== 'moderator' && req.user.role !== 'admin') {
    return res.json({ group: { id: group.id, name: group.name, avatar: group.avatar, isClosed: true, isMember: false } });
  }

  res.json({
    group: {
      ...group,
      members: group.members.map(m => ({ ...m, user: getUserSafe(users.get(m.userId)) })),
    },
  });
});

app.post('/api/groups/:groupId/join', authMiddleware, (req, res) => {
  const group = groups.get(req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Группа не найдена' });

  if (group.members.some(m => m.userId === req.userId)) return res.status(400).json({ error: 'Уже участник' });

  if (group.isClosed) {
    if (group.joinRequests.includes(req.userId)) return res.status(400).json({ error: 'Заявка уже отправлена' });
    group.joinRequests.push(req.userId);
    sendToUser(group.owner, { type: 'group_join_request', groupId: group.id, user: getUserSafe(req.user) });
    return res.json({ ok: true, message: 'Заявка отправлена' });
  }

  group.members.push({ userId: req.userId, role: 'member' });
  broadcastToGroup(group.id, { type: 'group_member_joined', groupId: group.id, user: getUserSafe(req.user) });
  res.json({ ok: true });
});

app.post('/api/groups/:groupId/join/:userId/accept', authMiddleware, (req, res) => {
  const group = groups.get(req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Группа не найдена' });
  if (group.owner !== req.userId) return res.status(403).json({ error: 'Только владелец может принимать заявки' });

  const idx = group.joinRequests.indexOf(req.params.userId);
  if (idx === -1) return res.status(400).json({ error: 'Нет такой заявки' });

  group.joinRequests.splice(idx, 1);
  group.members.push({ userId: req.params.userId, role: 'member' });

  sendToUser(req.params.userId, { type: 'group_join_accepted', groupId: group.id, groupName: group.name });
  broadcastToGroup(group.id, { type: 'group_member_joined', groupId: group.id, user: getUserSafe(users.get(req.params.userId)) });
  res.json({ ok: true });
});

app.post('/api/groups/:groupId/join/:userId/reject', authMiddleware, (req, res) => {
  const group = groups.get(req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Группа не найдена' });
  if (group.owner !== req.userId) return res.status(403).json({ error: 'Только владелец может отклонять заявки' });

  const idx = group.joinRequests.indexOf(req.params.userId);
  if (idx !== -1) group.joinRequests.splice(idx, 1);

  sendToUser(req.params.userId, { type: 'group_join_rejected', groupId: group.id });
  res.json({ ok: true });
});

app.get('/api/groups/:groupId/requests', authMiddleware, (req, res) => {
  const group = groups.get(req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Группа не найдена' });
  if (group.owner !== req.userId) return res.status(403).json({ error: 'Нет доступа' });

  const requests = group.joinRequests.map(uid => getUserSafe(users.get(uid))).filter(Boolean);
  res.json({ requests });
});

app.put('/api/groups/:groupId', authMiddleware, (req, res) => {
  const { name, avatar, isClosed, description } = req.body;
  const group = groups.get(req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Группа не найдена' });
  if (group.owner !== req.userId) return res.status(403).json({ error: 'Только владелец может редактировать' });

  if (name) group.name = name;
  if (avatar !== undefined) group.avatar = avatar;
  if (isClosed !== undefined) group.isClosed = isClosed;
  if (description !== undefined) group.description = description;

  broadcastToGroup(group.id, { type: 'group_updated', group: { id: group.id, name: group.name, avatar: group.avatar, isClosed: group.isClosed } });
  res.json({ group });
});

app.delete('/api/groups/:groupId', authMiddleware, (req, res) => {
  const group = groups.get(req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Группа не найдена' });
  if (group.owner !== req.userId) return res.status(403).json({ error: 'Только владелец может удалить группу' });

  broadcastToGroup(group.id, { type: 'group_deleted', groupId: group.id });
  groups.delete(req.params.groupId);
  res.json({ ok: true });
});

app.post('/api/groups/:groupId/leave', authMiddleware, (req, res) => {
  const group = groups.get(req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Группа не найдена' });

  const idx = group.members.findIndex(m => m.userId === req.userId);
  if (idx === -1) return res.status(400).json({ error: 'Вы не участник' });

  if (group.owner === req.userId) return res.status(400).json({ error: 'Владелец не может покинуть группу (удалите её)' });

  group.members.splice(idx, 1);
  broadcastToGroup(group.id, { type: 'group_member_left', groupId: group.id, userId: req.userId });
  res.json({ ok: true });
});

// ── Каналы группы ──
app.post('/api/groups/:groupId/channels', authMiddleware, (req, res) => {
  const { name, type, accessRole } = req.body;
  const group = groups.get(req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Группа не найдена' });
  if (group.owner !== req.userId) return res.status(403).json({ error: 'Только владелец может создавать каналы' });

  const channelId = generateId();
  const channel = { id: channelId, name: name || 'новый канал', accessRole: accessRole || 'member' };

  if (type === 'voice') {
    group.channels.voice.push(channel);
  } else {
    group.channels.text.push(channel);
    groupMessages.set(channelId, []);
  }

  broadcastToGroup(group.id, { type: 'group_channel_created', groupId: group.id, channel, channelType: type });
  res.json({ channel });
});

app.delete('/api/groups/:groupId/channels/:channelId', authMiddleware, (req, res) => {
  const group = groups.get(req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Группа не найдена' });
  if (group.owner !== req.userId) return res.status(403).json({ error: 'Нет доступа' });

  ['text', 'voice'].forEach(type => {
    const idx = group.channels[type].findIndex(c => c.id === req.params.channelId);
    if (idx !== -1) {
      group.channels[type].splice(idx, 1);
      if (type === 'text') groupMessages.delete(req.params.channelId);
    }
  });

  broadcastToGroup(group.id, { type: 'group_channel_deleted', groupId: group.id, channelId: req.params.channelId });
  res.json({ ok: true });
});

// ── Сообщения канала ──
app.get('/api/groups/:groupId/channels/:channelId/messages', authMiddleware, (req, res) => {
  const group = groups.get(req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Группа не найдена' });
  if (!group.members.some(m => m.userId === req.userId)) return res.status(403).json({ error: 'Нет доступа' });

  const messages = groupMessages.get(req.params.channelId) || [];
  const messagesWithUsers = messages.map(m => ({ ...m, sender: getUserSafe(users.get(m.senderId)) }));
  res.json({ messages: messagesWithUsers });
});

app.post('/api/groups/:groupId/channels/:channelId/messages', authMiddleware, checkMute, (req, res) => {
  const { text, attachments, duplicateToNews } = req.body;
  const group = groups.get(req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Группа не найдена' });
  if (!group.members.some(m => m.userId === req.userId)) return res.status(403).json({ error: 'Нет доступа' });

  const channel = [...group.channels.text, ...group.channels.voice].find(c => c.id === req.params.channelId);
  if (!channel) return res.status(404).json({ error: 'Канал не найден' });

  const message = {
    id: generateId(),
    senderId: req.userId,
    text,
    attachments: attachments || [],
    edited: false,
    timestamp: Date.now(),
  };

  if (!groupMessages.has(req.params.channelId)) groupMessages.set(req.params.channelId, []);
  groupMessages.get(req.params.channelId).push(message);

  broadcastToGroup(group.id, {
    type: 'group_message',
    groupId: group.id,
    channelId: req.params.channelId,
    message: { ...message, sender: getUserSafe(req.user) },
  });

  // Дублирование в новости
  if (duplicateToNews) {
    const newsId = generateId();
    const newsItem = {
      id: newsId,
      authorId: req.userId,
      groupId: group.id,
      groupName: group.name,
      text,
      media: attachments || [],
      timestamp: Date.now(),
    };
    news.set(newsId, newsItem);
  }

  res.json({ message });
});

app.put('/api/groups/:groupId/channels/:channelId/messages/:msgId', authMiddleware, (req, res) => {
  const { text } = req.body;
  const messages = groupMessages.get(req.params.channelId);
  if (!messages) return res.status(404).json({ error: 'Канал не найден' });

  const msg = messages.find(m => m.id === req.params.msgId);
  if (!msg) return res.status(404).json({ error: 'Сообщение не найдено' });
  if (msg.senderId !== req.userId) return res.status(403).json({ error: 'Нельзя редактировать чужое сообщение' });

  msg.text = text;
  msg.edited = true;

  const group = groups.get(req.params.groupId);
  broadcastToGroup(group.id, {
    type: 'group_message_edited',
    groupId: group.id,
    channelId: req.params.channelId,
    message: msg,
  });
  res.json({ message: msg });
});

app.delete('/api/groups/:groupId/channels/:channelId/messages/:msgId', authMiddleware, (req, res) => {
  const group = groups.get(req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Группа не найдена' });

  const messages = groupMessages.get(req.params.channelId);
  if (!messages) return res.status(404).json({ error: 'Канал не найден' });

  const idx = messages.findIndex(m => m.id === req.params.msgId);
  if (idx === -1) return res.status(404).json({ error: 'Сообщение не найдено' });

  const msg = messages[idx];
  const member = group.members.find(m => m.userId === req.userId);
  if (!member) return res.status(403).json({ error: 'Нет доступа' });

  const canDelete = msg.senderId === req.userId || member.role === 'owner' || member.role === 'moderator';
  if (!canDelete) return res.status(403).json({ error: 'Нет прав на удаление' });

  messages.splice(idx, 1);
  broadcastToGroup(group.id, { type: 'group_message_deleted', groupId: group.id, channelId: req.params.channelId, messageId: req.params.msgId });
  res.json({ ok: true });
});

// ── Роли ──
app.post('/api/groups/:groupId/roles', authMiddleware, (req, res) => {
  const { name, permissions } = req.body;
  const group = groups.get(req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Группа не найдена' });
  if (group.owner !== req.userId) return res.status(403).json({ error: 'Только владелец может управлять ролями' });

  const roleId = generateId();
  group.roles[roleId] = { name, permissions };

  res.json({ roleId, role: group.roles[roleId] });
});

app.put('/api/groups/:groupId/members/:userId/role', authMiddleware, (req, res) => {
  const { role } = req.body;
  const group = groups.get(req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Группа не найдена' });
  if (group.owner !== req.userId) return res.status(403).json({ error: 'Только владелец может менять роли' });

  const member = group.members.find(m => m.userId === req.params.userId);
  if (!member) return res.status(404).json({ error: 'Участник не найден' });

  member.role = role;
  broadcastToGroup(group.id, { type: 'group_member_role_changed', groupId: group.id, userId: req.params.userId, role });
  res.json({ ok: true });
});

// ──────────────────────────────────────────────
// NEWS
// ──────────────────────────────────────────────
app.get('/api/news', authMiddleware, (req, res) => {
  const newsList = [];
  for (const item of news.values()) {
    newsList.push({
      ...item,
      author: getUserSafe(users.get(item.authorId)),
    });
  }
  newsList.sort((a, b) => b.timestamp - a.timestamp);
  res.json({ news: newsList });
});

app.post('/api/news', authMiddleware, checkMute, (req, res) => {
  const { text, media } = req.body;
  if (!text) return res.status(400).json({ error: 'Текст обязателен' });

  const newsId = generateId();
  const newsItem = {
    id: newsId,
    authorId: req.userId,
    text,
    media: media || [],
    timestamp: Date.now(),
  };
  news.set(newsId, newsItem);

  res.json({ news: { ...newsItem, author: getUserSafe(req.user) } });
});

// ──────────────────────────────────────────────
// RADIO
// ──────────────────────────────────────────────
app.get('/api/radio', authMiddleware, (req, res) => {
  res.json({ stations: radioStations });
});

// ──────────────────────────────────────────────
// MODERATION
// ──────────────────────────────────────────────
app.post('/api/mod/mute', authMiddleware, (req, res) => {
  const { userId, reason, duration } = req.body;
  if (req.user.role !== 'moderator' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Нет прав модератора' });
  }

  const target = users.get(userId);
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });

  const minutes = Math.min(Math.max(parseInt(duration) || 1, 1), 9999);
  target.muted = true;
  target.muteUntil = Date.now() + minutes * 60 * 1000;
  target.muteReason = reason || 'Нарушение правил';

  sendToUser(userId, {
    type: 'muted',
    muteUntil: target.muteUntil,
    muteReason: target.muteReason,
  });

  res.json({ ok: true, user: getUserSafe(target) });
});

app.post('/api/mod/unmute', authMiddleware, (req, res) => {
  const { userId } = req.body;
  if (req.user.role !== 'moderator' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Нет прав модератора' });
  }

  const target = users.get(userId);
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });

  target.muted = false;
  target.muteUntil = 0;
  target.muteReason = '';

  sendToUser(userId, { type: 'unmuted' });
  res.json({ ok: true, user: getUserSafe(target) });
});

app.post('/api/mod/violation', authMiddleware, (req, res) => {
  const { targetId, reason } = req.body;
  const violationId = generateId();
  const violation = {
    id: violationId,
    reporterId: req.userId,
    targetId,
    reason: reason || 'Нарушение правил',
    timestamp: Date.now(),
    resolved: false,
  };
  violations.set(violationId, violation);
  res.json({ violation });
});

app.get('/api/mod/violations', authMiddleware, (req, res) => {
  if (req.user.role !== 'moderator' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Нет прав модератора' });
  }
  const list = [];
  for (const v of violations.values()) {
    list.push({
      ...v,
      reporter: getUserSafe(users.get(v.reporterId)),
      target: getUserSafe(users.get(v.targetId)),
    });
  }
  list.sort((a, b) => b.timestamp - a.timestamp);
  res.json({ violations: list });
});

app.get('/api/mod/muted', authMiddleware, (req, res) => {
  if (req.user.role !== 'moderator' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Нет прав модератора' });
  }
  const mutedUsers = [];
  for (const u of users.values()) {
    if (u.muted && u.muteUntil > Date.now()) {
      mutedUsers.push(getUserSafe(u));
    }
  }
  res.json({ muted: mutedUsers });
});

// ── Верификация сообществ ──
app.post('/api/mod/verification/request', authMiddleware, (req, res) => {
  const { groupId } = req.body;
  const group = groups.get(groupId);
  if (!group) return res.status(404).json({ error: 'Группа не найдена' });
  if (group.owner !== req.userId) return res.status(403).json({ error: 'Только владелец может запросить верификацию' });

  const existing = [...verificationRequests.values()].find(v => v.groupId === groupId && v.status === 'pending');
  if (existing) return res.status(400).json({ error: 'Заявка уже подана' });

  const requestId = generateId();
  verificationRequests.set(requestId, {
    id: requestId,
    groupId,
    groupName: group.name,
    requestedBy: req.userId,
    timestamp: Date.now(),
    status: 'pending',
  });

  res.json({ ok: true, requestId });
});

app.get('/api/mod/verification', authMiddleware, (req, res) => {
  if (req.user.role !== 'moderator' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Нет прав модератора' });
  }
  const list = [];
  for (const v of verificationRequests.values()) {
    if (v.status === 'pending') {
      list.push({
        ...v,
        group: groups.get(v.groupId) ? { id: groups.get(v.groupId).id, name: groups.get(v.groupId).name, avatar: groups.get(v.groupId).avatar } : null,
        requestedByUser: getUserSafe(users.get(v.requestedBy)),
      });
    }
  }
  list.sort((a, b) => b.timestamp - a.timestamp);
  res.json({ requests: list });
});

app.post('/api/mod/verification/:requestId/:action', authMiddleware, (req, res) => {
  if (req.user.role !== 'moderator' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Нет прав модератора' });
  }

  const v = verificationRequests.get(req.params.requestId);
  if (!v) return res.status(404).json({ error: 'Заявка не найдена' });

  if (req.params.action === 'approve') {
    v.status = 'approved';
    const group = groups.get(v.groupId);
    if (group) group.verified = true;
    sendToUser(v.requestedBy, { type: 'verification_approved', groupId: v.groupId });
  } else if (req.params.action === 'reject') {
    v.status = 'rejected';
    sendToUser(v.requestedBy, { type: 'verification_rejected', groupId: v.groupId });
  }

  res.json({ ok: true });
});

// ──────────────────────────────────────────────
// USER ROLE (глобальная)
// ──────────────────────────────────────────────
app.put('/api/admin/user/:userId/role', authMiddleware, (req, res) => {
  const { role } = req.body;
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Нет прав администратора' });

  const target = users.get(req.params.userId);
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });

  target.role = role;
  res.json({ ok: true, user: getUserSafe(target) });
});

// ──────────────────────────────────────────────
// WebSocket
// ──────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');

  if (!token) {
    ws.close();
    return;
  }

  const userId = sessions.get(token);
  if (!userId) {
    ws.close();
    return;
  }

  if (!wsClients.has(userId)) wsClients.set(userId, new Set());
  wsClients.get(userId).add(ws);
  ws.userId = userId;

  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    switch (data.type) {
      // WebRTC сигналинг
      case 'call_offer': {
        sendToUser(data.targetUserId, {
          type: 'call_offer',
          fromUserId: userId,
          fromUser: getUserSafe(users.get(userId)),
          sdp: data.sdp,
        });
        break;
      }

      case 'call_answer': {
        sendToUser(data.targetUserId, {
          type: 'call_answer',
          fromUserId: userId,
          sdp: data.sdp,
        });
        break;
      }

      case 'call_ice': {
        sendToUser(data.targetUserId, {
          type: 'call_ice',
          fromUserId: userId,
          candidate: data.candidate,
        });
        break;
      }

      case 'call_reject': {
        sendToUser(data.targetUserId, { type: 'call_reject', fromUserId: userId });
        break;
      }

      case 'call_end': {
        sendToUser(data.targetUserId, { type: 'call_end', fromUserId: userId });
        break;
      }

      // Голосовой канал группы
      case 'voice_channel_join': {
        const group = groups.get(data.groupId);
        if (!group) return;
        broadcastToGroup(group.id, {
          type: 'voice_channel_user_joined',
          groupId: data.groupId,
          channelId: data.channelId,
          userId,
        });
        break;
      }

      case 'voice_channel_leave': {
        const group = groups.get(data.groupId);
        if (!group) return;
        broadcastToGroup(group.id, {
          type: 'voice_channel_user_left',
          groupId: data.groupId,
          channelId: data.channelId,
          userId,
        });
        break;
      }

      case 'voice_channel_offer': {
        sendToUser(data.targetUserId, {
          type: 'voice_channel_offer',
          fromUserId: userId,
          groupId: data.groupId,
          channelId: data.channelId,
          sdp: data.sdp,
        });
        break;
      }

      case 'voice_channel_answer': {
        sendToUser(data.targetUserId, {
          type: 'voice_channel_answer',
          fromUserId: userId,
          channelId: data.channelId,
          sdp: data.sdp,
        });
        break;
      }

      case 'voice_channel_ice': {
        sendToUser(data.targetUserId, {
          type: 'voice_channel_ice',
          fromUserId: userId,
          candidate: data.candidate,
        });
        break;
      }

      // Набор текста
      case 'typing': {
        const chat = chats.get(data.chatId);
        if (chat) {
          chat.participants.forEach(uid => {
            if (uid !== userId) sendToUser(uid, { type: 'typing', chatId: data.chatId, userId });
          });
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    const clients = wsClients.get(userId);
    if (clients) {
      clients.delete(ws);
      if (clients.size === 0) wsClients.delete(userId);
    }
  });
});

// ──────────────────────────────────────────────
// Запуск
// ──────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер мессенджера запущен на http://localhost:${PORT}`);
});
