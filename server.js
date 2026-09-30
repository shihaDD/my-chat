const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Подключение к MongoDB (использует переменную окружения MONGO_URI или локальную базу для тестов)
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/messenger';

const dbSchema = new mongoose.Schema({
    key: { type: String, unique: true, default: 'main_db' },
    data: Object
});
const StateModel = mongoose.model('State', dbSchema);

let db = {
    users: {},
    messagesStore: {},
    friends: {},
    friendRequests: {},
    outgoingRequests: {},
    customNicknames: {},
    groups: {},
    news: [],
    lastSeen: {}
};

// Инициализация и загрузка базы данных из MongoDB при запуске
async function initDatabase() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('Успешное подключение к MongoDB!');

        let doc = await StateModel.findOne({ key: 'main_db' });
        if (doc && doc.data) {
            db = { ...db, ...doc.data };
            // Проверка структуры групп
            for (let gId in db.groups) {
                if (!db.groups[gId].subgroups) db.groups[gId].subgroups = [];
                if (!db.groups[gId].roles) db.groups[gId].roles = {};
                if (!db.groups[gId].customRoles) {
                    db.groups[gId].customRoles = {
                        'Админ': { canPost: true, canDelete: true, canVoice: true },
                        'Участник': { canPost: false, canDelete: false, canVoice: true }
                    };
                }
                if (!db.groups[gId].posts) db.groups[gId].posts = [];
                if (!db.groups[gId].messages) db.groups[gId].messages = [];
                if (!db.groups[gId].avatar) db.groups[gId].avatar = 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=150';
            }
            console.log('База данных успешно загружена из MongoDB.');
        } else {
            await StateModel.create({ key: 'main_db', data: db });
            console.log('Создана новая запись базы данных в MongoDB.');
        }
    } catch (e) {
        console.error('Ошибка подключения к MongoDB:', e);
    }
}

async function saveDb() {
    try {
        await StateModel.findOneAndUpdate(
            { key: 'main_db' },
            { data: db },
            { upsert: true }
        );
    } catch (e) {
        console.error('Ошибка сохранения базы данных в MongoDB:', e);
    }
}

app.get('/api/internet-news', async (req, res) => {
    const internetNews = [
        { title: 'Искусственный интеллект совершил прорыв в квантовых вычислениях', url: '#', score: 1250, by: 'TechNews', time: new Date().toLocaleString() },
        { title: 'Запущен новый стандарт сверхбыстрой беспроводной связи 6G', url: '#', score: 980, by: 'FutureNet', time: new Date().toLocaleString() },
        { title: 'Космический телескоп обнаружил экзопланету с признаками воды', url: '#', score: 850, by: 'SpaceObserver', time: new Date().toLocaleString() },
        { title: 'Релиз революционного движка для веб-разработки и 3D графики', url: '#', score: 720, by: 'DevDaily', time: new Date().toLocaleString() },
        { title: 'Тренды кибербезопасности и защиты данных в 2026 году', url: '#', score: 640, by: 'SecurityHub', time: new Date().toLocaleString() }
    ];
    res.json({ success: true, news: internetNews });
});

app.post('/api/register', async (req, res) => {
    const { login, name, password, email, avatar } = req.body;
    if (!login || !name || !password) {
        return res.json({ success: false, error: 'Заполните обязательные поля!' });
    }
    const cleanLogin = login.trim().toLowerCase();
    if (db.users[cleanLogin]) {
        return res.json({ success: false, error: 'Пользователь с таким логином уже существует!' });
    }

    db.users[cleanLogin] = { login: cleanLogin, name, password, email: email || '', avatar: avatar || '', bio: '' };
    db.friends[cleanLogin] = [];
    db.friendRequests[cleanLogin] = [];
    db.outgoingRequests[cleanLogin] = [];
    db.lastSeen[cleanLogin] = Date.now();
    await saveDb();

    res.json({ success: true, user: db.users[cleanLogin], db });
});

app.post('/api/login', async (req, res) => {
    const { login, password } = req.body;
    if (!login || !password) {
        return res.json({ success: false, error: 'Введите логин и пароль!' });
    }
    const cleanLogin = login.trim().toLowerCase();
    const user = db.users[cleanLogin];

    if (!user) {
        return res.json({ success: false, error: 'Пользователь не найден!' });
    }
    if (user.password !== password) {
        return res.json({ success: false, error: 'Неверный пароль!' });
    }

    if (!db.outgoingRequests) db.outgoingRequests = {};
    if (!db.outgoingRequests[cleanLogin]) db.outgoingRequests[cleanLogin] = [];

    db.lastSeen[cleanLogin] = Date.now();
    await saveDb();
    res.json({ success: true, user, db });
});

