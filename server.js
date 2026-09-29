const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// Настройки GitHub
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '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';
const REPO_OWNER = 'shihaDD';
const REPO_NAME = 'Chat-Database';
const FILE_PATH = 'database.json';

// Функция загрузки базы данных
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
        "messagesStore": {}
    };
}

// Функция сохранения базы данных с авто-коммитом на GitHub
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
                message: 'Social Network Data Update',
                content: contentEncoded,
                sha: fileSha
            })
        });
    } catch (e) {
        console.error('Не удалось отправить данные на GitHub:', e);
    }
}

// Получить всю базу
app.get('/api/data', async (req, res) => {
    const db = await loadDatabase();
    res.json(db);
});

// Регистрация пользователя
app.post('/api/register', async (req, res) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Имя не указано' });

    let db = await loadDatabase();
    if (!db.users.includes(username)) {
        db.users.push(username);
        db.userContacts[username] = [];
        db.messagesStore[username] = {};
        await saveDatabase(db);
    }
    res.json({ success: true, db });
});

// Отправка сообщения
app.post('/api/send-message', async (req, res) => {
    const { sender, receiver, text } = req.body;
    if (!sender || !receiver || !text) return res.status(400).json({ error: 'Неполные данные' });

    let db = await loadDatabase();
    
    // Создаем ветку диалога, если её нет
    if (!db.messagesStore[sender]) db.messagesStore[sender] = {};
    if (!db.messagesStore[sender][receiver]) db.messagesStore[sender][receiver] = [];
    if (!db.messagesStore[receiver]) db.messagesStore[receiver] = {};
    if (!db.messagesStore[receiver][sender]) db.messagesStore[receiver][sender] = [];

    const messageObj = { sender, text, time: new Date().toLocaleTimeString() };
    
    db.messagesStore[sender][receiver].push(messageObj);
    db.messagesStore[receiver][sender].push(messageObj);

    await saveDatabase(db);
    res.json({ success: true, db });
});

app.listen(PORT, () => {
    console.log(`Социальная сеть запущена на порту ${PORT}`);
});
