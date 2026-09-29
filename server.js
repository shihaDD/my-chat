const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DB_FILE = path.join(__dirname, 'database.json');

// Инициализация базы данных
function loadDB() {
    if (fs.existsSync(DB_FILE)) {
        try {
            const data = fs.readFileSync(DB_FILE, 'utf8');
            return JSON.parse(data);
        } catch (e) {
            console.error('Ошибка чтения database.json, создаем новую базу:', e);
        }
    }
    return {
        users: {},
        friends: {},
        friendRequests: {},
        nicknames: {},
        messagesStore: {},
        groups: {},
        lastSeen: {}
    };
}

function saveDB(db) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
    } catch (e) {
        console.error('Ошибка сохранения database.json:', e);
    }
}

let db = loadDB();

// API: Получить все данные
app.get('/api/data', (req, res) => {
    res.json(db);
});

// Регистрация
app.post('/api/register', (req, res) => {
    const { login, name, password, email, avatar } = req.body;
    const cleanLogin = login ? login.trim().toLowerCase() : '';

    if (!cleanLogin || !name || !password) {
        return res.json({ success: false, error: 'Заполните обязательные поля!' });
    }
    if (db.users[cleanLogin]) {
        return res.json({ success: false, error: 'Такой логин уже занят!' });
    }

    db.users[cleanLogin] = {
        login: cleanLogin,
        name: name.trim(),
        password: password,
        email: email ? email.trim() : '',
        avatar: avatar || '',
        lastLoginTime: new Date().toLocaleString()
    };

    if (!db.friends[cleanLogin]) db.friends[cleanLogin] = [];
    if (!db.friendRequests[cleanLogin]) db.friendRequests[cleanLogin] = [];
    if (!db.messagesStore[cleanLogin]) db.messagesStore[cleanLogin] = {};
    if (!db.nicknames[cleanLogin]) db.nicknames[cleanLogin] = {};

    saveDB(db);
    res.json({ success: true, user: db.users[cleanLogin], db });
});

// Вход
app.post('/api/login', (req, res) => {
    const { login, password } = req.body;
    const cleanLogin = login ? login.trim().toLowerCase() : '';

    const user = db.users[cleanLogin];
    if (!user) {
        return res.json({ success: false, error: 'Пользователь с таким логином не найден!' });
    }
    if (user.password !== password) {
        return res.json({ success: false, error: 'Неверный пароль!' });
    }

    user.lastLoginTime = new Date().toLocaleString();
    saveDB(db);
    res.json({ success: true, user, db });
});

// Пинг активности
app.post('/api/ping', (req, res) => {
    const { login } = req.body;
    if (login && db.users[login]) {
        if (!db.lastSeen) db.lastSeen = {};
        db.lastSeen[login] = Date.now();
    }
    res.json({ success: true });
});

// Добавить в друзья (отправить заявку)
app.post('/api/add-friend', (req, res) => {
    const { login, targetLogin } = req.body;
    const cleanTarget = targetLogin ? targetLogin.trim().toLowerCase() : '';

    if (!db.users[cleanTarget]) {
        return res.json({ success: false, error: 'Пользователь не найден!' });
    }
    if (cleanTarget === login) {
        return res.json({ success: false, error: 'Нельзя добавить самого себя!' });
    }

    if (!db.friends[login]) db.friends[login] = [];
    if (db.friends[login].includes(cleanTarget)) {
        return res.json({ success: false, error: 'Вы уже друзья!' });
    }

    if (!db.friendRequests[cleanTarget]) db.friendRequests[cleanTarget] = [];
    if (db.friendRequests[cleanTarget].includes(login)) {
        return res.json({ success: false, error: 'Заявка уже отправлена!' });
    }

    db.friendRequests[cleanTarget].push(login);
    saveDB(db);
    res.json({ success: true, db });
});

