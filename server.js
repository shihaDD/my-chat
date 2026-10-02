const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');

// ====== ГЛОБАЛЬНЫЕ ERROR HANDLERS — не дают серверу упасть ======
process.on('uncaughtException', (err) => {
    console.error('⚠️ uncaughtException:', err.message);
    console.error(err.stack);
});
process.on('unhandledRejection', (err) => {
    console.error('⚠️ unhandledRejection:', err && err.message ? err.message : err);
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    maxHttpBufferSize: 1e8 // 100MB
});

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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
        await mongoose.connect(MONGO_URI, {
            serverSelectionTimeoutMS: 3000,
            connectTimeoutMS: 5000
        });
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
                    'Админ': { canPost: true, canDelete: true, canVoice: true, canDuplicateNews: true, canVoiceControl: true },
                    'Участник': { canPost: false, canDelete: false, canVoice: true, canDuplicateNews: false, canVoiceControl: false }
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
        console.error('Ошибка подключения к MongoDB:', e.message);
        console.log('Сервер будет работать с данными в памяти (без MongoDB)');
    }
}

// --- Debounced saveDb and broadcastDb for performance ---
let saveTimer = null;
let broadcastTimer = null;
let isBroadcasting = false;
let isSaving = false;

async function saveDb() {
    if (mongoose.connection.readyState !== 1) return;
    if (isSaving) return;
    isSaving = true;
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
        );
    } catch (e) {
        console.error('Ошибка сохранения БД:', e.message);
    } finally {
        isSaving = false;
    }
}

function buildLightDb() {
    const lightUsers = {};
    for (let login in db.users) {
        lightUsers[login] = { ...db.users[login] };
        delete lightUsers[login].password;
    }
    return {
        users: lightUsers,
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
    };
}

function broadcastDb() {
    if (isBroadcasting) return;
    isBroadcasting = true;
    try {
        const lightDb = buildLightDb();
        io.emit('update-db', lightDb);
    } catch(e) {
        console.error('broadcastDb error:', e.message);
    } finally {
        setTimeout(() => { isBroadcasting = false; }, 50);
    }
}

function debouncedSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveDb(); }, 1000);
}

function debouncedBroadcast() {
    if (broadcastTimer) clearTimeout(broadcastTimer);
    broadcastTimer = setTimeout(() => { broadcastDb(); }, 200); // Уменьшили до 200мс
}

// Helper: save, broadcast, and return db in response
function saveAndBroadcast(res, extra) {
    debouncedSave();
    debouncedBroadcast();
    const lightDb = buildLightDb();
    const response = { success: true, db: lightDb };
    if (extra) {
        if (extra.user) {
            const safeUser = { ...extra.user };
            delete safeUser.password;
            response.user = safeUser;
        } else {
            Object.assign(response, extra);
        }
    }
    return res.json(response);
}

