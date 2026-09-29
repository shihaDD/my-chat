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
        
        // Проверяем, есть ли уже пользователь с таким телефоном, обновляем или добавляем
        const existingUserIndex = users.findIndex(u => u.phone === userData.phone);
        if (existingUserIndex !== -1) {
            users[existingUserIndex] = { ...userData, id: socket.id };
        } else {
            users.push({ ...userData, id: socket.id });
        }

        // Рассылаем обновленный список пользователей всем
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
        // data.toPhone — кому отправляем, data.message — текст
        const recipient = users.find(u => u.phone === data.toPhone);
        const sender = users.find(u => u.id === socket.id);

        if (recipient && sender) {
            const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            // 1. Отправляем само сообщение получателю
            io.to(recipient.id).emit('message', {
                fromPhone: sender.phone,
                text: data.message,
                time: time
            });

            // 2. Сразу меняем статус отправленного сообщения на "доставлено" (delivered), 
            // так как сервер его принял и переслал активному получателю
            socket.emit('message_status_update', {
                toPhone: recipient.phone,
                status: 'delivered'
            });
        }
    });

    // Событие: получатель открыл чат и прочитал сообщения
    socket.on('mark_as_read', (data) => {
        // data.fromPhone — чьи сообщения были прочитаны (кто отправил изначально)
        const sender = users.find(u => u.phone === data.fromPhone);
        const reader = users.find(u => u.id === socket.id);

        if (sender && reader) {
            // Уведомляем исходного отправителя о том, что его сообщения прочитаны
            io.to(sender.id).emit('message_status_update', {
                toPhone: reader.phone, // для отправителя это тот человек, с кем чат
                status: 'read'
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('Пользователь отключился:', socket.id);
        users = users.filter(u => u.id !== socket.id);
        io.emit('users_list', users);
    });
});

server.listen(3000, () => {
    console.log('Сервер запущен на http://localhost:3000');
});
