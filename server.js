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

// Базы данных в памяти
const users = new Map(); // username -> { password, nickname }
const friendships = new Map(); // username -> Set of friend usernames
const incomingRequests = new Map(); // username -> Set of pending requests
const outgoingRequests = new Map(); // username -> Set of sent requests
const customNames = new Map(); // "user1:user2" -> customNickname
const communities = new Map(); // communityId -> { id, name, creator, members: Map(username -> role) }
const messages = []; // Сообщения общего чата
const feedItems = []; // Лента

// Инициализация ленты
for (let i = 1; i <= 5; i++) {
  feedItems.push({
    id: i,
    type: i % 2 === 0 ? 'video' : 'image',
    url: i % 2 === 0 ? 'https://www.w3schools.com/html/mov_bbb.mp4' : `https://picsum.photos/seed/meme${i}/400/600`,
    caption: `Мем / Видео #${i} в ленте`,
    author: 'Система',
    likes: i * 5
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
      communities: getCommunitiesList()
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

  // Управление сообществами и ролями (Создатель, Админ, Участник)
  socket.on('create_community', ({ name }) => {
    const user = socket.data.username;
    if (!name) return;
    const communityId = 'comm_' + Date.now();
    const membersMap = new Map();
    membersMap.set(user, 'creator'); // Создатель

    communities.set(communityId, {
      id: communityId,
      name,
      creator: user,
      members: membersMap
    });

    io.to('main-room').emit('communities_updated', getCommunitiesList());
  });

  socket.on('join_community', ({ communityId }) => {
    const user = socket.data.username;
    const comm = communities.get(communityId);
    if (comm && !comm.members.has(user)) {
      comm.members.set(user, 'member'); // Участник по умолчанию
      io.to('main-room').emit('communities_updated', getCommunitiesList());
      socket.emit('community_joined', getCommunityDetails(communityId));
    }
  });

  socket.on('leave_community', ({ communityId }) => {
    const user = socket.data.username;
    const comm = communities.get(communityId);
    if (comm && comm.members.has(user)) {
      if (comm.creator === user) {
        communities.delete(communityId); // Создатель удаляет сообщество
      } else {
        comm.members.delete(user);
      }
      io.to('main-room').emit('communities_updated', getCommunitiesList());
    }
  });

  socket.on('set_member_role', ({ communityId, targetUser, newRole }) => {
    const user = socket.data.username;
    const comm = communities.get(communityId);
    if (comm && comm.members.get(user) === 'creator') {
      if (comm.members.has(targetUser) && targetUser !== comm.creator) {
        comm.members.set(targetUser, newRole); // 'admin' или 'member'
        io.to('main-room').emit('communities_updated', getCommunitiesList());
        socket.emit('community_joined', getCommunityDetails(communityId));
      }
    }
  });

  socket.on('get_community_details', ({ communityId }) => {
    socket.emit('community_joined', getCommunityDetails(communityId));
  });

  // Сообщения чата
  socket.on('chat_message', (data) => {
    const msg = {
      id: Date.now(),
      sender: socket.data.username,
      text: data.text,
      image: data.image || null,
      timestamp: new Date().toLocaleTimeString()
    };
    messages.push(msg);
    io.to('main-room').emit('chat_message', msg);
  });

  // Индикаторы печати
  socket.on('typing_status', (statusData) => {
    socket.broadcast.to('main-room').emit('user_typing', {
      username: socket.data.username,
      ...statusData
    });
  });

  // Псевдонимы
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

  // WebRTC Звонки
  socket.on('webrtc_offer', (data) => {
    socket.to(data.target).emit('webrtc_offer', { offer: data.offer, sender: socket.data.username });
  });

  socket.on('webrtc_answer', (data) => {
    socket.to(data.target).emit('webrtc_answer', { answer: data.answer, sender: socket.data.username });
  });

  socket.on('webrtc_ice_candidate', (data) => {
    socket.to(data.target).emit('webrtc_ice_candidate', { candidate: data.candidate, sender: socket.data.username });
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

function getCommunitiesList() {
  const list = [];
  communities.forEach((comm, id) => {
    list.push({
      id,
      name: comm.name,
      creator: comm.creator,
      membersCount: comm.members.size
    });
  });
  return list;
}

function getCommunityDetails(communityId) {
  const comm = communities.get(communityId);
  if (!comm) return null;
  const membersArr = [];
  comm.members.forEach((role, username) => {
    membersArr.push({ username, role });
  });
  return {
    id: comm.id,
    name: comm.name,
    creator: comm.creator,
    members: membersArr
  };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
