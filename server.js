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

// База данных по умолчанию
let db = {
    users: {},          // login -> { login, name, password, email, avatar, bio }
    messagesStore: {},  // login -> { partnerLogin -> [ { sender, text, media, time, edited } ] }
    friends: {},        // login -> [ friendLogins ]
    friendRequests: {}, // login -> [ requesterLogins ]
    nicknames: {},      // login -> { targetLogin -> customNickname }
    groups: {},         // groupId -> { id, name, creator, members: [], roles: {}, messages: [] }
    lastSeen: {}        // login -> timestamp
};

// Загрузка базы данных с диска
if (fs.existsSync(DB_FILE)) {
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        db = { ...db, ...JSON.parse(data) };
    } catch (e) {
        console.error('Ошибка чтения database.json, используется пустая база:', e);
    }
}

function saveDb() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
    } catch (e) {
        console.error('Ошибка сохранения базы данных:', e);
    }
}

// REST API эндпоинты
app.get('/api/data', (req, res) => {
    res.json(db);
});

// Актуальная лента новостей
app.get('/api/news', async (req, res) => {
    try {
        const response = await fetch('https://saurav.tech/NewsAPI/top-headlines/category/technology/in.json');
        if (response.ok) {
            const data = await response.json();
            if (data.articles && data.articles.length > 0) {
                const formatted = data.articles.slice(0, 10).map(item => ({
                    title: item.title || 'Новость без названия',
                    description: item.description || 'Описание отсутствует',
                    url: item.url || '#',
                    image: item.urlToImage || '',
                    publishedAt: new Date(item.publishedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    source: item.source?.name || 'Технологии'
                }));
                return res.json({ success: true, articles: formatted });
            }
        }
    } catch (e) {}

    // Резервная актуальная лента новостей
    res.json({
        success: true,
        articles: [
            {
                title: '⚡ В мессенджере запущены совместные групповые звонки и синхронизация TikTok',
                description: 'Теперь пользователи могут общаться несколькими участниками в одном звонке и вместе смотреть видео в реальном времени.',
                url: '#',
                image: '',
                publishedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                source: 'Новости Мессенджера'
            },
            {
                title: '🚀 Развитие технологий совместного просмотра контента',
                description: 'Синхронный скролл медиалент становится основным трендом среди современных платформ общения.',
                url: '#',
                image: '',
                publishedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                source: 'Tech Today'
            },
            {
                title: '🎮 Обновления и новинки в игровой индустрии',
                description: 'Анонсированы свежие игры и сетевые режимы для совместной игры с друзьями.',
                url: '#',
                image: '',
                publishedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                source: 'Игровые Вести'
            }
        ]
    });
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
    const { login, name, email, bio, avatar } = req.body;
    if (!login || !db.users[login]) return res.json({ success: false, error: 'Пользователь не найден' });
    if (name) db.users[login].name = name.trim();
    if (email !== undefined) db.users[login].email = email.trim();
    if (bio !== undefined) db.users[login].bio = bio.trim();
    if (avatar) db.users[login].avatar = avatar;
    saveDb();
    res.json({ success: true, user: db.users[login], db });
});

app.post('/api/set-nickname', (req, res) => {
    const { login, targetLogin, nickname } = req.body;
    if (!db.nicknames[login]) db.nicknames[login] = {};
    if (!nickname.trim()) {
        delete db.nicknames[login][targetLogin];
    } else {
        db.nicknames[login][targetLogin] = nickname.trim();
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

app.post('/api/create-group', (req, res) => {
    const { name, creator } = req.body;
    if (!name || !creator) return res.json({ success: false, error: 'Недостаточно данных' });

    const groupId = 'group_' + Date.now();
    db.groups[groupId] = {
        id: groupId,
        name: name.trim(),
        creator: creator,
        members: [creator],
        roles: { [creator]: 'Создатель' },
        messages: [],
        avatar: ''
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

app.post('/api/update-group', (req, res) => {
    const { groupId, login, name } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Сообщество не найдено' });

    if (group.creator !== login && group.roles[login] !== 'Администратор') {
        return res.json({ success: false, error: 'Недостаточно прав для редактирования' });
    }

    if (name) group.name = name.trim();
    saveDb();
    res.json({ success: true, db });
});

app.post('/api/set-group-role', (req, res) => {
    const { groupId, login, targetLogin, newRole } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Сообщество не найдено' });

    if (group.creator !== login) {
        return res.json({ success: false, error: 'Только создатель может менять роли' });
    }

    if (targetLogin === group.creator) {
        return res.json({ success: false, error: 'Нельзя изменить роль создателя' });
    }

    if (!group.roles) group.roles = {};
    group.roles[targetLogin] = newRole;
    saveDb();
    res.json({ success: true, db });
});

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

    const myRole = group.roles?.[sender] || (group.creator === sender ? 'Создатель' : 'Участник');
    if (group.creator !== sender && myRole !== 'Администратор') {
        return res.json({ success: false, error: 'Нет прав на отправку сообщений в сообщество' });
    }

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
    const myRole = group.roles?.[sender] || (group.creator === sender ? 'Создатель' : 'Участник');
    if (msg.sender !== sender && group.creator !== sender && myRole !== 'Администратор') {
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
    const myRole = group.roles?.[sender] || (group.creator === sender ? 'Создатель' : 'Участник');
    if (msg.sender !== sender && group.creator !== sender && myRole !== 'Администратор') {
        return res.json({ success: false, error: 'Нет прав на удаление' });
    }
    group.messages.splice(msgIndex, 1);
    saveDb();
    res.json({ success: true, db });
});

// Socket.io для мульти-звонков, статусов, совместного скролла и ввода
const activeSockets = {}; // login -> socket.id
const socketUsers = {};   // socket.id -> login
const callRooms = {};     // roomId -> Set of logins

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

    // --- ЛОГИКА ГРУППОВЫХ И СОВМЕСТНЫХ ЗВОНКОВ ---
    socket.on('join-call-room', ({ roomId, login }) => {
        socket.join(roomId);
        if (!callRooms[roomId]) callRooms[roomId] = new Set();
        
        const existingMembers = Array.from(callRooms[roomId]);
        callRooms[roomId].add(login);

        // Отправляем подключившемуся список участников
        socket.emit('call-room-members', { members: existingMembers, roomId });

        // Оповещаем остальных в комнате о новом пользователе
        socket.to(roomId).emit('user-joined-call', { login, roomId });
    });

    socket.on('invite-user-to-call', ({ to, roomId, fromLogin, fromName }) => {
        const targetSocketId = activeSockets[to];
        if (targetSocketId) {
            io.to(targetSocketId).emit('incoming-call-invite', { from: fromLogin, fromName, roomId });
        }
    });

    socket.on('call-signal', ({ targetLogin, signal, fromLogin, roomId }) => {
        const targetSocketId = activeSockets[targetLogin];
        if (targetSocketId) {
            io.to(targetSocketId).emit('call-signal', { signal, fromLogin, roomId });
        }
    });

    socket.on('leave-call-room', ({ roomId, login }) => {
        socket.leave(roomId);
        if (callRooms[roomId]) {
            callRooms[roomId].delete(login);
            if (callRooms[roomId].size === 0) delete callRooms[roomId];
        }
        socket.to(roomId).emit('user-left-call', { login, roomId });
    });

    // --- СОВМЕСТНЫЙ СКРОЛЛ TIKTOK ---
    socket.on('tiktok-sync-scroll', ({ videoIndex, sender }) => {
        socket.broadcast.emit('tiktok-scroll-event', { videoIndex, sender });
    });

    socket.on('disconnect', () => {
        const login = socketUsers[socket.id];
        if (login) {
            db.lastSeen[login] = Date.now();
            delete activeSockets[login];
            delete socketUsers[socket.id];

            for (const [roomId, members] of Object.entries(callRooms)) {
                if (members.has(login)) {
                    members.delete(login);
                    socket.to(roomId).emit('user-left-call', { login, roomId });
                    if (members.size === 0) delete callRooms[roomId];
                }
            }
        }
        saveDb();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