app.post('/api/update-profile', async (req, res) => {
    const { login, name, email, bio, avatar, password } = req.body;
    if (!login) return res.json({ success: false, error: 'Логин не передан' });
    const cleanLogin = login.trim().toLowerCase();
    if (!db.users[cleanLogin]) return res.json({ success: false, error: 'Пользователь не найден' });
    
    if (name) db.users[cleanLogin].name = name.trim();
    if (email !== undefined) db.users[cleanLogin].email = email.trim();
    if (bio !== undefined) db.users[cleanLogin].bio = bio.trim();
    if (avatar) db.users[cleanLogin].avatar = avatar;
    if (password) db.users[cleanLogin].password = password;
    await saveDb();
    res.json({ success: true, user: db.users[cleanLogin], db });
});

app.post('/api/add-friend', async (req, res) => {
    const { login, targetLogin } = req.body;
    const cleanTarget = targetLogin.trim().toLowerCase();

    if (!db.users[cleanTarget]) {
        return res.json({ success: false, error: 'Пользователь не найден!' });
    }
    if (cleanTarget === login) {
        return res.json({ success: false, error: 'Нельзя добавить самого себя!' });
    }
    if (db.friends[login] && db.friends[login].includes(cleanTarget)) {
        return res.json({ success: false, error: 'Вы уже друзья!' });
    }
    if (!db.friendRequests[cleanTarget]) db.friendRequests[cleanTarget] = [];
    if (!db.outgoingRequests) db.outgoingRequests = {};
    if (!db.outgoingRequests[login]) db.outgoingRequests[login] = [];

    if (db.friendRequests[cleanTarget].includes(login) || db.outgoingRequests[login].includes(cleanTarget)) {
        return res.json({ success: false, error: 'Заявка уже отправлена!' });
    }

    db.friendRequests[cleanTarget].push(login);
    db.outgoingRequests[login].push(cleanTarget);
    await saveDb();
    io.to(cleanTarget).emit('update-db', db);
    io.to(login).emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/cancel-friend-request', async (req, res) => {
    const { login, targetLogin } = req.body;
    if (db.outgoingRequests && db.outgoingRequests[login]) {
        db.outgoingRequests[login] = db.outgoingRequests[login].filter(l => l !== targetLogin);
    }
    if (db.friendRequests && db.friendRequests[targetLogin]) {
        db.friendRequests[targetLogin] = db.friendRequests[targetLogin].filter(l => l !== login);
    }
    await saveDb();
    io.to(targetLogin).emit('update-db', db);
    io.to(login).emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/respond-friend-request', async (req, res) => {
    const { login, requesterLogin, accept } = req.body;
    if (db.friendRequests && db.friendRequests[login]) {
        db.friendRequests[login] = db.friendRequests[login].filter(l => l !== requesterLogin);
    }
    if (db.outgoingRequests && db.outgoingRequests[requesterLogin]) {
        db.outgoingRequests[requesterLogin] = db.outgoingRequests[requesterLogin].filter(l => l !== login);
    }

    if (accept) {
        if (!db.friends[login]) db.friends[login] = [];
        if (!db.friends[requesterLogin]) db.friends[requesterLogin] = [];

        if (!db.friends[login].includes(requesterLogin)) db.friends[login].push(requesterLogin);
        if (!db.friends[requesterLogin].includes(login)) db.friends[requesterLogin].push(login);
    }
    await saveDb();
    io.to(login).emit('update-db', db);
    io.to(requesterLogin).emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/remove-friend', async (req, res) => {
    const { login, targetLogin } = req.body;
    if (db.friends[login]) db.friends[login] = db.friends[login].filter(l => l !== targetLogin);
    if (db.friends[targetLogin]) db.friends[targetLogin] = db.friends[targetLogin].filter(l => l !== login);
    await saveDb();
    io.to(login).emit('update-db', db);
    io.to(targetLogin).emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/create-group', async (req, res) => {
    const { name, creator } = req.body;
    if (!name || !creator) return res.json({ success: false, error: 'Недостаточно данных' });

    const groupId = 'group_' + Date.now();
    db.groups[groupId] = {
        id: groupId,
        name: name.trim(),
        creator: creator,
        avatar: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=150',
        members: [creator],
        roles: { [creator]: 'Лидер' },
        customRoles: {
            'Админ': { canPost: true, canDelete: true, canVoice: true },
            'Участник': { canPost: false, canDelete: false, canVoice: true }
        },
        messages: [],
        posts: [],
        subgroups: [],
        likes: Math.floor(Math.random() * 20)
    };
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/update-group', async (req, res) => {
    const { groupId, name, avatar, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    if (group.creator !== login && group.roles?.[login] !== 'Админ') {
        return res.json({ success: false, error: 'Недостаточно прав!' });
    }
    if (name) group.name = name.trim();
    if (avatar) group.avatar = avatar;
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db, group });
});

