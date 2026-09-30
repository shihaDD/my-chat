const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

// База данных в памяти
let db = {
    users: {},          // login -> { login, name, password, avatar, bio, email }
    messagesStore: {},  // chatKey -> [messages]
    friendRequests: {}, // login -> [requesterLogins]
    outgoingRequests: {},// login -> [targetLogins]
    friends: {},        // login -> [friendLogins]
    news: [],           // [{ id, author, text, media, timestamp }]
    customNicknames: {},// ownerLogin -> { targetLogin: nickname }
    groups: {},         // groupId -> { id, name, avatar, creator, members, isClosed, joinRequests, posts, subgroups, customRoles, roles, groupNicknames, groupMutedUsers }
    lastSeen: {},       // login -> timestamp
    pinnedMessages: {}, // chatKey -> messageId
    globalRoles: {},    // login -> role ('moderator', 'main_moderator', 'user')
    violations: [],     // [{ id, source, author, text, timestamp, groupName, groupId }]
    verificationRequests: [], // [{ id, groupId, groupName, requester, timestamp }]
    mutedUsers: {}      // login -> { expires: timestamp, reason: string }
};

// Вспомогательная функция очистки мутов и проверки
function checkActiveMute(login) {
    if (!login) return false;
    const l = login.toLowerCase();
    const now = Date.now();
    
    // Проверка глобального мута
    if (db.mutedUsers && db.mutedUsers[l]) {
        const muteObj = db.mutedUsers[l];
        const expires = typeof muteObj === 'object' ? muteObj.expires : muteObj;
        if (expires > now) return true;
        else {
            delete db.mutedUsers[l]; // Мут истек
        }
    }
    return false;
}

// REST API Маршруты

app.post('/api/register', (req, res) => {
    const { login, name, password, avatar } = req.body;
    if (!login || !password || !name) {
        return res.json({ success: false, error: 'Заполните все обязательные поля!' });
    }
    const l = login.toLowerCase();
    if (db.users[l]) {
        return res.json({ success: false, error: 'Пользователь с таким логином уже существует!' });
    }

    db.users[l] = { login: l, name, password, avatar };
    db.friends[l] = [];
    db.friendRequests[l] = [];
    db.outgoingRequests[l] = [];
    db.customNicknames[l] = {};

    res.json({ success: true });
});

app.post('/api/login', (req, res) => {
    const { login, password } = req.body;
    if (!login || !password) {
        return res.json({ success: false, error: 'Укажите логин и пароль!' });
    }
    const l = login.toLowerCase();
    const user = db.users[l];
    if (!user || user.password !== password) {
        return res.json({ success: false, error: 'Неверный логин или пароль!' });
    }

    db.lastSeen[l] = Date.now();
    res.json({ success: true, user, db });
});

app.post('/api/restore-session', (req, res) => {
    const { login } = req.body;
    if (!login) return res.json({ success: false });
    const l = login.toLowerCase();
    const user = db.users[l];
    if (!user) return res.json({ success: false });

    db.lastSeen[l] = Date.now();
    res.json({ success: true, user, db });
});

app.post('/api/update-profile', (req, res) => {
    const { login, name, bio, email, password, avatar } = req.body;
    const l = login.toLowerCase();
    if (!db.users[l]) return res.json({ success: false, error: 'Пользователь не найден' });

    db.users[l].name = name || db.users[l].name;
    db.users[l].bio = bio !== undefined ? bio : db.users[l].bio;
    db.users[l].email = email !== undefined ? email : db.users[l].email;
    if (password) db.users[l].password = password;
    if (avatar) db.users[l].avatar = avatar;

    res.json({ success: true, user: db.users[l], db });
});

// Управление друзьями
app.post('/api/add-friend', (req, res) => {
    const { login, targetLogin } = req.body;
    const l = login.toLowerCase();
    const target = targetLogin.toLowerCase();

    if (!db.users[target]) return res.json({ success: false, error: 'Пользователь не найден!' });
    if (l === target) return res.json({ success: false, error: 'Нельзя добавить самого себя!' });

    if (!db.friendRequests[target]) db.friendRequests[target] = [];
    if (!db.outgoingRequests[l]) db.outgoingRequests[l] = [];

    if (db.friendRequests[target].includes(l)) {
        return res.json({ success: false, error: 'Заявка уже отправлена!' });
    }

    db.friendRequests[target].push(l);
    db.outgoingRequests[l].push(target);
    res.json({ success: true, db });
});

