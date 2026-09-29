const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 20 * 1024 * 1024
});

app.use(express.static('public'));

const DB_FILE = path.join(__dirname, 'database.json');

function loadDatabase() {
    if (fs.existsSync(DB_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
            return {
                pendingCodes: data.pendingCodes || {},
                registeredUsers: data.registeredUsers || {},
                groups: data.groups || [],
                communities: data.communities || [],
                messages: data.messages || {},
                mutedChats: data.mutedChats || {} // { phone: [chatId1, chatId2] }
            };
        } catch (e) {
            console.error('Ошибка чтения базы данных, создаем новую:', e);
        }
    }
    return {
        pendingCodes: {},
        registeredUsers: {},
        groups: [],
        communities: [],
        messages: {},
        mutedChats: {}
    };
}

function saveDatabase() {
    const data = {
        pendingCodes,
        registeredUsers,
        groups,
        communities,
        messages,
        mutedChats
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

let db = loadDatabase();
let pendingCodes = db.pendingCodes;
let registeredUsers = db.registeredUsers;
let groups = db.groups;
let communities = db.communities;
let messages = db.messages;
let mutedChats = db.mutedChats;

io.on('connection', (socket) => {
    let currentPhone = null;

    socket.on('register_session', ({ phone, name }) => {
        currentPhone = phone;
        registeredUsers[phone] = { name, phone };
        saveDatabase();

        socket.join(phone);

        // Отправляем всю необходимую информацию клиенту
        socket.emit('all_messages', messages);
        socket.emit('groups_list', groups);
        socket.emit('communities_list', communities);
        socket.emit('muted_chats_list', mutedChats[phone] || []);
    });

    socket.on('private_message', ({ toPhone, message }) => {
        if (!currentPhone) return;
        const chatKey = currentPhone === toPhone ? `${currentPhone}_${currentPhone}` : [currentPhone, toPhone].sort().join('_');
        
        if (!messages[chatKey]) messages[chatKey] = [];
        
        const msgData = {
            fromPhone: currentPhone,
            fromName: registeredUsers[currentPhone]?.name || currentPhone,
            text: message,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            type: 'private'
        };
        
        messages[chatKey].push(msgData);
        saveDatabase();

        io.to(currentPhone).emit('message', msgData);
        if (currentPhone !== toPhone) {
            io.to(toPhone).emit('message', msgData);
        }
    });

    socket.on('group_message', ({ groupId, message }) => {
        if (!currentPhone) return;
        const chatKey = `group_${groupId}`;
        if (!messages[chatKey]) messages[chatKey] = [];

        const msgData = {
            fromPhone: currentPhone,
            fromName: registeredUsers[currentPhone]?.name || currentPhone,
            text: message,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            type: 'group',
            groupId
        };

        messages[chatKey].push(msgData);
        saveDatabase();

        const group = groups.find(g => g.id == groupId);
        if (group && group.members) {
            group.members.forEach(memberPhone => {
                io.to(memberPhone).emit('message', msgData);
            });
        }
    });

    socket.on('community_message', ({ communityId, message }) => {
        if (!currentPhone) return;
        const chatKey = `community_${communityId}`;
        if (!messages[chatKey]) messages[chatKey] = [];

        const msgData = {
            fromPhone: currentPhone,
            fromName: registeredUsers[currentPhone]?.name || currentPhone,
            text: message,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            type: 'community',
            communityId
        };

        messages[chatKey].push(msgData);
        saveDatabase();

        const com = communities.find(c => c.id == communityId);
        if (com && com.subscribers) {
            com.subscribers.forEach(subPhone => {
                io.to(subPhone).emit('message', subPhone); // исправление рассылки
            });
            // Правильная рассылка всем подписчикам
            com.subscribers.forEach(subPhone => {
                io.to(subPhone).emit('message', msgData);
            });
        }
    });

    socket.on('create_group', ({ name, members, creator }) => {
        const newGroup = {
            id: Date.now(),
            name,
            members,
            creator,
            avatar: ''
        };
        groups.push(newGroup);
        saveDatabase();

        io.emit('groups_list', groups);
    });

    socket.on('create_community', ({ name, creator }) => {
        const newCommunity = {
            id: Date.now(),
            name,
            subscribers: [creator],
            creator,
            avatar: ''
        };
        communities.push(newCommunity);
        saveDatabase();

        io.emit('communities_list', communities);
    });

    socket.on('toggle_mute_chat', ({ chatId }) => {
        if (!currentPhone) return;
        if (!mutedChats[currentPhone]) mutedChats[currentPhone] = [];

        const index = mutedChats[currentPhone].indexOf(chatId);
        let isMuted = false;
        if (index > -1) {
            mutedChats[currentPhone].splice(index, 1);
            isMuted = false;
        } else {
            mutedChats[currentPhone].push(chatId);
            isMuted = true;
        }
        saveDatabase();
        socket.emit('chat_mute_status', { chatId, isMuted });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
