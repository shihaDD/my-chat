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

const users = {}; // socket.id -> { phone, name }

io.on('connection', (socket) => {
    console.log('Пользователь подключился:', socket.id);

    // Регистрация по телефону и имени
    socket.on('register', (data, callback) => {
        // data = { phone, name }
        const cleanPhone = data.phone ? data.phone.replace(/\D/g, '') : '';
        const name = data.name ? data.name.trim() : '';

        if (cleanPhone.length < 10) {
            return callback({ success: false, message: 'Введите корректный номер телефона!' });
        }
        if (!name) {
            return callback({ success: false, message: 'Введите ваше имя!' });
        }
        
        users[socket.id] = { phone: data.phone.trim(), name: name };
        socket.userData = users[socket.id];
        
        callback({ success: true, user: users[socket.id] });
        updateUsersList();
    });

    // Обработка личных сообщений
    socket.on('private_message', (data) => {
        // data = { toPhone: 'номер', message: 'текст' }
        const recipientSocketId = Object.keys(users).find(
            key => users[key].phone === data.toPhone
        );

        if (recipientSocketId) {
            io.to(recipientSocketId).emit('message', {
                fromPhone: socket.userData.phone,
                fromName: socket.userData.name,
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
