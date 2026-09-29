const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const pendingCodes = {}; 
const users = {};        
const activeUsers = {};  
const groups = [];       
const communities = [];  
const messages = {};     

io.on('connection', (socket) => {
    console.log('Пользователь подключился:', socket.id);

    socket.on('request_code', ({ phone }) => {
        const code = Math.floor(1000 + Math.random() * 9000).toString();
        pendingCodes[phone] = code;
        
        // Отправляем код клиенту для отображения вверху экрана
        socket.emit('code_sent_debug', { code });
    });

    socket.on('verify_code', ({ name, phone, code }) => {
        if (pendingCodes[phone] && pendingCodes[phone] === code) {
            delete pendingCodes[phone];
            users[socket.id] = { name, phone };
            activeUsers[phone] = socket.id;

            socket.emit('verification_result', { success: true });
            updateAllLists();
            socket.emit('all_messages', messages);
        } else {
            socket.emit('verification_result', { success: false, message: 'Неверный код подтверждения!' });
        }
    });

    socket.on('add_contact', ({ myPhone, targetPhone }) => {
        if (targetPhone === myPhone) {
            socket.emit('add_contact_response', { success: false, message: 'Нельзя добавить свой номер!' });
            return;
        }
        socket.emit('add_contact_response', { success: true, message: 'Контакт успешно добавлен!' });
        updateAllLists();
    });

    socket.on('create_group', ({ name, members, creator }) => {
        const groupId = 'group_' + Date.now();
        const newGroup = { id: groupId, name, members, creator };
        groups.push(newGroup);
        updateAllLists();
    });

    socket.on('create_community', ({ name, description, creator }) => {
        const comId = 'com_' + Date.now();
        const newCom = { id: comId, name, description, creator, subscribersCount: 1 };
        communities.push(newCom);
        updateAllLists();
    });

    socket.on('private_message', ({ toPhone, message }) => {
        const sender = users[socket.id];
        if (!sender) return;

        const chatKey = [sender.phone, toPhone].sort().join('_');
        if (!messages[chatKey]) messages[chatKey] = [];

        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const msgData = { fromPhone: sender.phone, fromName: sender.name, text: message, time };
        
        messages[chatKey].push(msgData);

        const targetSocketId = activeUsers[toPhone];
        if (targetSocketId) {
            io.to(targetSocketId).emit('message', msgData);
        }
    });

    socket.on('group_message', ({ groupId, message }) => {
        const sender = users[socket.id];
        if (!sender) return;

        const chatKey = `group_${groupId}`;
        if (!messages[chatKey]) messages[chatKey] = [];

        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const msgData = { groupId, fromPhone: sender.phone, fromName: sender.name, text: message, time, type: 'group' };
        
        messages[chatKey].push(msgData);

        const group = groups.find(g => g.id === groupId);
        if (group) {
            group.members.forEach(phone => {
                const sId = activeUsers[phone];
                if (sId) io.to(sId).emit('message', msgData);
            });
        }
    });

    socket.on('community_message', ({ communityId, message }) => {
        const sender = users[socket.id];
        if (!sender) return;

        const chatKey = `community_${communityId}`;
        if (!messages[chatKey]) messages[chatKey] = [];

        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const msgData = { communityId, fromPhone: sender.phone, fromName: sender.name, text: message, time, type: 'community' };
        
        messages[chatKey].push(msgData);

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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
