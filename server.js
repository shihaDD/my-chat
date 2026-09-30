const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Подключение к MongoDB
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/messenger_db';

const AppStateSchema = new mongoose.Schema({
    key: { type: String, unique: true, default: 'main_db' },
    users: { type: Object, default: {} },
    messagesStore: { type: Object, default: {} },
    friends: { type: Object, default: {} },
    friendRequests: { type: Object, default: {} },
    outgoingRequests: { type: Object, default: {} },
    customNicknames: { type: Object, default: {} },
    groups: { type: Object, default: {} },
    news: { type: Array, default: [] },
    lastSeen: { type: Object, default: {} },
    pinnedMessages: { type: Object, default: {} },
    globalRoles: { type: Object, default: {} },
    violations: { type: Array, default: [] },
    groupPostRequests: { type: Object, default: {} },
    verificationRequests: { type: Array, default: [] },
    mutedUsers: { type: Object, default: {} }
});

const AppState = mongoose.model('AppState', AppStateSchema);

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
    globalRoles: {},
    violations: [],
    groupPostRequests: {},
    verificationRequests: [],
    mutedUsers: {}
};

async function initDatabase() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('Успешное подключение к MongoDB');
        
        let doc = await AppState.findOne({ key: 'main_db' });
        if (!doc) {
            doc = new AppState({ key: 'main_db', ...db });
            await doc.save();
            console.log('Создана новая структура базы данных в MongoDB');
        } else {
            db = {
                users: doc.users || {},
                messagesStore: doc.messagesStore || {},
                friends: doc.friends || {},
                friendRequests: doc.friendRequests || {},
                outgoingRequests: doc.outgoingRequests || {},
                customNicknames: doc.customNicknames || {},
                groups: doc.groups || {},
                news: doc.news || [],
                lastSeen: doc.lastSeen || {},
                pinnedMessages: doc.pinnedMessages || {},
                globalRoles: doc.globalRoles || {},
                violations: doc.violations || [],
                groupPostRequests: doc.groupPostRequests || {},
                verificationRequests: doc.verificationRequests || [],
                mutedUsers: doc.mutedUsers || {}
            };
        }

        for (let gId in db.groups) {
            if (!db.groups[gId].subgroups) db.groups[gId].subgroups = [];
            if (!db.groups[gId].roles) db.groups[gId].roles = {};
            if (!db.groups[gId].customRoles) {
                db.groups[gId].customRoles = {
                    'Админ': { canPost: true, canDelete: true, canVoice: true, canDuplicateNews: true },
                    'Участник': { canPost: false, canDelete: false, canVoice: true, canDuplicateNews: false }
                };
            }
            if (!db.groups[gId].posts) db.groups[gId].posts = [];
            if (!db.groups[gId].messages) db.groups[gId].messages = [];
            if (!db.groups[gId].avatar) db.groups[gId].avatar = 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=150';
            if (db.groups[gId].isClosed === undefined) db.groups[gId].isClosed = false;
            if (!db.groups[gId].joinRequests) db.groups[gId].joinRequests = [];
            if (db.groups[gId].isVerified === undefined) db.groups[gId].isVerified = false;
            if (db.groups[gId].verificationPending === undefined) db.groups[gId].verificationPending = false;
            if (!db.groups[gId].groupMutedUsers) db.groups[gId].groupMutedUsers = {};
            if (!db.groups[gId].groupNicknames) db.groups[gId].groupNicknames = {};
        }
    } catch (e) {
        console.error('Ошибка подключения к MongoDB:', e);
    }
}

async function saveDb() {
    try {
        await AppState.findOneAndUpdate(
            { key: 'main_db' },
            {
                users: db.users,
                messagesStore: db.messagesStore,
                friends: db.friends,
                friendRequests: db.friendRequests,
                outgoingRequests: db.outgoingRequests,
                customNicknames: db.customNicknames,
                groups: db.groups,
                news: db.news,
                lastSeen: db.lastSeen,
                pinnedMessages: db.pinnedMessages,
                globalRoles: db.globalRoles,
                violations: db.violations,
                groupPostRequests: db.groupPostRequests,
                verificationRequests: db.verificationRequests,
                mutedUsers: db.mutedUsers
            },
            { upsert: true, new: true }
        );
    } catch (e) {
        console.error('Ошибка сохранения базы данных в MongoDB:', e);
    }
}

