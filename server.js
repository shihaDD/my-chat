const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

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
    globalChannels: { type: Array, default: [] },
    news: { type: Array, default: [] },
    lastSeen: { type: Object, default: {} },
    pinnedMessages: { type: Object, default: {} },
    globalRoles: { type: Object, default: {} },
    violations: { type: Array, default: [] },
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
    globalChannels: [],
    news: [],
    lastSeen: {},
    pinnedMessages: {},
    globalRoles: {},
    violations: [],
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
        } else {
            db = {
                users: doc.users || {},
                messagesStore: doc.messagesStore || {},
                friends: doc.friends || {},
                friendRequests: doc.friendRequests || {},
                outgoingRequests: doc.outgoingRequests || {},
                customNicknames: doc.customNicknames || {},
                groups: doc.groups || {},
                globalChannels: doc.globalChannels || [],
                news: doc.news || [],
                lastSeen: doc.lastSeen || {},
                pinnedMessages: doc.pinnedMessages || {},
                globalRoles: doc.globalRoles || {},
                violations: doc.violations || [],
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

// Асинхронное фоновое сохранение для максимальной скорости отклика
function saveDb() {
    AppState.findOneAndUpdate(
        { key: 'main_db' },
        {
            users: db.users,
            messagesStore: db.messagesStore,
            friends: db.friends,
            friendRequests: db.friendRequests,
            outgoingRequests: db.outgoingRequests,
            customNicknames: db.customNicknames,
            groups: db.groups,
            globalChannels: db.globalChannels,
            news: db.news,
            lastSeen: db.lastSeen,
            pinnedMessages: db.pinnedMessages,
            globalRoles: db.globalRoles,
            violations: db.violations,
            verificationRequests: db.verificationRequests,
            mutedUsers: db.mutedUsers
        },
        { upsert: true, new: true }
    ).catch(e => {
        console.error('Ошибка сохранения базы данных в MongoDB:', e);
    });
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

// --- API ЭНДПОИНТЫ ---

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
    saveDb();

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
    saveDb();
    res.json({ success: true, user, db });
});

app.post('/api/restore-session', async (req, res) => {
    const { login } = req.body;
    if (!login) return res.json({ success: false });
    const cleanLogin = login.trim().toLowerCase();
    const user = db.users[cleanLogin];
    if (!user) return res.json({ success: false });
    db.lastSeen[cleanLogin] = Date.now();
    saveDb();
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
    saveDb();
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
    saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/set-global-mute', async (req, res) => {
    const { login, targetLogin, muteMinutes, reason } = req.body;
    const cleanLogin = login ? login.trim().toLowerCase() : '';
    if (!hasFullAccess(cleanLogin)) {
        return res.json({ success: false, error: 'Недостаточно прав!' });
    }
    if (!db.mutedUsers) db.mutedUsers = {};
    const mins = parseInt(muteMinutes) || 60;
    const clampedMins = Math.min(Math.max(mins, 1), 9999);
    db.mutedUsers[targetLogin.trim().toLowerCase()] = {
        expires: Date.now() + (clampedMins * 60 * 1000),
        reason: reason || 'Нарушение правил'
    };
    saveDb();
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
    saveDb();
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
    saveDb();
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
    saveDb();
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
    saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/remove-friend', async (req, res) => {
    const { login, targetLogin } = req.body;
    if (db.friends[login]) db.friends[login] = db.friends[login].filter(l => l !== targetLogin);
    if (db.friends[targetLogin]) db.friends[targetLogin] = db.friends[targetLogin].filter(l => l !== login);
    saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/create-group', async (req, res) => {
    const { name, isClosed, creator, login } = req.body;
    const author = creator || login;
    if (!name || !author) return res.json({ success: false, error: 'Недостаточно данных' });

    const groupId = 'group_' + Date.now();
    db.groups[groupId] = {
        id: groupId,
        name: name.trim(),
        creator: author,
        avatar: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=150',
        members: [author],
        roles: { [author]: 'Лидер' },
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
    saveDb();
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
    saveDb();
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
    saveDb();
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

    saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/group-set-nickname', async (req, res) => {
    const { groupId, login, targetLogin, nickname } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    const isLeader = group.creator === login;
    const myRole = group.roles?.[login] || 'Участник';
    const canManage = isLeader || myRole === 'Админ' || hasFullAccess(login);
    const isSelf = login.toLowerCase() === targetLogin.toLowerCase();

    if (!canManage && !isSelf) {
        return res.json({ success: false, error: 'Участники могут менять ник только себе!' });
    }

    if (!group.groupNicknames) group.groupNicknames = {};
    const cleanNick = nickname ? nickname.trim() : '';
    if (!cleanNick) {
        delete group.groupNicknames[targetLogin];
    } else {
        group.groupNicknames[targetLogin] = cleanNick;
    }

    saveDb();
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

    saveDb();
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
    saveDb();
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
        saveDb();
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
        saveDb();
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
    saveDb();
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
    saveDb();
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
    saveDb();
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
    saveDb();
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
        saveDb();
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
    saveDb();
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
    saveDb();
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
    saveDb();
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

    let storeKey = '';
    if (chatType === 'group') {
        storeKey = `group_${chatId}_${subgroup || 'main'}`;
    } else if (chatType === 'global') {
        storeKey = `global_${chatId}`;
    } else if (chatType === 'user') {
        storeKey = [sender, chatId].sort().join('_');
    } else {
        storeKey = `saved_${sender}`;
    }

    const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

    if (containsMat(text)) {
        if (!db.violations) db.violations = [];
        db.violations.push({
            id: 'viol_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            author: sender,
            text,
            timestamp: Date.now(),
            source: chatType === 'group' ? 'group' : (chatType === 'global' ? 'global' : 'chat'),
            groupName: chatType === 'group' ? db.groups[chatId]?.name : '',
            groupId: chatType === 'group' ? chatId : null,
            messageId: msgId,
            storeKey
        });
    }

    if (!db.messagesStore[storeKey]) db.messagesStore[storeKey] = [];
    const msg = {
        id: msgId,
        sender,
        text: text || '',
        media: media || null,
        timestamp: Date.now()
    };
    db.messagesStore[storeKey].push(msg);
    saveDb();

    if (chatType === 'group') {
        io.emit('receive-group-message', { groupId: chatId, msg, subgroup });
    } else if (chatType === 'global') {
        io.emit('receive-global-message', { channelId: chatId, msg });
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
        saveDb();
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
        saveDb();
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
    saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/unpin-message', async (req, res) => {
    const { chatKey } = req.body;
    if (db.pinnedMessages && db.pinnedMessages[chatKey]) {
        delete db.pinnedMessages[chatKey];
        saveDb();
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
    const postId = 'news_' + Date.now();
    const post = {
        id: postId,
        author: login,
        text: text || '',
        media: media || null,
        timestamp: Date.now()
    };
    db.news.unshift(post);

    if (containsMat(text)) {
        if (!db.violations) db.violations = [];
        db.violations.push({
            id: 'viol_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            author: login,
            text,
            timestamp: Date.now(),
            source: 'news',
            postId
        });
    }

    saveDb();
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

    const postId = 'gpost_' + Date.now();
    const post = {
        id: postId,
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
            groupName: group.name,
            groupVerified: true,
            text: text,
            timestamp: Date.now()
        });
    }

    saveDb();
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
        if (!db.news) db.news = [];
        db.news.unshift({
            id: 'news_' + Date.now(),
            author: viol.author,
            groupName: viol.groupName || '',
            groupVerified: viol.groupId ? !!db.groups[viol.groupId]?.isVerified : false,
            text: viol.text,
            timestamp: Date.now()
        });
    } else if (action === 'delete') {
        if (viol.messageId && viol.storeKey && db.messagesStore[viol.storeKey]) {
            db.messagesStore[viol.storeKey] = db.messagesStore[viol.storeKey].filter(m => m.id !== viol.messageId);
        }
    }

    db.violations = db.violations.filter(v => v.id !== violId);
    saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

// --- ВЕБ-ИНТЕРФЕЙС (ФРОНТЕНД) ---

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title>Современный Мессенджер</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="/socket.io/socket.io.js"></script>
</head>
<body class="bg-gray-900 text-white h-screen flex flex-col font-sans">
    <!-- Экран авторизации -->
    <div id="auth-screen" class="flex-1 flex items-center justify-center">
        <div class="bg-gray-800 p-8 rounded-2xl w-96 border border-gray-700 shadow-xl">
            <h2 id="auth-title" class="text-2xl font-bold mb-6 text-center text-purple-400">Вход в мессенджер</h2>
            <form id="auth-form" onsubmit="handleAuth(event)" class="space-y-4">
                <input type="text" id="login-input" placeholder="Логин" required class="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 focus:outline-none focus:border-purple-500">
                <input type="text" id="name-input" placeholder="Имя (для регистрации)" class="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 focus:outline-none focus:border-purple-500 hidden">
                <input type="password" id="password-input" placeholder="Пароль" required class="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 focus:outline-none focus:border-purple-500">
                <button type="submit" id="auth-btn" class="w-full bg-purple-600 hover:bg-purple-700 font-bold py-3 rounded-xl transition">Войти</button>
            </form>
            <button onclick="toggleAuthMode()" class="w-full mt-4 text-xs text-gray-400 hover:text-white transition" id="toggle-auth-text">Нет аккаунта? Зарегистрироваться</button>
        </div>
    </div>

    <!-- Основной интерфейс -->
    <div id="main-app" class="hidden flex-1 flex overflow-hidden">
        <!-- Левая панель с вкладками и списком групп -->
        <div class="w-80 bg-gray-800 border-r border-gray-700 flex flex-col">
            <div class="p-4 border-b border-gray-700 flex justify-between items-center">
                <span id="current-username" class="font-bold text-purple-400 text-sm truncate"></span>
                <button onclick="logout()" class="text-xs bg-red-600/30 hover:bg-red-600/50 text-red-300 px-3 py-1.5 rounded-lg transition">Выйти</button>
            </div>
            <div class="p-4 border-b border-gray-700">
                <input type="text" id="group-search-input" oninput="renderGroupsList()" placeholder="Поиск групп..." class="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-purple-500">
                <button onclick="openCreateGroupModal()" class="w-full mt-2 bg-purple-600/30 hover:bg-purple-600/50 text-purple-300 py-2 rounded-xl text-xs font-bold transition">Создать группу</button>
            </div>
            <div id="groups-list" class="flex-1 overflow-y-auto p-4 space-y-2">
                <!-- Список сообществ -->
            </div>
        </div>

        <!-- Рабочая область -->
        <div class="flex-1 flex flex-col bg-gray-900" id="chat-workspace">
            <div class="flex-1 flex items-center justify-center text-gray-500">Выберите сообщество для общения</div>
        </div>
    </div>

    <!-- Модальное окно создания группы -->
    <div id="create-group-modal" class="hidden fixed inset-0 bg-black/70 flex items-center justify-center z-50">
        <div class="bg-gray-800 p-6 rounded-2xl w-96 border border-gray-700">
            <h3 class="text-lg font-bold mb-4 text-purple-400">Создать сообщество</h3>
            <input type="text" id="new-group-name" placeholder="Название группы" class="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-2 mb-4 focus:outline-none focus:border-purple-500">
            <div class="flex justify-end space-x-2">
                <button onclick="closeCreateGroupModal()" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-xl text-xs">Отмена</button>
                <button onclick="createGroup()" class="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-xl text-xs font-bold">Создать</button>
            </div>
        </div>
    </div>

    <script>
        const socket = io();
        let currentUser = null;
        let db = { groups: {}, users: {}, messagesStore: {} };
        let isRegisterMode = false;
        let activeGroupId = null;

        window.addEventListener('DOMContentLoaded', () => {
            const savedLogin = localStorage.getItem('messenger_login');
            if (savedLogin) {
                fetch('/api/restore-session', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ login: savedLogin })
                })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        currentUser = data.user;
                        db = data.db;
                        enterApp();
                    }
                });
            }
        });

        socket.on('update-db', (serverDb) => {
            db = serverDb;
            renderGroupsList();
            if (activeGroupId) {
                renderGroupWorkspace(activeGroupId);
            }
        });

        socket.on('receive-group-message', ({ groupId, msg, subgroup }) => {
            const storeKey = \`group_\${groupId}_\${subgroup || 'main'}\`;
            if (!db.messagesStore[storeKey]) db.messagesStore[storeKey] = [];
            db.messagesStore[storeKey].push(msg);
            if (activeGroupId === groupId) {
                renderGroupMessages(groupId, subgroup);
            }
        });

        function toggleAuthMode() {
            isRegisterMode = !isRegisterMode;
            document.getElementById('auth-title').innerText = isRegisterMode ? 'Регистрация' : 'Вход в мессенджер';
            document.getElementById('auth-btn').innerText = isRegisterMode ? 'Зарегистрироваться' : 'Войти';
            document.getElementById('name-input').classList.toggle('hidden', !isRegisterMode);
            document.getElementById('toggle-auth-text').innerText = isRegisterMode ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться';
        }

        function handleAuth(e) {
            e.preventDefault();
            const login = document.getElementById('login-input').value.trim();
            const password = document.getElementById('password-input').value.trim();
            const name = document.getElementById('name-input').value.trim();

            const endpoint = isRegisterMode ? '/api/register' : '/api/login';
            const body = isRegisterMode ? { login, name, password } : { login, password };

            fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    currentUser = data.user;
                    db = data.db;
                    localStorage.setItem('messenger_login', currentUser.login);
                    enterApp();
                } else {
                    alert(data.error);
                }
            });
        }

        function enterApp() {
            document.getElementById('auth-screen').classList.add('hidden');
            document.getElementById('main-app').classList.remove('hidden');
            document.getElementById('current-username').innerText = currentUser.name || currentUser.login;
            socket.emit('register', currentUser.login);
            renderGroupsList();
        }

        function logout() {
            localStorage.removeItem('messenger_login');
            currentUser = null;
            document.getElementById('main-app').classList.add('hidden');
            document.getElementById('auth-screen').classList.remove('hidden');
        }

        function renderGroupsList() {
            const groupsListEl = document.getElementById('groups-list');
            if (!groupsListEl) return;
            const searchQuery = (document.getElementById('group-search-input')?.value || '').toLowerCase();
            
            let html = '';
            const groupsArray = Object.values(db.groups || {});
            
            if (groupsArray.length === 0) {
                groupsListEl.innerHTML = \`<div class="text-xs text-gray-500 text-center py-4">Нет доступных групп</div>\`;
                return;
            }

            const filtered = groupsArray.filter(g => g.name.toLowerCase().includes(searchQuery));
            if (filtered.length === 0) {
                groupsListEl.innerHTML = \`<div class="text-xs text-gray-500 text-center py-4">Группы не найдены</div>\`;
                return;
            }

            filtered.forEach(g => {
                const isMember = g.members && g.members.includes(currentUser.login);
                html += \`
                    <div class="bg-gray-800/60 border border-gray-700/50 p-3 rounded-xl flex items-center justify-between hover:border-purple-500/50 transition">
                        <div class="flex items-center space-x-3 cursor-pointer flex-1" onclick="openGroupWorkspace('\${g.id}')">
                            <img src="\${g.avatar}" class="w-10 h-10 rounded-xl object-cover border border-purple-500/30">
                            <div>
                                <div class="font-bold text-white text-sm flex items-center space-x-1">
                                    <span>\${g.name}</span>
                                    \${g.isVerified ? '<span class="text-blue-400 text-xs">✔</span>' : ''}
                                    \${g.isClosed ? '<span class="text-yellow-400 text-xs">🔒</span>' : ''}
                                </div>
                                <div class="text-xs text-gray-400">Участников: \${g.members ? g.members.length : 0}</div>
                            </div>
                        </div>
                        <div>
                            \${isMember ? 
                                \`<button onclick="openGroupWorkspace('\${g.id}')" class="bg-purple-600/30 hover:bg-purple-600/50 text-purple-300 px-3 py-1.5 rounded-lg text-xs font-bold transition">Открыть</button>\` :
                                (g.isClosed ? 
                                    \`<button onclick="requestJoinGroup('\${g.id}')" class="bg-yellow-600/30 hover:bg-yellow-600/50 text-yellow-300 px-3 py-1.5 rounded-lg text-xs font-bold transition">Заявка</button>\` :
                                    \`<button onclick="joinGroup('\${g.id}')" class="bg-green-600/30 hover:bg-green-600/50 text-green-300 px-3 py-1.5 rounded-lg text-xs font-bold transition">Вступить</button>\`
                                )
                            }
                        </div>
                    </div>
                \`;
            });
            groupsListEl.innerHTML = html;
        }

        function openCreateGroupModal() {
            document.getElementById('create-group-modal').classList.remove('hidden');
        }

        function closeCreateGroupModal() {
            document.getElementById('create-group-modal').classList.add('hidden');
        }

        function createGroup() {
            const name = document.getElementById('new-group-name').value.trim();
            if (!name) return alert('Введите название группы');

            fetch('/api/create-group', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, creator: currentUser.login })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    db = data.db;
                    closeCreateGroupModal();
                    document.getElementById('new-group-name').value = '';
                    renderGroupsList();
                } else {
                    alert(data.error);
                }
            });
        }

        function joinGroup(groupId) {
            fetch('/api/join-group', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ groupId, login: currentUser.login })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    db = data.db;
                    renderGroupsList();
                    openGroupWorkspace(groupId);
                } else {
                    alert(data.error);
                }
            });
        }

        function requestJoinGroup(groupId) {
            fetch('/api/request-join-group', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ groupId, login: currentUser.login })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    alert('Заявка на вступление отправлена администраторам группы.');
                } else {
                    alert(data.error);
                }
            });
        }

        function openGroupWorkspace(groupId) {
            activeGroupId = groupId;
            socket.emit('join-group-room', groupId);
            renderGroupWorkspace(groupId);
        }

        function renderGroupWorkspace(groupId, subgroup = 'main') {
            const g = db.groups[groupId];
            if (!g) return;
            const workspace = document.getElementById('chat-workspace');
            const storeKey = \`group_\${groupId}_\${subgroup}\`;
            const messages = db.messagesStore[storeKey] || [];

            let messagesHtml = messages.map(m => \`
                <div class="mb-3">
                    <div class="text-xs text-purple-400 font-bold">\${m.sender}</div>
                    <div class="bg-gray-800 p-3 rounded-xl mt-1 text-sm text-white inline-block max-w-lg">\${m.text}</div>
                </div>
            \`).join('');

            workspace.innerHTML = \`
                <div class="p-4 border-b border-gray-700 flex items-center justify-between bg-gray-800/40">
                    <div class="flex items-center space-x-3">
                        <img src="\${g.avatar}" class="w-10 h-10 rounded-xl object-cover">
                        <span class="font-bold text-white">\${g.name}</span>
                    </div>
                </div>
                <div id="messages-container" class="flex-1 p-4 overflow-y-auto space-y-2">\${messagesHtml}</div>
                <div class="p-4 border-t border-gray-700 bg-gray-800/40 flex space-x-2">
                    <input type="text" id="chat-input" placeholder="Введите сообщение..." onkeydown="if(event.key==='Enter') sendMessage('\${groupId}', '\${subgroup}')" class="flex-1 bg-gray-900 border border-gray-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-purple-500">
                    <button onclick="sendMessage('\${groupId}', '\${subgroup}')" class="bg-purple-600 hover:bg-purple-700 px-6 py-2.5 rounded-xl font-bold text-sm transition">Отправить</button>
                </div>
            \`;
            const container = document.getElementById('messages-container');
            container.scrollTop = container.scrollHeight;
        }

        function renderGroupMessages(groupId, subgroup = 'main') {
            const storeKey = \`group_\${groupId}_\${subgroup}\`;
            const messages = db.messagesStore[storeKey] || [];
            const container = document.getElementById('messages-container');
            if (!container) return;

            container.innerHTML = messages.map(m => \`
                <div class="mb-3">
                    <div class="text-xs text-purple-400 font-bold">\${m.sender}</div>
                    <div class="bg-gray-800 p-3 rounded-xl mt-1 text-sm text-white inline-block max-w-lg">\${m.text}</div>
                </div>
            \`).join('');
            container.scrollTop = container.scrollHeight;
        }

        function sendMessage(groupId, subgroup = 'main') {
            const input = document.getElementById('chat-input');
            const text = input.value.trim();
            if (!text) return;

            fetch('/api/send-message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sender: currentUser.login,
                    text,
                    chatType: 'group',
                    chatId: groupId,
                    subgroup
                })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    input.value = '';
                } else {
                    alert(data.error);
                }
            });
        }
    </script>
</body>
</html>
    `);
});

const PORT = process.env.PORT || 3000;
initDatabase().then(() => {
    server.listen(PORT, () => {
        console.log(`Приложение успешно запущено! Откройте в браузере: http://localhost:${PORT}`);
    });
});
