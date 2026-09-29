const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e8
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 1. Указываем Express отдавать статику из папки 'public'
app.use(express.static(path.join(__dirname, 'public')));

// 2. Отдаем index.html из папки 'public' при запросе главной страницы
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Хранилище данных в памяти
let db = {
    users: [],
    messagesStore: {},
    friendRequests: {},
    friends: {},
    news: [],
    customNicknames: {},
    groups: {}
};

const userSockets = {};
const groupCalls = {};

// API Маршруты
app.post('/api/register', (req, res) => {
    const { login, password, avatar } = req.body;
    if (!login || !password) return res.json({ success: false, error: 'Заполните поля' });
    if (db.users.find(u => u.login === login)) return res.json({ success: false, error: 'Пользователь существует' });

    const newUser = { login, password, avatar: avatar || 'https://via.placeholder.com/150', bio: '', email: '' };
    db.users.push(newUser);
    db.messagesStore[login] = {};
    db.friends[login] = [];
    db.friendRequests[login] = [];
    db.customNicknames[login] = {};

    return res.json({ success: true });
});

app.post('/api/login', (req, res) => {
    const { login, password } = req.body;
    const user = db.users.find(u => u.login === login && u.password === password);
    if (!user) return res.json({ success: false, error: 'Неверные данные' });
    return res.json({ success: true, user, db });
});

app.post('/api/update-profile', (req, res) => {
    const { login, avatar, bio, email, password } = req.body;
    const user = db.users.find(u => u.login === login);
    if (!user) return res.json({ success: false, error: 'Не найден' });
    if (avatar) user.avatar = avatar;
    if (bio !== undefined) user.bio = bio;
    if (email !== undefined) user.email = email;
    if (password) user.password = password;
    return res.json({ success: true, user, db });
});

app.post('/api/add-friend', (req, res) => {
    const { login, targetLogin } = req.body;
    if (login === targetLogin) return res.json({ success: false, error: 'Нельзя добавить себя' });
    if (!db.users.find(u => u.login === targetLogin)) return res.json({ success: false, error: 'Не найден' });

    if (!db.friendRequests[targetLogin]) db.friendRequests[targetLogin] = [];
    if (!db.friends[login]) db.friends[login] = [];

    if (db.friends[login].includes(targetLogin)) return res.json({ success: false, error: 'Уже в друзьях' });
    if (db.friendRequests[targetLogin].includes(login)) return res.json({ success: false, error: 'Уже отправлено' });

    db.friendRequests[targetLogin].push(login);
    return res.json({ success: true, db });
});

app.post('/api/respond-friend-request', (req, res) => {
    const { login, requesterLogin, accept } = req.body;
    if (db.friendRequests[login]) {
        db.friendRequests[login] = db.friendRequests[login].filter(r => r !== requesterLogin);
    }
    if (accept) {
        if (!db.friends[login]) db.friends[login] = [];
        if (!db.friends[requesterLogin]) db.friends[requesterLogin] = [];
        if (!db.friends[login].includes(requesterLogin)) db.friends[login].push(requesterLogin);
        if (!db.friends[requesterLogin].includes(login)) db.friends[requesterLogin].push(login);
    }
    return res.json({ success: true, db });
});

app.post('/api/remove-friend', (req, res) => {
    const { login, targetLogin } = req.body;
    if (db.friends[login]) db.friends[login] = db.friends[login].filter(f => f !== targetLogin);
    if (db.friends[targetLogin]) db.friends[targetLogin] = db.friends[targetLogin].filter(f => f !== login);
    return res.json({ success: true, db });
});

app.post('/api/set-nickname', (req, res) => {
    const { owner, target, nickname } = req.body;
    if (!db.customNicknames[owner]) db.customNicknames[owner] = {};
    db.customNicknames[owner][target] = nickname;
    return res.json({ success: true, db });
});

app.post('/api/send-message', (req, res) => {
    const { sender, receiver, text, media } = req.body;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msgObj = { sender, text, media, time, edited: false };

    if (!db.messagesStore[sender]) db.messagesStore[sender] = {};
    if (!db.messagesStore[sender][receiver]) db.messagesStore[sender][receiver] = [];
    db.messagesStore[sender][receiver].push(msgObj);

    if (sender !== receiver) {
        if (!db.messagesStore[receiver]) db.messagesStore[receiver] = {};
        if (!db.messagesStore[receiver][sender]) db.messagesStore[receiver][sender] = [];
        db.messagesStore[receiver][sender].push(msgObj);
    }
    return res.json({ success: true, db });
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
    return res.json({ success: true, db });
});