app.post('/api/cancel-friend-request', (req, res) => {
    const { login, targetLogin } = req.body;
    const l = login.toLowerCase();
    const target = targetLogin.toLowerCase();

    if (db.friendRequests[target]) {
        db.friendRequests[target] = db.friendRequests[target].filter(item => item !== l);
    }
    if (db.outgoingRequests[l]) {
        db.outgoingRequests[l] = db.outgoingRequests[l].filter(item => item !== target);
    }
    res.json({ success: true, db });
});

app.post('/api/respond-friend-request', (req, res) => {
    const { login, requesterLogin, accept } = req.body;
    const l = login.toLowerCase();
    const reqLogin = requesterLogin.toLowerCase();

    if (db.friendRequests[l]) {
        db.friendRequests[l] = db.friendRequests[l].filter(item => item !== reqLogin);
    }
    if (db.outgoingRequests[reqLogin]) {
        db.outgoingRequests[reqLogin] = db.outgoingRequests[reqLogin].filter(item => item !== l);
    }

    if (accept) {
        if (!db.friends[l]) db.friends[l] = [];
        if (!db.friends[reqLogin]) db.friends[reqLogin] = [];

        if (!db.friends[l].includes(reqLogin)) db.friends[l].push(reqLogin);
        if (!db.friends[reqLogin].includes(l)) db.friends[reqLogin].push(l);
    }

    res.json({ success: true, db });
});

app.post('/api/remove-friend', (req, res) => {
    const { login, targetLogin } = req.body;
    const l = login.toLowerCase();
    const target = targetLogin.toLowerCase();

    if (db.friends[l]) db.friends[l] = db.friends[l].filter(item => item !== target);
    if (db.friends[target]) db.friends[target] = db.friends[target].filter(item => item !== l);

    res.json({ success: true, db });
});

// Отправка сообщений
app.post('/api/send-message', (req, res) => {
    const { sender, text, media, chatType, chatId, subgroup } = req.body;
    const l = sender.toLowerCase();

    if (checkActiveMute(l)) {
        return res.json({ success: false, error: 'У вас активен глобальный мут!' });
    }

    const msg = {
        id: 'msg_' + Date.now() + '_' + Math.random().toString(36.substring(2, 7)),
        sender: l,
        text: text || '',
        media: media || null,
        timestamp: Date.now(),
        subgroup: subgroup || 'main'
    };

    if (chatType === 'group') {
        const group = db.groups[chatId];
        if (!group) return res.json({ success: false, error: 'Группа не найдена' });

        if (group.groupMutedUsers && group.groupMutedUsers[l]) {
            const gm = group.groupMutedUsers[l];
            const exp = typeof gm === 'object' ? gm.expires : gm;
            if (exp > Date.now()) {
                return res.json({ success: false, error: 'Вы замучены в этой группе!' });
            }
        }

        const key = `group_${chatId}_${subgroup || 'main'}`;
        if (!db.messagesStore[key]) db.messagesStore[key] = [];
        db.messagesStore[key].push(msg);

        io.to(`group_${chatId}`).emit('receive-group-message', { groupId: chatId, msg, subgroup: msg.subgroup });
    } else {
        const key = [l, chatId.toLowerCase()].sort().join('_');
        if (!db.messagesStore[key]) db.messagesStore[key] = [];
        db.messagesStore[key].push(msg);

        io.to(chatId.toLowerCase()).emit('receive-message', { sender: l, receiver: chatId.toLowerCase(), msg });
    }

    res.json({ success: true, db, msg });
});

app.post('/api/edit-message', (req, res) => {
    const { login, messageId, newText } = req.body;
    const l = login.toLowerCase();

    for (let key of Object.keys(db.messagesStore)) {
        const msgs = db.messagesStore[key];
        const msg = msgs.find(m => m.id === messageId);
        if (msg) {
            const isWarren = l === 'warren';
            const isMod = db.globalRoles[l] === 'moderator' || db.globalRoles[l] === 'main_moderator';
            if (msg.sender !== l && !isWarren && !isMod) {
                return res.json({ success: false, error: 'Недостаточно прав' });
            }
            msg.text = newText;
            break;
        }
    }
    res.json({ success: true, db });
});