app.post('/api/join-group', async (req, res) => {
    const { groupId, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Сообщество не найдено' });

    if (!group.members.includes(login)) {
        group.members.push(login);
        group.roles[login] = 'Участник';
        await saveDb();
        io.emit('update-db', db);
    }
    res.json({ success: true, db });
});

app.post('/api/set-group-role', async (req, res) => {
    const { groupId, login, targetLogin, newRole } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Сообщество не найдено' });

    const isLeader = group.creator === login;
    if (!isLeader && group.roles?.[login] !== 'Админ') {
        return res.json({ success: false, error: 'Недостаточно прав для изменения ролей!' });
    }
    if (!group.roles) group.roles = {};
    group.roles[targetLogin] = newRole;
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/create-custom-role', async (req, res) => {
    const { groupId, login, roleName, permissions } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    if (group.creator !== login) {
        return res.json({ success: false, error: 'Только лидер группы может создавать роли!' });
    }
    if (!group.customRoles) group.customRoles = {};
    const cleanName = roleName.trim();
    if (!cleanName) return res.json({ success: false, error: 'Введите название роли' });

    group.customRoles[cleanName] = permissions || { canPost: true, canDelete: true, canVoice: true };
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/delete-custom-role', async (req, res) => {
    const { groupId, login, roleName } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    if (group.creator !== login) {
        return res.json({ success: false, error: 'Только лидер группы может удалять роли!' });
    }
    if (roleName === 'Лидер' || roleName === 'Админ' || roleName === 'Участник') {
        return res.json({ success: false, error: 'Нельзя удалить системную роль!' });
    }
    if (group.customRoles && group.customRoles[roleName]) {
        delete group.customRoles[roleName];
        await saveDb();
        io.emit('update-db', db);
    }
    res.json({ success: true, db });
});

app.post('/api/kick-group-member', async (req, res) => {
    const { groupId, login, targetLogin } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Сообщество не найдено' });

    const isLeader = group.creator === login;
    const myRole = group.roles?.[login];
    if (!isLeader && myRole !== 'Админ') {
        return res.json({ success: false, error: 'Только лидер и админы могут исключать участников!' });
    }
    if (group.creator === targetLogin) {
        return res.json({ success: false, error: 'Нельзя исключить создателя группы!' });
    }

    group.members = group.members.filter(m => m !== targetLogin);
    if (group.roles) delete group.roles[targetLogin];
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/create-subgroup', async (req, res) => {
    const { groupId, name, type, permission, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    const isLeader = group.creator === login;
    const myRole = group.roles?.[login] || (isLeader ? 'Лидер' : 'Участник');
    if (!isLeader && myRole !== 'Админ') {
        return res.json({ success: false, error: 'Недостаточно прав для создания канала!' });
    }

    if (!group.subgroups) group.subgroups = [];
    const subId = 'sub_' + Date.now();
    group.subgroups.push({ id: subId, name: name.trim(), type: type || 'text', permission: permission || 'all', messages: [] });
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/delete-subgroup', async (req, res) => {
    const { groupId, subId, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    if (group.creator !== login && group.roles?.[login] !== 'Админ') {
        return res.json({ success: false, error: 'Недостаточно прав!' });
    }
    group.subgroups = (group.subgroups || []).filter(s => s.id !== subId);
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/create-group-post', async (req, res) => {
    const { groupId, author, text, media } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    const isLeader = group.creator === author;
    const myRole = group.roles?.[author] || (isLeader ? 'Лидер' : 'Участник');
    const rolePermissions = group.customRoles?.[myRole] || { canPost: myRole === 'Лидер' || myRole === 'Админ' };
    
    if (!isLeader && myRole !== 'Админ' && !rolePermissions.canPost) {
        return res.json({ success: false, error: 'Ваша роль не имеет прав на публикацию постов!' });
    }

    if (!group.posts) group.posts = [];
    const time = new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    group.posts.unshift({ author, text: text || '', media: media || null, time, likes: 0, comments: [] });
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/delete-group-post', async (req, res) => {
    const { groupId, login, postIndex } = req.body;
    const group = db.groups[groupId];
    if (!group || !group.posts?.[postIndex]) return res.json({ success: false, error: 'Пост не найден' });

    const post = group.posts[postIndex];
    const isLeader = group.creator === login;
    const myRole = group.roles?.[login] || (isLeader ? 'Лидер' : 'Участник');
    const rolePermissions = group.customRoles?.[myRole] || {};

    if (!isLeader && myRole !== 'Админ' && !rolePermissions.canDelete && post.author !== login) {
        return res.json({ success: false, error: 'Недостаточно прав для удаления поста!' });
    }

    group.posts.splice(postIndex, 1);
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/send-message', async (req, res) => {
    const { sender, receiver, text, media, messageId } = req.body;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msgObj = { id: messageId || 'msg_' + Date.now() + '_' + Math.random(), sender, receiver, text: text || '', media: media || null, time, edited: false, read: false };

    if (!db.messagesStore[sender]) db.messagesStore[sender] = {};
    if (!db.messagesStore[sender][receiver]) db.messagesStore[sender][receiver] = [];
    db.messagesStore[sender][receiver].push(msgObj);

    if (sender !== receiver) {
        if (!db.messagesStore[receiver]) db.messagesStore[receiver] = {};
        if (!db.messagesStore[receiver][sender]) db.messagesStore[receiver][sender] = [];
        db.messagesStore[receiver][sender].push(msgObj);
    }

    await saveDb();
    io.to(receiver).emit('receive-message', { sender, receiver, msg: msgObj });
    res.json({ success: true, db, msg: msgObj });
});

app.post('/api/edit-message', async (req, res) => {
    const { login, peer, messageId, newText } = req.body;
    if (!db.messagesStore[login]?.[peer]) return res.json({ success: false, error: 'Чат не найден' });

    let found = false;
    db.messagesStore[login][peer].forEach(m => {
        if (m.id === messageId && m.sender === login) {
            m.text = newText;
            m.edited = true;
            found = true;
        }
    });

    if (login !== peer && db.messagesStore[peer]?.[login]) {
        db.messagesStore[peer][login].forEach(m => {
            if (m.id === messageId && m.sender === login) {
                m.text = newText;
                m.edited = true;
            }
        });
    }

    if (found) {
        await saveDb();
        io.to(peer).emit('message-edited', { sender: login, receiver: peer, messageId, newText });
        io.to(login).emit('message-edited', { sender: login, receiver: peer, messageId, newText });
        res.json({ success: true, db });
    } else {
        res.json({ success: false, error: 'Не удалось отредактировать сообщение' });
    }
});

app.post('/api/delete-message', async (req, res) => {
    const { login, peer, messageId } = req.body;
    if (db.messagesStore[login]?.[peer]) {
        db.messagesStore[login][peer] = db.messagesStore[login][peer].filter(m => m.id !== messageId);
    }
    if (login !== peer && db.messagesStore[peer]?.[login]) {
        db.messagesStore[peer][login] = db.messagesStore[peer][login].filter(m => m.id !== messageId);
    }
    await saveDb();
    io.to(peer).emit('message-deleted', { sender: login, receiver: peer, messageId });
    io.to(login).emit('message-deleted', { sender: login, receiver: peer, messageId });
    res.json({ success: true, db });
});

app.post('/api/mark-read', async (req, res) => {
    const { login, peer } = req.body;
    if (db.messagesStore[login]?.[peer]) {
        db.messagesStore[login][peer].forEach(m => {
            if (m.sender === peer) m.read = true;
        });
    }
    if (db.messagesStore[peer]?.[login]) {
        db.messagesStore[peer][login].forEach(m => {
            if (m.sender === peer) m.read = true;
        });
    }
    await saveDb();
    io.to(peer).emit('messages-read', { reader: login, peer });
    res.json({ success: true });
});

app.post('/api/send-group-message', async (req, res) => {
    const { groupId, sender, text, media, subgroup } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msgObj = { id: 'gmsg_' + Date.now(), sender, text: text || '', media: media || null, time, edited: false };

    if (!subgroup || subgroup === 'main') {
        if (!group.messages) group.messages = [];
        group.messages.push(msgObj);
    } else {
        const sub = group.subgroups?.find(s => s.id === subgroup);
        if (sub) {
            if (!sub.messages) sub.messages = [];
            sub.messages.push(msgObj);
        }
    }

    await saveDb();
    io.to(groupId).emit('receive-group-message', { groupId, msg: msgObj, subgroup: subgroup || 'main' });
    res.json({ success: true, db });
});

app.post('/api/news', async (req, res) => {
    const { author, text, media } = req.body;
    const time = new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    db.news.unshift({ author, text: text || '', media: media || null, time, likes: 0, dislikes: 0, comments: [] });
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/news-like', async (req, res) => {
    const { index } = req.body;
    if (db.news[index]) {
        db.news[index].likes = (db.news[index].likes || 0) + 1;
        await saveDb();
        io.emit('update-db', db);
    }
    res.json({ success: true, db });
});

app.post('/api/news-dislike', async (req, res) => {
    const { index } = req.body;
    if (db.news[index]) {
        db.news[index].dislikes = (db.news[index].dislikes || 0) + 1;
        await saveDb();
        io.emit('update-db', db);
    }
    res.json({ success: true, db });
});

io.on('connection', (socket) => {
    socket.on('register', (login) => {
        socket.login = login;
        socket.join(login);
    });

    socket.on('join-group-room', (groupId) => {
        socket.join(groupId);
    });

    socket.on('refresh-db', () => {
        socket.emit('update-db', db);
    });

    socket.on('call-user', ({ to, offer, from }) => {
        io.to(to).emit('incoming-call', { from, offer, isGroup: false });
    });

    socket.on('start-group-conference', ({ groupId, channelId, targets, from }) => {
        targets.forEach(targetLogin => {
            io.to(targetLogin).emit('incoming-call', { from, offer: null, isGroup: true, groupId, channelId });
        });
    });

    socket.on('call-accepted', ({ to, answer }) => {
        io.to(to).emit('call-answered', { answer });
    });

    socket.on('ice-candidate', ({ to, candidate }) => {
        io.to(to).emit('ice-candidate', { candidate });
    });

    socket.on('hang-up', ({ to }) => {
        io.to(to).emit('hang-up');
    });

    socket.on('typing', ({ from, to, isGroup }) => {
        if (!isGroup) io.to(to).emit('user-typing', { from, to, isGroup });
    });

    socket.on('stop-typing', ({ from, to, isGroup }) => {
        if (!isGroup) io.to(to).emit('user-stop-typing');
    });

    socket.on('join-group-call', ({ groupId, channelId, login }) => {
        const roomName = `${groupId}_${channelId || 'main'}`;
        socket.join(roomName);
        const room = io.sockets.adapter.rooms.get(roomName);
        const clients = [];
        if (room) {
            room.forEach(socketId => {
                const s = io.sockets.sockets.get(socketId);
                if (s && s.id !== socket.id) {
                    clients.push({ socketId: s.id, login: s.login });
                }
            });
        }
        socket.emit('group-call-users', clients);
        socket.to(roomName).emit('user-joined-group-call', { login, socketId: socket.id, roomName });
    });

    socket.on('group-signal', ({ toSocketId, signal, fromLogin }) => {
        io.to(toSocketId).emit('group-signal', { fromSocketId: socket.id, signal, fromLogin });
    });

    socket.on('leave-group-call', ({ groupId, channelId, login }) => {
        const roomName = `${groupId}_${channelId || 'main'}`;
        socket.leave(roomName);
        socket.to(roomName).emit('user-left-group-call', { socketId: socket.id });
    });

    socket.on('mod-mute-user', ({ targetSocketId, muted }) => {
        io.to(targetSocketId).emit('mod-mute-action', { muted });
    });

    socket.on('mod-mute-all', ({ roomName, muted }) => {
        socket.to(roomName).emit('mod-mute-action', { muted });
        socket.emit('mod-mute-action', { muted });
    });

    socket.on('mod-kick-user', ({ targetSocketId }) => {
        io.to(targetSocketId).emit('mod-kick-action');
    });

    socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 3000;

// Запуск сервера после подключения к базе данных
initDatabase().then(() => {
    server.listen(PORT, () => {
        console.log(`Сервер запущен на порту ${PORT}`);
    });
});
