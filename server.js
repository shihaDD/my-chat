const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

const DB_FILE = path.join(__dirname, 'database.json');

let db = {
    users: [],
    messagesStore: {},
    friendRequests: {},
    friends: {},
    news: [],
    customNicknames: {},
    groups: {},
    lastSeen: {}
};

function loadDb() {
    if (fs.existsSync(DB_FILE)) {
        try {
            const data = fs.readFileSync(DB_FILE, 'utf8');
            db = JSON.parse(data);
            if (!db.users) db.users = [];
            if (!db.messagesStore) db.messagesStore = {};
            if (!db.friendRequests) db.friendRequests = {};
            if (!db.friends) db.friends = {};
            if (!db.news) db.news = [];
            if (!db.customNicknames) db.customNicknames = {};
            if (!db.groups) db.groups = {};
            if (!db.lastSeen) db.lastSeen = {};
        } catch (e) {
            console.error('Ошибка чтения database.json:', e);
        }
    } else {
        saveDb();
    }
}

function saveDb() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
    } catch (e) {
        console.error('Ошибка записи database.json:', e);
    }
}

loadDb();

// Регистрация
app.post('/api/register', (req, res) => {
    const { login, password, avatar } = req.body;
    if (!login || !password) {
        return res.json({ success: false, error: 'Заполните логин и пароль!' });
    }
    const cleanLogin = login.trim();
    if (db.users.find(u => u.login.toLowerCase() === cleanLogin.toLowerCase())) {
        return res.json({ success: false, error: 'Пользователь уже существует!' });
    }

    const newUser = {
        login: cleanLogin,
        password,
        avatar: avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150',
        bio: 'Всем привет!',
        email: ''
    };

    db.users.push(newUser);
    saveDb();
    res.json({ success: true, db });
});

// Авторизация
app.post('/api/login', (req, res) => {
    const { login, password } = req.body;
    const cleanLogin = (login || '').trim();
    const user = db.users.find(u => u.login.toLowerCase() === cleanLogin.toLowerCase() && u.password === password);

    if (!user) {
        return res.json({ success: false, error: 'Неверный логин или пароль!' });
    }

    res.json({ success: true, user, db });
});

// Обновление профиля
app.post('/api/update-profile', (req, res) => {
    const { login, avatar, bio, email, password } = req.body;
    const user = db.users.find(u => u.login === login);

    if (!user) {
        return res.json({ success: false, error: 'Пользователь не найден!' });
    }

    if (avatar) user.avatar = avatar;
    if (bio !== undefined) user.bio = bio;
    if (email !== undefined) user.email = email;
    if (password) user.password = password;

    saveDb();
    res.json({ success: true, user, db });
});

// Новости / Посты
app.post('/api/news', (req, res) => {
    const { author, text, media } = req.body;
    if (!text && !media) {
        return res.json({ success: false, error: 'Пост не может быть пустым!' });
    }

    const time = new Date().toLocaleString();
    const post = { id: Date.now(), author, text: text || '', media: media || null, time };
    db.news.unshift(post);

    saveDb();
    res.json({ success: true, db });
});

// Псевдонимы
app.post('/api/set-nickname', (req, res) => {
    const { owner, target, nickname } = req.body;
    if (!db.customNicknames[owner]) db.customNicknames[owner] = {};

    if (nickname && nickname.trim()) {
        db.customNicknames[owner][target] = nickname.trim();
    } else {
        delete db.customNicknames[owner][target];
    }

    saveDb();
    res.json({ success: true, db });
});

// Добавление в друзья
app.post('/api/add-friend', (req, res) => {
    const { login, targetLogin } = req.body;
    const cleanTarget = (targetLogin || '').trim();

    if (!cleanTarget) {
        return res.json({ success: false, error: 'Введите имя пользователя!' });
    }

    if (cleanTarget.toLowerCase() === login.toLowerCase()) {
        return res.json({ success: false, error: 'Нельзя добавить самого себя!' });
    }

    const targetUser = db.users.find(u => u.login.toLowerCase() === cleanTarget.toLowerCase());
    if (!targetUser) {
        return res.json({ success: false, error: 'Пользователь не найден!' });
    }

    const actualTargetName = targetUser.login;

    if (!db.friends[login]) db.friends[login] = [];
    if (db.friends[login].includes(actualTargetName)) {
        return res.json({ success: false, error: 'Этот пользователь уже в друзьях!' });
    }

    if (!db.friendRequests[actualTargetName]) db.friendRequests[actualTargetName] = [];
    if (db.friendRequests[actualTargetName].includes(login)) {
        return res.json({ success: false, error: 'Заявка уже отправлена!' });
    }

    db.friendRequests[actualTargetName].push(login);
    saveDb();
    res.json({ success: true, db });
});

