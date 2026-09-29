const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// База данных в памяти
const users = new Map(); // username -> { password, nickname }
const friendships = new Map(); // username -> Set of friend usernames
const incomingRequests = new Map(); // username -> Set of pending requests
const outgoingRequests = new Map(); // username -> Set of sent requests
const customNames = new Map(); // "user1:user2" -> customNickname
const messages = []; // Сообщения общего чата
const feedItems = []; // Лента

// Инициализация стартовых элементов ленты
for (let i = 1; i <= 10; i++) {
  feedItems.push({
    id: i,
    type: i % 2 === 0 ? 'video' : 'image',
    url: i % 2 === 0 ? 'https://www.w3schools.com/html/mov_bbb.mp4' : `https://picsum.photos/seed/meme${i}/400/600`,
    caption: `Мем / Видео #${i} в ленте`,
    author: 'Система',
    likes: i * 5,
    comments: []
  });
}

// REST API: Регистрация
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Заполните все поля' });
  if (users.has(username)) return res.status(400).json({ error: 'Пользователь уже существует' });
  
  users.set(username, { password, nickname: username });
  friendships.set(username, new Set());
  incomingRequests.set(username, new Set());
  outgoingRequests.set(username, new Set());
  res.json({ success: true, username });
});

// REST API: Вход
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = users.get(username);
  if (!user || user.password !== password) {
    return res.status(400).json({ error: 'Неверный логин или пароль' });
  }
  res.json({ success: true, username, nickname: user.nickname });
});

// Socket.io соединения
io.on('connection', (socket) => {
  console.log('Пользователь подключился:', socket.id);

  socket.on('auth', ({ username }) => {
    socket.data.username = username;
    socket.join('main-room');
    socket.emit('init_data', {
      messages,
      feed: feedItems,
      users: Array.from(users.keys()).filter(u => u !== username)
    });
    broadcastUserData(socket);
  });

  // Заявки в друзья
  socket.on('send_friend_request', ({ targetUser }) => {
    const user = socket.data.username;
    if (users.has(targetUser) && user !== targetUser) {
      if (!incomingRequests.has(targetUser)) incomingRequests.set(targetUser, new Set());
      if (!outgoingRequests.has(user)) outgoingRequests.set(user, new Set());

      incomingRequests.get(targetUser).add(user);
      outgoingRequests.get(user).add(targetUser);
      broadcastUserData(socket);
    }
  });

  socket.on('accept_friend_request', ({ targetUser }) => {
    const user = socket.data.username;
    if (incomingRequests.has(user)) incomingRequests.get(user).delete(targetUser);
    if (outgoingRequests.has(targetUser)) outgoingRequests.get(targetUser).delete(user);

    if (!friendships.has(user)) friendships.set(user, new Set());
    if (!friendships.has(targetUser)) friendships.set(targetUser, new Set());
    friendships.get(user).add(targetUser);
    friendships.get(targetUser).add(user);

    broadcastUserData(socket);
  });

  // Сообщения чата
  socket.on('chat_message', (data) => {
    const msg = {
      id: Date.now(),
      sender: socket.data.username,
      recipient: data.recipient || null,
      text: data.text,
      image: data.image || null,
      timestamp: new Date().toLocaleTimeString()
    };
    messages.push(msg);
    io.to('main-room').emit('chat_message', msg);
  });

  // Индикаторы печати / отправки фото
  socket.on('typing_status', (statusData) => {
    socket.broadcast.to('main-room').emit('user_typing', {
      username: socket.data.username,
      ...statusData
    });
  });

  // Кастомное имя / псевдоним друга
  socket.on('set_custom_name', ({ targetUser, customName }) => {
    const user = socket.data.username;
    const key = `${user}:${targetUser}`;
    if (customName) {
      customNames.set(key, customName);
    } else {
      customNames.delete(key);
    }
    socket.emit('custom_name_updated', { targetUser, customName });
  });

  // WebRTC Сигнализация (Звонки)
  socket.on('webrtc_offer', (data) => {
    socket.to(data.target).emit('webrtc_offer', { offer: data.offer, sender: socket.data.username });
  });

  socket.on('webrtc_answer', (data) => {
    socket.to(data.target).emit('webrtc_answer', { answer: data.answer, sender: socket.data.username });
  });

  socket.on('webrtc_ice_candidate', (data) => {
    socket.to(data.target).emit('webrtc_ice_candidate', { candidate: data.candidate, sender: socket.data.username });
  });

  // Бесконечный скролл ленты
  socket.on('load_more_feed', () => {
    const lastId = feedItems.length > 0 ? feedItems[feedItems.length - 1].id : 0;
    const newItems = [];
    for (let i = 1; i <= 5; i++) {
      const id = lastId + i;
      newItems.push({
        id,
        type: id % 3 === 0 ? 'video' : 'image',
        url: id % 3 === 0 ? 'https://www.w3schools.com/html/mov_bbb.mp4' : `https://picsum.photos/seed/memeNew${id}/400/600`,
        caption: `Мем / Видео #${id} из ленты`,
        author: 'Автоподборка',
        likes: Math.floor(Math.random() * 50),
        comments: []
      });
    }
    feedItems.push(...newItems);
    io.emit('feed_updated', feedItems);
  });

  socket.on('like_feed_item', ({ itemId }) => {
    const item = feedItems.find(f => f.id === itemId);
    if (item) {
      item.likes++;
      io.emit('feed_updated', feedItems);
    }
  });

  socket.on('disconnect', () => {
    console.log('Пользователь отключился:', socket.id);
  });
});

function broadcastUserData(socket) {
  const currentUsername = socket.data.username;
  const friendSet = friendships.get(currentUsername) || new Set();
  const incomingSet = incomingRequests.get(currentUsername) || new Set();
  const outgoingSet = outgoingRequests.get(currentUsername) || new Set();
  
  const allUsers = Array.from(users.keys()).map(u => {
    const customKey = `${currentUsername}:${u}`;
    return {
      username: u,
      isFriend: friendSet.has(u),
      hasIncoming: incomingSet.has(u),
      hasOutgoing: outgoingSet.has(u),
      customName: customNames.get(customKey) || u
    };
  });
  
  io.to('main-room').emit('users_list', allUsers);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
