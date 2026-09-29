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

    // Обработка входа / подтверждения (клиент теперь генерирует код сам, 
    // поэтому сервер просто регистрирует пользователя по телефону и имени)
    socket.on('verify_code', (data) => {
        const { phone, name } = data;
        if (!phone || !name) return;

        // Сохраняем пользователя в общем списке по его номеру телефона
        users[phone] = { socketId: socket.id, phone, name };
        socket.userPhone = phone;

        console.log(`Пользователь вошел: ${name} (${phone})`);

        // Рассылаем обновленный список всех пользователей всем клиентам
        io.emit('users_list', Object.values(users));
    });

    // Пересылка личных сообщений между пользователями
    socket.on('private_message', (data) => {
        const { toPhone, message } = data;
        const recipient = users[toPhone];

        if (recipient && socket.userPhone) {
            const sender = users[socket.userPhone];
            const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            // Отправляем сообщение получателю
            io.to(recipient.socketId).emit('message', {
                fromPhone: socket.userPhone,
                fromName: sender ? sender.name : 'Неизвестный',
                text: message,
                time: time
            });
        }
    });

    // Обработка отключения пользователя
    socket.on('disconnect', () => {
        if (socket.userPhone && users[socket.userPhone]) {
            console.log(`Пользователь отключился: ${users[socket.userPhone].name} (${socket.userPhone})`);
            delete users[socket.userPhone];
            // Обновляем список пользователей у остальных
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