// Удаление из друзей
app.post('/api/remove-friend', (req, res) => {
    const { login, targetLogin } = req.body;
    if (db.friends[login]) {
        db.friends[login] = db.friends[login].filter(u => u !== targetLogin);
    }
    if (db.friends[targetLogin]) {
        db.friends[targetLogin] = db.friends[targetLogin].filter(u => u !== login);
    }
    saveDb();
    res.json({ success: true, db });
});

// Ответ на заявку в друзья
app.post('/api/respond-friend-request', (req, res) => {
    const { login, requesterLogin, accept } = req.body;
    if (!db.friendRequests[login]) db.friendRequests[login] = [];

    db.friendRequests[login] = db.friendRequests[login].filter(u => u !== requesterLogin);

    if (accept) {
        if (!db.friends[login]) db.friends[login] = [];
        if (!db.friends[requesterLogin]) db.friends[requesterLogin] = [];

        if (!db.friends[login].includes(requesterLogin)) db.friends[login].push(requesterLogin);
        if (!db.friends[requesterLogin].includes(login)) db.friends[requesterLogin].push(login);
    }

    saveDb();
    res.json({ success: true, db });
});

// Группы / Сообщества
app.post('/api/create-group', (req, res) => {
    const { name, creator } = req.body;
    if (!name || !creator) return res.json({ success: false, error: 'Заполните название группы!' });

    const groupId = 'group_' + Date.now();
    db.groups[groupId] = {
        id: groupId,
        name: name.trim(),
        creator,
        members: [creator],
        roles: { [creator]: 'Создатель' },
        messages: []
    };

    saveDb();
    res.json({ success: true, db });
});

