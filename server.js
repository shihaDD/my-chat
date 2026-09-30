const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/messenger';

const dbStateSchema = new mongoose.Schema({
    key: { type: String, unique: true, default: 'main' },
    data: { type: mongoose.Schema.Types.Mixed, default: {} }
});

const DbState = mongoose.model('DbState', dbStateSchema);

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
    pinnedMessages: {}
};

async function initDatabase() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('✅ Успешное подключение к MongoDB!');

        let doc = await DbState.findOne({ key: 'main' });
        if (doc && doc.data) {
            db = { ...db, ...doc.data };
            console.log('📂 Данные успешно загружены из MongoDB.');
        } else {
            await DbState.create({ key: 'main', data: db });
            console.log('🆕 Создан начальный документ базы данных в MongoDB.');
        }

        // Проверка и инициализация глобальных ролей
        for (let u in db.users) {
            if (!db.users[u].globalRole) {
                db.users[u].globalRole = (u === 'warren' ? 'warren' : 'user');
            }
        }
        if (db.users['warren'] && db.users['warren'].globalRole !== 'warren') {
            db.users['warren'].globalRole = 'warren';
        }
    } catch (err) {
        console.error('❌ Ошибка подключения к MongoDB:', err);
    }
}

initDatabase();

async function saveDb() {
    try {
        await DbState.updateOne({ key: 'main' }, { data: db }, { upsert: true });
    } catch (e) {
        console.error('❌ Ошибка сохранения в MongoDB:', e);
    }
}

app.get('/api/internet-news', async (req, res) => {
    const internetNews = [
        { title: 'Искусственный интеллект совершил прорыв в квантовых вычислениях', url: '#', score: 1250, by: 'TechNews', time: new Date().toLocaleString() },
        { title: 'Запущен новый стандарт сверхбыстрой беспроводной связи 6G', url: '#', score: 980, by: 'FutureNet', time: new Date().toLocaleString() },
        { title: 'Космический телескоп обнаружил экзопланету с признаками воды', url: '#', score: 850, by: 'SpaceObserver', time: new Date().toLocaleString() }
    ];
    res.json({ success: true, news: internetNews });
});

app.post('/api/register', async (req, res) => {
    const { login, name, password, email, avatar } = req.body;
    if (!login || !name || !password) {
        return res.json({ success: false, error: 'Заполните обязательные поля!' });
    }
    const cleanLogin = login.trim().toLowerCase();
    if (db.users[cleanLogin]) {
        return res.json({ success: false, error: 'Пользователь с таким логином уже существует!' });
    }

    db.users[cleanLogin] = {
        login: cleanLogin,
        name,
        password,
        email: email || '',
        avatar: avatar || '',
        bio: '',
        globalRole: cleanLogin === 'warren' ? 'warren' : 'user'
    };
    db.friends[cleanLogin] = [];
    db.friendRequests[cleanLogin] = [];
    db.outgoingRequests[cleanLogin] = [];
    db.lastSeen[cleanLogin] = Date.now();
    await saveDb();

    res.json({ success: true, user: db.users[cleanLogin], db });
});

app.post('/api/login', async (req, res) => {
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

    if (!user.globalRole) {
        user.globalRole = (cleanLogin === 'warren' ? 'warren' : 'user');
    }

    if (!db.outgoingRequests) db.outgoingRequests = {};
    if (!db.outgoingRequests[cleanLogin]) db.outgoingRequests[cleanLogin] = [];

    db.lastSeen[cleanLogin] = Date.now();
    await saveDb();
    res.json({ success: true, user, db });
});

app.post('/api/restore-session', async (req, res) => {
    const { login } = req.body;
    if (!login || !db.users[login]) {
        return res.json({ success: false, error: 'Сессия не найдена' });
    }
    const user = db.users[login];
    if (!user.globalRole) {
        user.globalRole = (login === 'warren' ? 'warren' : 'user');
    }
    db.lastSeen[login] = Date.now();
    await saveDb();
    res.json({ success: true, user: db.users[login], db });
});

app.post('/api/update-profile', async (req, res) => {
    const { login, name, email, bio, avatar, password } = req.body;
    if (!login) return res.json({ success: false, error: 'Логин не передан' });
    const cleanLogin = login.trim().toLowerCase();
    if (!db.users[cleanLogin]) return res.json({ success: false, error: 'Пользователь не найден' });
    
    if (name) db.users[cleanLogin].name = name.trim();
    if (email !== undefined) db.users[cleanLogin].email = email.trim();
    if (bio !== undefined) db.users[cleanLogin].bio = bio.trim();
    if (avatar) db.users[cleanLogin].avatar = avatar;
    if (password) db.users[cleanLogin].password = password;
    await saveDb();
    res.json({ success: true, user: db.users[cleanLogin], db });
});