app.post('/api/delete-message', (req, res) => {
    const { sender, receiver, msgIndex } = req.body;
    if (db.messagesStore[sender]?.[receiver]) db.messagesStore[sender][receiver].splice(msgIndex, 1);
    if (sender !== receiver && db.messagesStore[receiver]?.[sender]) db.messagesStore[receiver][sender].splice(msgIndex, 1);
    return res.json({ success: true, db });
});

app.post('/api/create-group', (req, res) => {
    const { name, creator } = req.body;
    const groupId = 'group_' + Date.now();
    db.groups[groupId] = { id: groupId, name, creator, members: [creator], messages: [] };
    return res.json({ success: true, db });
});

app.post('/api/join-group', (req, res) => {
    const { groupId, login } = req.body;
    const group = db.groups[groupId];
    if (group && !group.members.includes(login)) group.members.push(login);
    return res.json({ success: true, db });
});

app.post('/api/send-group-message', (req, res) => {
    const { groupId, sender, text, media } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    group.messages.push({ sender, text, media, time, edited: false });
    return res.json({ success: true, db });
});

app.post('/api/edit-group-message', (req, res) => {
    const { groupId, msgIndex, newText } = req.body;
    const group = db.groups[groupId];
    if (group && group.messages[msgIndex]) {
        group.messages[msgIndex].text = newText;
        group.messages[msgIndex].edited = true;
    }
    return res.json({ success: true, db });
});

app.post('/api/delete-group-message', (req, res) => {
    const { groupId, msgIndex } = req.body;
    const group = db.groups[groupId];
    if (group && group.messages[msgIndex]) group.messages.splice(msgIndex, 1);
    return res.json({ success: true, db });
});

app.post('/api/news', (req, res) => {
    const { author, text, media } = req.body;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    db.news.unshift({ id: 'post_' + Date.now(), author, text, media, time });
    return res.json({ success: true, db });
});

// Socket.io
io.on('connection', (socket) => {
    socket.on('register', (login) => {
        userSockets[login] = socket.id;
        socket.login = login;
    });

    socket.on('typing', ({ from, to, isGroup }) => {
        if (isGroup) {
            socket.broadcast.emit('user-typing', { from, to, isGroup });
        } else {
            const target = userSockets[to];
            if (target) io.to(target).emit('user-typing', { from, to, isGroup });
        }
    });

    socket.on('stop-typing', ({ from, to, isGroup }) => {
        if (isGroup) {
            socket.broadcast.emit('user-stop-typing', { from });
        } else {
            const target = userSockets[to];
            if (target) io.to(target).emit('user-stop-typing', { from });
        }
    });

    socket.on('call-user', ({ to, offer, from }) => {
        const target = userSockets[to];
        if (target) io.to(target).emit('incoming-call', { from, offer });
    });

    socket.on('call-accepted', ({ to, answer }) => {
        const target = userSockets[to];
        if (target) io.to(target).emit('call-answered', { answer });
    });

    socket.on('ice-candidate', ({ to, candidate }) => {
        const target = userSockets[to];
        if (target) io.to(target).emit('ice-candidate', { candidate });
    });

    socket.on('hang-up', ({ to }) => {
        const target = userSockets[to];
        if (target) io.to(target).emit('hang-up');
    });

    socket.on('join-group-call', ({ groupId, login }) => {
        socket.join(groupId);
        if (!groupCalls[groupId]) groupCalls[groupId] = [];
        socket.emit('group-call-users', groupCalls[groupId].filter(u => u.socketId !== socket.id));
        groupCalls[groupId].push({ socketId: socket.id, login });
        socket.to(groupId).emit('user-joined-group-call', { login, socketId: socket.id });
    });

    socket.on('group-signal', ({ toSocketId, signal, fromLogin }) => {
        io.to(toSocketId).emit('group-signal', { fromSocketId: socket.id, signal, fromLogin });
    });

    socket.on('leave-group-call', ({ groupId }) => {
        socket.leave(groupId);
        if (groupCalls[groupId]) {
            groupCalls[groupId] = groupCalls[groupId].filter(u => u.socketId !== socket.id);
            socket.to(groupId).emit('user-left-group-call', { socketId: socket.id });
        }
    });

    socket.on('disconnect', () => {
        if (socket.login && userSockets[socket.login] === socket.id) {
            delete userSockets[socket.login];
        }
        for (const groupId in groupCalls) {
            const len = groupCalls[groupId].length;
            groupCalls[groupId] = groupCalls[groupId].filter(u => u.socketId !== socket.id);
            if (groupCalls[groupId].length < len) {
                io.to(groupId).emit('user-left-group-call', { socketId: socket.id });
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