app.post('/api/join-group', (req, res) => {
    const { groupId, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    if (!group.members.includes(login)) {
        group.members.push(login);
        group.roles[login] = 'Участник';
        saveDb();
    }
    res.json({ success: true, db });
});

app.post('/api/update-group', (req, res) => {
    const { groupId, login, name } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    if (group.creator !== login && group.roles[login] !== 'Администратор') {
        return res.json({ success: false, error: 'Нет прав на редактирование' });
    }

    if (name) group.name = name.trim();
    saveDb();
    res.json({ success: true, db });
});

app.post('/api/set-group-role', (req, res) => {
    const { groupId, login, targetLogin, newRole } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    if (group.creator !== login) {
        return res.json({ success: false, error: 'Только создатель может менять роли' });
    }

    group.roles[targetLogin] = newRole;
    saveDb();
    res.json({ success: true, db });
});

// Личные сообщения
app.post('/api/send-message', (req, res) => {
    const { sender, receiver, text, media } = req.body;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msg = { sender, text: text || '', media: media || null, time, edited: false };

    if (!db.messagesStore[sender]) db.messagesStore[sender] = {};
    if (!db.messagesStore[sender][receiver]) db.messagesStore[sender][receiver] = [];
    db.messagesStore[sender][receiver].push(msg);

    if (sender !== receiver) {
        if (!db.messagesStore[receiver]) db.messagesStore[receiver] = {};
        if (!db.messagesStore[receiver][sender]) db.messagesStore[receiver][sender] = [];
        db.messagesStore[receiver][sender].push(msg);
    }

    saveDb();
    res.json({ success: true, db });
});

app.post('/api/edit-message', (req, res) => {
    const { sender, receiver, msgIndex, newText } = req.body;
    if (db.messagesStore[sender]?.[receiver]?.[msgIndex]) {
        db.messagesStore[sender][receiver][msgIndex].text = newText;
        db.messagesStore[sender][receiver][msgIndex].edited = true;
    }
    if (sender !== receiver && db.messagesStore[receiver]?.[sender]?.[msgIndex]) {
        db.messagesStore[receiver][sender][msgIndex].text = newText;
        db.messagesStore[receiver][sender][msgIndex].edited = true;
    }
    saveDb();
    res.json({ success: true, db });
});

app.post('/api/delete-message', (req, res) => {
    const { sender, receiver, msgIndex } = req.body;
    if (db.messagesStore[sender]?.[receiver]) {
        db.messagesStore[sender][receiver].splice(msgIndex, 1);
    }
    if (sender !== receiver && db.messagesStore[receiver]?.[sender]) {
        db.messagesStore[receiver][sender].splice(msgIndex, 1);
    }
    saveDb();
    res.json({ success: true, db });
});

// Групповые сообщения
app.post('/api/send-group-message', (req, res) => {
    const { groupId, sender, text, media } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    group.messages.push({ sender, text: text || '', media: media || null, time, edited: false });

    saveDb();
    res.json({ success: true, db });
});

app.post('/api/edit-group-message', (req, res) => {
    const { groupId, sender, msgIndex, newText } = req.body;
    const group = db.groups[groupId];
    if (group?.messages[msgIndex]) {
        group.messages[msgIndex].text = newText;
        group.messages[msgIndex].edited = true;
        saveDb();
    }
    res.json({ success: true, db });
});

app.post('/api/delete-group-message', (req, res) => {
    const { groupId, sender, msgIndex } = req.body;
    const group = db.groups[groupId];
    if (group?.messages[msgIndex]) {
        group.messages.splice(msgIndex, 1);
        saveDb();
    }
    res.json({ success: true, db });
});

// Socket.IO
const userSockets = {};
const groupCallRooms = {}; // groupId -> [{ login, socketId }]

io.on('connection', (socket) => {
    socket.on('register', (login) => {
        userSockets[login] = socket.id;
        db.lastSeen[login] = Date.now();
    });

    socket.on('typing', ({ from, to, isGroup }) => {
        if (isGroup) {
            socket.broadcast.emit('user-typing', { from, to, isGroup: true });
        } else if (userSockets[to]) {
            io.to(userSockets[to]).emit('user-typing', { from, to, isGroup: false });
        }
    });

    socket.on('stop-typing', ({ from, to, isGroup }) => {
        if (isGroup) {
            socket.broadcast.emit('user-stop-typing', { from, to, isGroup: true });
        } else if (userSockets[to]) {
            io.to(userSockets[to]).emit('user-stop-typing', { from, to, isGroup: false });
        }
    });

    // Одиночные WebRTC звонки
    socket.on('call-user', ({ to, offer, from }) => {
        if (userSockets[to]) {
            io.to(userSockets[to]).emit('incoming-call', { from, offer });
        }
    });

    socket.on('call-accepted', ({ to, answer }) => {
        if (userSockets[to]) {
            io.to(userSockets[to]).emit('call-answered', { answer });
        }
    });

    socket.on('ice-candidate', ({ to, candidate }) => {
        if (userSockets[to]) {
            io.to(userSockets[to]).emit('ice-candidate', { candidate });
        }
    });

    socket.on('hang-up', ({ to }) => {
        if (userSockets[to]) {
            io.to(userSockets[to]).emit('hang-up');
        }
    });

    // Групповые WebRTC звонки
    socket.on('join-group-call', ({ groupId, login }) => {
        if (!groupCallRooms[groupId]) groupCallRooms[groupId] = [];
        groupCallRooms[groupId] = groupCallRooms[groupId].filter(p => p.login !== login);
        
        const existingUsers = [...groupCallRooms[groupId]];
        groupCallRooms[groupId].push({ login, socketId: socket.id });
        socket.join(groupId);

        socket.emit('group-call-users', existingUsers);
        socket.to(groupId).emit('user-joined-group-call', { login, socketId: socket.id });
    });

    socket.on('group-signal', ({ toSocketId, signal, fromLogin }) => {
        io.to(toSocketId).emit('group-signal', {
            fromSocketId: socket.id,
            fromLogin,
            signal
        });
    });

    socket.on('leave-group-call', ({ groupId, login }) => {
        if (groupCallRooms[groupId]) {
            groupCallRooms[groupId] = groupCallRooms[groupId].filter(p => p.login !== login);
            socket.to(groupId).emit('user-left-group-call', { socketId: socket.id, login });
        }
        socket.leave(groupId);
    });

    socket.on('disconnect', () => {
        for (const [login, id] of Object.entries(userSockets)) {
            if (id === socket.id) {
                delete userSockets[login];
                db.lastSeen[login] = Date.now();
                break;
            }
        }
        for (const [groupId, participants] of Object.entries(groupCallRooms)) {
            const userIndex = participants.findIndex(p => p.socketId === socket.id);
            if (userIndex !== -1) {
                const user = participants[userIndex];
                participants.splice(userIndex, 1);
                io.to(groupId).emit('user-left-group-call', { socketId: socket.id, login: user.login });
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
