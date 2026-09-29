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
    settings: {},       // Настройки пользователя (клавиши, мышь)
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

app.post('/api/register', (req, res) => {
    const { login, name, password, email, avatar } = req.body;
    if (!login || !name || !password) {
        return res.json({ success: false, error: 'Заполните обязательные поля!' });
    }
    const cleanLogin = login.trim().toLowerCase();
    if (db.users[cleanLogin]) {
        return res.json({ success: false, error: 'Пользователь уже существует!' });
    }

    db.users[cleanLogin] = { login: cleanLogin, name, password, email: email || '', avatar: avatar || '' };
    db.friends[cleanLogin] = [];
    db.friendRequests[cleanLogin] = [];
    db.settings[cleanLogin] = { keybinds: { mute: 'M', call: 'Enter' }, mouseDevice: 'Стандартная мышь' };
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

    if (!db.settings[cleanLogin]) {
        db.settings[cleanLogin] = { keybinds: { mute: 'M', call: 'Enter' }, mouseDevice: 'Стандартная мышь' };
    }

    db.lastSeen[cleanLogin] = Date.now();
    saveDb();
    res.json({ success: true, user, db });
});

app.post('/api/update-settings', (req, res) => {
    const { login, keybinds, mouseDevice } = req.body;
    if (!login || !db.users[login]) return res.json({ success: false, error: 'Пользователь не найден' });

    if (!db.settings[login]) db.settings[login] = { keybinds: {}, mouseDevice: '' };
    if (keybinds) db.settings[login].keybinds = { ...db.settings[login].keybinds, ...keybinds };
    if (mouseDevice !== undefined) db.settings[login].mouseDevice = mouseDevice;

    saveDb();
    res.json({ success: true, settings: db.settings[login], db });
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

    if (!db.users[cleanTarget]) return res.json({ success: false, error: 'Пользователь не найден!' });
    if (cleanTarget === login) return res.json({ success: false, error: 'Нельзя добавить самого себя!' });
    if (db.friends[login]?.includes(cleanTarget)) return res.json({ success: false, error: 'Вы уже друзья!' });

    if (!db.friendRequests[cleanTarget]) db.friendRequests[cleanTarget] = [];
    if (db.friendRequests[cleanTarget].includes(login)) return res.json({ success: false, error: 'Заявка уже отправлена!' });

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

app.post('/api/send-message', (req, res) => {
    const { sender, receiver, text, media } = req.body;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msgObj = { sender, text: text || '', media: media || null, time };

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

const activeSockets = {};
io.on('connection', (socket) => {
    socket.on('register', (login) => {
        if (login) {
            activeSockets[login] = socket.id;
            db.lastSeen[login] = Date.now();
        }
    });

    socket.on('call-user', ({ to, offer, from }) => {
        const targetSocketId = activeSockets[to];
        if (targetSocketId) io.to(targetSocketId).emit('incoming-call', { from, offer });
    });

    socket.on('call-accepted', ({ to, answer }) => {
        const targetSocketId = activeSockets[to];
        if (targetSocketId) io.to(targetSocketId).emit('call-answered', { answer });
    });

    socket.on('ice-candidate', ({ to, candidate }) => {
        const targetSocketId = activeSockets[to];
        if (targetSocketId) io.to(targetSocketId).emit('ice-candidate', { candidate });
    });

    socket.on('hang-up', ({ to }) => {
        const targetSocketId = activeSockets[to];
        if (targetSocketId) io.to(targetSocketId).emit('hang-up');
    });

    socket.on('disconnect', () => {
        for (const [login, sId] of Object.entries(activeSockets)) {
            if (sId === socket.id) {
                db.lastSeen[login] = Date.now();
                delete activeSockets[login];
                break;
            }
        }
        saveDb();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен: http://localhost:${PORT}`);
});
