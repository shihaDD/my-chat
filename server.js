const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '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';
const REPO_OWNER = 'shihaDD';
const REPO_NAME = 'Chat-Database';
const FILE_PATH = 'database.json';

const pendingRegistrations = {};
const resetCodes = {};

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

    return { "users": {}, "friends": {}, "friendRequests": {}, "nicknames": {}, "messagesStore": {}, "lastSeen": {}, "groups": {} };
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

app.post('/api/send-reg-code', async (req, res) => {
    let { email, login } = req.body;
    if (!email || !login) return res.status(400).json({ success: false, error: 'Заполните почту и логин' });
    
    email = email.trim().toLowerCase();
    login = login.trim().toLowerCase();

    let db = await loadDatabase();
    if (db.users && db.users[login]) {
        return res.status(400).json({ success: false, error: 'Логин уже занят' });
    }

    const code = Math.floor(1000 + Math.random() * 9000).toString();
    pendingRegistrations[email] = { code };
    res.json({ success: true, debugCode: code });
});

app.post('/api/register', async (req, res) => {
    let { login, name, password, avatar, email, code } = req.body;
    if (!login || !name || !password) return res.status(400).json({ success: false, error: 'Заполните обязательные поля' });
    
    login = login.trim().toLowerCase();
    name = name.trim();
    if (email) email = email.trim().toLowerCase();

    let db = await loadDatabase();
    if (!db.users) db.users = {};
    if (!db.friends) db.friends = {};
    if (!db.friendRequests) db.friendRequests = {};
    if (!db.nicknames) db.nicknames = {};
    if (!db.messagesStore) db.messagesStore = {};
    if (!db.lastSeen) db.lastSeen = {};
    if (!db.groups) db.groups = {};

    if (db.users[login]) {
        return res.status(400).json({ success: false, error: 'Логин уже занят' });
    }

    if (email && email !== '') {
        const pending = pendingRegistrations[email];
        if (!pending || pending.code !== code) {
            return res.status(400).json({ success: false, error: 'Неверный код подтверждения почты' });
        }
        delete pendingRegistrations[email];
    }

    db.users[login] = { 
        login, 
        name, 
        password, 
        email: email || '',
        avatar: avatar || 'https://api.iconify.design/lucide:user.svg?color=%2366fcf1',
        lastLoginTime: new Date().toLocaleString()
    };
    db.friends[login] = [];
    db.friendRequests[login] = [];
    db.nicknames[login] = {};
    db.messagesStore[login] = {};
    db.lastSeen[login] = Date.now();

    await saveDatabase(db);
    res.json({ success: true, user: db.users[login], db });
});

app.post('/api/login', async (req, res) => {
    let { login, password } = req.body;
    if (!login || !password) return res.status(400).json({ success: false, error: 'Заполните все поля' });

    login = login.trim().toLowerCase();
    let db = await loadDatabase();

    const user = db.users && db.users[login];
    if (!user) {
        return res.status(400).json({ success: false, error: 'Пользователь с таким логином не найден' });
    }
    if (user.password !== password) {
        return res.status(400).json({ success: false, error: 'Неверный пароль' });
    }

    user.lastLoginTime = new Date().toLocaleString();
    db.lastSeen[login] = Date.now();
    await saveDatabase(db);
    res.json({ success: true, user, db });
});

app.post('/api/forgot-password', async (req, res) => {
    let { email } = req.body;
    if (!email) return res.status(400).json({ success: false, error: 'Введите email' });
    email = email.trim().toLowerCase();

    let db = await loadDatabase();
    let targetLogin = null;
    for (const [l, u] of Object.entries(db.users || {})) {
        if (u.email === email) {
            targetLogin = l;
            break;
        }
    }

    if (!targetLogin) {
        return res.status(400).json({ success: false, error: 'Пользователь с такой почтой не найден' });
    }

    const code = Math.floor(1000 + Math.random() * 9000).toString();
    resetCodes[email] = { code, login: targetLogin };
    res.json({ success: true, debugCode: code });
});

app.post('/api/reset-password', async (req, res) => {
    let { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) return res.status(400).json({ success: false, error: 'Заполните все поля' });
    email = email.trim().toLowerCase();

    const record = resetCodes[email];
    if (!record || record.code !== code) {
        return res.status(400).json({ success: false, error: 'Неверный код подтверждения' });
    }

    let db = await loadDatabase();
    if (db.users && db.users[record.login]) {
        db.users[record.login].password = newPassword;
        await saveDatabase(db);
        delete resetCodes[email];
        return res.json({ success: true });
    }

    res.status(400).json({ success: false, error: 'Ошибка сброса пароля' });
});

app.post('/api/update-profile', async (req, res) => {
    let { login, name, avatar, email } = req.body;
    let db = await loadDatabase();
    if (!db.users || !db.users[login]) return res.status(400).json({ success: false, error: 'Пользователь не найден' });

    if (name) db.users[login].name = name.trim();
    if (avatar) db.users[login].avatar = avatar;
    if (email !== undefined) db.users[login].email = email.trim().toLowerCase();

    await saveDatabase(db);
    res.json({ success: true, user: db.users[login], db });
});

