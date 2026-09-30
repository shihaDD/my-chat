const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DB_FILE = path.join(__dirname, 'database.json');

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

app.get('/api/music-search', async (req, res) => {
    const q = (req.query.q || 'popular').toLowerCase();
    const tracks = [
        { title: `Хит: ${q} (Remix)`, artist: 'Neon Wave', previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3', artwork: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=150' },
        { title: `${q} - Cyber Edition`, artist: 'DJ Cyber', previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3', artwork: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=150' },
        { title: `Chill Lofi: ${q}`, artist: 'Lofi Club', previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3', artwork: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=150' },
        { title: `Future Bass: ${q}`, artist: 'Future Sound', previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3', artwork: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=150' }
    ];
    res.json({ success: true, tracks });
});

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
    db.outgoingRequests[cleanLogin] = [];
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

    if (!db.outgoingRequests) db.outgoingRequests = {};
    if (!db.outgoingRequests[cleanLogin]) db.outgoingRequests[cleanLogin] = [];

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
    const { owner, target, nickname } = req.body;
    if (!db.customNicknames) db.customNicknames = {};
    if (!db.customNicknames[owner]) db.customNicknames[owner] = {};
    if (!nickname.trim()) {
        delete db.customNicknames[owner][target];
    } else {
        db.customNicknames[owner][target] = nickname.trim();
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
    if (!db.outgoingRequests) db.outgoingRequests = {};
    if (!db.outgoingRequests[login]) db.outgoingRequests[login] = [];

    if (db.friendRequests[cleanTarget].includes(login) || db.outgoingRequests[login].includes(cleanTarget)) {
        return res.json({ success: false, error: 'Заявка уже отправлена!' });
    }

    db.friendRequests[cleanTarget].push(login);
    db.outgoingRequests[login].push(cleanTarget);
    saveDb();
    io.to(cleanTarget).emit('update-db', db);
    io.to(login).emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/cancel-friend-request', (req, res) => {
    const { login, targetLogin } = req.body;
    if (db.outgoingRequests && db.outgoingRequests[login]) {
        db.outgoingRequests[login] = db.outgoingRequests[login].filter(l => l !== targetLogin);
    }
    if (db.friendRequests && db.friendRequests[targetLogin]) {
        db.friendRequests[targetLogin] = db.friendRequests[targetLogin].filter(l => l !== login);
    }
    saveDb();
    io.to(targetLogin).emit('update-db', db);
    io.to(login).emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/respond-friend-request', (req, res) => {
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
    saveDb();
    io.to(login).emit('update-db', db);
    io.to(requesterLogin).emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/remove-friend', (req, res) => {
    const { login, targetLogin } = req.body;
    if (db.friends[login]) db.friends[login] = db.friends[login].filter(l => l !== targetLogin);
    if (db.friends[targetLogin]) db.friends[targetLogin] = db.friends[targetLogin].filter(l => l !== login);
    saveDb();
    io.to(login).emit('update-db', db);
    io.to(targetLogin).emit('update-db', db);
    res.json({ success: true, db });
});

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
        posts: [],
        subgroups: [],
        likes: Math.floor(Math.random() * 20)
    };
    saveDb();
    io.emit('update-db', db);
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
        io.emit('update-db', db);
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
    if (!group.roles) group.roles = {};
    group.roles[targetLogin] = newRole;
    saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/kick-group-member', (req, res) => {
    const { groupId, login, targetLogin } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Сообщество не найдено' });

    if (group.creator !== login) {
        return res.json({ success: false, error: 'Только лидер может выгонять участников!' });
    }

    group.members = group.members.filter(m => m !== targetLogin);
    if (group.roles) delete group.roles[targetLogin];
    saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/create-subgroup', (req, res) => {
    const { groupId, name, permission, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    const isLeader = group.creator === login;
    const myRole = group.roles?.[login] || (isLeader ? 'Лидер' : 'Участник');
    if (!isLeader && myRole !== 'Админ') {
        return res.json({ success: false, error: 'Недостаточно прав для создания подгруппы!' });
    }

    if (!group.subgroups) group.subgroups = [];
    const subId = 'sub_' + Date.now();
    group.subgroups.push({ id: subId, name: name.trim(), permission, messages: [] });
    saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/create-group-post', (req, res) => {
    const { groupId, author, text, media } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    const isLeader = group.creator === author;
    const myRole = group.roles?.[author] || (isLeader ? 'Лидер' : 'Участник');
    if (!isLeader && myRole !== 'Админ') {
        return res.json({ success: false, error: 'Только лидер и админы могут публиковать посты!' });
    }

    if (!group.posts) group.posts = [];
    const time = new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    group.posts.unshift({ author, text: text || '', media: media || null, time, likes: 0, comments: [] });
    saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/delete-group-post', (req, res) => {
    const { groupId, login, postIndex } = req.body;
    const group = db.groups[groupId];
    if (!group || !group.posts?.[postIndex]) return res.json({ success: false, error: 'Пост не найден' });

    const post = group.posts[postIndex];
    const isLeader = group.creator === login;
    const myRole = group.roles?.[login] || (isLeader ? 'Лидер' : 'Участник');

    if (!isLeader && myRole !== 'Админ' && post.author !== login) {
        return res.json({ success: false, error: 'Недостаточно прав для удаления поста!' });
    }

    group.posts.splice(postIndex, 1);
    saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/send-message', (req, res) => {
    const { sender, receiver, text, media } = req.body;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msgObj = { sender, receiver, text: text || '', media: media || null, time, edited: false };

    if (!db.messagesStore[sender]) db.messagesStore[sender] = {};
    if (!db.messagesStore[sender][receiver]) db.messagesStore[sender][receiver] = [];
    db.messagesStore[sender][receiver].push(msgObj);

    if (sender !== receiver) {
        if (!db.messagesStore[receiver]) db.messagesStore[receiver] = {};
        if (!db.messagesStore[receiver][sender]) db.messagesStore[receiver][sender] = [];
        db.messagesStore[receiver][sender].push(msgObj);
    }

    saveDb();
    io.to(receiver).emit('receive-message', { sender, receiver, msg: msgObj });
    res.json({ success: true, db });
});

