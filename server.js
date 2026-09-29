const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname)));

const DB_FILE = path.join(__dirname, 'database.json');

// Базовая инициализация базы данных, если файл отсутствует
function loadDB() {
    if (!fs.existsSync(DB_FILE)) {
        const initialDB = {
            users: {},
            friends: {},
            friendRequests: {},
            messagesStore: {},
            groups: {},
            nicknames: {},
            lastSeen: {}
        };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialDB, null, 2));
    }
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return { users: {}, friends: {}, friendRequests: {}, messagesStore: {}, groups: {}, nicknames: {}, lastSeen: {} };
    }
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// REST API эндпоинты
app.get('/api/data', (req, res) => {
    const db = loadDB();
    res.json(db);
});

app.post('/api/register', (req, res) => {
    const { login, name, password, email, avatar } = req.body;
    const db = loadDB();
    if (!login || !name || !password) {
        return res.json({ success: false, error: 'Заполните все обязательные поля' });
    }
    if (db.users[login]) {
        return res.json({ success: false, error: 'Пользователь с таким логином уже существует' });
    }

    db.users[login] = { login, name, password, email, avatar };
    db.friends[login] = [];
    db.friendRequests[login] = [];
    db.messagesStore[login] = {};
    db.nicknames[login] = {};
    saveDB(db);

    res.json({ success: true, user: db.users[login], db });
});

app.post('/api/login', (req, res) => {
    const { login, password } = req.body;
    const db = loadDB();
    const user = db.users[login];
    if (!user || user.password !== password) {
        return res.json({ success: false, error: 'Неверный логин или пароль' });
    }
    res.json({ success: true, user, db });
});

// Сохранение локального псевдонима контакта
app.post('/api/set-nickname', (req, res) => {
    const { login, targetLogin, nickname } = req.body;
    const db = loadDB();
    if (!db.nicknames[login]) db.nicknames[login] = {};
    if (!nickname.trim()) {
        delete db.nicknames[login][targetLogin];
    } else {
        db.nicknames[login][targetLogin] = nickname.trim();
    }
    saveDB(db);
    res.json({ success: true, db });
});

app.post('/api/add-friend', (req, res) => {
    const { login, targetLogin } = req.body;
    const db = loadDB();
    if (!db.users[targetLogin]) {
        return res.json({ success: false, error: 'Пользователь с таким логином не найден' });
    }
    if (login === targetLogin) {
        return res.json({ success: false, error: 'Нельзя добавить самого себя в друзья' });
    }
    if (db.friends[login] && db.friends[login].includes(targetLogin)) {
        return res.json({ success: false, error: 'Этот пользователь уже у вас в друзьях' });
    }

    if (!db.friendRequests[targetLogin]) db.friendRequests[targetLogin] = [];
    if (!db.friendRequests[targetLogin].includes(login)) {
        db.friendRequests[targetLogin].push(login);
    }
    saveDB(db);
    res.json({ success: true, db });
});

app.post('/api/respond-friend-request', (req, res) => {
    const { login, requesterLogin, accept } = req.body;
    const db = loadDB();
    if (db.friendRequests[login]) {
        db.friendRequests[login] = db.friendRequests[login].filter(l => l !== requesterLogin);
    }
    if (accept) {
        if (!db.friends[login]) db.friends[login] = [];
        if (!db.friends[login].includes(requesterLogin)) db.friends[login].push(requesterLogin);

        if (!db.friends[requesterLogin]) db.friends[requesterLogin] = [];
        if (!db.friends[requesterLogin].includes(login)) db.friends[requesterLogin].push(login);
    }
    saveDB(db);
    res.json({ success: true, db });
});

app.post('/api/send-message', (req, res) => {
    const { sender, receiver, text, media } = req.body;
    const db = loadDB();
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msgObj = { sender, text, media, time };

    if (!db.messagesStore[sender]) db.messagesStore[sender] = {};
    if (!db.messagesStore[sender][receiver]) db.messagesStore[sender][receiver] = [];
    db.messagesStore[sender][receiver].push(msgObj);

    if (sender !== receiver) {
        if (!db.messagesStore[receiver]) db.messagesStore[receiver] = {};
        if (!db.messagesStore[receiver][sender]) db.messagesStore[receiver][sender] = [];
        db.messagesStore[receiver][sender].push(msgObj);
    }

    saveDB(db);
    res.json({ success: true, db });
});

