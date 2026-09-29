const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e8
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// База данных в памяти
let db = {
    users: [],
    messagesStore: {},
    friendRequests: {},
    friends: {},
    news: [],
    customNicknames: {},
    groups: {}
};

const userSockets = {};
const groupCalls = {};

// API Маршруты
app.post('/api/register', (req, res) => {
    const { login, password, avatar } = req.body;
    if (!login || !password) return res.json({ success: false, error: 'Заполните все поля' });
    if (db.users.find(u => u.login === login)) return res.json({ success: false, error: 'Пользователь уже существует' });

    const newUser = { login, password, avatar: avatar || 'https://via.placeholder.com/150', bio: '', email: '' };
    db.users.push(newUser);
    db.messagesStore[login] = {};
    db.friends[login] = [];
    db.friendRequests[login] = [];
    db.customNicknames[login] = {};

    return res.json({ success: true });
});

app.post('/api/login', (req, res) => {
    const { login, password } = req.body;
    const user = db.users.find(u => u.login === login && u.password === password);
    if (!user) return res.json({ success: false, error: 'Неверный логин или пароль' });
    return res.json({ success: true, user, db });
});

app.post('/api/update-profile', (req, res) => {
    const { login, avatar, bio, email, password } = req.body;
    const user = db.users.find(u => u.login === login);
    if (!user) return res.json({ success: false, error: 'Пользователь не найден' });
    if (avatar) user.avatar = avatar;
    if (bio !== undefined) user.bio = bio;
    if (email !== undefined) user.email = email;
    if (password) user.password = password;
    return res.json({ success: true, user, db });
});

app.post('/api/add-friend', (req, res) => {
    const { login, targetLogin } = req.body;
    if (login === targetLogin) return res.json({ success: false, error: 'Нельзя добавить самого себя' });
    if (!db.users.find(u => u.login === targetLogin)) return res.json({ success: false, error: 'Пользователь не найден' });

    if (!db.friendRequests[targetLogin]) db.friendRequests[targetLogin] = [];
    if (!db.friends[login]) db.friends[login] = [];

    if (db.friends[login].includes(targetLogin)) return res.json({ success: false, error: 'Уже в друзьях' });
    if (db.friendRequests[targetLogin].includes(login)) return res.json({ success: false, error: 'Заявка уже отправлена' });

    db.friendRequests[targetLogin].push(login);
    return res.json({ success: true, db });
});

app.post('/api/respond-friend-request', (req, res) => {
    const { login, requesterLogin, accept } = req.body;
    if (db.friendRequests[login]) {
        db.friendRequests[login] = db.friendRequests[login].filter(r => r !== requesterLogin);
    }
    if (accept) {
        if (!db.friends[login]) db.friends[login] = [];
        if (!db.friends[requesterLogin]) db.friends[requesterLogin] = [];
        if (!db.friends[login].includes(requesterLogin)) db.friends[login].push(requesterLogin);
        if (!db.friends[requesterLogin].includes(login)) db.friends[requesterLogin].push(login);
    }
    return res.json({ success: true, db });
});

app.post('/api/remove-friend', (req, res) => {
    const { login, targetLogin } = req.body;
    if (db.friends[login]) db.friends[login] = db.friends[login].filter(f => f !== targetLogin);
    if (db.friends[targetLogin]) db.friends[targetLogin] = db.friends[targetLogin].filter(f => f !== login);
    return res.json({ success: true, db });
});

app.post('/api/set-nickname', (req, res) => {
    const { owner, target, nickname } = req.body;
    if (!db.customNicknames[owner]) db.customNicknames[owner] = {};
    db.customNicknames[owner][target] = nickname;
    return res.json({ success: true, db });
});