app.post('/api/send-group-message', (req, res) => {
    const { groupId, sender, text, media, subgroup } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msgObj = { sender, text: text || '', media: media || null, time, edited: false };

    if (!subgroup || subgroup === 'main') {
        group.messages.push(msgObj);
    } else {
        const sub = group.subgroups?.find(s => s.id === subgroup);
        if (sub) {
            if (!sub.messages) sub.messages = [];
            sub.messages.push(msgObj);
        }
    }

    saveDb();
    io.to(groupId).emit('receive-group-message', { groupId, msg: msgObj, subgroup: subgroup || 'main' });
    res.json({ success: true, db });
});

app.post('/api/news', (req, res) => {
    const { author, text, media } = req.body;
    const time = new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    db.news.unshift({ author, text: text || '', media: media || null, time, likes: 0, dislikes: 0, comments: [] });
    saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/news-like', (req, res) => {
    const { index } = req.body;
    if (db.news[index]) {
        db.news[index].likes = (db.news[index].likes || 0) + 1;
        saveDb();
        io.emit('update-db', db);
    }
    res.json({ success: true, db });
});

app.post('/api/news-dislike', (req, res) => {
    const { index } = req.body;
    if (db.news[index]) {
        db.news[index].dislikes = (db.news[index].dislikes || 0) + 1;
        saveDb();
        io.emit('update-db', db);
    }
    res.json({ success: true, db });
});

io.on('connection', (socket) => {
    socket.on('register', (login) => {
        socket.login = login;
        socket.join(login);
    });

    socket.on('refresh-db', () => {
        socket.emit('update-db', db);
    });

    socket.on('call-user', ({ to, offer, from }) => {
        io.to(to).emit('incoming-call', { from, offer, isGroup: false });
    });

    socket.on('start-group-conference', ({ groupId, targets, from }) => {
        targets.forEach(targetLogin => {
            io.to(targetLogin).emit('incoming-call', { from, offer: null, isGroup: true, groupId });
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

    socket.on('join-group-call', ({ groupId, login }) => {
        socket.join(groupId);
        const room = io.sockets.adapter.rooms.get(groupId);
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
        socket.to(groupId).emit('user-joined-group-call', { login, socketId: socket.id });
    });

    socket.on('group-signal', ({ toSocketId, signal, fromLogin }) => {
        io.to(toSocketId).emit('group-signal', { fromSocketId: socket.id, signal, fromLogin });
    });

    socket.on('leave-group-call', ({ groupId, login }) => {
        socket.leave(groupId);
        socket.to(groupId).emit('user-left-group-call', { socketId: socket.id });
    });

    socket.on('disconnect', () => {});
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});
