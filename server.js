const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 20 * 1024 * 1024 // Увеличен лимит для передачи файлов до 20 МБ
});

app.use(express.static('public'));

const pendingCodes = {}; 
const registeredUsers = {}; 
const activeUsers = {};     
const groups = [];       
const communities = [];  
const messages = {};     

io.on('connection', (socket) => {
    console.log('Пользователь подключился:', socket.id);

    socket.on('request_code', ({ phone }) => {
        const code = Math.floor(1000 + Math.random() * 9000).toString();
        pendingCodes[phone] = code;
        socket.emit('code_sent_debug', { code });
    });

    socket.on('verify_code', ({ name, phone, code }) => {
        if (pendingCodes[phone] && pendingCodes[phone] === code) {
            delete pendingCodes[phone];
            registeredUsers[phone] = { name, phone, isOnline: true };
            activeUsers[phone] = socket.id;

            socket.emit('verification_result', { success: true });
            socket.emit('all_messages', messages);
            updateAllLists();
        } else {
            socket.emit('verification_result', { success: false, message: 'Неверный код подтверждения!' });
        }
    });

    socket.on('register_session', ({ phone, name }) => {
        if (phone && name) {
            registeredUsers[phone] = { name, phone, isOnline: true };
            activeUsers[phone] = socket.id;
            updateAllLists();
        }
    });

    socket.on('check_contact', ({ phone }) => {
        const targetUser = registeredUsers[phone];
        if (targetUser) {
            socket.emit('contact_check_result', {
                exists: true,
                contact: { phone: targetUser.phone, name: targetUser.name, isOnline: !!activeUsers[phone] }
            });
        } else {
            socket.emit('contact_check_result', { exists: false });
        }
    });

    socket.on('create_group', ({ name, description, members, creator }) => {
        const groupId = 'group_' + Date.now();
        const newGroup = { id: groupId, name, description: description || '', avatar: '', members, creator };
        groups.push(newGroup);
        updateAllLists();
    });

    socket.on('create_community', ({ name, description, creator }) => {
        const comId = 'com_' + Date.now();
        const newCom = { id: comId, name, description: description || '', avatar: '', creator, subscribers: [creator] };
        communities.push(newCom);
        updateAllLists();
    });

    socket.on('update_group_info', ({ groupId, name, description, avatar, myPhone }) => {
        const group = groups.find(g => g.id === groupId);
        if (group && group.creator === myPhone) {
            group.name = name;
            group.description = description;
            if (avatar) group.avatar = avatar;
            updateAllLists();
            io.emit('group_updated', group);
        }
    });

    socket.on('update_community_info', ({ communityId, name, description, avatar, myPhone }) => {
        const com = communities.find(c => c.id === communityId);
        if (com && com.creator === myPhone) {
            com.name = name;
            com.description = description;
            if (avatar) com.avatar = avatar;
            updateAllLists();
            io.emit('community_updated', com);
        }
    });

    socket.on('add_group_member', ({ groupId, phone }) => {
        const group = groups.find(g => g.id === groupId);
        if (group && !group.members.includes(phone)) {
            group.members.push(phone);
            updateAllLists();
            io.emit('group_updated', group);
        }
    });

    socket.on('remove_group_member', ({ groupId, phone }) => {
        const group = groups.find(g => g.id === groupId);
        if (group) {
            group.members = group.members.filter(p => p !== phone);
            updateAllLists();
            io.emit('group_updated', group);
        }
    });

    socket.on('add_community_member', ({ communityId, phone }) => {
        const com = communities.find(c => c.id === communityId);
        if (com && !com.subscribers.includes(phone)) {
            com.subscribers.push(phone);
            updateAllLists();
            io.emit('community_updated', com);
        }
    });

    socket.on('remove_community_member', ({ communityId, phone }) => {
        const com = communities.find(c => c.id === communityId);
        if (com) {
            com.subscribers = com.subscribers.filter(p => p !== phone);
            updateAllLists();
            io.emit('community_updated', com);
        }
    });

    socket.on('private_message', ({ toPhone, message, file }) => {
        const senderSocketId = socket.id;
        let senderPhone = null;
        let senderName = 'Пользователь';

        for (const [phone, sId] of Object.entries(activeUsers)) {
            if (sId === senderSocketId) {
                senderPhone = phone;
                if (registeredUsers[phone]) senderName = registeredUsers[phone].name;
                break;
            }
        }

        if (!senderPhone) return;

        const chatKey = [senderPhone, toPhone].sort().join('_');
        if (!messages[chatKey]) messages[chatKey] = [];

        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const msgData = { fromPhone: senderPhone, fromName: senderName, text: message, file, time };
        
        messages[chatKey].push(msgData);

        const targetSocketId = activeUsers[toPhone];
        if (targetSocketId) {
            io.to(targetSocketId).emit('message', msgData);
        }
    });

    socket.on('group_message', ({ groupId, message, file }) => {
        let senderPhone = null;
        let senderName = 'Пользователь';

        for (const [phone, sId] of Object.entries(activeUsers)) {
            if (sId === socket.id) {
                senderPhone = phone;
                if (registeredUsers[phone]) senderName = registeredUsers[phone].name;
                break;
            }
        }

        if (!senderPhone) return;

        const chatKey = `group_${groupId}`;
        if (!messages[chatKey]) messages[chatKey] = [];

        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const msgData = { groupId, fromPhone: senderPhone, fromName: senderName, text: message, file, time, type: 'group' };
        
        messages[chatKey].push(msgData);

        const group = groups.find(g => g.id === groupId);
        if (group) {
            group.members.forEach(phone => {
                const sId = activeUsers[phone];
                if (sId) io.to(sId).emit('message', msgData);
            });
        }
    });

    socket.on('community_message', ({ communityId, message, file }) => {
        let senderPhone = null;
        let senderName = 'Пользователь';

        for (const [phone, sId] of Object.entries(activeUsers)) {
            if (sId === socket.id) {
                senderPhone = phone;
                if (registeredUsers[phone]) senderName = registeredUsers[phone].name;
                break;
            }
        }

        if (!senderPhone) return;

        const chatKey = `community_${communityId}`;
        if (!messages[chatKey]) messages[chatKey] = [];

        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const msgData = { communityId, fromPhone: senderPhone, fromName: senderName, text: message, file, time, type: 'community' };
        
        messages[chatKey].push(msgData);

        const com = communities.find(c => c.id === communityId);
        if (com) {
            com.subscribers.forEach(phone => {
                const sId = activeUsers[phone];
                if (sId) io.to(sId).emit('message', msgData);
            });
        }
    });

    socket.on('disconnect', () => {
        for (const [phone, sId] of Object.entries(activeUsers)) {
            if (sId === socket.id) {
                delete activeUsers[phone];
                if (registeredUsers[phone]) registeredUsers[phone].isOnline = false;
                break;
            }
        }
        updateAllLists();
    });
});

function updateAllLists() {
    io.emit('groups_list', groups);
    io.emit('communities_list', communities);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