// NEW: Быстрый ответ БЕЗ рассылки всем (для login, restore-session, register)
function fastResponse(res, extra) {
    debouncedSave(); // Сохраняем, но НЕ рассылаем всем
    const lightDb = buildLightDb();
    const response = { success: true, db: lightDb };
    if (extra) {
        if (extra.user) {
            const safeUser = { ...extra.user };
            delete safeUser.password;
            response.user = safeUser;
        } else {
            Object.assign(response, extra);
        }
    }
    return res.json(response);
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

function safeToRoom(target) {
    if (!target || typeof target !== 'string') return null;
    return target.toLowerCase();
}

// ====== API ROUTES ======

app.post('/api/register', async (req, res) => {
    try {
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

    return fastResponse(res); // БЫСТРЕЕ: не рассылаем всем
    } catch(e) { console.error('register error:', e); return res.json({ success: false, error: 'Внутренняя ошибка сервера' }); }
});

app.post('/api/login', async (req, res) => {
    try {
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

    db.lastSeen[cleanLogin] = Date.now();
    return fastResponse(res, { user }); // БЫСТРЕЕ: не рассылаем всем
    } catch(e) { console.error('login error:', e); return res.json({ success: false, error: 'Внутренняя ошибка сервера' }); }
});

app.post('/api/restore-session', async (req, res) => {
    try {
    const { login } = req.body;
    if (!login) return res.json({ success: false });
    const cleanLogin = login.trim().toLowerCase();
    const user = db.users[cleanLogin];
    if (!user) return res.json({ success: false });
    db.lastSeen[cleanLogin] = Date.now();
    return fastResponse(res, { user }); // БЫСТРЕЕ: не рассылаем всем
    } catch(e) { console.error('restore-session error:', e); return res.json({ success: false }); }
});

app.post('/api/update-profile', async (req, res) => {
    try {
    const { login, name, email, bio, avatar, password } = req.body;
    if (!login) return res.json({ success: false, error: 'Логин не передан' });
    const cleanLogin = login.trim().toLowerCase();
    if (!db.users[cleanLogin]) return res.json({ success: false, error: 'Пользователь не найден' });
    
    if (name) db.users[cleanLogin].name = name.trim();
    if (email !== undefined) db.users[cleanLogin].email = email.trim();
    if (bio !== undefined) db.users[cleanLogin].bio = bio.trim();
    if (avatar) db.users[cleanLogin].avatar = avatar;
    if (password) db.users[cleanLogin].password = password;
    return saveAndBroadcast(res, { user: db.users[cleanLogin] });
    } catch(e) { console.error('update-profile error:', e); return res.json({ success: false, error: 'Внутренняя ошибка сервера' }); }
});

app.post('/api/set-global-role', async (req, res) => {
    try {
    const { login, targetLogin, newRole } = req.body;
    const cleanLogin = login ? login.trim().toLowerCase() : '';
    if (cleanLogin !== 'warren' && getUserGlobalRole(cleanLogin) !== 'main_moderator') {
        return res.json({ success: false, error: 'Недостаточно прав!' });
    }
    if (!db.globalRoles) db.globalRoles = {};
    db.globalRoles[targetLogin.trim().toLowerCase()] = newRole;
    return saveAndBroadcast(res);
    } catch(e) { console.error('set-global-role error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/remove-global-mute', async (req, res) => {
    try {
    const { login, targetLogin } = req.body;
    const cleanLogin = login ? login.trim().toLowerCase() : '';
    if (!hasFullAccess(cleanLogin)) {
        return res.json({ success: false, error: 'Недостаточно прав!' });
    }
    if (db.mutedUsers && targetLogin) {
        delete db.mutedUsers[targetLogin.trim().toLowerCase()];
    }
    return saveAndBroadcast(res);
    } catch(e) { console.error('remove-global-mute error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/issue-global-mute', async (req, res) => {
    try {
    const { login, targetLogin, muteMinutes, reason } = req.body;
    if (!hasFullAccess(login)) {
        return res.json({ success: false, error: 'Недостаточно прав!' });
    }
    if (!db.mutedUsers) db.mutedUsers = {};
    const mins = parseInt(muteMinutes) || 60;
    const clampedMins = Math.min(Math.max(mins, 1), 9999);
    db.mutedUsers[targetLogin.trim().toLowerCase()] = {
        expires: Date.now() + (clampedMins * 60 * 1000),
        reason: reason || 'Нарушение правил'
    };
    return saveAndBroadcast(res);
    } catch(e) { console.error('issue-global-mute error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/add-friend', async (req, res) => {
    try {
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
    
    // ЗАЩИТА ОТ ДУБЛИКАТОВ: проверяем, не отправлена ли уже заявка
    if (!db.friendRequests[cleanTarget]) db.friendRequests[cleanTarget] = [];
    if (!db.outgoingRequests) db.outgoingRequests = {};
    if (!db.outgoingRequests[login]) db.outgoingRequests[login] = [];

    if (db.friendRequests[cleanTarget].includes(login)) {
        return res.json({ success: false, error: 'Заявка уже отправлена!' });
    }
    if (db.outgoingRequests[login].includes(cleanTarget)) {
        return res.json({ success: false, error: 'Заявка уже отправлена!' });
    }

    db.friendRequests[cleanTarget].push(login);
    db.outgoingRequests[login].push(cleanTarget);
    return saveAndBroadcast(res);
    } catch(e) { console.error('add-friend error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/cancel-friend-request', async (req, res) => {
    try {
    const { login, targetLogin } = req.body;
    if (db.outgoingRequests && db.outgoingRequests[login]) {
        db.outgoingRequests[login] = db.outgoingRequests[login].filter(l => l !== targetLogin);
    }
    if (db.friendRequests && db.friendRequests[targetLogin]) {
        db.friendRequests[targetLogin] = db.friendRequests[targetLogin].filter(l => l !== login);
    }
    return saveAndBroadcast(res);
    } catch(e) { console.error('cancel-friend error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/respond-friend-request', async (req, res) => {
    try {
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
    return saveAndBroadcast(res);
    } catch(e) { console.error('respond-friend error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/remove-friend', async (req, res) => {
    try {
    const { login, targetLogin } = req.body;
    if (db.friends[login]) db.friends[login] = db.friends[login].filter(l => l !== targetLogin);
    if (db.friends[targetLogin]) db.friends[targetLogin] = db.friends[targetLogin].filter(l => l !== login);
    return saveAndBroadcast(res);
    } catch(e) { console.error('remove-friend error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/create-group', async (req, res) => {
    try {
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
            'Админ': { canPost: true, canDelete: true, canVoice: true, canDuplicateNews: true, canVoiceControl: true },
            'Участник': { canPost: false, canDelete: false, canVoice: true, canDuplicateNews: false, canVoiceControl: false }
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
    return saveAndBroadcast(res);
    } catch(e) { console.error('create-group error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/delete-group', async (req, res) => {
    try {
    const { groupId, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    const isLeader = group.creator === login;
    const globalRole = getUserGlobalRole(login);
    const isWarrenOrMainMod = login.toLowerCase() === 'warren' || globalRole === 'main_moderator';

    if (!isLeader && !isWarrenOrMainMod && !hasFullAccess(login)) {
        return res.json({ success: false, error: 'Недостаточно прав!' });
    }
    delete db.groups[groupId];
    return saveAndBroadcast(res);
    } catch(e) { console.error('delete-group error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/update-group-settings', async (req, res) => {
    try {
    const { groupId, name, avatar, isClosed, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    if (group.creator !== login && group.roles?.[login] !== 'Админ' && !hasFullAccess(login)) {
        return res.json({ success: false, error: 'Недостаточно прав!' });
    }
    if (name) group.name = name.trim();
    if (avatar) group.avatar = avatar;
    if (isClosed !== undefined) group.isClosed = !!isClosed;
    return saveAndBroadcast(res, { group });
    } catch(e) { console.error('update-group-settings error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/update-group', async (req, res) => {
    try {
    const { groupId, name, avatar, isClosed, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    if (group.creator !== login && group.roles?.[login] !== 'Админ' && !hasFullAccess(login)) {
        return res.json({ success: false, error: 'Недостаточно прав!' });
    }
    if (name) group.name = name.trim();
    if (avatar) group.avatar = avatar;
    if (isClosed !== undefined) group.isClosed = !!isClosed;
    return saveAndBroadcast(res, { group });
    } catch(e) { console.error('update-group error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/leave-group', async (req, res) => {
    try {
    const { groupId, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    if (!group.members.includes(login)) return res.json({ success: false, error: 'Вы не участник группы' });

    if (group.creator === login) {
        const otherMembers = group.members.filter(m => m !== login);
        if (otherMembers.length === 0) {
            delete db.groups[groupId];
            return saveAndBroadcast(res);
        }
        let nextLeader = otherMembers.find(m => group.roles?.[m] === 'Админ') || otherMembers[0];
        group.creator = nextLeader;
        group.roles[nextLeader] = 'Лидер';
    }

    group.members = group.members.filter(m => m !== login);
    if (group.roles) delete group.roles[login];
    if (group.groupMutedUsers) delete group.groupMutedUsers[login];
    if (group.groupNicknames) delete group.groupNicknames[login];

    return saveAndBroadcast(res);
    } catch(e) { console.error('leave-group error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/group-mute-member', async (req, res) => {
    try {
    const { groupId, login, targetLogin, muteMinutes, reason } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    const isLeader = group.creator === login;
    const myRole = group.roles?.[login];
    if (!isLeader && myRole !== 'Админ' && !hasFullAccess(login)) {
        return res.json({ success: false, error: 'Недостаточно прав для выдачи мута в группе!' });
    }

    if (!group.groupMutedUsers) group.groupMutedUsers = {};
    const cleanTarget = targetLogin.trim().toLowerCase();
    const mins = parseInt(muteMinutes) || 0;
    if (mins <= 0) {
        delete group.groupMutedUsers[cleanTarget];
    } else {
        const clampedMins = Math.min(Math.max(mins, 1), 9999);
        group.groupMutedUsers[cleanTarget] = {
            expires: Date.now() + (clampedMins * 60 * 1000),
            reason: reason || 'Нарушение правил группы'
        };
    }

    return saveAndBroadcast(res);
    } catch(e) { console.error('group-mute error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/group-set-nickname', async (req, res) => {
    try {
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
        delete group.groupNicknames[targetLogin.toLowerCase()];
    } else {
        group.groupNicknames[targetLogin.toLowerCase()] = cleanNick;
    }

    return saveAndBroadcast(res);
    } catch(e) { console.error('group-set-nickname error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/request-verification', async (req, res) => {
    try {
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

    return saveAndBroadcast(res);
    } catch(e) { console.error('request-verification error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/resolve-verification', async (req, res) => {
    try {
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
    return saveAndBroadcast(res);
    } catch(e) { console.error('resolve-verification error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/join-group', async (req, res) => {
    try {
    const { groupId, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Сообщество не найдено' });

    if (group.isClosed) {
        return res.json({ success: false, error: 'Эта группа закрытая. Подайте заявку на вступление.' });
    }

    if (!group.members.includes(login)) {
        group.members.push(login);
        group.roles[login] = 'Участник';
    }
    return saveAndBroadcast(res);
    } catch(e) { console.error('join-group error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/request-join-group', async (req, res) => {
    try {
    const { groupId, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Сообщество не найдено' });
    if (group.members.includes(login)) return res.json({ success: false, error: 'Вы уже участник группы' });

    if (!group.joinRequests) group.joinRequests = [];
    if (!group.joinRequests.includes(login)) {
        group.joinRequests.push(login);
    }
    return saveAndBroadcast(res);
    } catch(e) { console.error('request-join-group error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/respond-join-request', async (req, res) => {
    try {
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
    return saveAndBroadcast(res);
    } catch(e) { console.error('respond-join-request error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/set-group-role', async (req, res) => {
    try {
    const { groupId, login, targetLogin, newRole } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Сообщество не найдено' });

    const isLeader = group.creator === login;
    if (!isLeader && group.roles?.[login] !== 'Админ' && !hasFullAccess(login)) {
        return res.json({ success: false, error: 'Недостаточно прав для изменения ролей!' });
    }
    if (!group.roles) group.roles = {};
    group.roles[targetLogin] = newRole;
    return saveAndBroadcast(res);
    } catch(e) { console.error('set-group-role error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/change-group-member-role', async (req, res) => {
    try {
    const { groupId, login, targetLogin, newRole } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Сообщество не найдено' });

    const isLeader = group.creator === login;
    if (!isLeader && group.roles?.[login] !== 'Админ' && !hasFullAccess(login)) {
        return res.json({ success: false, error: 'Недостаточно прав для изменения ролей!' });
    }
    if (!group.roles) group.roles = {};
    group.roles[targetLogin] = newRole;
    return saveAndBroadcast(res);
    } catch(e) { console.error('change-group-member-role error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/create-custom-role', async (req, res) => {
    try {
    const { groupId, login, roleName, permissions } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    if (group.creator !== login && !hasFullAccess(login)) {
        return res.json({ success: false, error: 'Только лидер группы может создавать роли!' });
    }
    if (!group.customRoles) group.customRoles = {};
    const cleanName = roleName.trim();
    if (!cleanName) return res.json({ success: false, error: 'Введите название роли' });

    group.customRoles[cleanName] = permissions || { canPost: true, canDelete: true, canVoice: true, canDuplicateNews: false, canVoiceControl: false };
    return saveAndBroadcast(res);
    } catch(e) { console.error('create-custom-role error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/update-role-permissions', async (req, res) => {
    try {
    const { groupId, login, roleName, permissions } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    if (group.creator !== login && group.roles?.[login] !== 'Админ' && !hasFullAccess(login)) {
        return res.json({ success: false, error: 'Недостаточно прав!' });
    }
    if (!group.customRoles) group.customRoles = {};
    group.customRoles[roleName] = permissions;
    return saveAndBroadcast(res);
    } catch(e) { console.error('update-role-permissions error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/delete-custom-role', async (req, res) => {
    try {
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
    }
    return saveAndBroadcast(res);
    } catch(e) { console.error('delete-custom-role error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/kick-group-member', async (req, res) => {
    try {
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
    return saveAndBroadcast(res);
    } catch(e) { console.error('kick-group-member error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/create-subgroup', async (req, res) => {
    try {
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
    return saveAndBroadcast(res);
    } catch(e) { console.error('create-subgroup error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/delete-subgroup', async (req, res) => {
    try {
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
    return saveAndBroadcast(res);
    } catch(e) { console.error('delete-subgroup error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/edit-message', async (req, res) => {
    try {
    const { login, msgId, messageId, newText } = req.body;
    const id = msgId || messageId;
    let found = false;

    for (let key in db.messagesStore) {
        const msgs = db.messagesStore[key];
        const m = msgs.find(item => item.id === id);
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
        return saveAndBroadcast(res);
    } else {
        res.json({ success: false, error: 'Сообщение не найдено' });
    }
    } catch(e) { console.error('edit-message error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/delete-message', async (req, res) => {
    try {
    const { login, msgId, messageId } = req.body;
    const id = msgId || messageId;
    let found = false;

    for (let key in db.messagesStore) {
        const msgs = db.messagesStore[key];
        const idx = msgs.findIndex(item => item.id === id);
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
        return saveAndBroadcast(res);
    } else {
        res.json({ success: false, error: 'Сообщение не найдено' });
    }
    } catch(e) { console.error('delete-message error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/pin-message', async (req, res) => {
    try {
    const { login, messageId, chatKey } = req.body;
    if (!db.pinnedMessages) db.pinnedMessages = {};
    db.pinnedMessages[chatKey] = messageId;
    return saveAndBroadcast(res);
    } catch(e) { console.error('pin-message error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/unpin-message', async (req, res) => {
    try {
    const { chatKey } = req.body;
    if (db.pinnedMessages && db.pinnedMessages[chatKey]) {
        delete db.pinnedMessages[chatKey];
    }
    return saveAndBroadcast(res);
    } catch(e) { console.error('unpin-message error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/create-news', async (req, res) => {
    try {
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

    return saveAndBroadcast(res);
    } catch(e) { console.error('create-news error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/publish-news', async (req, res) => {
    try {
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

    return saveAndBroadcast(res);
    } catch(e) { console.error('publish-news error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/delete-news', async (req, res) => {
    try {
    const { login, postId } = req.body;
    const post = (db.news || []).find(p => p.id === postId);
    if (!post) return res.json({ success: false, error: 'Новость не найдена' });
    if (post.author !== login && !hasFullAccess(login)) {
        return res.json({ success: false, error: 'Недостаточно прав' });
    }
    db.news = db.news.filter(p => p.id !== postId);
    return saveAndBroadcast(res);
    } catch(e) { console.error('delete-news error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/create-group-post', async (req, res) => {
    try {
    const { groupId, login, text, isAnnouncement, announcement } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    const isLeader = group.creator === login;
    const myRole = group.roles?.[login];
    const rolePerms = group.customRoles?.[myRole];
    const canPost = isLeader || myRole === 'Админ' || (rolePerms && rolePerms.canPost) || hasFullAccess(login);

    if (!canPost) {
        return res.json({ success: false, error: 'У вас нет прав на публикацию постов в этой группе!' });
    }

    const shouldAnnounce = isAnnouncement || announcement;
    if (shouldAnnounce && !group.isVerified) {
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

    if (shouldAnnounce && group.isVerified) {
        if (!db.news) db.news = [];
        const grp = db.groups[groupId];
        db.news.unshift({
            id: 'news_' + Date.now(),
            author: login,
            sourceGroup: { name: grp.name, isVerified: grp.isVerified, avatar: grp.avatar || '' },
            text: text,
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
            groupName: group.name,
            groupId,
            groupPostId: postId
        });
    }

    return saveAndBroadcast(res);
    } catch(e) { console.error('create-group-post error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/publish-group-post', async (req, res) => {
    try {
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
        const grp = db.groups[groupId];
        db.news.unshift({
            id: 'news_' + Date.now(),
            author: login,
            sourceGroup: { name: grp.name, isVerified: grp.isVerified, avatar: grp.avatar || '' },
            text: text,
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
            groupName: group.name,
            groupId,
            groupPostId: postId
        });
    }

    return saveAndBroadcast(res);
    } catch(e) { console.error('publish-group-post error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/delete-group-post', async (req, res) => {
    try {
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
    return saveAndBroadcast(res);
    } catch(e) { console.error('delete-group-post error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.post('/api/resolve-violation-action', async (req, res) => {
    try {
    const { login, violId, action, newText, muteMinutes, reason } = req.body;
    if (!hasFullAccess(login)) return res.json({ success: false, error: 'Недостаточно прав' });
    if (!db.violations) db.violations = [];

    const viol = db.violations.find(v => v.id === violId);
    if (!viol) return res.json({ success: false, error: 'Нарушение не найдено' });

    if (action === 'approve') {
        if (!db.news) db.news = [];
        const grp = viol.groupId ? db.groups[viol.groupId] : null;
        db.news.unshift({
            id: 'news_' + Date.now(),
            author: viol.author,
            sourceGroup: grp ? { name: grp.name, isVerified: grp.isVerified, avatar: grp.avatar || '' } : null,
            text: viol.text,
            timestamp: Date.now()
        });
    } else if (action === 'edit') {
        viol.text = newText;
        if (!db.news) db.news = [];
        const grp = viol.groupId ? db.groups[viol.groupId] : null;
        db.news.unshift({
            id: 'news_' + Date.now(),
            author: viol.author,
            sourceGroup: grp ? { name: grp.name, isVerified: grp.isVerified, avatar: grp.avatar || '' } : null,
            text: newText,
            timestamp: Date.now()
        });
        if (viol.groupId && viol.groupPostId && db.groups[viol.groupId]) {
            const g = db.groups[viol.groupId];
            if (g.posts) {
                const gpost = g.posts.find(p => p.id === viol.groupPostId);
                if (gpost) {
                    gpost.text = newText;
                }
            }
        }
        if (viol.messageId && viol.storeKey && db.messagesStore[viol.storeKey]) {
            const msg = db.messagesStore[viol.storeKey].find(m => m.id === viol.messageId);
            if (msg) {
                msg.text = newText;
            }
        }
    } else if (action === 'mute') {
        if (!db.mutedUsers) db.mutedUsers = {};
        const mins = parseInt(muteMinutes) || 60;
        const clampedMins = Math.min(Math.max(mins, 1), 9999);
        db.mutedUsers[viol.author.toLowerCase()] = {
            expires: Date.now() + (clampedMins * 60 * 1000),
            reason: reason || 'Нарушение правил'
        };
    } else if (action === 'delete') {
        if (viol.messageId && viol.storeKey && db.messagesStore[viol.storeKey]) {
            db.messagesStore[viol.storeKey] = db.messagesStore[viol.storeKey].filter(m => m.id !== viol.messageId);
        }
        if (viol.postId) {
            db.news = db.news.filter(n => n.id !== viol.postId);
        }
        if (viol.groupId && viol.groupPostId && db.groups[viol.groupId]) {
            const g = db.groups[viol.groupId];
            if (g.posts) {
                g.posts = g.posts.filter(p => p.id !== viol.groupPostId);
            }
        }
    }

    db.violations = db.violations.filter(v => v.id !== violId);
    return saveAndBroadcast(res);
    } catch(e) { console.error('resolve-violation-action error:', e); return res.json({ success: false, error: 'Внутренняя ошибка' }); }
});

app.get('/api/internet-news', async (req, res) => {
    try {
        if (typeof fetch === 'undefined') return res.json([]);
        const response = await fetch('https://newsapi.org/v2/top-headlines?country=ru&apiKey=demo&pageSize=10');
        const data = await response.json();
        if (data.articles) {
            const items = data.articles.map(a => ({
                title: a.title,
                description: a.description || '',
                url: a.url,
                image: a.urlToImage || '',
                source: a.source?.name || ''
            }));
            return res.json(items);
        }
        res.json([]);
    } catch (e) {
        console.error('internet-news error:', e.message);
        res.json([]);
    }
});

// Извлечение groupId из roomKey
function extractGroupIdFromRoomKey(roomKey) {
    if (!roomKey || typeof roomKey !== 'string') return null;
    const parts = roomKey.split('_');
    if (parts.length >= 2 && parts[0] === 'group') return parts[1];
    return null;
}

// ====== SOCKET.IO ======
io.on('connection', (socket) => {
    socket.on('register', (login) => {
        try {
        if (login) {
            socket.userLogin = login.toLowerCase();
            socket.join(socket.userLogin);
            db.lastSeen[socket.userLogin] = Date.now();
        }
        } catch(e) { console.error('socket register error:', e.message); }
    });

    socket.on('refresh-db', () => {
        try {
            const lightDb = buildLightDb();
            socket.emit('update-db', lightDb);
        } catch(e) { console.error('refresh-db error:', e.message); }
    });

    socket.on('join-group-room', (groupId) => {
        try { if (groupId) socket.join(`group_${groupId}`); } catch(e) {}
    });

    socket.on('join-group-workspace', (groupId) => {
        try { if (groupId) socket.join(`workspace_${groupId}`); } catch(e) {}
    });

    socket.on('leave-group-workspace', (groupId) => {
        try { if (groupId) socket.leave(`workspace_${groupId}`); } catch(e) {}
    });

    socket.on('call-user', ({ offer, to, from }) => {
        try {
        const room = safeToRoom(to);
        if (room) io.to(room).emit('incoming-call', { offer, from });
        } catch(e) { console.error('call-user error:', e.message); }
    });

    socket.on('make-answer', ({ answer, to }) => {
        try {
        const room = safeToRoom(to);
        if (room) io.to(room).emit('call-answered', { answer, from: socket.userLogin });
        } catch(e) { console.error('make-answer error:', e.message); }
    });

    socket.on('reject-call', ({ to }) => {
        try {
        const room = safeToRoom(to);
        if (room) io.to(room).emit('call-rejected');
        } catch(e) { console.error('reject-call error:', e.message); }
    });

    socket.on('hang-up', ({ to }) => {
        try {
        const room = safeToRoom(to);
        if (room) io.to(room).emit('call-ended');
        } catch(e) { console.error('hang-up error:', e.message); }
    });

    socket.on('ice-candidate', ({ candidate, to }) => {
        try {
        const room = safeToRoom(to);
        if (room) io.to(room).emit('ice-candidate', { candidate, from: socket.userLogin });
        } catch(e) { console.error('ice-candidate error:', e.message); }
    });

    socket.on('send-message', ({ sender, receiver, msg }) => {
        try {
        if (!sender || !receiver || !msg) return;
        const storeKey = [sender, receiver].sort().join('_');
        if (!db.messagesStore[storeKey]) db.messagesStore[storeKey] = [];
        
        // Дедупликация
        if (db.messagesStore[storeKey].some(m => m.id === msg.id)) return;
        
        if (containsMat(msg.text)) {
            if (!db.violations) db.violations = [];
            db.violations.push({
                id: 'viol_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                author: sender,
                text: msg.text,
                timestamp: Date.now(),
                source: 'chat',
                messageId: msg.id,
                storeKey
            });
        }
        
        db.messagesStore[storeKey].push(msg);
        debouncedSave();
        
        io.to(receiver.toLowerCase()).emit('receive-message', { sender, receiver, msg });
        io.to(sender.toLowerCase()).emit('receive-message', { sender, receiver, msg });
        debouncedBroadcast();
        } catch(e) { console.error('send-message socket error:', e.message); }
    });

    socket.on('send-saved-message', ({ login, msg }) => {
        try {
        if (!login || !msg) return;
        const storeKey = `saved_${login}`;
        if (!db.messagesStore[storeKey]) db.messagesStore[storeKey] = [];
        if (db.messagesStore[storeKey].some(m => m.id === msg.id)) return;
        db.messagesStore[storeKey].push(msg);
        debouncedSave();
        } catch(e) { console.error('send-saved-message error:', e.message); }
    });

    socket.on('send-group-message', ({ groupId, subgroup, msg }) => {
        try {
        if (!groupId || !msg) return;
        const group = db.groups[groupId];
        if (!group) return;
        
        const sender = msg.sender;
        
        if (group.groupMutedUsers?.[sender.toLowerCase()] && group.groupMutedUsers[sender.toLowerCase()].expires > Date.now()) {
            return;
        }
        
        const storeKey = `group_${groupId}_${subgroup || 'main'}`;
        if (!db.messagesStore[storeKey]) db.messagesStore[storeKey] = [];
        
        // Дедупликация
        if (db.messagesStore[storeKey].some(m => m.id === msg.id)) return;
        
        if (containsMat(msg.text)) {
            if (!db.violations) db.violations = [];
            db.violations.push({
                id: 'viol_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                author: sender,
                text: msg.text,
                timestamp: Date.now(),
                source: 'group',
                groupName: group.name,
                groupId,
                messageId: msg.id,
                storeKey
            });
        }
        
        db.messagesStore[storeKey].push(msg);
        debouncedSave();
        
        io.emit('receive-group-message', { groupId, msg, subgroup: subgroup || 'main' });
        debouncedBroadcast();
        } catch(e) { console.error('send-group-message socket error:', e.message); }
    });

    socket.on('join-voice-room', ({ roomKey, login }) => {
        try {
        if (!roomKey || !login) return;
        socket.join(roomKey);
        socket.roomKey = roomKey;
        socket.voiceLogin = login;

        if (!global.voiceRooms) global.voiceRooms = {};
        if (!global.voiceRooms[roomKey]) global.voiceRooms[roomKey] = new Set();
        global.voiceRooms[roomKey].add(login);

        const participants = Array.from(global.voiceRooms[roomKey]);
        
        io.to(roomKey).emit('voice-room-update', { roomKey, participants });
        // НОВЫМ участникам говорим, кто уже в канале — они сами отправят offer каждому
        socket.to(roomKey).emit('voice-user-joined', { login });

        const gId = extractGroupIdFromRoomKey(roomKey);
        if (gId) io.to(`workspace_${gId}`).emit('voice-room-update', { roomKey, participants });
        } catch(e) { console.error('join-voice-room error:', e.message); }
    });

    socket.on('leave-voice-room', ({ roomKey, login }) => {
        try {
        if (!roomKey) return;
        socket.leave(roomKey);
        
        if (global.voiceRooms && global.voiceRooms[roomKey] && login) {
            global.voiceRooms[roomKey].delete(login);
            const participants = Array.from(global.voiceRooms[roomKey]);
            io.to(roomKey).emit('voice-room-update', { roomKey, participants });
            socket.emit('voice-room-update', { roomKey, participants });

            const gId = extractGroupIdFromRoomKey(roomKey);
            if (gId) io.to(`workspace_${gId}`).emit('voice-room-update', { roomKey, participants });
        }
        
        socket.roomKey = null;
        socket.voiceLogin = null;
        } catch(e) { console.error('leave-voice-room error:', e.message); }
    });

    socket.on('voice-speaking', ({ roomKey, login, isSpeaking }) => {
        try {
        if (!roomKey || !login) return;
        socket.to(roomKey).emit('user-speaking', { login, isSpeaking });

        const gId = extractGroupIdFromRoomKey(roomKey);
        if (gId) io.to(`workspace_${gId}`).emit('user-speaking', { login, isSpeaking });
        } catch(e) { console.error('voice-speaking error:', e.message); }
    });

    socket.on('voice-offer', ({ offer, to, from }) => {
        try {
        const room = safeToRoom(to);
        if (room) io.to(room).emit('voice-offer', { offer, from });
        } catch(e) { console.error('voice-offer error:', e.message); }
    });

    socket.on('voice-answer', ({ answer, to }) => {
        try {
        const room = safeToRoom(to);
        if (room) io.to(room).emit('voice-answer', { answer, from: socket.userLogin });
        } catch(e) { console.error('voice-answer error:', e.message); }
    });

    socket.on('admin-voice-action', ({ groupId, subId, targetLogin, action, adminLogin }) => {
        try {
        if (!groupId || !targetLogin) return;
        const group = db.groups[groupId];
        if (!group) return;
        const isLeader = group.creator === adminLogin;
        const myRole = group.roles?.[adminLogin] || 'Участник';
        const rolePerms = group.customRoles?.[myRole];
        const canCtrl = isLeader || myRole === 'Админ' || (rolePerms && rolePerms.canVoiceControl) || hasFullAccess(adminLogin);
        if (!canCtrl) return;

        const room = safeToRoom(targetLogin);
        if (room) io.to(room).emit('forced-voice-action', { action, subId });
        } catch(e) { console.error('admin-voice-action error:', e.message); }
    });

    socket.on('disconnect', () => {
        try {
        if (socket.userLogin) {
            db.lastSeen[socket.userLogin] = Date.now();
        }
        if (socket.roomKey && socket.voiceLogin) {
            if (global.voiceRooms && global.voiceRooms[socket.roomKey]) {
                global.voiceRooms[socket.roomKey].delete(socket.voiceLogin);
                const participants = Array.from(global.voiceRooms[socket.roomKey]);
                io.to(socket.roomKey).emit('voice-room-update', { roomKey: socket.roomKey, participants });

                const gId = extractGroupIdFromRoomKey(socket.roomKey);
                if (gId) io.to(`workspace_${gId}`).emit('voice-room-update', { roomKey: socket.roomKey, participants });
            }
        }
        } catch(e) { console.error('disconnect error:', e.message); }
    });
});

const PORT = process.env.PORT || 3000;
initDatabase().then(() => {
    server.listen(PORT, () => {
        console.log(`Сервер запущен на порту ${PORT}`);
    });
}).catch(e => {
    console.error('Ошибка инициализации БД:', e);
    server.listen(PORT, () => {
        console.log(`Сервер запущен на порту ${PORT} (без подключения к MongoDB)`);
    });
});
