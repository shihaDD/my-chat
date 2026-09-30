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
    const matRegex = /(ху[йяёеию]|пизд|бля[дт]|ебат|ебал|ебну|сук[аиу]|мраз[ью]|уёб|выёб|заёб|поёб|наёб|отёб|гандон|гондон|мудак|пидор|педик|пидар|чмо|шлюх|бляд|сук[аи]|мандавош|манда|епт|епрст)/i;
    return matRegex.test(text);
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
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/create-subgroup', async (req, res) => {
    const { groupId, name, type, allowedRole, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    const isLeader = group.creator === login;
    const myRole = group.roles?.[login] || (isLeader ? 'Лидер' : 'Участник');
    if (!isLeader && myRole !== 'Админ' && !hasFullAccess(login)) {
        return res.json({ success: false, error: 'Недостаточно прав для создания канала!' });
    }

    if (!group.subgroups) group.subgroups = [];
    const subId = 'sub_' + Date.now();
    group.subgroups.push({ 
        id: subId, 
        name: name.trim(), 
        type: type || 'text', 
        allowedRole: allowedRole || 'all', 
        messages: [] 
    });
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

// Создание глобальных каналов Warren / Main Moderator из раздела Общение
app.post('/api/create-global-channel', async (req, res) => {
    const { login, name, type, groupId } = req.body;
    if (!hasFullAccess(login)) return res.json({ success: false, error: 'Недостаточно прав!' });

    if (groupId) {
        const group = db.groups[groupId];
        if (!group) return res.json({ success: false, error: 'Группа не найдена' });
        if (!group.subgroups) group.subgroups = [];
        const subId = 'sub_' + Date.now();
        group.subgroups.push({ id: subId, name: name.trim(), type: type || 'text', allowedRole: 'all', messages: [] });
    } else {
        // Создаем глобальную группу общения Warren/Mod если нужно или добавляем в виртуальное пространство
        let defGroupKey = Object.keys(db.groups)[0];
        if (!defGroupKey) {
            // Создаем системную общую группу
            defGroupKey = 'group_system_' + Date.now();
            db.groups[defGroupKey] = {
                id: defGroupKey,
                name: 'Общий чат Warren',
                creator: 'warren',
                avatar: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=150',
                members: [login],
                roles: { [login]: 'Лидер' },
                customRoles: {},
                isClosed: false,
                subgroups: [],
                posts: [],
                messages: [],
                isVerified: true
            };
        }
        const group = db.groups[defGroupKey];
        if (!group.subgroups) group.subgroups = [];
        group.subgroups.push({ id: 'sub_' + Date.now(), name: name.trim(), type: type || 'text', allowedRole: 'all', messages: [] });
    }

    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/delete-subgroup', async (req, res) => {
    const { groupId, subId, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    if (group.creator !== login && group.roles?.[login] !== 'Админ' && !hasFullAccess(login)) {
        return res.json({ success: false, error: 'Недостаточно прав!' });
    }
    group.subgroups = (group.subgroups || []).filter(s => s.id !== subId);
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/publish-group-post', async (req, res) => {
    const { groupId, login, text, media, announcement } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    const isLeader = group.creator === login;
    const userRole = isLeader ? 'Лидер' : (group.roles?.[login] || 'Участник');
    const rolePerms = group.customRoles?.[userRole] || { canPost: userRole !== 'Участник', canDelete: false, canVoice: true, canDuplicateNews: false };

    if (!rolePerms.canPost && !isLeader && !hasFullAccess(login)) {
        return res.json({ success: false, error: 'У вашей роли нет прав на публикацию постов в этой группе!' });
    }

    if (announcement) {
        if (!group.isVerified) {
            return res.json({ success: false, error: 'Необходимо пройти верификацию сообщества, чтобы дублировать посты в ленту новостей!' });
        }
        if (!rolePerms.canDuplicateNews && !isLeader && !hasFullAccess(login)) {
            return res.json({ success: false, error: 'У вашей роли нет прав на дублирование постов в ленту новостей!' });
        }
    }

    if (!db.violations) db.violations = [];
    if (containsMat(text)) {
        db.violations.push({
            id: 'viol_' + Date.now(),
            author: login,
            source: 'group_post',
            groupId,
            groupName: group.name,
            text: text || '',
            media: media || null,
            timestamp: Date.now()
        });
    }

    if (!group.posts) group.posts = [];
    const postId = 'gpost_' + Date.now();
    const postObj = { id: postId, author: login, text: text || '', media: media || null, timestamp: Date.now(), likes: 0 };
    group.posts.unshift(postObj);

    if (announcement && group.isVerified) {
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

    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/delete-group-post', async (req, res) => {
    const { groupId, login, postId } = req.body;
    const group = db.groups[groupId];
    if (!group || !group.posts) return res.json({ success: false, error: 'Пост не найден' });

    const post = group.posts.find(p => p.id === postId);
    if (!post) return res.json({ success: false, error: 'Пост не найден' });

    const isLeader = group.creator === login;
    const userRole = group.roles?.[login];
    const canDelByRole = group.customRoles?.[userRole]?.canDelete;
    if (post.author !== login && !isLeader && !canDelByRole && !hasFullAccess(login)) {
        return res.json({ success: false, error: 'Недостаточно прав для удаления поста!' });
    }

    group.posts = group.posts.filter(p => p.id !== postId);
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/send-message', async (req, res) => {
    const { sender, receiver, text, media, messageId, chatType, chatId, subgroup } = req.body;
    
    // Проверка мута
    if (db.mutedUsers && db.mutedUsers[sender] && db.mutedUsers[sender] > Date.now()) {
        const leftMinutes = Math.ceil((db.mutedUsers[sender] - Date.now()) / 60000);
        return res.json({ success: false, error: `Вы находитесь в муте. Осталось минут: ${leftMinutes}` });
    }

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const timestamp = req.body.timestamp || Date.now();
    const msgObj = { id: messageId || 'msg_' + Date.now() + '_' + Math.random(), sender, text: text || '', media: media || null, time, timestamp, edited: false, read: false };

    if (chatType === 'group' && chatId) {
        const group = db.groups[chatId];
        if (group) {
            const isLeader = group.creator === sender;
            const userRole = isLeader ? 'Лидер' : (group.roles?.[sender] || 'Участник');
            const rolePerms = group.customRoles?.[userRole] || { canPost: userRole !== 'Участник', canDelete: false, canVoice: true };
            if (!rolePerms.canPost && !isLeader && !hasFullAccess(sender)) {
                return res.json({ success: false, error: 'У вашей роли нет прав на отправку сообщений в этом канале!' });
            }

            if (subgroup && subgroup !== 'main') {
                const sub = (group.subgroups || []).find(s => s.id === subgroup);
                if (sub && sub.allowedRole && sub.allowedRole !== 'all') {
                    if (userRole !== sub.allowedRole && !isLeader && !hasFullAccess(sender)) {
                        return res.json({ success: false, error: 'У вашей роли нет доступа к этому каналу!' });
                    }
                }
            }
        }
        const key = `group_${chatId}_${subgroup || 'main'}`;
        if (!db.messagesStore[key]) db.messagesStore[key] = [];
        db.messagesStore[key].push(msgObj);
        await saveDb();
        io.to(chatId).emit('receive-group-message', { groupId: chatId, msg: msgObj, subgroup: subgroup || 'main' });
        io.emit('update-db', db);
        return res.json({ success: true, db, msg: msgObj });
    }

    const peer = receiver || chatId;
    if (!peer) return res.json({ success: false, error: 'Получатель не указан' });

    const chatKey = [sender, peer].sort().join('_');
    if (!db.messagesStore[chatKey]) db.messagesStore[chatKey] = [];
    db.messagesStore[chatKey].push(msgObj);

    await saveDb();
    io.to(peer).emit('receive-message', { sender, receiver: peer, msg: msgObj });
    io.to(sender).emit('receive-message', { sender, receiver: peer, msg: msgObj });
    res.json({ success: true, db, msg: msgObj });
});

app.post('/api/edit-message', async (req, res) => {
    const { login, messageId, newText } = req.body;
    let found = false;
    for (let key in db.messagesStore) {
        db.messagesStore[key].forEach(m => {
            if (m.id === messageId && (m.sender === login || hasFullAccess(login))) {
                m.text = newText;
                m.edited = true;
                found = true;
            }
        });
    }
    if (found) {
        await saveDb();
        io.emit('update-db', db);
        res.json({ success: true, db });
    } else {
        res.json({ success: false, error: 'Сообщение не найдено или нет прав' });
    }
});

app.post('/api/delete-message', async (req, res) => {
    const { login, messageId } = req.body;
    let found = false;
    for (let key in db.messagesStore) {
        const beforeLen = db.messagesStore[key].length;
        db.messagesStore[key] = db.messagesStore[key].filter(m => !(m.id === messageId && (m.sender === login || hasFullAccess(login))));
        if (db.messagesStore[key].length < beforeLen) found = true;
    }
    if (found) {
        await saveDb();
        io.emit('update-db', db);
        res.json({ success: true, db });
    } else {
        res.json({ success: false, error: 'Не удалось удалить сообщение' });
    }
});

app.post('/api/pin-message', async (req, res) => {
    const { messageId, chatKey } = req.body;
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

app.post(['/api/news', '/api/publish-news'], async (req, res) => {
    const { login, author, text, media } = req.body;
    const postAuthor = author || login;
    if (!postAuthor) return res.json({ success: false, error: 'Автор не указан' });

    if (!hasFullAccess(postAuthor)) {
        return res.json({ success: false, error: 'Публиковать новости могут только модераторы и Warren!' });
    }

    if (!db.violations) db.violations = [];
    if (containsMat(text)) {
        db.violations.push({
            id: 'viol_' + Date.now(),
            author: postAuthor,
            source: 'news',
            text: text || '',
            media: media || null,
            timestamp: Date.now()
        });
    }

    const time = new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const postId = 'post_' + Date.now();
    db.news.unshift({ id: postId, author: postAuthor, text: text || '', media: media || null, time, timestamp: Date.now(), likes: 0, dislikes: 0, comments: [] });
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

app.post('/api/edit-news', async (req, res) => {
    const { login, postId, newText } = req.body;
    const post = db.news.find(p => p.id === postId);
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
    const post = db.news.find(p => p.id === postId);
    if (!post) return res.json({ success: false, error: 'Новость не найдена' });
    if (post.author !== login && !hasFullAccess(login)) {
        return res.json({ success: false, error: 'Недостаточно прав' });
    }
    db.news = db.news.filter(p => p.id !== postId);
    await saveDb();
    io.emit('update-db', db);
    res.json({ success: true, db });
});

// Отдельные действия с нарушениями (Одобрить, Редактировать, Удалить, Mute)
app.post('/api/resolve-violation-action', async (req, res) => {
    const { login, violId, action, newText, muteMinutes } = req.body;
    if (!hasFullAccess(login)) return res.json({ success: false, error: 'Недостаточно прав' });
    if (!db.violations) db.violations = [];

    const viol = db.violations.find(v => v.id === violId);
    if (!viol) return res.json({ success: false, error: 'Нарушение не найдено' });

    if (action === 'approve') {
        // Одобрить -> улетает в новости
        if (!db.news) db.news = [];
        db.news.unshift({
            id: 'news_' + Date.now(),
            author: viol.author,
            text: viol.text || '',
            media: viol.media || null,
            timestamp: Date.now(),
            likes: 0,
            dislikes: 0,
            comments: []
        });
        db.violations = db.violations.filter(v => v.id !== violId);
    } else if (action === 'edit') {
        // Редактировать -> с внесенными изменениями улетает в новости
        if (!db.news) db.news = [];
        db.news.unshift({
            id: 'news_' + Date.now(),
            author: viol.author,
            text: newText || viol.text || '',
            media: viol.media || null,
            timestamp: Date.now(),
            likes: 0,
            dislikes: 0,
            comments: []
        });
        db.violations = db.violations.filter(v => v.id !== violId);
    } else if (action === 'delete') {
        // Удалить -> удаляется из всех вкладок (нарушений)
        db.violations = db.violations.filter(v => v.id !== violId);
    } else if (action === 'mute') {
        // Mute -> запрет сообщений от 10 мин до 7 суток (в минутах)
        const mins = parseInt(muteMinutes) || 60;
        if (!db.mutedUsers) db.mutedUsers = {};
        db.mutedUsers[viol.author] = Date.now() + (mins * 60 * 1000);
        db.violations = db.violations.filter(v => v.id !== violId);
    }

    await saveDb();
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
        if (targets && targets.length > 0) {
            targets.forEach(targetLogin => {
                io.to(targetLogin).emit('incoming-call', { from, offer: null, isGroup: true, groupId, channelId });
            });
        }
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
initDatabase().then(() => {
    server.listen(PORT, () => {
        console.log(`Сервер запущен на http://localhost:${PORT}`);
    });
});
