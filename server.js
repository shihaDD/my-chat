const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Хранилище временных кодов и данных пользователей
const pendingCodes = {}; // phone -> code
const users = {};        // socketId -> { name, phone }
const activeUsers = {};  // phone -> socketId
const groups = [];       // список групп
const communities = [];  // список сообществ
const messages = {};     // история сообщений

io.on('connection', (socket) => {
    console.log('Пользователь подключился:', socket.id);

    // Запрос кода подтверждения
    socket.on('request_code', ({ phone }) => {
        // Генерируем случайный 4-значный код
        const code = Math.floor(1000 + Math.random() * 9000).toString();
        pendingCodes[phone] = code;
        
        // Выводим код в консоль сервера (как в реальных сервисах по отправке SMS)
        console.log(`\n========================================`);
        console.log(`📱 КОД ПОДТВЕРЖДЕНИЯ ДЛЯ ${phone}: [ ${code} ]`);
        console.log(`========================================\n`);
    });

    // Проверка введенного кода
    socket.on('verify_code', ({ name, phone, code }) => {
        // Проверяем, совпадает ли код или является ли это авто-авторизацией (0000 для отладки, если нужно)
        if (pendingCodes[phone] && pendingCodes[phone] === code) {
            delete pendingCodes[phone];
            users[socket.id] = { name, phone };
            activeUsers[phone] = socket.id;

            socket.emit('verification_result', { success: true });
            
            // Рассылаем актуальные списки
            updateAllLists();
            
            // Передаем историю сообщений
            socket.emit('all_messages', messages);
        } else {
            socket.emit('verification_result', { success: false, message: 'Неверный код подтверждения!' });
        }
    });

    // Добавление контакта
    socket.on('add_contact', ({ myPhone, targetPhone }) => {
        if (targetPhone === myPhone) {
            socket.emit('add_contact_response', { success: false, message: 'Нельзя добавить свой номер!' });
            return;
        }
        socket.emit('add_contact_response', { success: true, message: 'Контакт успешно добавлен!' });
        updateAllLists();
    });

    // Создание группы
    socket.on('create_group', ({ name, members, creator }) => {
        const groupId = 'group_' + Date.now();
        const newGroup = { id: groupId, name, members, creator };
        groups.push(newGroup);
        updateAllLists();
    });

    // Создание сообщества
    socket.on('create_community', ({ name, description, creator }) => {
        const comId = 'com_' + Date.now();
        const newCom = { id: comId, name, description, creator, subscribersCount: 1 };
        communities.push(newCom);
        updateAllLists();
    });

    // Личные сообщения
    socket.on('private_message', ({ toPhone, message }) => {
        const sender = users[socket.id];
        if (!sender) return;

        const chatKey = [sender.phone, toPhone].sort().join('_');
        if (!messages[chatKey]) messages[chatKey] = [];

        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const msgData = { fromPhone: sender.phone, fromName: sender.name, text: message, time };
        
        messages[chatKey].push(msgData);

        // Отправка получателю, если он в сети
        const targetSocketId = activeUsers[toPhone];
        if (targetSocketId) {
            io.to(targetSocketId).emit('message', msgData);
        }
    });

    // Сообщения в группе
    socket.on('group_message', ({ groupId, message }) => {
        const sender = users[socket.id];
        if (!sender) return;

        const chatKey = `group_${groupId}`;
        if (!messages[chatKey]) messages[chatKey] = [];

        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const msgData = { groupId, fromPhone: sender.phone, fromName: sender.name, text: message, time, type: 'group' };
        
        messages[chatKey].push(msgData);

        // Рассылаем всем участникам группы
        const group = groups.find(g => g.id === groupId);
        if (group) {
            group.members.forEach(phone => {
                const sId = activeUsers[phone];
                if (sId) io.to(sId).emit('message', msgData);
            });
        }
    });

    // Сообщения в сообществе
    socket.on('community_message', ({ communityId, message }) => {
        const sender = users[socket.id];
        if (!sender) return;

        const chatKey = `community_${communityId}`;
        if (!messages[chatKey]) messages[chatKey] = [];

        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const msgData = { communityId, fromPhone: sender.phone, fromName: sender.name, text: message, time, type: 'community' };
        
        messages[chatKey].push(msgData);

        // Рассылаем всем подключенным клиентам (в рамках симуляции сообщества)
        Object.values(activeUsers).forEach(sId => {
            io.to(sId).emit('message', msgData);
        });
    });

    socket.on('disconnect', () => {
        const user = users[socket.id];
        if (user) {
            delete activeUsers[user.phone];
            delete users[socket.id];
            updateAllLists();
        }
        console.log('Пользователь отключился:', socket.id);
    });
});

function updateAllLists() {
    const contactsList = Object.values(users).map(u => ({
        phone: u.phone,
        name: u.name,
        isOnline: true
    }));

    io.emit('contacts_list', contactsList);
    io.emit('groups_list', groups);
    io.emit('communities_list', communities);
}

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});
