const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static(path.join(__dirname, 'public')));

const users = {}; // socket.id -> номер телефона

io.on('connection', (socket) => {
    console.log('Пользователь подключился:', socket.id);

    // Регистрация по номеру телефона
    socket.on('register', (phone, callback) => {
        const cleanPhone = phone.replace(/\D/g, ''); // убираем всё лишнее для проверки
        if (cleanPhone.length < 10) {
            return callback({ success: false, message: 'Введите корректный номер телефона!' });
        }
        
        users[socket.id] = phone.trim();
        socket.phone = phone.trim();
        
        callback({ success: true, phone: socket.phone });
        updateUsersList();
    });

    // Обработка личных сообщений
    socket.on('private_message', (data) => {
        // data = { to: 'номер_получателя', message: 'текст' }
        const recipientSocketId = Object.keys(users).find(
            key => users[key] === data.to
        );

        if (recipientSocketId) {
            io.to(recipientSocketId).emit('message', {
                from: socket.phone,
                text: data.message,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('Пользователь отключился:', socket.id);
        delete users[socket.id];
        updateUsersList();
    });

    function updateUsersList() {
        const userList = Object.values(users);
        io.emit('users_list', userList);
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