function getUserGlobalRole(login) {
    if (!login) return 'user';
    const l = login.toLowerCase();
    if (l === 'warren') return 'warren';
    return db.globalRoles?.[l] || 'user';
}

function hasFullAccess(login) {
    if (!login) return false;
    const l = login.toLowerCase();
    const role = getUserGlobalRole(login);
    return l === 'warren' || role === 'main_moderator' || role === 'moderator';
}

function containsMat(text) {
    if (!text) return false;
    const matRegex = /(ху[йяёеию]|пизд|бля[дт]|ебат|ебал|ебну|сук[аиу]|mraz|мраз[ью]|уёб|выёб|заёб|поёб|наёб|отёб|гандон|гондон|мудак|пидор|педик|пидар|чмо|шлюх|бляд|сук[аи]|мандавош|манда|епт|епрст)/i;
    return matRegex.test(text);
}

// REST API эндпоинты

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

app.post('/api/register', async (req, res) => {
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

    if (!db.outgoingRequests) db.outgoingRequests = {};
    if (!db.outgoingRequests[cleanLogin]) db.outgoingRequests[cleanLogin] = [];

    db.lastSeen[cleanLogin] = Date.now();
    await saveDb();
    res.json({ success: true, user, db });
});

app.post('/api/restore-session', async (req, res) => {
    const { login } = req.body;
    if (!login) return res.json({ success: false });
    const cleanLogin = login.trim().toLowerCase();
    const user = db.users[cleanLogin];
    if (!user) return res.json({ success: false });
    db.lastSeen[cleanLogin] = Date.now();
    await saveDb();
    res.json({ success: true, user, db });
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

app.post('/api/set-global-role', async (req, res) => {
    const { login, targetLogin, newRole } = req.body;
    const cleanLogin = login ? login.trim().toLowerCase() : '';
    if (cleanLogin !== 'warren' && getUserGlobalRole(cleanLogin) !== 'main_moderator') {
        return res.json({ success: false, error: 'Недостаточно прав!' });
    }
    if (!db.globalRoles) db.globalRoles = {};
    db.globalRoles[targetLogin.trim().toLowerCase()] = newRole;
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/remove-global-mute', async (req, res) => {
    const { login, targetLogin } = req.body;
    const cleanLogin = login ? login.trim().toLowerCase() : '';
    if (!hasFullAccess(cleanLogin)) {
        return res.json({ success: false, error: 'Недостаточно прав!' });
    }
    if (db.mutedUsers && targetLogin) {
        delete db.mutedUsers[targetLogin.trim().toLowerCase()];
    }
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

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
    io.emit('update-db', db);
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
    io.emit('update-db', db);
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
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/remove-friend', async (req, res) => {
    const { login, targetLogin } = req.body;
    if (db.friends[login]) db.friends[login] = db.friends[login].filter(l => l !== targetLogin);
    if (db.friends[targetLogin]) db.friends[targetLogin] = db.friends[targetLogin].filter(l => l !== login);
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/create-group', async (req, res) => {
    const { name, isClosed } = req.body;
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
            'Админ': { canPost: true, canDelete: true, canVoice: true, canDuplicateNews: true },
            'Участник': { canPost: false, canDelete: false, canVoice: true, canDuplicateNews: false }
        },
        isClosed: !!isClosed,
        joinRequests: [],
        messages: [],
        posts: [],
        subgroups: [],
        groupMutedUsers: {},
        groupNicknames: {},
        likes: 0,
        isVerified: false,
        verificationPending: false
    };
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/delete-group', async (req, res) => {
    const { groupId, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    const isLeader = group.creator === login;
    if (!isLeader && !hasFullAccess(login)) {
        return res.json({ success: false, error: 'Недостаточно прав!' });
    }
    delete db.groups[groupId];
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/update-group', async (req, res) => {
    const { groupId, name, avatar, isClosed, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    if (group.creator !== login && group.roles?.[login] !== 'Админ' && !hasFullAccess(login)) {
        return res.json({ success: false, error: 'Недостаточно прав!' });
    }
    if (name) group.name = name.trim();
    if (avatar) group.avatar = avatar;
    if (isClosed !== undefined) group.isClosed = !!isClosed;
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db, group });
});

