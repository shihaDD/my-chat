const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Раздаем статические файлы из папки public
app.use(express.static('public'));

// Список подключенных пользователей
const users = {};

io.on('connection', (socket) => {
    console.log('Пользователь подключился:', socket.id);

    // Регистрация или верификация пользователя
    socket.on('verify_code', (data) => {
        const { phone, name } = data;
        if (!phone || !name) return;

        users[phone] = { socketId: socket.id, phone, name };
        socket.userPhone = phone;

        console.log(`Пользователь вошел: ${name} (${phone})`);
        io.emit('users_list', Object.values(users));
    });

    // Обновление профиля пользователя
    socket.on('update_profile', (data) => {
        const { oldPhone, phone, name } = data;
        if (!phone || !name) return;

        // Если номер телефона изменился, удаляем старый ключ
        if (oldPhone && oldPhone !== phone && users[oldPhone]) {
            delete users[oldPhone];
        }

        users[phone] = { socketId: socket.id, phone, name };
        socket.userPhone = phone;

        console.log(`Профиль обновлен: ${name} (${phone})`);
        io.emit('users_list', Object.values(users));
    });

    // Пересылка личных сообщений между пользователями
    socket.on('private_message', (data) => {
        const { toPhone, message } = data;
        const recipient = users[toPhone];

        if (recipient && socket.userPhone) {
            const sender = users[socket.userPhone];
            const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            io.to(recipient.socketId).emit('message', {
                fromPhone: socket.userPhone,
                fromName: sender ? sender.name : 'Неизвестный',
                text: message,
                time: time
            });
        }
    });

    // Отключение пользователя
    socket.on('disconnect', () => {
        if (socket.userPhone && users[socket.userPhone]) {
            console.log(`Пользователь отключился: ${users[socket.userPhone].name} (${socket.userPhone})`);
            delete users[socket.userPhone];
            io.emit('users_list', Object.values(users));
        } else {
            console.log('Пользователь отключился:', socket.id);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
