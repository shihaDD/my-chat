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

const verificationCodes = {};

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
        "userContacts": {},
        "messagesStore": {},
        "favorites": {}
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

// Эндпоинт для подтяжки свежих новостей с Google News RSS
app.get('/api/news', async (req, res) => {
    try {
        const rssRes = await fetch('https://news.google.com/rss?hl=ru&gl=RU&ceid=RU:ru');
        const rssText = await rssRes.text();
        
        // Простой парсинг элементов <item> из RSS
        const items = [];
        const itemMatches = rssText.match(/<item>([\s\S]*?)<\/item>/g) || [];
        
        for (let i = 0; i < Math.min(items.length + 15, itemMatches.length); i++) {
            const item = itemMatches[i];
            const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/);
            const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/);
            const dateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);

            if (titleMatch) {
                // Очищаем от CDATA и HTML сущностей
                let title = titleMatch[1].replace('<![CDATA[', '').replace(']]>', '').trim();
                let link = linkMatch ? linkMatch[1].replace('<![CDATA[', '').replace(']]>', '').trim() : '#';
                let date = dateMatch ? new Date(dateMatch[1]).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
                items.push({ title, link, date });
            }
        }
        res.json({ success: true, news: items });
    } catch (e) {
        console.error('Ошибка загрузки новостей:', e);
        res.json({ success: false, news: [] });
    }
});

app.post('/api/send-code', (req, res) => {
    const { name, phone } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'Заполните имя и телефон' });

    const code = Math.floor(1000 + Math.random() * 9000).toString();
    verificationCodes[phone] = { code, name };

    console.log(`[SMS] Код для ${name} (${phone}): ${code}`);
    res.json({ success: true, debugCode: code });
});

app.post('/api/verify-code', async (req, res) => {
    const { phone, code } = req.body;
    const record = verificationCodes[phone];

    if (!record || record.code !== code) {
        return res.status(400).json({ error: 'Неверный код' });
    }

    const username = record.name;
    let db = await loadDatabase();

    if (!db.users.includes(username)) {
        db.users.push(username);
        db.userContacts[username] = [];
        db.messagesStore[username] = {};
        db.favorites[username] = [];
        await saveDatabase(db);
    }

    delete verificationCodes[phone];
    res.json({ success: true, username, db });
});

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
    db.messagesStore[receiver][sender].push(messageObj);

    await saveDatabase(db);
    res.json({ success: true, db });
});

// Добавить/удалить из избранного
app.post('/api/toggle-favorite', async (req, res) => {
    const { username, target } = req.body;
    let db = await loadDatabase();
    if (!db.favorites[username]) db.favorites[username] = [];

    const index = db.favorites[username].indexOf(target);
    if (index > -1) {
        db.favorites[username].splice(index, 1);
    } else {
        db.favorites[username].push(target);
    }

    await saveDatabase(db);
    res.json({ success: true, db });
});

app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