app.post('/api/set-nickname', async (req, res) => {
    let { login, targetLogin, nickname } = req.body;
    let db = await loadDatabase();
    if (!db.nicknames) db.nicknames = {};
    if (!db.nicknames[login]) db.nicknames[login] = {};

    db.nicknames[login][targetLogin] = nickname.trim();
    await saveDatabase(db);
    res.json({ success: true, db });
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

    if (!db.users || !db.users[targetLogin]) {
        return res.status(400).json({ success: false, error: `Пользователь @${targetLogin} не найден!` });
    }
    if (targetLogin === login) {
        return res.status(400).json({ success: false, error: 'Нельзя добавить самого себя!' });
    }

    if (!db.friends) db.friends = {};
    if (!db.friendRequests) db.friendRequests = {};

    if (db.friends[login] && db.friends[login].includes(targetLogin)) {
        return res.status(400).json({ success: false, error: 'Вы уже друзья!' });
    }

    if (!db.friendRequests[targetLogin]) db.friendRequests[targetLogin] = [];
    if (!db.friendRequests[targetLogin].includes(login)) {
        db.friendRequests[targetLogin].push(login);
    }

    await saveDatabase(db);
    res.json({ success: true, db });
});

app.post('/api/respond-friend-request', async (req, res) => {
    let { login, requesterLogin, accept } = req.body;
    login = login.trim().toLowerCase();
    requesterLogin = requesterLogin.trim().toLowerCase();

    let db = await loadDatabase();
    if (!db.friendRequests || !db.friendRequests[login]) return res.status(400).json({ success: false });

    db.friendRequests[login] = db.friendRequests[login].filter(l => l !== requesterLogin);

    if (accept) {
        if (!db.friends[login]) db.friends[login] = [];
        if (!db.friends[login].includes(requesterLogin)) db.friends[login].push(requesterLogin);

        if (!db.friends[requesterLogin]) db.friends[requesterLogin] = [];
        if (!db.friends[requesterLogin].includes(login)) db.friends[requesterLogin].push(login);
    }

    await saveDatabase(db);
    res.json({ success: true, db });
});

app.post('/api/send-message', async (req, res) => {
    const { sender, receiver, text, media } = req.body;
    let db = await loadDatabase();
    
    if (!db.messagesStore) db.messagesStore = {};
    if (!db.messagesStore[sender]) db.messagesStore[sender] = {};
    if (!db.messagesStore[sender][receiver]) db.messagesStore[sender][receiver] = [];

    const messageObj = { 
        sender, 
        text: text || '', 
        media: media || null, 
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
        roles: { [creator]: 'Создатель' },
        messages: []
    };

    await saveDatabase(db);
    res.json({ success: true, db });
});

app.post('/api/join-group', async (req, res) => {
    let { groupId, login } = req.body;
    let db = await loadDatabase();
    if (!db.groups || !db.groups[groupId]) return res.status(400).json({ success: false, error: 'Группа не найдена' });

    if (!db.groups[groupId].members.includes(login)) {
        db.groups[groupId].members.push(login);
        if (!db.groups[groupId].roles) db.groups[groupId].roles = {};
        if (!db.groups[groupId].roles[login]) db.groups[groupId].roles[login] = 'Участник';
        await saveDatabase(db);
    }
    res.json({ success: true, db });
});

app.post('/api/send-group-message', async (req, res) => {
    let { groupId, sender, text, media } = req.body;
    let db = await loadDatabase();
    if (!db.groups || !db.groups[groupId]) return res.status(400).json({ success: false });

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

app.post('/api/update-group', async (req, res) => {
    let { groupId, login, name, avatar } = req.body;
    let db = await loadDatabase();
    if (!db.groups || !db.groups[groupId]) return res.status(400).json({ success: false, error: 'Сообщество не найдено' });

    const g = db.groups[groupId];
    const myRole = g.roles?.[login] || (g.creator === login ? 'Создатель' : 'Участник');

    if (g.creator !== login && myRole !== 'Администратор') {
        return res.status(400).json({ success: false, error: 'Недостаточно прав' });
    }

    if (name) g.name = name.trim();
    if (avatar) g.avatar = avatar;

    await saveDatabase(db);
    res.json({ success: true, db });
});

app.post('/api/set-group-role', async (req, res) => {
    let { groupId, login, targetLogin, newRole } = req.body;
    let db = await loadDatabase();
    if (!db.groups || !db.groups[groupId]) return res.status(400).json({ success: false });

    const g = db.groups[groupId];
    if (g.creator !== login) {
        return res.status(400).json({ success: false, error: 'Только создатель может изменять роли участников' });
    }

    if (!g.roles) g.roles = {};
    g.roles[targetLogin] = newRole;

    await saveDatabase(db);
    res.json({ success: true, db });
});

app.get('/api/news', async (req, res) => {
    try {
        const response = await fetch('https://meme-api.com/gimme/pikabu/20');
        const data = await response.json();
        const memes = (data.memes || []).map(m => ({
            title: m.title,
            url: m.url,
            isVideos: m.url.endsWith('.mp4') || m.url.endsWith('.webm'),
            author: m.author || 'Сеть'
        }));
        res.json({ success: true, memes });
    } catch (e) {
        res.json({ success: false, memes: [] });
    }
});

const onlineSockets = {};
io.on('connection', (socket) => {
    socket.on('register', (login) => { onlineSockets[login] = socket.id; });
    socket.on('call-user', ({ to, offer, from, callType }) => {
        if (onlineSockets[to]) io.to(onlineSockets[to]).emit('incoming-call', { from, offer, callType });
    });
    socket.on('call-answered', ({ to, answer }) => {
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