app.post('/api/create-group', (req, res) => {
    const { name, creator } = req.body;
    const db = loadDB();
    const groupId = 'group_' + Date.now();
    db.groups[groupId] = {
        id: groupId,
        name,
        creator,
        members: [creator],
        roles: { [creator]: 'Создатель' },
        messages: []
    };
    saveDB(db);
    res.json({ success: true, db });
});

app.post('/api/join-group', (req, res) => {
    const { groupId, login } = req.body;
    const db = loadDB();
    const group = db.groups[groupId];
    if (group && !group.members.includes(login)) {
        group.members.push(login);
        if (!group.roles) group.roles = {};
        group.roles[login] = 'Участник';
        saveDB(db);
    }
    res.json({ success: true, db });
});

app.post('/api/send-group-message', (req, res) => {
    const { groupId, sender, text, media } = req.body;
    const db = loadDB();
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    const role = group.roles?.[sender] || (group.creator === sender ? 'Создатель' : 'Участник');
    if (group.creator !== sender && role !== 'Администратор') {
        return res.json({ success: false, error: 'Недостаточно прав для отправки сообщений' });
    }

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msgObj = { sender, text, media, time };
    group.messages.push(msgObj);
    saveDB(db);
    res.json({ success: true, db });
});

app.post('/api/update-group', (req, res) => {
    const { groupId, login, name } = req.body;
    const db = loadDB();
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    if (group.creator !== login) return res.json({ success: false, error: 'Только создатель может изменять настройки' });

    if (name) group.name = name;
    saveDB(db);
    res.json({ success: true, db });
});

app.post('/api/set-group-role', (req, res) => {
    const { groupId, login, targetLogin, newRole } = req.body;
    const db = loadDB();
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    if (group.creator !== login) return res.json({ success: false, error: 'Только создатель может назначать роли' });

    if (!group.roles) group.roles = {};
    group.roles[targetLogin] = newRole;
    saveDB(db);
    res.json({ success: true, db });
});

// Сокеты для WebRTC и статусов в реальном времени
const onlineUsers = new Map();

io.on('connection', (socket) => {
    socket.on('register', (login) => {
        onlineUsers.set(login, socket.id);
        socket.login = login;
        const db = loadDB();
        if (!db.lastSeen) db.lastSeen = {};
        db.lastSeen[login] = Date.now();
        saveDB(db);
    });

    // Обработка статусов "печатает..." / "отправляет фото..."
    socket.on('typing', (data) => {
        const targetSocketId = onlineUsers.get(data.to);
        if (targetSocketId) {
            io.to(targetSocketId).emit('user-typing', data);
        }
    });

    socket.on('call-user', ({ to, offer, from }) => {
        const targetSocketId = onlineUsers.get(to);
        if (targetSocketId) {
            io.to(targetSocketId).emit('incoming-call', { from, offer });
        }
    });

    socket.on('call-accepted', ({ to, answer }) => {
        const targetSocketId = onlineUsers.get(to);
        if (targetSocketId) {
            io.to(targetSocketId).emit('call-answered', { answer });
        }
    });

    socket.on('ice-candidate', ({ to, candidate }) => {
        const targetSocketId = onlineUsers.get(to);
        if (targetSocketId) {
            io.to(targetSocketId).emit('ice-candidate', { candidate });
        }
    });

    socket.on('hang-up', ({ to }) => {
        const targetSocketId = onlineUsers.get(to);
        if (targetSocketId) {
            io.to(targetSocketId).emit('hang-up');
        }
    });

    socket.on('disconnect', () => {
        if (socket.login) {
            const db = loadDB();
            if (!db.lastSeen) db.lastSeen = {};
            db.lastSeen[socket.login] = Date.now();
            saveDB(db);
            onlineUsers.delete(socket.login);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
