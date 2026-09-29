const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 20 * 1024 * 1024 // Поддержка больших файлов и аватарок
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
                mutedChats: data.mutedChats || {} // Хранилище заглушенных чатов: { phone: [chatId1, chatId2] }
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
const pendingCodes = db.pendingCodes;
const registeredUsers = db.registeredUsers;
const activeUsers = {}; 
let groups = db.groups;
let communities = db.communities;
const messages = db.messages;
const mutedChats = db.mutedChats;

// Функция для сохранения базы и рассылки актуальных списков и аватарок всем клиентам
function updateAllLists() {
    saveDatabase();
    io.emit('groups_list', groups);
    io.emit('communities_list', communities);
}

io.on('connection', (socket) => {
    console.log('Пользователь подключился:', socket.id);

    // При подключении сразу отправляем актуальные списки и аватарки
    socket.emit('groups_list', groups);
    socket.emit('communities_list', communities);

    function getPhoneBySocket(sId) {
        for (const [phone, id] of Object.entries(activeUsers)) {
            if (id === sId) return phone;
        }
        return null;
    }

    socket.on('request_code', ({ phone }) => {
        const code = Math.floor(1000 + Math.random() * 9000).toString();
        pendingCodes[phone] = code;
        saveDatabase();
        socket.emit('code_sent_debug', { code });
    });

    socket.on('verify_code', ({ name, phone, code }) => {
        if (pendingCodes[phone] && pendingCodes[phone] === code) {
            delete pendingCodes[phone];
            registeredUsers[phone] = { name, phone, isOnline: true };
            activeUsers[phone] = socket.id;
            socket.emit('verification_result', { success: true });
            socket.emit('all_messages', messages);
            socket.emit('muted_chats_list', mutedChats[phone] || []);
            updateAllLists();
        } else {
            socket.emit('verification_result', { success: false, message: 'Неверный код подтверждения!' });
        }
    });

    socket.on('register_session', ({ phone, name }) => {
        if (phone && name) {
            registeredUsers[phone] = { name, phone, isOnline: true };
            activeUsers[phone] = socket.id;
            socket.emit('muted_chats_list', mutedChats[phone] || []);
            updateAllLists();
        }
    });

    // --- УПРАВЛЕНИЕ УВЕДОМЛЕНИЯМИ (МЬЮТ / МУТ ДРУЗЕЙ, ГРУПП, СООБЩЕСТВ) ---
    socket.on('toggle_mute_chat', ({ chatId }) => {
        const phone = getPhoneBySocket(socket.id);
        if (!phone) return;

        if (!mutedChats[phone]) {
            mutedChats[phone] = [];
        }

        const index = mutedChats[phone].indexOf(chatId);
        let isMuted = false;

        if (index > -1) {
            mutedChats[phone].splice(index, 1);
            isMuted = false;
        } else {
            mutedChats[phone].push(chatId);
            isMuted = true;
        }

        saveDatabase();
        socket.emit('chat_mute_status', { chatId, isMuted });
    });

    socket.on('check_contact', ({ phone, autoAdd }) => {
        const targetUser = registeredUsers[phone];
        if (targetUser) {
            const contactData = { phone: targetUser.phone, name: targetUser.name, isOnline: !!activeUsers[phone] };
            socket.emit('contact_check_result', {
                exists: true,
                contact: contactData
            });
            if (autoAdd) {
                socket.emit('auto_added_contact', contactData);
            }
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

    socket.on('delete_group', ({ groupId, myPhone }) => {
        const group = groups.find(g => g.id === groupId);
        if (group && group.creator === myPhone) {
            groups = groups.filter(g => g.id !== groupId);
            delete messages[`group_${groupId}`];
            updateAllLists();
        }
    });

    socket.on('delete_community', ({ communityId, myPhone }) => {
        const com = communities.find(c => c.id === communityId);
        if (com && com.creator === myPhone) {
            communities = communities.filter(c => c.id !== communityId);
            delete messages[`community_${communityId}`];
            updateAllLists();
        }
    });

    socket.on('join_group_by_link', ({ groupId, myPhone }) => {
        const group = groups.find(g => g.id === groupId);
        if (group && !group.members.includes(myPhone)) {
            group.members.push(myPhone);
            updateAllLists();
            io.emit('group_updated', group);
        }
    });

    socket.on('join_community_by_link', ({ communityId, myPhone }) => {
        const com = communities.find(c => c.id === communityId);
        if (com && !com.subscribers.includes(myPhone)) {
            com.subscribers.push(myPhone);
            updateAllLists();
            io.emit('community_updated', com);
        }
    });

    // --- ОБНОВЛЕНИЕ ИНФОРМАЦИИ И АВАТАРОК ---
    socket.on('update_group_info', ({ groupId, name, description, avatar, myPhone }) => {
        const group = groups.find(g => g.id === groupId);
        if (group && group.creator === myPhone) {
            group.name = name;
            group.description = description;
            if (avatar !== undefined) group.avatar = avatar; // Сохраняем новую аватарку группы
            updateAllLists();
            io.emit('group_updated', group);
        }
    });

    socket.on('update_community_info', ({ communityId, name, description, avatar, myPhone }) => {
        const com = communities.find(c => c.id === communityId);
        if (com && com.creator === myPhone) {
            com.name = name;
            com.description = description;
            if (avatar !== undefined) com.avatar = avatar; // Сохраняем новую аватарку сообщества
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

    // --- ЛИЧНЫЕ СООБЩЕНИЯ И ИЗБРАННОЕ ---
    socket.on('private_message', ({ toPhone, message, file }) => {
        const senderPhone = getPhoneBySocket(socket.id);
        let senderName = 'Пользователь';
        if (senderPhone && registeredUsers[senderPhone]) {
            senderName = registeredUsers[senderPhone].name;
        }
        if (!senderPhone) return;

        // Если отправляем себе (Избранное) — фиксированный ключ, чтобы чат не очищался
        const chatKey = senderPhone === toPhone ? `${senderPhone}_${senderPhone}` : [senderPhone, toPhone].sort().join('_');

        if (!messages[chatKey]) messages[chatKey] = [];
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const msgData = { fromPhone: senderPhone, fromName: senderName, text: message, file, time };
                
        messages[chatKey].push(msgData);
        saveDatabase();

        const targetSocketId = activeUsers[toPhone];
        if (targetSocketId && senderPhone !== toPhone) {
            const recipientMuted = mutedChats[toPhone] && mutedChats[toPhone].includes(chatKey);
            io.to(targetSocketId).emit('message', { ...msgData, isMuted: recipientMuted });
        } else if (senderPhone === toPhone) {
            socket.emit('message', msgData);
        }
    });

    // --- СООБЩЕНИЯ ГРУПП ---
    socket.on('group_message', ({ groupId, message, file }) => {
        const senderPhone = getPhoneBySocket(socket.id);
        let senderName = 'Пользователь';
        if (senderPhone && registeredUsers[senderPhone]) {
            senderName = registeredUsers[senderPhone].name;
        }
        if (!senderPhone) return;

        const chatKey = `group_${groupId}`;
        if (!messages[chatKey]) messages[chatKey] = [];
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const msgData = { groupId, fromPhone: senderPhone, fromName: senderName, text: message, file, time, type: 'group' };
                
        messages[chatKey].push(msgData);
        saveDatabase();

        const group = groups.find(g => g.id === groupId);
        if (group) {
            group.members.forEach(phone => {
                const sId = activeUsers[phone];
                if (sId) {
                    const recipientMuted = mutedChats[phone] && mutedChats[phone].includes(chatKey);
                    io.to(sId).emit('message', { ...msgData, isMuted: recipientMuted });
                }
            });
        }
    });

    // --- СООБЩЕНИЯ СООБЩЕСТВ ---
    socket.on('community_message', ({ communityId, message, file }) => {
        const senderPhone = getPhoneBySocket(socket.id);
        let senderName = 'Пользователь';
        if (senderPhone && registeredUsers[senderPhone]) {
            senderName = registeredUsers[senderPhone].name;
        }
        if (!senderPhone) return;

        const chatKey = `community_${communityId}`;
        if (!messages[chatKey]) messages[chatKey] = [];
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const msgData = { communityId, fromPhone: senderPhone, fromName: senderName, text: message, file, time, type: 'community' };
                
        messages[chatKey].push(msgData);
        saveDatabase();

        const com = communities.find(c => c.id === communityId);
        if (com) {
            com.subscribers.forEach(phone => {
                const sId = activeUsers[phone];
                if (sId) {
                    const recipientMuted = mutedChats[phone] && mutedChats[phone].includes(chatKey);
                    io.to(sId).emit('message', { ...msgData, isMuted: recipientMuted });
                }
            });
        }
    });

    socket.on('disconnect', () => {
        const phone = getPhoneBySocket(socket.id);
        if (phone) {
            delete activeUsers[phone];
            if (registeredUsers[phone]) registeredUsers[phone].isOnline = false;
        }
        updateAllLists();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