// Управление глобальными ролями (Warren и Главный модератор)
app.post('/api/set-global-role', async (req, res) => {
    const { adminUser, targetUser, role } = req.body; // role: 'head_moderator', 'moderator', 'user'
    const requester = db.users[adminUser?.trim().toLowerCase()];
    const target = db.users[targetUser?.trim().toLowerCase()];

    if (!requester || !target) {
        return res.json({ success: false, error: 'Пользователь не найден' });
    }

    const isWarren = (adminUser.trim().toLowerCase() === 'warren' || requester.globalRole === 'warren');
    const isHeadMod = (requester.globalRole === 'head_moderator');

    if (isWarren) {
        // warren может назначать и снимать главного модератора и модератора
        target.globalRole = role;
    } else if (isHeadMod) {
        // главный модератор может назначать и снимать модераторов
        if (role === 'moderator' || role === 'user') {
            target.globalRole = role;
        } else {
            return res.json({ success: false, error: 'Главный модератор может назначать только модераторов или обычных пользователей' });
        }
    } else {
        return res.json({ success: false, error: 'Недостаточно прав для назначения роли!' });
    }

    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

// Новости
app.post('/api/news', async (req, res) => {
    const { author, text, media } = req.body;
    const time = new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    db.news.unshift({ author, text: text || '', media: media || null, time, likes: 0, dislikes: 0, comments: [] });
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/delete-news', async (req, res) => {
    const { login, newsIndex } = req.body;
    const user = db.users[login];
    if (!user) return res.json({ success: false, error: 'Пользователь не найден' });
    const newsItem = db.news[newsIndex];
    if (!newsItem) return res.json({ success: false, error: 'Новость не найдена' });

    const isWarren = (login === 'warren' || user.globalRole === 'warren');
    const isHeadMod = (user.globalRole === 'head_moderator');
    const isMod = (user.globalRole === 'moderator');
    const isAuthor = (newsItem.author.split(' ')[0] === login);

    if (!isWarren && !isHeadMod && !isMod && !isAuthor) {
        return res.json({ success: false, error: 'Недостаточно прав для удаления новости!' });
    }

    db.news.splice(newsIndex, 1);
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/edit-news', async (req, res) => {
    const { login, newsIndex, newText } = req.body;
    const user = db.users[login];
    if (!user) return res.json({ success: false, error: 'Пользователь не найден' });
    const newsItem = db.news[newsIndex];
    if (!newsItem) return res.json({ success: false, error: 'Новость не найдена' });

    const isWarren = (login === 'warren' || user.globalRole === 'warren');
    const isHeadMod = (user.globalRole === 'head_moderator');
    const isMod = (user.globalRole === 'moderator');
    const isAuthor = (newsItem.author.split(' ')[0] === login);

    if (!isWarren && !isHeadMod && !isMod && !isAuthor) {
        return res.json({ success: false, error: 'Недостаточно прав для редактирования новости!' });
    }

    newsItem.text = newText;
    newsItem.edited = true;
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/news-like', async (req, res) => {
    const { index } = req.body;
    if (db.news[index]) {
        db.news[index].likes = (db.news[index].likes || 0) + 1;
        await saveDb();
        io.emit('update-db', db);
    }
    res.json({ success: true, db });
});

app.post('/api/news-dislike', async (req, res) => {
    const { index } = req.body;
    if (db.news[index]) {
        db.news[index].dislikes = (db.news[index].dislikes || 0) + 1;
        await saveDb();
        io.emit('update-db', db);
    }
    res.json({ success: true, db });
});

// Друзья и группы
app.post('/api/add-friend', async (req, res) => {
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
    await saveDb();
    io.to(cleanTarget).emit('update-db', db);
    io.to(login).emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/cancel-friend-request', async (req, res) => {
    const { login, targetLogin } = req.body;
    if (db.outgoingRequests && db.outgoingRequests[login]) {
        db.outgoingRequests[login] = db.outgoingRequests[login].filter(l => l !== targetLogin);
    }
    if (db.friendRequests && db.friendRequests[targetLogin]) {
        db.friendRequests[targetLogin] = db.friendRequests[targetLogin].filter(l => l !== login);
    }
    await saveDb();
    io.to(targetLogin).emit('update-db', db);
    io.to(login).emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/respond-friend-request', async (req, res) => {
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
    await saveDb();
    io.to(login).emit('update-db', db);
    io.to(requesterLogin).emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/remove-friend', async (req, res) => {
    const { login, targetLogin } = req.body;
    if (db.friends[login]) db.friends[login] = db.friends[login].filter(l => l !== targetLogin);
    if (db.friends[targetLogin]) db.friends[targetLogin] = db.friends[targetLogin].filter(l => l !== login);
    await saveDb();
    io.to(login).emit('update-db', db);
    io.to(targetLogin).emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/create-group', async (req, res) => {
    const { name, creator } = req.body;
    if (!name || !creator) return res.json({ success: false, error: 'Недостаточно данных' });

    const groupId = 'group_' + Date.now();
    db.groups[groupId] = {
        id: groupId,
        name: name.trim(),
        creator: creator,
        members: [creator],
        roles: { [creator]: 'Лидер' },
        customRoles: [],
        messages: [],
        posts: [],
        subgroups: [],
        likes: Math.floor(Math.random() * 20)
    };
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/update-group', async (req, res) => {
    const { groupId, name, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    if (group.creator !== login && group.roles?.[login] !== 'Админ') {
        return res.json({ success: false, error: 'Недостаточно прав!' });
    }
    if (name) group.name = name.trim();
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/join-group', async (req, res) => {
    const { groupId, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Сообщество не найдено' });

    if (!group.members.includes(login)) {
        group.members.push(login);
        group.roles[login] = 'Участник';
        await saveDb();
        io.emit('update-db', db);
    }
    res.json({ success: true, db });
});

app.post('/api/set-group-role', async (req, res) => {
    const { groupId, login, targetLogin, newRole } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Сообщество не найдено' });

    if (group.creator !== login) {
        return res.json({ success: false, error: 'Только лидер может назначать роли!' });
    }
    if (!group.roles) group.roles = {};
    group.roles[targetLogin] = newRole;
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

// Настройка роли в группе (включая право дублировать в новости canAnnounce)
app.post('/api/save-group-role', async (req, res) => {
    const { groupId, login, roleName, permissions, canAnnounce } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    const isLeader = group.creator === login;
    const myRoleName = group.roles?.[login] || (isLeader ? 'Лидер' : 'Участник');
    if (!isLeader && myRoleName !== 'Админ') {
        return res.json({ success: false, error: 'Недостаточно прав для настройки ролей' });
    }

    if (!group.customRoles) group.customRoles = [];
    let role = group.customRoles.find(r => r.name === roleName);
    if (role) {
        role.permissions = permissions || {};
        role.canAnnounce = !!canAnnounce;
    } else {
        group.customRoles.push({ name: roleName, permissions: permissions || {}, canAnnounce: !!canAnnounce });
    }

    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/kick-group-member', async (req, res) => {
    const { groupId, login, targetLogin } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Сообщество не найдено' });

    if (group.creator !== login) {
        return res.json({ success: false, error: 'Только лидер может выгонять участников!' });
    }

    group.members = group.members.filter(m => m !== targetLogin);
    if (group.roles) delete group.roles[targetLogin];
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/create-subgroup', async (req, res) => {
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
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/delete-subgroup', async (req, res) => {
    const { groupId, subId, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    if (group.creator !== login && group.roles?.[login] !== 'Админ') {
        return res.json({ success: false, error: 'Недостаточно прав!' });
    }
    group.subgroups = (group.subgroups || []).filter(s => s.id !== subId);
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

// Публикация поста в группе с дублированием в новости (если разрешено ролью и выставлен флаг)
app.post('/api/create-group-post', async (req, res) => {
    const { groupId, author, text, media, isAnnouncement } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    const isLeader = group.creator === author;
    const myRoleName = group.roles?.[author] || (isLeader ? 'Лидер' : 'Участник');
    
    let canPost = isLeader || myRoleName === 'Админ';
    if (!canPost && group.customRoles) {
        const customRole = group.customRoles.find(r => r.name === myRoleName);
        if (customRole && customRole.permissions?.canPost) canPost = true;
    }

    if (!canPost) {
        return res.json({ success: false, error: 'Только лидер, админы и лица с соответствующими правами могут публиковать посты!' });
    }

    if (!group.posts) group.posts = [];
    const time = new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    group.posts.unshift({ author, text: text || '', media: media || null, time, likes: 0, comments: [], isAnnouncement: !!isAnnouncement });

    // Проверка права на дублирование в новости (canAnnounce)
    if (isAnnouncement) {
        let canAnnounce = isLeader || myRoleName === 'Админ';
        if (!canAnnounce && group.customRoles) {
            const customRole = group.customRoles.find(r => r.name === myRoleName);
            if (customRole && customRole.canAnnounce) canAnnounce = true;
        }

        if (canAnnounce) {
            db.news.unshift({
                author: `${author} (Группа: ${group.name} 📢)`,
                text: text || '',
                media: media || null,
                time,
                likes: 0,
                dislikes: 0,
                comments: [],
                isAnnouncement: true,
                groupId
            });
        }
    }

    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/delete-group-post', async (req, res) => {
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
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/send-message', async (req, res) => {
    const { sender, receiver, text, media } = req.body;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msgObj = { id: 'msg_' + Date.now() + Math.random().toString(36).substr(2, 5), sender, receiver, text: text || '', media: media || null, time, edited: false, reactions: {}, read: false };

    if (!db.messagesStore[sender]) db.messagesStore[sender] = {};
    if (!db.messagesStore[sender][receiver]) db.messagesStore[sender][receiver] = [];
    db.messagesStore[sender][receiver].push(msgObj);

    if (sender !== receiver) {
        if (!db.messagesStore[receiver]) db.messagesStore[receiver] = {};
        if (!db.messagesStore[receiver][sender]) db.messagesStore[receiver][sender] = [];
        db.messagesStore[receiver][sender].push(msgObj);
    }

    await saveDb();
    io.to(receiver).emit('receive-message', { sender, receiver, msg: msgObj });
    res.json({ success: true, db });
});

app.post('/api/send-group-message', async (req, res) => {
    const { groupId, sender, text, media, subgroup } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msgObj = { id: 'msg_' + Date.now() + Math.random().toString(36).substr(2, 5), sender, text: text || '', media: media || null, time, edited: false, reactions: {} };

    if (!subgroup || subgroup === 'main') {
        if (!group.messages) group.messages = [];
        group.messages.push(msgObj);
    } else {
        const sub = group.subgroups?.find(s => s.id === subgroup);
        if (sub) {
            if (!sub.messages) sub.messages = [];
            sub.messages.push(msgObj);
        }
    }

    await saveDb();
    io.to(groupId).emit('receive-group-message', { groupId, msg: msgObj, subgroup: subgroup || 'main' });
    res.json({ success: true, db });
});

app.post('/api/add-reaction', async (req, res) => {
    const { login, peer, messageId, emoji, isGroup, groupId, subgroup } = req.body;
    if (isGroup) {
        const group = db.groups[groupId];
        if (group) {
            let msgs = subgroup && subgroup !== 'main' ? group.subgroups?.find(s => s.id === subgroup)?.messages : group.messages;
            if (msgs) {
                const msg = msgs.find(m => m.id === messageId);
                if (msg) {
                    if (!msg.reactions) msg.reactions = {};
                    if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
                    const idx = msg.reactions[emoji].indexOf(login);
                    if (idx > -1) {
                        msg.reactions[emoji].splice(idx, 1);
                        if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
                    } else {
                        msg.reactions[emoji].push(login);
                    }
                    await saveDb();
                    io.emit('update-db', db);
                }
            }
        }
    } else {
        const chatPair1 = db.messagesStore[login]?.[peer];
        const chatPair2 = db.messagesStore[peer]?.[login];
        [chatPair1, chatPair2].forEach(msgs => {
            if (msgs) {
                const msg = msgs.find(m => m.id === messageId);
                if (msg) {
                    if (!msg.reactions) msg.reactions = {};
                    if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
                    const idx = msg.reactions[emoji].indexOf(login);
                    if (idx > -1) {
                        msg.reactions[emoji].splice(idx, 1);
                        if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
                    } else {
                        msg.reactions[emoji].push(login);
                    }
                }
            }
        });
        await saveDb();
        io.to(login).emit('update-db', db);
        io.to(peer).emit('update-db', db);
    }
    res.json({ success: true, db });
});

app.post('/api/pin-message', async (req, res) => {
    const { login, peer, messageId, isGroup, groupId, subgroup } = req.body;
    const key = isGroup ? `group_${groupId}_${subgroup || 'main'}` : [login, peer].sort().join('_');
    if (!db.pinnedMessages) db.pinnedMessages = {};
    if (db.pinnedMessages[key] === messageId) {
        db.pinnedMessages[key] = null;
    } else {
        db.pinnedMessages[key] = messageId;
    }
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

io.on('connection', (socket) => {
    socket.on('register', (login) => {
        socket.login = login;
        socket.join(login);
        if (db.lastSeen) {
            db.lastSeen[login] = Date.now();
            io.emit('user-status', { login, online: true });
        }
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

    socket.on('disconnect', () => {
        if (socket.login && db.lastSeen) {
            db.lastSeen[socket.login] = Date.now();
            io.emit('user-status', { login: socket.login, online: false, lastSeen: db.lastSeen[socket.login] });
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на http://localhost:${PORT} с MongoDB`);
});