app.post('/api/delete-message', (req, res) => {
    const { login, messageId } = req.body;
    const l = login.toLowerCase();

    for (let key of Object.keys(db.messagesStore)) {
        const msgs = db.messagesStore[key];
        const idx = msgs.findIndex(m => m.id === messageId);
        if (idx !== -1) {
            const msg = msgs[idx];
            const isWarren = l === 'warren';
            const isMod = db.globalRoles[l] === 'moderator' || db.globalRoles[l] === 'main_moderator';
            if (msg.sender !== l && !isWarren && !isMod) {
                return res.json({ success: false, error: 'Недостаточно прав' });
            }
            msgs.splice(idx, 1);
            break;
        }
    }
    res.json({ success: true, db });
});

app.post('/api/pin-message', (req, res) => {
    const { login, messageId, chatKey } = req.body;
    if (!db.pinnedMessages) db.pinnedMessages = {};
    db.pinnedMessages[chatKey] = messageId;
    res.json({ success: true, db });
});

app.post('/api/unpin-message', (req, res) => {
    const { login, chatKey } = req.body;
    if (db.pinnedMessages) {
        delete db.pinnedMessages[chatKey];
    }
    res.json({ success: true, db });
});

// Сообщества и Группы
app.post('/api/create-group', (req, res) => {
    const { name, isClosed, creator } = req.body;
    const l = creator.toLowerCase();
    if (!name) return res.json({ success: false, error: 'Введите название группы' });

    const groupId = 'group_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    db.groups[groupId] = {
        id: groupId,
        name,
        avatar: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150',
        creator: l,
        members: [l],
        isClosed: !!isClosed,
        joinRequests: [],
        posts: [],
        subgroups: [],
        customRoles: {
            'Админ': { canPost: true, canDelete: true, canVoice: true, canDuplicateNews: true, canVoiceControl: true }
        },
        roles: { [l]: 'Лидер' },
        groupNicknames: {},
        groupMutedUsers: {}
    };

    res.json({ success: true, db, groupId });
});

app.post('/api/join-group', (req, res) => {
    const { groupId, login } = req.body;
    const l = login.toLowerCase();
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    if (group.isClosed) {
        return res.json({ success: false, error: 'Группа закрытая. Требуется запрос на вступление.' });
    }

    if (!group.members.includes(l)) {
        group.members.push(l);
        group.roles[l] = 'Участник';
    }
    res.json({ success: true, db });
});

app.post('/api/request-join-group', (req, res) => {
    const { groupId, login } = req.body;
    const l = login.toLowerCase();
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    if (!group.joinRequests) group.joinRequests = [];
    if (!group.joinRequests.includes(l) && !group.members.includes(l)) {
        group.joinRequests.push(l);
    }
    res.json({ success: true, db });
});

app.post('/api/respond-join-request', (req, res) => {
    const { groupId, login, targetLogin, accept } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    group.joinRequests = (group.joinRequests || []).filter(item => item !== targetLogin);
    if (accept) {
        if (!group.members.includes(targetLogin)) {
            group.members.push(targetLogin);
            group.roles[targetLogin] = 'Участник';
        }
    }
    res.json({ success: true, db });
});

app.post('/api/leave-group', (req, res) => {
    const { groupId, login } = req.body;
    const l = login.toLowerCase();
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    if (group.creator === l) {
        return res.json({ success: false, error: 'Создатель не может покинуть группу. Удалите её или передайте права.' });
    }

    group.members = group.members.filter(m => m !== l);
    delete group.roles[l];
    res.json({ success: true, db });
});

app.post('/api/delete-group', (req, res) => {
    const { groupId, login } = req.body;
    const l = login.toLowerCase();
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    const isWarren = l === 'warren';
    const isMainMod = db.globalRoles[l] === 'main_moderator';
    if (group.creator !== l && !isWarren && !isMainMod) {
        return res.json({ success: false, error: 'Недостаточно прав для удаления группы' });
    }

    delete db.groups[groupId];
    res.json({ success: true, db });
});

