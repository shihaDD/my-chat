const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Увеличиваем лимит для JSON, чтобы можно было принимать картинки/файлы в base64
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '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';
const REPO_OWNER = 'shihaDD';
const REPO_NAME = 'Chat-Database';
const FILE_PATH = 'database.json';

async function loadDatabase() {
    try {
        if (fs.existsSync(FILE_PATH)) {
            const data = fs.readFileSync(FILE_PATH, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.log('Локального файла нет, загружаем с GitHub...');
    }

    try {
        const response = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`, {
            headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'User-Agent': 'NodeJS-Server' }
        });
        if (response.ok) {
            const json = await response.json();
            const content = Buffer.from(json.content, 'base64').toString('utf8');
            fs.writeFileSync(FILE_PATH, content, 'utf8');
            return JSON.parse(content);
        }
    } catch (e) {
        console.error('Ошибка загрузки с GitHub:', e);
    }

    return { "users": {}, "friends": {}, "messagesStore": {}, "lastSeen": {}, "groups": {} };
}

async function saveDatabase(dbData) {
    const jsonString = JSON.stringify(dbData, null, 2);
    fs.writeFileSync(FILE_PATH, jsonString, 'utf8');

    try {
        const getRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`, {
            headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'User-Agent': 'NodeJS-Server' }
        });
        let fileSha = getRes.ok ? (await getRes.json()).sha : '';
        const contentEncoded = Buffer.from(jsonString, 'utf8').toString('base64');

        await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`, {
            method: 'PUT',
            headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'User-Agent': 'NodeJS-Server', 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'Update via V Odno Eblo', content: contentEncoded, sha: fileSha })
        });
    } catch (e) {
        console.error('Ошибка коммита на GitHub:', e);
    }
}

app.get('/api/data', async (req, res) => {
    const db = await loadDatabase();
    res.json(db);
});

app.get('/api/check-login/:login', async (req, res) => {
    const login = req.params.login.trim().toLowerCase();
    const db = await loadDatabase();
    res.json({ exists: !!db.users?.[login] });
});

// Регистрация с поддержкой аватара
app.post('/api/register', async (req, res) => {
    let { login, name, password, avatar } = req.body;
    if (!login || !name || !password) return res.status(400).json({ success: false, error: 'Заполните все поля' });
    
    login = login.trim().toLowerCase();
    name = name.trim();

    let db = await loadDatabase();
    if (!db.users) db.users = {};
    if (!db.friends) db.friends = {};
    if (!db.messagesStore) db.messagesStore = {};
    if (!db.lastSeen) db.lastSeen = {};
    if (!db.groups) db.groups = {};

    if (db.users[login]) {
        return res.status(400).json({ success: false, error: 'Логин уже занят' });
    }

    db.users[login] = { 
        login, 
        name, 
        password, 
        avatar: avatar || 'https://api.iconify.design/lucide:user.svg?color=%2366fcf1',
        lastLoginTime: new Date().toLocaleString()
    };
    db.friends[login] = [];
    db.messagesStore[login] = {};
    db.lastSeen[login] = Date.now();

    await saveDatabase(db);
    res.json({ success: true, user: db.users[login], db });
});

// Вход с обновлением последнего времени входа
app.post('/api/login', async (req, res) => {
    let { login, password } = req.body;
    if (!login || !password) return res.status(400).json({ success: false, error: 'Заполните все поля' });

    login = login.trim().toLowerCase();
    let db = await loadDatabase();

    const user = db.users?.[login];
    if (!user || user.password !== password) {
        return res.status(400).json({ success: false, error: 'Неверный логин или пароль' });
    }

    user.lastLoginTime = new Date().toLocaleString();
    db.lastSeen[login] = Date.now();
    await saveDatabase(db);
    res.json({ success: true, user, db });
});

// Обновление профиля (имя, аватар)
app.post('/api/update-profile', async (req, res) => {
    let { login, name, avatar } = req.body;
    let db = await loadDatabase();
    if (!db.users?.[login]) return res.status(400).json({ success: false, error: 'Пользователь не найден' });

    if (name) db.users[login].name = name.trim();
    if (avatar) db.users[login].avatar = avatar;

    await saveDatabase(db);
    res.json({ success: true, user: db.users[login], db });
});

app.post('/api/ping', async (req, res) => {
    const { login } = req.body;
    if (!login) return res.sendStatus(400);
    let db = await loadDatabase();
    if (!db.lastSeen) db.lastSeen = {};
    db.lastSeen[login] = Date.now();
    await saveDatabase(db);
    res.json({ success: true });
});

app.post('/api/add-friend', async (req, res) => {
    let { login, targetLogin } = req.body;
    login = login ? login.trim().toLowerCase() : '';
    targetLogin = targetLogin ? targetLogin.trim().toLowerCase().replace('@', '') : '';
    
    let db = await loadDatabase();

    if (!db.users?.[targetLogin]) {
        return res.status(400).json({ success: false, error: `Пользователь @${targetLogin} не найден!` });
    }
    if (targetLogin === login) {
        return res.status(400).json({ success: false, error: 'Нельзя добавить самого себя!' });
    }

    if (!db.friends[login]) db.friends[login] = [];
    if (!db.friends[login].includes(targetLogin)) db.friends[login].push(targetLogin);

    if (!db.friends[targetLogin]) db.friends[targetLogin] = [];
    if (!db.friends[targetLogin].includes(login)) db.friends[targetLogin].push(login);

    await saveDatabase(db);
    res.json({ success: true, db });
});

// Отправка сообщений (с поддержкой медиа: фото, видео, файлы)
app.post('/api/send-message', async (req, res) => {
    const { sender, receiver, text, media } = req.body;
    let db = await loadDatabase();
    
    if (!db.messagesStore) db.messagesStore = {};
    if (!db.messagesStore[sender]) db.messagesStore[sender] = {};
    if (!db.messagesStore[sender][receiver]) db.messagesStore[sender][receiver] = [];

    const messageObj = { 
        sender, 
        text: text || '', 
        media: media || null, // объект { type: 'image'/'video'/'file', url: '...', name: '...' }
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
    };
    
    db.messagesStore[sender][receiver].push(messageObj);

    if (sender !== receiver) {
        if (!db.messagesStore[receiver]) db.messagesStore[receiver] = {};
        if (!db.messagesStore[receiver][sender]) db.messagesStore[receiver][sender] = [];
        db.messagesStore[receiver][sender].push(messageObj);
    }

    await saveDatabase(db);
    res.json({ success: true, db });
});

// Управление группами/сообществами
app.post('/api/create-group', async (req, res) => {
    let { name, creator } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Укажите название группы' });

    let db = await loadDatabase();
    if (!db.groups) db.groups = {};

    const groupId = 'group_' + Date.now();
    db.groups[groupId] = {
        id: groupId,
        name: name.trim(),
        creator,
        members: [creator],
        messages: []
    };

    await saveDatabase(db);
    res.json({ success: true, db });
});

app.post('/api/join-group', async (req, res) => {
    let { groupId, login } = req.body;
    let db = await loadDatabase();
    if (!db.groups?.[groupId]) return res.status(400).json({ success: false, error: 'Группа не найдена' });

    if (!db.groups[groupId].members.includes(login)) {
        db.groups[groupId].members.push(login);
        await saveDatabase(db);
    }
    res.json({ success: true, db });
});

app.post('/api/send-group-message', async (req, res) => {
    let { groupId, sender, text, media } = req.body;
    let db = await loadDatabase();
    if (!db.groups?.[groupId]) return res.status(400).json({ success: false });

    const msg = {
        sender,
        text: text || '',
        media: media || null,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    db.groups[groupId].messages.push(msg);
    await saveDatabase(db);
    res.json({ success: true, db });
});

app.get('/api/news', async (req, res) => {
    try {
        const response = await fetch('https://meme-api.com/gimme/20');
        const data = await response.json();
        const memes = (data.memes || []).map(m => ({
            title: m.title,
            image: m.url,
            author: m.author,
            link: m.postLink
        }));
        res.json({ success: true, memes });
    } catch (e) {
        res.json({ success: false, memes: [] });
    }
});

// WebRTC сигналинг
const onlineSockets = {};
io.on('connection', (socket) => {
    socket.on('register', (login) => { onlineSockets[login] = socket.id; });
    socket.on('call-user', ({ to, offer, from, callType }) => {
        if (onlineSockets[to]) io.to(onlineSockets[to]).emit('incoming-call', { from, offer, callType });
    });
    socket.on('call-accepted', ({ to, answer }) => {
        if (onlineSockets[to]) io.to(onlineSockets[to]).emit('call-answered', { answer });
    });
    socket.on('ice-candidate', ({ to, candidate }) => {
        if (onlineSockets[to]) io.to(onlineSockets[to]).emit('ice-candidate', { candidate });
    });
    socket.on('hang-up', ({ to }) => {
        if (onlineSockets[to]) io.to(onlineSockets[to]).emit('hang-up');
    });
    socket.on('disconnect', () => {
        for (const [login, id] of Object.entries(onlineSockets)) {
            if (id === socket.id) { delete onlineSockets[login]; break; }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