// Принять / отклонить заявку в друзья
app.post('/api/respond-friend-request', (req, res) => {
    const { login, requesterLogin, accept } = req.body;
    if (!db.friendRequests[login]) return res.json({ success: false });

    db.friendRequests[login] = db.friendRequests[login].filter(l => l !== requesterLogin);

    if (accept) {
        if (!db.friends[login]) db.friends[login] = [];
        if (!db.friends[requesterLogin]) db.friends[requesterLogin] = [];

        if (!db.friends[login].includes(requesterLogin)) db.friends[login].push(requesterLogin);
        if (!db.friends[requesterLogin].includes(login)) db.friends[requesterLogin].push(login);
    }

    saveDB(db);
    res.json({ success: true, db });
});

// Создать сообщество
app.post('/api/create-group', (req, res) => {
    const { name, creator } = req.body;
    if (!name || !creator) return res.json({ success: false, error: 'Заполните название группы' });

    const groupId = 'group_' + Date.now();
    db.groups[groupId] = {
        id: groupId,
        name: name.trim(),
        creator: creator,
        avatar: '',
        members: [creator],
        roles: { [creator]: 'Создатель' },
        messages: []
    };

    saveDB(db);
    res.json({ success: true, db });
});

// Вступить в сообщество
app.post('/api/join-group', (req, res) => {
    const { groupId, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Сообщество не найдено' });

    if (!group.members.includes(login)) {
        group.members.push(login);
        if (!group.roles) group.roles = {};
        group.roles[login] = 'Участник';
        saveDB(db);
    }
    res.json({ success: true, db });
});

// Отправить личное сообщение
app.post('/api/send-message', (req, res) => {
    const { sender, receiver, text, media } = req.body;
    if (!db.messagesStore[sender]) db.messagesStore[sender] = {};
    if (!db.messagesStore[sender][receiver]) db.messagesStore[sender][receiver] = [];

    if (!db.messagesStore[receiver]) db.messagesStore[receiver] = {};
    if (!db.messagesStore[receiver][sender]) db.messagesStore[receiver][sender] = [];

    const msg = {
        sender,
        text: text || '',
        media: media || null,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    db.messagesStore[sender][receiver].push(msg);
    if (sender !== receiver) {
        db.messagesStore[receiver][sender].push(msg);
    }

    saveDB(db);
    res.json({ success: true, db });
});

// Отправить сообщение в сообщество (от имени группы, доступно создателю/админам)
app.post('/api/send-group-message', (req, res) => {
    const { groupId, sender, text, media } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Сообщество не найдено' });

    const role = group.roles?.[sender] || (group.creator === sender ? 'Создатель' : 'Участник');
    if (group.creator !== sender && role !== 'Администратор') {
        return res.json({ success: false, error: 'Только создатель и администраторы могут писать от имени сообщества!' });
    }

    const msg = {
        sender,
        text: text || '',
        media: media || null,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    group.messages.push(msg);
    saveDB(db);
    res.json({ success: true, db });
});

// Управление ролями в группе
app.post('/api/set-group-role', (req, res) => {
    const { groupId, login, targetLogin, newRole } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false });

    if (group.creator !== login) {
        return res.json({ success: false, error: 'Только создатель может менять роли!' });
    }

    if (!group.roles) group.roles = {};
    group.roles[targetLogin] = newRole;
    saveDB(db);
    res.json({ success: true, db });
});

// Обновление настроек группы
app.post('/api/update-group', (req, res) => {
    const { groupId, login, name } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false });

    const role = group.roles?.[login] || (group.creator === login ? 'Создатель' : 'Участник');
    if (group.creator !== login && role !== 'Администратор') {
        return res.json({ success: false, error: 'Недостаточно прав!' });
    }

    if (name) group.name = name.trim();

    saveDB(db);
    res.json({ success: true, db });
});

// Псевдонимы контактов
app.post('/api/set-nickname', (req, res) => {
    const { login, targetLogin, nickname } = req.body;
    if (!db.nicknames[login]) db.nicknames[login] = {};
    db.nicknames[login][targetLogin] = nickname ? nickname.trim() : '';
    saveDB(db);
    res.json({ success: true, db });
});

// WebRTC Signaling
io.on('connection', (socket) => {
    socket.on('register', (login) => {
        if (login) socket.join(login);
    });

    socket.on('call-user', ({ to, offer, from }) => {
        io.to(to).emit('incoming-call', { from, offer });
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
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