// ПУНКТ 12: Мгновенная доставка личных сообщений обоим собеседникам
app.post('/api/send-message', (req, res) => {
    const { sender, receiver, text, media } = req.body;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msgObj = { sender, text, media, time, edited: false };

    if (!db.messagesStore[sender]) db.messagesStore[sender] = {};
    if (!db.messagesStore[sender][receiver]) db.messagesStore[sender][receiver] = [];
    db.messagesStore[sender][receiver].push(msgObj);

    if (sender !== receiver) {
        if (!db.messagesStore[receiver]) db.messagesStore[receiver] = {};
        if (!db.messagesStore[receiver][sender]) db.messagesStore[receiver][sender] = [];
        db.messagesStore[receiver][sender].push(msgObj);
    }

    // Сокет-уведомление получателю
    const receiverSocket = userSockets[receiver];
    if (receiverSocket) {
        io.to(receiverSocket).emit('new-private-message', { sender, msgObj });
    }

    return res.json({ success: true, db });
});

app.post('/api/edit-message', (req, res) => {
    const { sender, receiver, msgIndex, newText } = req.body;
    if (db.messagesStore[sender]?.[receiver]?.[msgIndex]) {
        db.messagesStore[sender][receiver][msgIndex].text = newText;
        db.messagesStore[sender][receiver][msgIndex].edited = true;
    }
    if (sender !== receiver && db.messagesStore[receiver]?.[sender]?.[msgIndex]) {
        db.messagesStore[receiver][sender][msgIndex].text = newText;
        db.messagesStore[receiver][sender][msgIndex].edited = true;
    }
    return res.json({ success: true, db });
});

app.post('/api/delete-message', (req, res) => {
    const { sender, receiver, msgIndex } = req.body;
    if (db.messagesStore[sender]?.[receiver]) db.messagesStore[sender][receiver].splice(msgIndex, 1);
    if (sender !== receiver && db.messagesStore[receiver]?.[sender]) db.messagesStore[receiver][sender].splice(msgIndex, 1);
    return res.json({ success: true, db });
});

// ПУНКТ 3: Роли в группах (Лидер ⭐, Админ 🛡️, Участник 👤)
app.post('/api/create-group', (req, res) => {
    const { name, creator } = req.body;
    const groupId = 'group_' + Date.now();
    db.groups[groupId] = {
        id: groupId,
        name,
        creator,
        roles: { [creator]: 'Leader' },
        members: [creator],
        messages: [],
        likes: 0
    };
    return res.json({ success: true, db });
});

app.post('/api/join-group', (req, res) => {
    const { groupId, login } = req.body;
    const group = db.groups[groupId];
    if (group) {
        if (!group.members.includes(login)) group.members.push(login);
        if (!group.roles[login]) group.roles[login] = 'Member';
    }
    return res.json({ success: true, db });
});

app.post('/api/set-group-role', (req, res) => {
    const { groupId, requester, target, role } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    if (group.roles[requester] !== 'Leader') {
        return res.json({ success: false, error: 'Только Лидер может назначать роли' });
    }
    if (target === group.creator) {
        return res.json({ success: false, error: 'Нельзя изменить роль Лидера' });
    }
    group.roles[target] = role;
    return res.json({ success: true, db });
});

app.post('/api/kick-group-member', (req, res) => {
    const { groupId, requester, target } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });

    const reqRole = group.roles[requester];
    const targetRole = group.roles[target];

    if (reqRole === 'Member') return res.json({ success: false, error: 'Нет прав' });
    if (reqRole === 'Admin' && (targetRole === 'Leader' || targetRole === 'Admin')) {
        return res.json({ success: false, error: 'Админ не может выгонять Лидера или других Админов' });
    }

    group.members = group.members.filter(m => m !== target);
    delete group.roles[target];
    return res.json({ success: true, db });
});

app.post('/api/send-group-message', (req, res) => {
    const { groupId, sender, text, media } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    group.messages.push({ sender, text, media, time, edited: false });
    return res.json({ success: true, db });
});

app.post('/api/edit-group-message', (req, res) => {
    const { groupId, requester, msgIndex, newText } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    const msg = group.messages[msgIndex];
    if (!msg) return res.json({ success: false, error: 'Сообщение не найдено' });

    const reqRole = group.roles[requester];
    if (msg.sender !== requester && reqRole !== 'Leader' && reqRole !== 'Admin') {
        return res.json({ success: false, error: 'У вас нет прав для редактирования этого сообщения' });
    }

    msg.text = newText;
    msg.edited = true;
    return res.json({ success: true, db });
});

