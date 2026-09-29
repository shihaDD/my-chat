const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let users = [];

io.on('connection', (socket) => {
    console.log('Пользователь подключился:', socket.id);

    // Авторизация / вход пользователя
    socket.on('verify_code', (userData) => {
        socket.userPhone = userData.phone;
        
        // Ищем существующего пользователя по номеру телефона
        let existingUser = users.find(u => u.phone === userData.phone);

        if (existingUser) {
            // Обновляем данные и ставим статус "онлайн"
            existingUser.id = socket.id;
            existingUser.name = userData.name;
            if (userData.avatar) existingUser.avatar = userData.avatar;
            existingUser.isOnline = true;
        } else {
            // Добавляем нового пользователя
            users.push({
                phone: userData.phone,
                name: userData.name,
                avatar: userData.avatar || null,
                id: socket.id,
                isOnline: true,
                lastSeen: null
            });
        }

        // Рассылаем актуальный список всем клиентам
        io.emit('users_list', users);
    });

    // Обновление профиля
    socket.on('update_profile', (data) => {
        const user = users.find(u => u.phone === data.oldPhone || u.phone === data.phone);
        if (user) {
            user.name = data.name;
            user.phone = data.phone;
            user.avatar = data.avatar;
            socket.userPhone = data.phone;
            io.emit('users_list', users);
        }
    });

    // Отправка личного сообщения
    socket.on('private_message', (data) => {
        const recipient = users.find(u => u.phone === data.toPhone);
        const sender = users.find(u => u.id === socket.id);

        if (recipient && sender) {
            const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            io.to(recipient.id).emit('message', {
                fromPhone: sender.phone,
                text: data.message,
                time: time
            });

            socket.emit('message_status_update', {
                toPhone: recipient.phone,
                status: 'delivered'
            });
        }
    });

    // Прочтение сообщений
    socket.on('mark_as_read', (data) => {
        const sender = users.find(u => u.phone === data.fromPhone);
        const reader = users.find(u => u.id === socket.id);

        if (sender && reader) {
            io.to(sender.id).emit('message_status_update', {
                toPhone: reader.phone,
                status: 'read'
            });
        }
    });

    // При отключении не удаляем пользователя, а переводим в офлайн и сохраняем время
    socket.on('disconnect', () => {
        console.log('Пользователь отключился:', socket.id);
        const user = users.find(u => u.id === socket.id);
        if (user) {
            user.isOnline = false;
            user.lastSeen = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            user.id = null; // сбрасываем сокет-id
        }
        io.emit('users_list', users);
    });
});

server.listen(3000, () => {
    console.log('Сервер запущен на http://localhost:3000');
});