app.post('/api/group-mute-member', async (req, res) => {
    const { groupId, login, targetLogin, muteMinutes, reason } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    const isLeader = group.creator === login;
    const myRole = group.roles?.[login];
    if (!isLeader && myRole !== 'Админ' && !hasFullAccess(login)) {
        return res.json({ success: false, error: 'Недостаточно прав для выдачи мута в группе!' });
    }

    if (!group.groupMutedUsers) group.groupMutedUsers = {};
    const mins = parseInt(muteMinutes) || 0;
    if (mins <= 0) {
        delete group.groupMutedUsers[targetLogin];
    } else {
        const clampedMins = Math.min(Math.max(mins, 1), 9999);
        group.groupMutedUsers[targetLogin] = {
            expires: Date.now() + (clampedMins * 60 * 1000),
            reason: reason || 'Нарушение правил'
        };
    }

    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/group-set-nickname', async (req, res) => {
    const { groupId, login, targetLogin, nickname } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    const isLeader = group.creator === login;
    const myRole = group.roles?.[login];
    if (!isLeader && myRole !== 'Админ' && !hasFullAccess(login)) {
        return res.json({ success: false, error: 'Недостаточно прав для изменения никнейма в группе!' });
    }

    if (!group.groupNicknames) group.groupNicknames = {};
    const cleanNick = nickname ? nickname.trim() : '';
    if (!cleanNick) {
        delete group.groupNicknames[targetLogin];
    } else {
        group.groupNicknames[targetLogin] = cleanNick;
    }

    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/request-verification', async (req, res) => {
    const { groupId, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    if (group.creator !== login && group.roles?.[login] !== 'Админ' && !hasFullAccess(login)) {
        return res.json({ success: false, error: 'Недостаточно прав!' });
    }
    if (group.isVerified) return res.json({ success: false, error: 'Группа уже верифицирована' });
    if (group.verificationPending) return res.json({ success: false, error: 'Запрос на верификацию уже отправлен' });

    group.verificationPending = true;
    if (!db.verificationRequests) db.verificationRequests = [];
    
    db.verificationRequests = db.verificationRequests.filter(r => r.groupId !== groupId);
    db.verificationRequests.push({
        id: 'verif_' + Date.now(),
        groupId,
        groupName: group.name,
        requester: login,
        timestamp: Date.now()
    });

    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/resolve-verification', async (req, res) => {
    const { login, requestId, accept } = req.body;
    if (!hasFullAccess(login)) return res.json({ success: false, error: 'Недостаточно прав' });
    if (!db.verificationRequests) db.verificationRequests = [];

    const reqObj = db.verificationRequests.find(r => r.id === requestId);
    if (!reqObj) return res.json({ success: false, error: 'Запрос не найден' });

    const group = db.groups[reqObj.groupId];
    if (group) {
        group.verificationPending = false;
        if (accept) {
            group.isVerified = true;
        }
    }

    db.verificationRequests = db.verificationRequests.filter(r => r.id !== requestId);
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/join-group', async (req, res) => {
    const { groupId, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Сообщество не найдено' });

    if (group.isClosed) {
        return res.json({ success: false, error: 'Эта группа закрытая. Подайте заявку на вступление.' });
    }

    if (!group.members.includes(login)) {
        group.members.push(login);
        group.roles[login] = 'Участник';
        await saveDb();
        io.emit('update-db', db);
    }
    res.json({ success: true, db });
});

app.post('/api/request-join-group', async (req, res) => {
    const { groupId, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Сообщество не найдено' });
    if (group.members.includes(login)) return res.json({ success: false, error: 'Вы уже участник группы' });

    if (!group.joinRequests) group.joinRequests = [];
    if (!group.joinRequests.includes(login)) {
        group.joinRequests.push(login);
        await saveDb();
        io.emit('update-db', db);
    }
    res.json({ success: true, db });
});

app.post('/api/respond-join-request', async (req, res) => {
    const { groupId, login, targetLogin, accept } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Сообщество не найдено' });

    const isLeader = group.creator === login;
    const myRole = group.roles?.[login];
    if (!isLeader && myRole !== 'Админ' && !hasFullAccess(login)) {
        return res.json({ success: false, error: 'Недостаточно прав!' });
    }

    if (group.joinRequests) {
        group.joinRequests = group.joinRequests.filter(l => l !== targetLogin);
    }
    if (accept) {
        if (!group.members.includes(targetLogin)) {
            group.members.push(targetLogin);
            group.roles[targetLogin] = 'Участник';
        }
    }
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/set-group-role', async (req, res) => {
    const { groupId, login, targetLogin, newRole } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Сообщество не найдено' });

    const isLeader = group.creator === login;
    if (!isLeader && group.roles?.[login] !== 'Админ' && !hasFullAccess(login)) {
        return res.json({ success: false, error: 'Недостаточно прав для изменения ролей!' });
    }
    if (!group.roles) group.roles = {};
    group.roles[targetLogin] = newRole;
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/create-custom-role', async (req, res) => {
    const { groupId, login, roleName, permissions } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    if (group.creator !== login && !hasFullAccess(login)) {
        return res.json({ success: false, error: 'Только лидер группы может создавать роли!' });
    }
    if (!group.customRoles) group.customRoles = {};
    const cleanName = roleName.trim();
    if (!cleanName) return res.json({ success: false, error: 'Введите название роли' });

    group.customRoles[cleanName] = permissions || { canPost: true, canDelete: true, canVoice: true, canDuplicateNews: false };
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/update-role-permissions', async (req, res) => {
    const { groupId, login, roleName, permissions } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    if (group.creator !== login && group.roles?.[login] !== 'Админ' && !hasFullAccess(login)) {
        return res.json({ success: false, error: 'Недостаточно прав!' });
    }
    if (!group.customRoles) group.customRoles = {};
    group.customRoles[roleName] = permissions;
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/delete-custom-role', async (req, res) => {
    const { groupId, login, roleName } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    if (group.creator !== login && !hasFullAccess(login)) {
        return res.json({ success: false, error: 'Только лидер группы может удалять роли!' });
    }
    if (roleName === 'Лидер' || roleName === 'Админ' || roleName === 'Участник') {
        return res.json({ success: false, error: 'Нельзя удалить системную роль!' });
    }
    if (group.customRoles && group.customRoles[roleName]) {
        delete group.customRoles[roleName];
        await saveDb();
        io.emit('update-db', db);
    }
    res.json({ success: true, db });
});

app.post('/api/kick-group-member', async (req, res) => {
    const { groupId, login, targetLogin } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Сообщество не найдено' });

    const isLeader = group.creator === login;
    const myRole = group.roles?.[login];
    if (!isLeader && myRole !== 'Админ' && !hasFullAccess(login)) {
        return res.json({ success: false, error: 'Только лидер и админы могут исключать участников!' });
    }
    if (group.creator === targetLogin) {
        return res.json({ success: false, error: 'Нельзя исключить создателя группы!' });
    }

    group.members = group.members.filter(m => m !== targetLogin);
    if (group.roles) delete group.roles[targetLogin];
    if (group.groupMutedUsers) delete group.groupMutedUsers[targetLogin];
    if (group.groupNicknames) delete group.groupNicknames[targetLogin];
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/create-subgroup', async (req, res) => {
    const { groupId, name, type, allowedRole, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    const isLeader = group.creator === login;
    if (!isLeader && group.roles?.[login] !== 'Админ' && !hasFullAccess(login)) {
        return res.json({ success: false, error: 'Недостаточно прав!' });
    }
    if (!group.subgroups) group.subgroups = [];
    const subId = 'sub_' + Date.now();
    group.subgroups.push({
        id: subId,
        name: name.trim(),
        type: type || 'text',
        allowedRole: allowedRole || 'all'
    });
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/delete-subgroup', async (req, res) => {
    const { groupId, subId, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    const isLeader = group.creator === login;
    if (!isLeader && group.roles?.[login] !== 'Админ' && !hasFullAccess(login)) {
        return res.json({ success: false, error: 'Недостаточно прав!' });
    }
    if (group.subgroups) {
        group.subgroups = group.subgroups.filter(s => s.id !== subId);
    }
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/create-global-channel', async (req, res) => {
    const { login, name, type } = req.body;
    if (!hasFullAccess(login)) {
        return res.json({ success: false, error: 'Недостаточно прав!' });
    }
    const targetGroupId = Object.keys(db.groups)[0];
    if (!targetGroupId) {
        return res.json({ success: false, error: 'Сначала создайте хотя бы одну группу!' });
    }
    const group = db.groups[targetGroupId];
    if (!group.subgroups) group.subgroups = [];
    group.subgroups.push({
        id: 'global_sub_' + Date.now(),
        name: name.trim(),
        type: type || 'text',
        allowedRole: 'all'
    });
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/send-message', async (req, res) => {
    const { sender, text, media, chatType, chatId, subgroup } = req.body;
    if (!sender) return res.json({ success: false, error: 'Не авторизован' });

    if (db.mutedUsers?.[sender] && db.mutedUsers[sender].expires > Date.now()) {
        return res.json({ success: false, error: 'Вы находитесь в глобальном муте!' });
    }

    if (chatType === 'group') {
        const group = db.groups[chatId];
        if (group && group.groupMutedUsers?.[sender] && group.groupMutedUsers[sender].expires > Date.now()) {
            return res.json({ success: false, error: 'Вы замучены в этой группе!' });
        }
    }

    if (containsMat(text)) {
        if (!db.violations) db.violations = [];
        db.violations.push({
            id: 'viol_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            author: sender,
            text,
            timestamp: Date.now(),
            source: chatType === 'group' ? 'group' : 'chat',
            groupName: chatType === 'group' ? db.groups[chatId]?.name : ''
        });
    }

    let storeKey = '';
    if (chatType === 'group') {
        storeKey = `group_${chatId}_${subgroup || 'main'}`;
    } else if (chatType === 'user') {
        storeKey = [sender, chatId].sort().join('_');
    } else {
        storeKey = `saved_${sender}`;
    }

    if (!db.messagesStore[storeKey]) db.messagesStore[storeKey] = [];
    const msg = {
        id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        sender,
        text: text || '',
        media: media || null,
        timestamp: Date.now()
    };
    db.messagesStore[storeKey].push(msg);
    await saveDb();

    if (chatType === 'group') {
        io.emit('receive-group-message', { groupId: chatId, msg, subgroup });
    } else if (chatType === 'user') {
        io.to(chatId).emit('receive-message', { sender, receiver: chatId, msg });
        io.to(sender).emit('receive-message', { sender, receiver: chatId, msg });
    } else {
        io.to(sender).emit('receive-message', { sender, receiver: sender, msg });
    }

    res.json({ success: true, db });
});

app.post('/api/edit-message', async (req, res) => {
    const { login, messageId, newText } = req.body;
    let found = false;

    for (let key in db.messagesStore) {
        const msgs = db.messagesStore[key];
        const m = msgs.find(item => item.id === messageId);
        if (m) {
            if (m.sender !== login && !hasFullAccess(login)) {
                return res.json({ success: false, error: 'Недостаточно прав' });
            }
            m.text = newText;
            found = true;
            break;
        }
    }

    if (found) {
        await saveDb();
        io.emit('update-db', db);
        res.json({ success: true, db });
    } else {
        res.json({ success: false, error: 'Сообщение не найдено' });
    }
});

app.post('/api/delete-message', async (req, res) => {
    const { login, messageId } = req.body;
    let found = false;

    for (let key in db.messagesStore) {
        const msgs = db.messagesStore[key];
        const idx = msgs.findIndex(item => item.id === messageId);
        if (idx !== -1) {
            const m = msgs[idx];
            if (m.sender !== login && !hasFullAccess(login)) {
                return res.json({ success: false, error: 'Недостаточно прав' });
            }
            msgs.splice(idx, 1);
            found = true;
            break;
        }
    }

    if (found) {
        await saveDb();
        io.emit('update-db', db);
        res.json({ success: true, db });
    } else {
        res.json({ success: false, error: 'Сообщение не найдено' });
    }
});

app.post('/api/pin-message', async (req, res) => {
    const { login, messageId, chatKey } = req.body;
    if (!db.pinnedMessages) db.pinnedMessages = {};
    db.pinnedMessages[chatKey] = messageId;
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/unpin-message', async (req, res) => {
    const { chatKey } = req.body;
    if (db.pinnedMessages && db.pinnedMessages[chatKey]) {
        delete db.pinnedMessages[chatKey];
        await saveDb();
        io.emit('update-db', db);
    }
    res.json({ success: true, db });
});

app.post('/api/publish-news', async (req, res) => {
    const { login, text, media } = req.body;
    if (!hasFullAccess(login)) {
        return res.json({ success: false, error: 'Только модераторы могут публиковать в ленту новостей!' });
    }
    if (!db.news) db.news = [];
    const post = {
        id: 'news_' + Date.now(),
        author: login,
        text: text || '',
        media: media || null,
        timestamp: Date.now()
    };
    db.news.unshift(post);
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/edit-news', async (req, res) => {
    const { login, postId, newText } = req.body;
    const post = (db.news || []).find(p => p.id === postId);
    if (!post) return res.json({ success: false, error: 'Новость не найдена' });
    if (post.author !== login && !hasFullAccess(login)) {
        return res.json({ success: false, error: 'Недостаточно прав' });
    }
    post.text = newText;
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/delete-news', async (req, res) => {
    const { login, postId } = req.body;
    const post = (db.news || []).find(p => p.id === postId);
    if (!post) return res.json({ success: false, error: 'Новость не найдена' });
    if (post.author !== login && !hasFullAccess(login)) {
        return res.json({ success: false, error: 'Недостаточно прав' });
    }
    db.news = db.news.filter(p => p.id !== postId);
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/publish-group-post', async (req, res) => {
    const { groupId, login, text, announcement } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    const isLeader = group.creator === login;
    const myRole = group.roles?.[login];
    const rolePerms = group.customRoles?.[myRole];
    const canPost = isLeader || myRole === 'Админ' || (rolePerms && rolePerms.canPost) || hasFullAccess(login);

    if (!canPost) {
        return res.json({ success: false, error: 'У вас нет прав на публикацию постов в этой группе!' });
    }

    if (announcement && !group.isVerified) {
        return res.json({ success: false, error: 'Сообщество не верифицировано! Дублирование в новости запрещено.' });
    }

    const post = {
        id: 'gpost_' + Date.now(),
        author: login,
        text: text || '',
        timestamp: Date.now()
    };
    if (!group.posts) group.posts = [];
    group.posts.unshift(post);

    if (announcement && group.isVerified) {
        if (!db.news) db.news = [];
        db.news.unshift({
            id: 'news_' + Date.now(),
            author: login,
            text: `[${group.name} ✓] ${text}`,
            timestamp: Date.now()
        });
    }

    if (containsMat(text)) {
        if (!db.violations) db.violations = [];
        db.violations.push({
            id: 'viol_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            author: login,
            text,
            timestamp: Date.now(),
            source: 'group_post',
            groupName: group.name
        });
    }

    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/delete-group-post', async (req, res) => {
    const { login, groupId, postId } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    const post = (group.posts || []).find(p => p.id === postId);
    if (!post) return res.json({ success: false, error: 'Пост не найден' });

    const isLeader = group.creator === login;
    const myRole = group.roles?.[login];
    const rolePerms = group.customRoles?.[myRole];
    const canDelete = isLeader || myRole === 'Админ' || (rolePerms && rolePerms.canDelete) || post.author === login || hasFullAccess(login);

    if (!canDelete) {
        return res.json({ success: false, error: 'Недостаточно прав для удаления поста' });
    }

    group.posts = group.posts.filter(p => p.id !== postId);
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/resolve-violation-action', async (req, res) => {
    const { login, violId, action, newText, muteMinutes, reason } = req.body;
    if (!hasFullAccess(login)) return res.json({ success: false, error: 'Недостаточно прав' });
    if (!db.violations) db.violations = [];

    const viol = db.violations.find(v => v.id === violId);
    if (!viol) return res.json({ success: false, error: 'Нарушение не найдено' });

    if (action === 'approve') {
        // Одобрить и отправить в новости
        if (!db.news) db.news = [];
        db.news.unshift({
            id: 'news_' + Date.now(),
            author: viol.author,
            text: viol.text,
            timestamp: Date.now()
        });
    } else if (action === 'edit') {
        viol.text = newText;
        if (!db.news) db.news = [];
        db.news.unshift({
            id: 'news_' + Date.now(),
            author: viol.author,
            text: newText,
            timestamp: Date.now()
        });
    } else if (action === 'mute') {
        if (!db.mutedUsers) db.mutedUsers = {};
        const mins = parseInt(muteMinutes) || 60;
        const clampedMins = Math.min(Math.max(mins, 1), 9999);
        db.mutedUsers[viol.author.toLowerCase()] = {
            expires: Date.now() + (clampedMins * 60 * 1000),
            reason: reason || 'Нарушение правил'
        };
    }

    db.violations = db.violations.filter(v => v.id !== violId);
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

// Socket.io WebRTC Сигнализация (для устранения вечного подключения в звонках и конференциях)
io.on('connection', (socket) => {
    socket.on('register', (login) => {
        if (login) {
            socket.userLogin = login.toLowerCase();
            socket.join(socket.userLogin);
            db.lastSeen[socket.userLogin] = Date.now();
        }
    });

    socket.on('refresh-db', () => {
        io.emit('update-db', db);
    });

    socket.on('join-group-room', (groupId) => {
        socket.join(`group_${groupId}`);
    });

    // Прямые аудиозвонки WebRTC
    socket.on('call-user', ({ targetLogin, offer, callerLogin }) => {
        io.to(targetLogin.toLowerCase()).emit('incoming-call', { callerLogin, offer });
    });

    socket.on('accept-call', ({ targetLogin, answer, accepterLogin }) => {
        io.to(targetLogin.toLowerCase()).emit('call-accepted', { answer, accepterLogin });
    });

    socket.on('reject-call', ({ targetLogin }) => {
        io.to(targetLogin.toLowerCase()).emit('call-rejected');
    });

    socket.on('hangup-call', ({ targetLogin }) => {
        io.to(targetLogin.toLowerCase()).emit('call-hangup');
    });

    socket.on('webrtc-candidate', ({ targetLogin, candidate }) => {
        io.to(targetLogin.toLowerCase()).emit('webrtc-candidate', { candidate });
    });

    // Конференции и голосовые каналы в группах
    socket.on('join-voice-channel', ({ groupId, channelId, login }) => {
        const roomName = `voice_${groupId}_${channelId}`;
        socket.join(roomName);
        socket.to(roomName).emit('user-joined-voice', { socketId: socket.id, login });
    });

    socket.on('leave-voice-channel', ({ groupId, channelId }) => {
        const roomName = `voice_${groupId}_${channelId}`;
        socket.leave(roomName);
        socket.to(roomName).emit('user-left-voice', { socketId: socket.id });
    });

    socket.on('group-webrtc-offer', ({ targetSocketId, offer }) => {
        io.to(targetSocketId).emit('group-webrtc-offer', { offer, senderSocketId: socket.id });
    });

    socket.on('group-webrtc-answer', ({ targetSocketId, answer }) => {
        io.to(targetSocketId).emit('group-webrtc-answer', { answer, senderSocketId: socket.id });
    });

    socket.on('group-webrtc-candidate', ({ targetSocketId, candidate }) => {
        io.to(targetSocketId).emit('group-webrtc-candidate', { candidate, senderSocketId: socket.id });
    });

    socket.on('disconnect', () => {
        if (socket.userLogin) {
            db.lastSeen[socket.userLogin] = Date.now();
        }
    });
});

const PORT = process.env.PORT || 3000;
initDatabase().then(() => {
    server.listen(PORT, () => {
        console.log(`Сервер запущен на порту ${PORT}`);
    });
});
