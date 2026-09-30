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
    lastSeen: {},
    pinnedMessages: {},
    globalRoles: {}
};

if (fs.existsSync(DB_FILE)) {
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        const parsed = JSON.parse(data);
        db = { ...db, ...parsed };
        for (let gId in db.groups) {
            if (!db.groups[gId].subgroups) db.groups[gId].subgroups = [];
            if (!db.groups[gId].roles) db.groups[gId].roles = {};
            if (!db.groups[gId].customRoles) {
                db.groups[gId].customRoles = {
                    'Админ': { canPost: true, canDelete: true, canVoice: true },
                    'Участник': { canPost: false, canDelete: false, canVoice: true }
                };
            }
            if (!db.groups[gId].posts) db.groups[gId].posts = [];
            if (!db.groups[gId].messages) db.groups[gId].messages = [];
            if (!db.groups[gId].avatar) db.groups[gId].avatar = 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=150';
        }
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

    if (!user) {
        return res.json({ success: false, error: 'Пользователь не найден!' });
    }
    if (user.password !== password) {
        return res.json({ success: false, error: 'Неверный пароль!' });
    }

    if (!db.outgoingRequests) db.outgoingRequests = {};
    if (!db.outgoingRequests[cleanLogin]) db.outgoingRequests[cleanLogin] = [];

    db.lastSeen[cleanLogin] = Date.now();
    saveDb();
    res.json({ success: true, user, db });
});

app.post('/api/restore-session', (req, res) => {
    const { login } = req.body;
    if (!login) return res.json({ success: false });
    const cleanLogin = login.trim().toLowerCase();
    const user = db.users[cleanLogin];
    if (!user) return res.json({ success: false });
    db.lastSeen[cleanLogin] = Date.now();
    saveDb();
    res.json({ success: true, user, db });
});

app.post('/api/update-profile', (req, res) => {
    const { login, name, email, bio, avatar, password } = req.body;
    if (!login) return res.json({ success: false, error: 'Логин не передан' });
    const cleanLogin = login.trim().toLowerCase();
    if (!db.users[cleanLogin]) return res.json({ success: false, error: 'Пользователь не найден' });
    
    if (name) db.users[cleanLogin].name = name.trim();
    if (email !== undefined) db.users[cleanLogin].email = email.trim();
    if (bio !== undefined) db.users[cleanLogin].bio = bio.trim();
    if (avatar) db.users[cleanLogin].avatar = avatar;
    if (password) db.users[cleanLogin].password = password;
    saveDb();
    res.json({ success: true, user: db.users[cleanLogin], db });
});

app.post('/api/set-global-role', (req, res) => {
    const { login, targetLogin, newRole } = req.body;
    const cleanLogin = login ? login.trim().toLowerCase() : '';
    if (cleanLogin !== 'warren' && db.globalRoles?.[cleanLogin] !== 'main_moderator') {
        return res.json({ success: false, error: 'Недостаточно прав!' });
    }
    if (!db.globalRoles) db.globalRoles = {};
    db.globalRoles[targetLogin.trim().toLowerCase()] = newRole;
    saveDb();
    io.emit('update-db', db);
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
    const { name } = req.body;
    const creator = req.body.creator || req.body.login;
    if (!name || !creator) return res.json({ success: false, error: 'Недостаточно данных' });

    const groupId = 'group_' + Date.now();
    db.groups[groupId] = {
        id: groupId,
        name: name.trim(),
        creator: creator,
        avatar: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=150',
        members: [creator],
        roles: { [creator]: 'Лидер' },
        customRoles: {
            'Админ': { canPost: true, canDelete: true, canVoice: true },
            'Участник': { canPost: false, canDelete: false, canVoice: true }
        },
        messages: [],
        posts: [],
        subgroups: [],
        likes: 0
    };
    saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/delete-group', (req, res) => {
    const { groupId, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    const isLeader = group.creator === login;
    if (!isLeader && login.toLowerCase() !== 'warren' && getUserGlobalRole(login) !== 'main_moderator') {
        return res.json({ success: false, error: 'Недостаточно прав!' });
    }
    delete db.groups[groupId];
    saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/update-group', (req, res) => {
    const { groupId, name, avatar, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    if (group.creator !== login && group.roles?.[login] !== 'Админ' && login.toLowerCase() !== 'warren') {
        return res.json({ success: false, error: 'Недостаточно прав!' });
    }
    if (name) group.name = name.trim();
    if (avatar) group.avatar = avatar;
    saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db, group });
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

    const isLeader = group.creator === login;
    if (!isLeader && group.roles?.[login] !== 'Админ' && login.toLowerCase() !== 'warren') {
        return res.json({ success: false, error: 'Недостаточно прав для изменения ролей!' });
    }
    if (!group.roles) group.roles = {};
    group.roles[targetLogin] = newRole;
    saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/create-custom-role', (req, res) => {
    const { groupId, login, roleName, permissions } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    if (group.creator !== login && login.toLowerCase() !== 'warren') {
        return res.json({ success: false, error: 'Только лидер группы может создавать роли!' });
    }
    if (!group.customRoles) group.customRoles = {};
    const cleanName = roleName.trim();
    if (!cleanName) return res.json({ success: false, error: 'Введите название роли' });

    group.customRoles[cleanName] = permissions || { canPost: true, canDelete: true, canVoice: true };
    saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/delete-custom-role', (req, res) => {
    const { groupId, login, roleName } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    if (group.creator !== login && login.toLowerCase() !== 'warren') {
        return res.json({ success: false, error: 'Только лидер группы может удалять роли!' });
    }
    if (roleName === 'Лидер' || roleName === 'Админ' || roleName === 'Участник') {
        return res.json({ success: false, error: 'Нельзя удалить системную роль!' });
    }
    if (group.customRoles && group.customRoles[roleName]) {
        delete group.customRoles[roleName];
        saveDb();
        io.emit('update-db', db);
    }
    res.json({ success: true, db });
});

