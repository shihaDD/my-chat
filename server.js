const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const users = {};

io.on('connection', (socket) => {
  let currentUser = null;

  socket.on('register', (username, callback) => {
    const name = (username || '').trim();
    if (!name) return callback({ success: false, message: 'Имя не может быть пустым' });
    if (users[name]) return callback({ success: false, message: 'Никнейм уже занят' });

    users[name] = socket.id;
    currentUser = name;
    callback({ success: true, username: name });
    io.emit('users_list', Object.keys(users));
  });

  socket.on('private_message', ({ to, message }) => {
    const targetSocketId = users[to];
    if (targetSocketId) {
      io.to(targetSocketId).emit('message', {
        from: currentUser,
        text: message,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    }
  });

  socket.on('disconnect', () => {
    if (currentUser) {
      delete users[currentUser];
      io.emit('users_list', Object.keys(users));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер запущен: http://localhost:${PORT}`));