app.post('/api/delete-group-message', (req, res) => {
    const { groupId, requester, msgIndex } = req.body;
    const group = db.groups[groupId];
    if (!group) return res.json({ success: false, error: 'Группа не найдена' });
    const msg = group.messages[msgIndex];
    if (!msg) return res.json({ success: false, error: 'Сообщение не найдено' });

    const reqRole = group.roles[requester];
    if (msg.sender !== requester && reqRole !== 'Leader' && reqRole !== 'Admin') {
        return res.json({ success: false, error: 'У вас нет прав для удаления этого сообщения' });
    }

    group.messages.splice(msgIndex, 1);
    return res.json({ success: true, db });
});

// ПУНКТ 6: Лента, комментарии, лайки и дизлайки
app.post('/api/news', (req, res) => {
    const { author, text, media } = req.body;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    db.news.unshift({
        id: 'post_' + Date.now(),
        author,
        text,
        media,
        time,
        likes: [],
        dislikes: [],
        comments: []
    });
    return res.json({ success: true, db });
});

app.post('/api/post-react', (req, res) => {
    const { postId, user, type } = req.body; // type: 'like' | 'dislike'
    const post = db.news.find(p => p.id === postId);
    if (!post) return res.json({ success: false, error: 'Пост не найден' });

    if (!post.likes) post.likes = [];
    if (!post.dislikes) post.dislikes = [];

    if (type === 'like') {
        if (post.likes.includes(user)) {
            post.likes = post.likes.filter(u => u !== user);
        } else {
            post.likes.push(user);
            post.dislikes = post.dislikes.filter(u => u !== user);
        }
    } else if (type === 'dislike') {
        if (post.dislikes.includes(user)) {
            post.dislikes = post.dislikes.filter(u => u !== user);
        } else {
            post.dislikes.push(user);
            post.likes = post.likes.filter(u => u !== user);
        }
    }

    return res.json({ success: true, db });
});

app.post('/api/add-comment', (req, res) => {
    const { postId, author, text } = req.body;
    const post = db.news.find(p => p.id === postId);
    if (!post) return res.json({ success: false, error: 'Пост не найден' });

    if (!post.comments) post.comments = [];
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    post.comments.push({ author, text, time });

    return res.json({ success: true, db });
});

// Socket.io & Звонки
io.on('connection', (socket) => {
    socket.on('register', (login) => {
        userSockets[login] = socket.id;
        socket.login = login;
    });

    socket.on('typing', ({ from, to, isGroup }) => {
        if (isGroup) {
            socket.broadcast.emit('user-typing', { from, to, isGroup });
        } else {
            const target = userSockets[to];
            if (target) io.to(target).emit('user-typing', { from, to, isGroup });
        }
    });

    socket.on('stop-typing', ({ from, to, isGroup }) => {
        if (isGroup) {
            socket.broadcast.emit('user-stop-typing', { from });
        } else {
            const target = userSockets[to];
            if (target) io.to(target).emit('user-stop-typing', { from });
        }
    });

    // ПУНКТ 9: Звонки с всплывающим окном вызова
    socket.on('call-user', ({ to, offer, from }) => {
        const target = userSockets[to];
        if (target) io.to(target).emit('incoming-call', { from, offer });
    });

    socket.on('call-accepted', ({ to, answer }) => {
        const target = userSockets[to];
        if (target) io.to(target).emit('call-answered', { answer });
    });

    socket.on('ice-candidate', ({ to, candidate }) => {
        const target = userSockets[to];
        if (target) io.to(target).emit('ice-candidate', { candidate });
    });

    socket.on('hang-up', ({ to }) => {
        const target = userSockets[to];
        if (target) io.to(target).emit('hang-up');
    });

    socket.on('disconnect', () => {
        if (socket.login && userSockets[socket.login] === socket.id) {
            delete userSockets[socket.login];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер «Точка сбора» запущен на порту ${PORT}`);
});