app.post('/api/kick-group-member', (req, res) => {
    const { groupId, login, targetLogin } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Сообщество не найдено' });

    const isLeader = group.creator === login;
    const myRole = group.roles?.[login];
    if (!isLeader && myRole !== 'Админ' && login.toLowerCase() !== 'warren') {
        return res.json({ success: false, error: 'Только лидер и админы могут исключать участников!' });
    }
    if (group.creator === targetLogin) {
        return res.json({ success: false, error: 'Нельзя исключить создателя группы!' });
    }

    group.members = group.members.filter(m => m !== targetLogin);
    if (group.roles) delete group.roles[targetLogin];
    saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/create-subgroup', (req, res) => {
    const { groupId, name, type, permission, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    const isLeader = group.creator === login;
    const myRole = group.roles?.[login] || (isLeader ? 'Лидер' : 'Участник');
    if (!isLeader && myRole !== 'Админ' && login.toLowerCase() !== 'warren') {
        return res.json({ success: false, error: 'Недостаточно прав для создания канала!' });
    }

    if (!group.subgroups) group.subgroups = [];
    const subId = 'sub_' + Date.now();
    group.subgroups.push({ id: subId, name: name.trim(), type: type || 'text', permission: permission || 'all', messages: [] });
    saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/delete-subgroup', (req, res) => {
    const { groupId, subId, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    if (group.creator !== login && group.roles?.[login] !== 'Админ' && login.toLowerCase() !== 'warren') {
        return res.json({ success: false, error: 'Недостаточно прав!' });
    }
    group.subgroups = (group.subgroups || []).filter(s => s.id !== subId);
    saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/publish-group-post', (req, res) => {
    const { groupId, login, text, media, announcement } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    if (!group.posts) group.posts = [];
    const postId = 'gpost_' + Date.now();
    const postObj = { id: postId, author: login, text: text || '', media: media || null, timestamp: Date.now(), likes: 0 };
    group.posts.unshift(postObj);

    if (announcement) {
        if (!db.news) db.news = [];
        db.news.unshift({
            id: 'news_' + Date.now(),
            author: login,
            text: `📢 Объявление из группы "${group.name}":\n${text || ''}`,
            media: media || null,
            timestamp: Date.now(),
            likes: 0,
            dislikes: 0,
            comments: []
        });
    }

    saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/delete-group-post', (req, res) => {
    const { groupId, login, postId } = req.body;
    const group = db.groups[groupId];
    if (!group || !group.posts) return res.json({ success: false, error: 'Пост не найден' });

    group.posts = group.posts.filter(p => p.id !== postId);
    saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/send-message', (req, res) => {
    const { sender, receiver, text, media, messageId, chatType, chatId, subgroup } = req.body;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const timestamp = req.body.timestamp || Date.now();
    const msgObj = { id: messageId || 'msg_' + Date.now() + '_' + Math.random(), sender, text: text || '', media: media || null, time, timestamp, edited: false, read: false };

    if (chatType === 'group' && chatId) {
        const key = `group_${chatId}_${subgroup || 'main'}`;
        if (!db.messagesStore[key]) db.messagesStore[key] = [];
        db.messagesStore[key].push(msgObj);
        saveDb();
        io.to(chatId).emit('receive-group-message', { groupId: chatId, msg: msgObj, subgroup: subgroup || 'main' });
        io.emit('update-db', db);
        return res.json({ success: true, db, msg: msgObj });
    }

    const peer = receiver || chatId;
    if (!peer) return res.json({ success: false, error: 'Получатель не указан' });

    const chatKey = [sender, peer].sort().join('_');
    if (!db.messagesStore[chatKey]) db.messagesStore[chatKey] = [];
    db.messagesStore[chatKey].push(msgObj);

    saveDb();
    io.to(peer).emit('receive-message', { sender, receiver: peer, msg: msgObj });
    io.to(sender).emit('receive-message', { sender, receiver: peer, msg: msgObj });
    res.json({ success: true, db, msg: msgObj });
});

app.post('/api/edit-message', (req, res) => {
    const { login, messageId, newText } = req.body;
    let found = false;
    for (let key in db.messagesStore) {
        db.messagesStore[key].forEach(m => {
            if (m.id === messageId && m.sender === login) {
                m.text = newText;
                m.edited = true;
                found = true;
            }
        });
    }
    if (found) {
        saveDb();
        io.emit('update-db', db);
        res.json({ success: true, db });
    } else {
        res.json({ success: false, error: 'Сообщение не найдено' });
    }
});

app.post('/api/delete-message', (req, res) => {
    const { login, messageId } = req.body;
    let found = false;
    for (let key in db.messagesStore) {
        const beforeLen = db.messagesStore[key].length;
        db.messagesStore[key] = db.messagesStore[key].filter(m => !(m.id === messageId && (m.sender === login || login.toLowerCase() === 'warren')));
        if (db.messagesStore[key].length < beforeLen) found = true;
    }
    if (found) {
        saveDb();
        io.emit('update-db', db);
        res.json({ success: true, db });
    } else {
        res.json({ success: false, error: 'Не удалось удалить сообщение' });
    }
});

app.post('/api/pin-message', (req, res) => {
    const { messageId, chatKey } = req.body;
    if (!db.pinnedMessages) db.pinnedMessages = {};
    db.pinnedMessages[chatKey] = messageId;
    saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/unpin-message', (req, res) => {
    const { chatKey } = req.body;
    if (db.pinnedMessages && db.pinnedMessages[chatKey]) {
        delete db.pinnedMessages[chatKey];
        saveDb();
        io.emit('update-db', db);
    }
    res.json({ success: true, db });
});

app.post(['/api/news', '/api/publish-news'], (req, res) => {
    const { login, author, text, media } = req.body;
    const postAuthor = author || login;
    if (!postAuthor) return res.json({ success: false, error: 'Автор не указан' });
    const time = new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const postId = 'post_' + Date.now();
    db.news.unshift({ id: postId, author: postAuthor, text: text || '', media: media || null, time, timestamp: Date.now(), likes: 0, dislikes: 0, comments: [] });
    saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/edit-news', (req, res) => {
    const { login, postId, newText } = req.body;
    const post = db.news.find(p => p.id === postId);
    if (!post) return res.json({ success: false, error: 'Новость не найдена' });
    if (post.author !== login && login.toLowerCase() !== 'warren') {
        return res.json({ success: false, error: 'Недостаточно прав' });
    }
    post.text = newText;
    saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/delete-news', (req, res) => {
    const { login, postId } = req.body;
    const post = db.news.find(p => p.id === postId);
    if (!post) return res.json({ success: false, error: 'Новость не найдена' });
    if (post.author !== login && login.toLowerCase() !== 'warren') {
        return res.json({ success: false, error: 'Недостаточно прав' });
    }
    db.news = db.news.filter(p => p.id !== postId);
    saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

io.on('connection', (socket) => {
    socket.on('register', (login) => {
        socket.login = login;
        socket.join(login);
    });

    socket.on('join-group-room', (groupId) => {
        socket.join(groupId);
    });

    socket.on('refresh-db', () => {
        socket.emit('update-db', db);
    });

    socket.on('call-user', ({ to, offer, from }) => {
        io.to(to).emit('incoming-call', { from, offer, isGroup: false });
    });

    socket.on('start-group-conference', ({ groupId, channelId, targets, from }) => {
        targets.forEach(targetLogin => {
            io.to(targetLogin).emit('incoming-call', { from, offer: null, isGroup: true, groupId, channelId });
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

    socket.on('disconnect', () => {});
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});
