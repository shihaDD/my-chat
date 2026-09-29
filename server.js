const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
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
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'User-Agent': 'NodeJS-Server'
            }
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

    return {
        "users": [],
        "userIds": {},       // username -> uniqueId
        "idToUser": {},       // uniqueId -> username
        "friends": {},
        "messagesStore": {},
        "lastSeen": {}
    };
}

async function saveDatabase(dbData) {
    const jsonString = JSON.stringify(dbData, null, 2);
    fs.writeFileSync(FILE_PATH, jsonString, 'utf8');

    try {
        const getRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'User-Agent': 'NodeJS-Server'
            }
        });
        
        let fileSha = '';
        if (getRes.ok) {
            const fileData = await getRes.json();
            fileSha = fileData.sha;
        }

        const contentEncoded = Buffer.from(jsonString, 'utf8').toString('base64');

        await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'User-Agent': 'NodeJS-Server',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: 'Update via V Odno Eblo',
                content: contentEncoded,
                sha: fileSha
            })
        });
    } catch (e) {
        console.error('Не удалось отправить данные на GitHub:', e);
    }
}

app.get('/api/data', async (req, res) => {
    const db = await loadDatabase();
    res.json(db);
});

// Новости Google RSS
app.get('/api/news', async (req, res) => {
    try {
        const rssRes = await fetch('https://news.google.com/rss?hl=ru&gl=RU&ceid=RU:ru');
        const rssText = await rssRes.text();
        
        const items = [];
        const itemMatches = rssText.match(/<item>([\s\S]*?)<\/item>/g) || [];
        
        for (let i = 0; i < Math.min(15, itemMatches.length); i++) {
            const item = itemMatches[i];
            const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/);
            const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/);
            const dateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);

            if (titleMatch) {
                let title = titleMatch[1].replace('<![CDATA[', '').replace(']]>', '').trim();
                let link = linkMatch ? linkMatch[1].replace('<![CDATA[', '').replace(']]>', '').trim() : '#';
                let date = dateMatch ? new Date(dateMatch[1]).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
                items.push({ title, link, date });
            }
        }
        res.json({ success: true, news: items });
    } catch (e) {
        res.json({ success: false, news: [] });
    }
});

// Авторизация по никнейму с генерацией ID
app.post('/api/login', async (req, res) => {
    const { username } = req.body;
    if (!username || !username.trim()) {
        return res.status(400).json({ success: false, error: 'Введите никнейм' });
    }

    let db = await loadDatabase();
    if (!db.users) db.users = [];
    if (!db.userIds) db.userIds = {};
    if (!db.idToUser) db.idToUser = {};
    if (!db.friends) db.friends = {};
    if (!db.messagesStore) db.messagesStore = {};
    if (!db.lastSeen) db.lastSeen = {};

    let userTag = db.userIds[username];
    let isNew = false;

    if (!userTag) {
        isNew = true;
        // Генерируем уникальный 6-значный ID
        do {
            userTag = Math.floor(100000 + Math.random() * 900000).toString();
        } while (db.idToUser[userTag]);

        db.userIds[username] = userTag;
        db.idToUser[userTag] = username;
        db.users.push(username);
        db.friends[username] = [];
        db.messagesStore[username] = {};
    }

    db.lastSeen[username] = Date.now();
    await saveDatabase(db);

    res.json({ success: true, username, userId: userTag, isNew, db });
});

// Пинг статуса
app.post('/api/ping', async (req, res) => {
    const { username } = req.body;
    if (!username) return res.sendStatus(400);
    let db = await loadDatabase();
    if (!db.lastSeen) db.lastSeen = {};
    db.lastSeen[username] = Date.now();
    await saveDatabase(db);
    res.json({ success: true });
});

// Добавление в друзья по ID
app.post('/api/add-friend-by-id', async (req, res) => {
    const { username, targetId } = req.body;
    let db = await loadDatabase();

    const targetUser = db.idToUser?.[targetId];
    if (!targetUser || targetUser === username) {
        return res.status(400).json({ success: false, error: 'Пользователь с таким ID не найден' });
    }

    if (!db.friends[username]) db.friends[username] = [];
    if (!db.friends[username].includes(targetUser)) {
        db.friends[username].push(targetUser);
        await saveDatabase(db);
    }

    res.json({ success: true, db, friendName: targetUser });
});

// Отправка сообщения
app.post('/api/send-message', async (req, res) => {
    const { sender, receiver, text } = req.body;
    if (!sender || !receiver || !text) return res.status(400).json({ error: 'Ошибка' });

    let db = await loadDatabase();
    
    if (!db.messagesStore[sender]) db.messagesStore[sender] = {};
    if (!db.messagesStore[sender][receiver]) db.messagesStore[sender][receiver] = [];
    if (!db.messagesStore[receiver]) db.messagesStore[receiver] = {};
    if (!db.messagesStore[receiver][sender]) db.messagesStore[receiver][sender] = [];

    const messageObj = { sender, text, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
    
    db.messagesStore[sender][receiver].push(messageObj);
    if (sender !== receiver) {
        db.messagesStore[receiver][sender].push(messageObj);
    }

    await saveDatabase(db);
    res.json({ success: true, db });
});

app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