app.post('/api/update-group', (req, res) => {
    const { groupId, name, avatar, isClosed, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    group.name = name;
    group.avatar = avatar;
    group.isClosed = !!isClosed;
    res.json({ success: true, db });
});

app.post('/api/group-set-nickname', (req, res) => {
    const { groupId, login, targetLogin, nickname } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    if (!group.groupNicknames) group.groupNicknames = {};
    if (nickname.trim() === '') {
        delete group.groupNicknames[targetLogin];
    } else {
        group.groupNicknames[targetLogin] = nickname;
    }
    res.json({ success: true, db });
});

// ИСПРАВЛЕНИЕ МУТА В ГРУППЕ (ПЕРЕДАЧА В МИЛЛИСЕКУНДАХ)
app.post('/api/group-mute-member', (req, res) => {
    const { groupId, login, targetLogin, muteMinutes, reason } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    if (!group.groupMutedUsers) group.groupMutedUsers = {};
    
    if (muteMinutes <= 0) {
        delete group.groupMutedUsers[targetLogin];
    } else {
        // Обязательно умножаем на 60 * 1000 для корректного перевода в миллисекунды
        const expiresTime = Date.now() + (parseInt(muteMinutes) * 60 * 1000);
        group.groupMutedUsers[targetLogin] = {
            expires: expiresTime,
            reason: reason || 'Нарушение правил в группе'
        };
    }
    res.json({ success: true, db });
});

app.post('/api/kick-group-member', (req, res) => {
    const { groupId, login, targetLogin } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    group.members = group.members.filter(m => m !== targetLogin);
    delete group.roles[targetLogin];
    res.json({ success: true, db });
});

app.post('/api/set-group-role', (req, res) => {
    const { groupId, login, targetLogin, newRole } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    if (!group.roles) group.roles = {};
    group.roles[targetLogin] = newRole;
    res.json({ success: true, db });
});

app.post('/api/create-custom-role', (req, res) => {
    const { groupId, login, roleName, permissions } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    if (!group.customRoles) group.customRoles = {};
    group.customRoles[roleName] = permissions;
    res.json({ success: true, db });
});

app.post('/api/delete-custom-role', (req, res) => {
    const { groupId, login, roleName } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    if (group.customRoles) delete group.customRoles[roleName];
    res.json({ success: true, db });
});

app.post('/api/update-role-permissions', (req, res) => {
    const { groupId, login, roleName, permissions } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    if (!group.customRoles) group.customRoles = {};
    group.customRoles[roleName] = permissions;
    res.json({ success: true, db });
});

app.post('/api/create-subgroup', (req, res) => {
    const { groupId, name, type, allowedRole, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    if (!group.subgroups) group.subgroups = [];
    const subId = 'sub_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    group.subgroups.push({ id: subId, name, type: type || 'text', allowedRole: allowedRole || 'all' });

    res.json({ success: true, db });
});

app.post('/api/delete-subgroup', (req, res) => {
    const { groupId, subId, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    if (group.subgroups) {
        group.subgroups = group.subgroups.filter(s => s.id !== subId);
    }
    res.json({ success: true, db });
});

app.post('/api/publish-group-post', (req, res) => {
    const { groupId, login, text, duplicateToNews } = req.body;
    const l = login.toLowerCase();
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    const post = {
        id: 'gpost_' + Date.now(),
        author: l,
        text,
        timestamp: Date.now()
    };

    if (!group.posts) group.posts = [];
    group.posts.push(post);

    if (duplicateToNews) {
        if (group.isVerified) {
            db.news.unshift({
                id: 'news_' + Date.now(),
                author: l,
                text: `[Объявление от группы "${group.name}"]: ${text}`,
                media: null,
                timestamp: Date.now()
            });
        } else {
            if (!db.violations) db.violations = [];
            db.violations.push({
                id: 'viol_' + Date.now(),
                source: 'group_post',
                groupId,
                groupName: group.name,
                author: l,
                text,
                timestamp: Date.now()
            });
        }
    }

    res.json({ success: true, db });
});

app.post('/api/delete-group-post', (req, res) => {
    const { groupId, postId, login } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    if (group.posts) {
        group.posts = group.posts.filter(p => p.id !== postId);
    }
    res.json({ success: true, db });
});

// Новости и Верификация
app.post('/api/publish-news', (req, res) => {
    const { login, text, media } = req.body;
    const l = login.toLowerCase();

    const isWarren = l === 'warren';
    const isMod = db.globalRoles[l] === 'moderator' || db.globalRoles[l] === 'main_moderator';

    if (!isWarren && !isMod) {
        return res.json({ success: false, error: 'Только модераторы и Warren могут публиковать новости напрямую.' });
    }

    db.news.unshift({
        id: 'news_' + Date.now(),
        author: l,
        text,
        media,
        timestamp: Date.now()
    });

    res.json({ success: true, db });
});

app.post('/api/delete-news', (req, res) => {
    const { login, postId } = req.body;
    const l = login.toLowerCase();
    const item = (db.news || []).find(n => n.id === postId);

    if (item) {
        const isWarren = l === 'warren';
        const isMod = db.globalRoles[l] === 'moderator' || db.globalRoles[l] === 'main_moderator';
        if (item.author !== l && !isWarren && !isMod) {
            return res.json({ success: false, error: 'Недостаточно прав' });
        }
        db.news = db.news.filter(n => n.id !== postId);
    }
    res.json({ success: true, db });
});

app.post('/api/request-verification', (req, res) => {
    const { groupId, login } = req.body;
    const l = login.toLowerCase();
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    group.verificationPending = true;
    if (!db.verificationRequests) db.verificationRequests = [];
    
    // Удаляем прошлые дубликаты запросов для этой группы
    db.verificationRequests = db.verificationRequests.filter(r => r.groupId !== groupId);
    db.verificationRequests.push({
        id: 'verif_' + Date.now(),
        groupId,
        groupName: group.name,
        requester: l,
        timestamp: Date.now()
    });

    res.json({ success: true, db });
});

app.post('/api/resolve-verification', (req, res) => {
    const { login, requestId, accept } = req.body;
    const l = login.toLowerCase();

    if (!db.verificationRequests) return res.json({ success: false });
    const reqItem = db.verificationRequests.find(r => r.id === requestId);
    if (!reqItem) return res.json({ success: false, error: 'Запрос не найден' });

    db.verificationRequests = db.verificationRequests.filter(r => r.id !== requestId);
    const group = db.groups[reqItem.groupId];
    if (group) {
        group.verificationPending = false;
        if (accept) {
            group.isVerified = true;
        }
    }

    res.json({ success: true, db });
});

// Модерация и глобальные муты
app.post('/api/resolve-violation-action', (req, res) => {
    const { login, violId, action, newText, muteMinutes, reason } = req.body;
    const l = login.toLowerCase();

    const isWarren = l === 'warren';
    const isMod = db.globalRoles[l] === 'moderator' || db.globalRoles[l] === 'main_moderator';
    if (!isWarren && !isMod) return res.json({ success: false, error: 'Недостаточно прав' });

    if (!db.violations) db.violations = [];
    const vIndex = db.violations.findIndex(v => v.id === violId);
    if (vIndex === -1 && action !== 'mute') return res.json({ success: false, error: 'Нарушение не найдено' });

    const viol = db.violations[vIndex];

    if (action === 'approve') {
        db.news.unshift({
            id: 'news_' + Date.now(),
            author: viol.author,
            text: viol.text,
            media: null,
            timestamp: Date.now()
        });
        db.violations.splice(vIndex, 1);
    } else if (action === 'edit') {
        if (viol) viol.text = newText;
    } else if (action === 'delete') {
        db.violations.splice(vIndex, 1);
    } else if (action === 'mute') {
        const targetLogin = viol ? viol.author : req.body.targetLogin;
        if (targetLogin) {
            if (!db.mutedUsers) db.mutedUsers = {};
            const minutes = parseInt(muteMinutes) || 60;
            // УМНОЖЕНИЕ НА 60 * 1000 ДЛЯ МИЛЛИСЕКУНД
            const expiresTime = Date.now() + (minutes * 60 * 1000);
            db.mutedUsers[targetLogin.toLowerCase()] = {
                expires: expiresTime,
                reason: reason || 'Нарушение правил'
            };
            if (viol) db.violations.splice(vIndex, 1);
        }
    }

    res.json({ success: true, db });
});

app.post('/api/remove-global-mute', (req, res) => {
    const { login, targetLogin } = req.body;
    const l = login.toLowerCase();

    if (!db.mutedUsers) db.mutedUsers = {};
    delete db.mutedUsers[targetLogin.toLowerCase()];
    res.json({ success: true, db });
});

app.post('/api/set-global-role', (req, res) => {
    const { login, targetLogin, newRole } = req.body;
    const l = login.toLowerCase();

    if (l !== 'warren' && db.globalRoles[l] !== 'main_moderator') {
        return res.json({ success: false, error: 'Недостаточно прав' });
    }

    if (!db.globalRoles) db.globalRoles = {};
    db.globalRoles[targetLogin.toLowerCase()] = newRole;
    res.json({ success: true, db });
});

// Socket.io Сигналинг для Звонков и Раций
io.on('connection', (socket) => {
    socket.on('register', (login) => {
        if (!login) return;
        const l = login.toLowerCase();
        socket.join(l);
        db.lastSeen[l] = Date.now();
    });

    socket.on('refresh-db', () => {
        io.emit('update-db', db);
    });

    socket.on('typing', ({ targetLogin, sender }) => {
        io.to(targetLogin.toLowerCase()).emit('typing', { sender });
    });

    // P2P Звонки
    socket.on('call-offer', ({ targetLogin, offer, callerLogin }) => {
        io.to(targetLogin.toLowerCase()).emit('call-offer', { callerLogin, offer });
    });

    socket.on('call-answer', ({ targetLogin, answer }) => {
        io.to(targetLogin.toLowerCase()).emit('call-answer', { answer });
    });

    socket.on('call-reject', ({ targetLogin }) => {
        io.to(targetLogin.toLowerCase()).emit('call-reject');
    });

    socket.on('ice-candidate', ({ targetLogin, candidate }) => {
        io.to(targetLogin.toLowerCase()).emit('ice-candidate', { senderLogin: socket.id, candidate });
    });

    socket.on('hang-up', ({ targetLogin }) => {
        if (targetLogin) {
            io.to(targetLogin.toLowerCase()).emit('hang-up');
        }
    });

    // Голосовые конференции в группах
    let currentVoiceRoom = null;
    let currentUserLogin = null;
    let currentGroupId = null;
    let currentSubId = null;

    socket.on('join-group-room', (groupId) => {
        socket.join(`group_${groupId}`);
    });

    socket.on('join-voice-channel', ({ roomKey, login, groupId, subId }) => {
        currentVoiceRoom = roomKey;
        currentUserLogin = login;
        currentGroupId = groupId;
        currentSubId = subId;

        socket.join(roomKey);

        if (!global.voiceRoomsMap) global.voiceRoomsMap = {};
        if (!global.voiceRoomsMap[roomKey]) global.voiceRoomsMap[roomKey] = {};
        global.voiceRoomsMap[roomKey][socket.id] = login;

        const participants = Object.values(global.voiceRoomsMap[roomKey]);
        io.to(roomKey).emit('voice-participants-update', { channelKey: subId, participants });

        socket.to(roomKey).emit('user-joined-voice', { socketId: socket.id, login });
    });

    socket.on('voice-offer', ({ targetSocketId, offer, callerLogin }) => {
        io.to(targetSocketId).emit('voice-offer', { targetSocketId: socket.id, offer, callerLogin });
    });

    socket.on('voice-answer', ({ targetSocketId, answer }) => {
        io.to(targetSocketId).emit('voice-answer', { targetSocketId: socket.id, answer });
    });

    socket.on('voice-candidate', ({ targetSocketId, candidate }) => {
        io.to(targetSocketId).emit('voice-candidate', { targetSocketId: socket.id, candidate });
    });

    socket.on('leave-voice-channel', ({ roomKey, groupId, subId }) => {
        if (global.voiceRoomsMap && global.voiceRoomsMap[roomKey]) {
            delete global.voiceRoomsMap[roomKey][socket.id];
            const participants = Object.values(global.voiceRoomsMap[roomKey]);
            io.to(roomKey).emit('voice-participants-update', { channelKey: subId, participants });
        }
        socket.to(roomKey).emit('user-left-voice', { socketId: socket.id });
        socket.leave(roomKey);
    });

    socket.on('admin-voice-action', ({ groupId, subId, targetLogin, action, adminLogin }) => {
        io.emit('forced-voice-action', { targetLogin, action, subId });
    });

    socket.on('disconnect', () => {
        if (currentVoiceRoom && global.voiceRoomsMap && global.voiceRoomsMap[currentVoiceRoom]) {
            delete global.voiceRoomsMap[currentVoiceRoom][socket.id];
            const participants = Object.values(global.voiceRoomsMap[currentVoiceRoom]);
            io.to(currentVoiceRoom).emit('voice-participants-update', { channelKey: currentSubId, participants });
            socket.to(currentVoiceRoom).emit('user-left-voice', { socketId: socket.id });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
