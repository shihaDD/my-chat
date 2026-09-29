const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // если фронтенд в папке public, либо уберите, если всё в корне

const PORT = process.env.PORT || 3000;

// Настройки GitHub
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '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';
const REPO_OWNER = 'shihaDD';
const REPO_NAME = 'Chat-Database';
const FILE_PATH = 'database.json';

// Функция чтения базы данных (сначала пробуем локально, если нет — качаем с GitHub)
async function loadDatabase() {
    try {
        if (fs.existsSync(FILE_PATH)) {
            const data = fs.readFileSync(FILE_PATH, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.log('Локального файла нет, пробуем загрузить с GitHub...');
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
            fs.writeFileSync(FILE_PATH, content, 'utf8'); // сохраняем локально для кэша
            return JSON.parse(content);
        }
    } catch (e) {
        console.error('Ошибка загрузки с GitHub:', e);
    }

    // Дефолтная структура, если вообще ничего нет
    return {
        "users": [],
        "userContacts": {},
        "messagesStore": {}
    };
}

// Функция сохранения базы данных (и локально, и на GitHub)
async function saveDatabase(dbData) {
    const jsonString = JSON.stringify(dbData, null, 2);
    
    // 1. Сохраняем локально на сервере
    fs.writeFileSync(FILE_PATH, jsonString, 'utf8');

    // 2. Отправляем изменения на GitHub
    try {
        // Сначала нужно получить текущий sha файла на GitHub (требование API GitHub для обновления)
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

        // Кодируем в Base64
        const contentEncoded = Buffer.from(jsonString, 'utf8').toString('base64');

        // Отправляем PUT запрос на обновление файла
        const updateRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'User-Agent': 'NodeJS-Server',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: 'Auto-update database.json from server',
                content: contentEncoded,
                sha: fileSha
            })
        });

        if (updateRes.ok) {
            console.log('База данных успешно обновлена на GitHub!');
        } else {
            const errText = await updateRes.text();
            console.error('Ошибка при коммите на GitHub:', errText);
        }
    } catch (e) {
        console.error('Не удалось отправить данные на GitHub:', e);
    }
}

// Пример маршрута для получения данных
app.get('/api/data', async (req, res) => {
    const db = await loadDatabase();
    res.json(db);
});

// Пример маршрута для обновления данных (например, добавление пользователя/сообщения)
app.post('/api/update', async (req, res) => {
    let db = await loadDatabase();
    
    // Здесь вы обновляете нужные поля в объекте db на основе req.body
    // Например: db.users.push(req.body.user);
    
    // Сохраняем (функция сама отправит на GitHub)
    await saveDatabase(db);
    
    res.json({ success: true, db });
});

app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
