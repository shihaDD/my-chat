const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DB_FILE = path.join(__dirname, 'database.json');

let db = {
    users: {},
    messagesStore: {},
    friends: {},
    friendRequests: {},
    nicknames: {},
    groups: {},
    news: [],
    lastSeen: {}
};

if (fs.existsSync(DB_FILE)) {
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        db = { ...db, ...JSON.parse(data) };
    } catch (e) {
        console.error('Ошибка чтения database.json:', e);
    }
}

function saveDb() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
    } catch (e) {
        console.error('Ошибка сохранения базы данных:', e);
    }
}

app.get('/api/data', (req, res) => {
    res.json(db);
});

// Яндекс.Музыка и поиск треков
app.get('/api/music-search', async (req, res) => {
    const q = req.query.q || 'popular';
    // Имитация интеграции каталога треков с превью для Яндекс.Музыки
    const mockTracks = [
        { title: `Трек по запросу: ${q} (Remix)`, artist: 'Яндекс.Артист 1', previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
        { title: `Новинка: ${q} (Cyberpunk Mix)`, artist: 'Neon Sound', previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3' },
        { title: `Хит недели: ${q}`, artist: 'Точка сбора Wave', previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3' },
        { title: `Инструментал: ${q}`, artist: 'Lofi Chill', previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3' }
    ];
    res.json({ success: true, tracks: mockTracks });
});

app.post('/api/register', (req, res) => {
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
    db.lastSeen[cleanLogin] = Date.now();
    saveDb();

    res.json({ success: true, user: db.users[cleanLogin], db });
});

app.post('/api/login', (req, res) => {
    const { login, password } = req.body;
    if (!login || !password) {
        return res.json({ success: false, error: 'Введите логин и пароль!' });
    }
    const cleanLogin = login.trim().toLowerCase();
    const user = db.users[cleanLogin];

    if (!user || user.password !== password) {
        return res.json({ success: false, error: 'Неверный логин или пароль!' });
    }

    db.lastSeen[cleanLogin] = Date.now();
    saveDb();
    res.json({ success: true, user, db });
});

app.post('/api/update-profile', (req, res) => {
    const { login, name, email, bio, avatar, password } = req.body;
    if (!login || !db.users[login]) return res.json({ success: false, error: 'Пользователь не найден' });
    if (name) db.users[login].name = name.trim();
    if (email !== undefined) db.users[login].email = email.trim();
    if (bio !== undefined) db.users[login].bio = bio.trim();
    if (avatar) db.users[login].avatar = avatar;
    if (password) db.users[login].password = password;
    saveDb();
    res.json({ success: true, user: db.users[login], db });
});

app.post('/api/set-nickname', (req, res) => {
    const { login, target, nickname } = req.body;
    if (!db.nicknames[login]) db.nicknames[login] = {};
    if (!nickname.trim()) {
        delete db.nicknames[login][target];
    } else {
        db.nicknames[login][target] = nickname.trim();
    }
    saveDb();
    res.json({ success: true, db });
});

app.post('/api/add-friend', (req, res) => {
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
    if (db.friendRequests[cleanTarget].includes(login)) {
        return res.json({ success: false, error: 'Заявка уже отправлена!' });
    }

    db.friendRequests[cleanTarget].push(login);
    saveDb();
    res.json({ success: true, db });
});

app.post('/api/respond-friend-request', (req, res) => {
    const { login, requesterLogin, accept } = req.body;
    if (db.friendRequests[login]) {
        db.friendRequests[login] = db.friendRequests[login].filter(l => l !== requesterLogin);
    }

    if (accept) {
        if (!db.friends[login]) db.friends[login] = [];
        if (!db.friends[requesterLogin]) db.friends[requesterLogin] = [];

        if (!db.friends[login].includes(requesterLogin)) db.friends[login].push(requesterLogin);
        if (!db.friends[requesterLogin].includes(login)) db.friends[requesterLogin].push(login);
    }
    saveDb();
    res.json({ success: true, db });
});

app.post('/api/remove-friend', (req, res) => {
    const { login, targetLogin } = req.body;
    if (db.friends[login]) db.friends[login] = db.friends[login].filter(l => l !== targetLogin);
    if (db.friends[targetLogin]) db.friends[targetLogin] = db.friends[targetLogin].filter(l => l !== login);
    saveDb();
    res.json({ success: true, db });
});

// Группы и роли
app.post('/api/create-group', (req, res) => {
    const { name, creator } = req.body;
    if (!name || !creator) return res.json({ success: false, error: 'Недостаточно данных' });

    const groupId = 'group_' + Date.now();
    db.groups[groupId] = {
        id: groupId,
        name: name.trim(),
        creator: creator,
        members: [creator],
        roles: { [creator]: 'Лидер' },
        messages: [],
        likes: Math.floor(Math.random() * 15)
    };
    saveDb();
    res.json({ success: true, db });
});

app.post('/api/join-group', (req, res) => {
    const { groupId, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Сообщество не найдено' });

    if (!group.members.includes(login)) {
        group.members.push(login);
        group.roles[login] = 'Участник';
        saveDb();
    }
    res.json({ success: true, db });
});

app.post('/api/set-group-role', (req, res) => {
    const { groupId, login, targetLogin, newRole } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Сообщество не найдено' });

    if (group.creator !== login) {
        return res.json({ success: false, error: 'Только лидер может назначать роли!' });
    }
    if (targetLogin === group.creator) {
        return res.json({ success: false, error: 'Нельзя изменить роль лидера' });
    }

    if (!group.roles) group.roles = {};
    group.roles[targetLogin] = newRole;
    saveDb();
    res.json({ success: true, db });
});

app.post('/api/kick-group-member', (req, res) => {
    const { groupId, login, targetLogin } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Сообщество не найдено' });

    const callerRole = group.roles?.[login] || (group.creator === login ? 'Лидер' : 'Участник');
    if (group.creator !== login && callerRole !== 'Админ') {
        return res.json({ success: false, error: 'Недостаточно прав для изгнания участников' });
    }
    if (targetLogin === group.creator || group.roles?.[targetLogin] === 'Админ') {
        return res.json({ success: false, error: 'Нельзя выгнать Лидера или Админа' });
    }

    group.members = group.members.filter(m => m !== targetLogin);
    delete group.roles[targetLogin];
    saveDb();
    res.json({ success: true, db });
});

// Сообщения
app.post('/api/send-message', (req, res) => {
    const { sender, receiver, text, media } = req.body;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msgObj = { sender, text: text || '', media: media || null, time, edited: false };

    if (!db.messagesStore[sender]) db.messagesStore[sender] = {};
    if (!db.messagesStore[sender][receiver]) db.messagesStore[sender][receiver] = [];
    db.messagesStore[sender][receiver].push(msgObj);

    if (sender !== receiver) {
        if (!db.messagesStore[receiver]) db.messagesStore[receiver] = {};
        if (!db.messagesStore[receiver][sender]) db.messagesStore[receiver][sender] = [];
        db.messagesStore[receiver][sender].push(msgObj);
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

app.post('/api/send-group-message', (req, res) => {
    const { groupId, sender, text, media } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msgObj = { sender, text: text || '', media: media || null, time, edited: false };

    if (!group.messages) group.messages = [];
    group.messages.push(msgObj);

    saveDb();
    res.json({ success: true, db });
});

app.post('/api/edit-group-message', (req, res) => {
    const { groupId, sender, msgIndex, newText } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Сообщество не найдено' });
    const msg = group.messages[msgIndex];
    if (!msg) return res.json({ success: false, error: 'Сообщение не найдено' });
    
    const role = group.roles?.[sender] || (group.creator === sender ? 'Лидер' : 'Участник');
    if (msg.sender !== sender && group.creator !== sender && role !== 'Админ') {
        return res.json({ success: false, error: 'Нет прав на редактирование' });
    }
    msg.text = newText;
    msg.edited = true;
    saveDb();
    res.json({ success: true, db });
});

app.post('/api/delete-group-message', (req, res) => {
    const { groupId, sender, msgIndex } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Сообщество не найдено' });
    const msg = group.messages[msgIndex];
    if (!msg) return res.json({ success: false, error: 'Сообщение не найдено' });

    const role = group.roles?.[sender] || (group.creator === sender ? 'Лидер' : 'Участник');
    if (msg.sender !== sender && group.creator !== sender && role !== 'Админ') {
        return res.json({ success: false, error: 'Нет прав на удаление' });
    }
    group.messages.splice(msgIndex, 1);
    saveDb();
    res.json({ success: true, db });
});

// Новости, лайки, дизлайки, комментарии
app.post('/api/news', (req, res) => {
    const { author, text, media } = req.body;
    if (!db.news) db.news = [];
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    db.news.unshift({ author, text: text || '', media: media || null, time, likes: 0, dislikes: 0, comments: [] });
    saveDb();
    res.json({ success: true, db });
});

app.post('/api/news-like', (req, res) => {
    const { index } = req.body;
    if (db.news[index]) {
        db.news[index].likes = (db.news[index].likes || 0) + 1;
        saveDb();
    }
    res.json({ success: true, db });
});

app.post('/api/news-dislike', (req, res) => {
    const { index } = req.body;
    if (db.news[index]) {
        db.news[index].dislikes = (db.news[index].dislikes || 0) + 1;
        saveDb();
    }
    res.json({ success: true, db });
});

app.post('/api/news-comment', (req, res) => {
    const { index, author, text } = req.body;
    if (db.news[index]) {
        if (!db.news[index].comments) db.news[index].comments = [];
        db.news[index].comments.push({ author, text });
        saveDb();
    }
    res.json({ success: true, db });
});

// Socket.io для звонков и WebRTC
const activeSockets = {};
const socketUsers = {};
const callRooms = {};

io.on('connection', (socket) => {
    socket.on('register', (login) => {
        if (login) {
            activeSockets[login] = socket.id;
            socketUsers[socket.id] = login;
            db.lastSeen[login] = Date.now();
        }
    });

    socket.on('typing', ({ from, to, isGroup }) => {
        if (isGroup) {
            socket.broadcast.emit('user-typing', { from, to, isGroup: true });
        } else {
            const targetSocketId = activeSockets[to];
            if (targetSocketId) {
                io.to(targetSocketId).emit('user-typing', { from, to, isGroup: false });
            }
        }
    });

    socket.on('stop-typing', ({ from, to, isGroup }) => {
        if (isGroup) {
            socket.broadcast.emit('user-stop-typing', { from, to, isGroup: true });
        } else {
            const targetSocketId = activeSockets[to];
            if (targetSocketId) {
                io.to(targetSocketId).emit('user-stop-typing', { from, to, isGroup: false });
            }
        }
    });

    socket.on('call-user', ({ to, offer, from }) => {
        const targetSocketId = activeSockets[to];
        if (targetSocketId) {
            io.to(targetSocketId).emit('incoming-call', { from, offer });
        }
    });

    socket.on('call-accepted', ({ to, answer }) => {
        const targetSocketId = activeSockets[to];
        if (targetSocketId) {
            io.to(targetSocketId).emit('call-answered', { answer });
        }
    });

    socket.on('ice-candidate', ({ to, candidate }) => {
        const targetSocketId = activeSockets[to];
        if (targetSocketId) {
            io.to(targetSocketId).emit('ice-candidate', { candidate });
        }
    });

    socket.on('hang-up', ({ to }) => {
        const targetSocketId = activeSockets[to];
        if (targetSocketId) {
            io.to(targetSocketId).emit('hang-up');
        }
    });

    socket.on('join-group-call', ({ groupId, login }) => {
        socket.join(groupId);
        if (!callRooms[groupId]) callRooms[groupId] = new Set();
        const existingMembers = Array.from(callRooms[groupId]).map(l => ({ login: l, socketId: activeSockets[l] }));
        callRooms[groupId].add(login);

        socket.emit('group-call-users', existingMembers);
        socket.to(groupId).emit('user-joined-group-call', { login, socketId: socket.id });
    });

    socket.on('group-signal', ({ toSocketId, signal, fromLogin }) => {
        io.to(toSocketId).emit('group-signal', { fromSocketId: socket.id, signal, fromLogin });
    });

    socket.on('leave-group-call', ({ groupId, login }) => {
        socket.leave(groupId);
        if (callRooms[groupId]) {
            callRooms[groupId].delete(login);
            if (callRooms[groupId].size === 0) delete callRooms[groupId];
        }
        socket.to(groupId).emit('user-left-group-call', { socketId: socket.id });
    });

    socket.on('disconnect', () => {
        const login = socketUsers[socket.id];
        if (login) {
            db.lastSeen[login] = Date.now();
            delete activeSockets[login];
            delete socketUsers[socket.id];

            for (const [groupId, members] of Object.entries(callRooms)) {
                if (members.has(login)) {
                    members.delete(login);
                    socket.to(groupId).emit('user-left-group-call', { socketId: socket.id });
                    if (members.size === 0) delete callRooms[groupId];
                }
            }
        }
        saveDb();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер «Точка сбора» запущен на порту ${PORT}`);
});
