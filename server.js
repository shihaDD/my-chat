const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Octokit } = require('octokit');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// ==========================================
// НАСТРОЙКИ GITHUB
// ==========================================
const GITHUB_TOKEN = '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'; 
const REPO_OWNER = 'shihaDD';
const REPO_NAME = 'Chat-Database';
const FILE_PATH = 'database.json';

const octokit = new Octokit({ auth: GITHUB_TOKEN });

// Структура данных в памяти (синхронизируется с GitHub)
let db = {
    users: [],
    userContacts: {},
    messagesStore: {}
};

// Функция загрузки данных с GitHub при запуске сервера
async function loadDataFromGitHub() {
    try {
        const response = await octokit.rest.repos.getContent({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            path: FILE_PATH,
        });
        const content = Buffer.from(response.data.content, 'base64').toString('utf8');
        db = JSON.parse(content);
        console.log('Данные успешно загружены с GitHub!');
    } catch (e) {
        console.log('Файл на GitHub еще не создан или ошибка загрузки, используем пустую базу.', e.message);
        await saveDataToGitHub(); // Создадим пустой файл, если его нет
    }
}

// Функция сохранения данных на GitHub
let isSaving = false;
async function saveDataToGitHub() {
    if (isSaving) return;
    isSaving = true;
    try {
        let sha;
        try {
            const fileData = await octokit.rest.repos.getContent({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                path: FILE_PATH,
            });
            sha = fileData.data.sha;
        } catch (err) {
            // Файла еще может не быть
        }

        const contentBase64 = Buffer.from(JSON.stringify(db, null, 2)).toString('base64');

        await octokit.rest.repos.createOrUpdateFileContents({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            path: FILE_PATH,
            message: 'Update chat database via auto-save [skip ci]',
            content: contentBase64,
            sha: sha,
        });
        console.log('Данные успешно сохранены на GitHub!');
    } catch (e) {
        console.error('Ошибка сохранения на GitHub:', e);
    } finally {
        isSaving = false;
    }
}

io.on('connection', (socket) => {
    console.log('Пользователь подключился:', socket.id);

    socket.on('verify_code', (userData) => {
        socket.userPhone = userData.phone;
        
        let existingUser = db.users.find(u => u.phone === userData.phone);

        if (existingUser) {
            existingUser.id = socket.id;
            existingUser.name = userData.name;
            if (userData.avatar) existingUser.avatar = userData.avatar;
            existingUser.isOnline = true;
        } else {
            db.users.push({
                phone: userData.phone,
                name: userData.name,
                avatar: userData.avatar || null,
                id: socket.id,
                isOnline: true,
                lastSeen: null
            });
            if (!db.userContacts[userData.phone]) {
                db.userContacts[userData.phone] = [];
            }
        }

        saveDataToGitHub();
        sendUpdatedContacts(userData.phone);
    });

    socket.on('update_profile', (data) => {
        const user = db.users.find(u => u.phone === data.oldPhone || u.phone === data.phone);
        if (user) {
            user.name = data.name;
            user.phone = data.phone;
            user.avatar = data.avatar;
            socket.userPhone = data.phone;

            for (let ownerPhone in db.userContacts) {
                let contact = db.userContacts[ownerPhone].find(c => c.phone === data.oldPhone || c.phone === data.phone);
                if (contact) {
                    contact.name = data.name;
                    contact.phone = data.phone;
                    contact.avatar = data.avatar;
                    sendUpdatedContacts(ownerPhone);
                }
            }
            saveDataToGitHub();
            sendUpdatedContacts(data.phone);
        }
    });

    socket.on('add_contact', (data) => {
        const ownerPhone = data.myPhone;
        const targetPhone = data.targetPhone.trim();

        if (ownerPhone === targetPhone) {
            socket.emit('add_contact_response', { success: false, message: 'Нельзя добавить свой собственный номер!' });
            return;
        }

        const targetUser = db.users.find(u => u.phone === targetPhone);
        if (!targetUser) {
            socket.emit('add_contact_response', { success: false, message: 'Пользователь с таким номером не зарегистрирован!' });
            return;
        }

        if (!db.userContacts[ownerPhone]) {
            db.userContacts[ownerPhone] = [];
        }

        const alreadyExists = db.userContacts[ownerPhone].some(c => c.phone === targetPhone);
        if (alreadyExists) {
            socket.emit('add_contact_response', { success: false, message: 'Этот контакт уже есть в вашем списке!' });
            return;
        }

        db.userContacts[ownerPhone].push({
            phone: targetUser.phone,
            name: targetUser.name,
            avatar: targetUser.avatar,
            isOnline: targetUser.isOnline,
            lastSeen: targetUser.lastSeen
        });

        saveDataToGitHub();
        socket.emit('add_contact_response', { success: true, message: 'Контакт успешно добавлен!' });
        sendUpdatedContacts(ownerPhone);
    });

    socket.on('private_message', (data) => {
        const recipient = db.users.find(u => u.phone === data.toPhone);
        const sender = db.users.find(u => u.id === socket.id);

        if (recipient && sender) {
            const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            const chatKey = [sender.phone, recipient.phone].sort().join('_');
            if (!db.messagesStore[chatKey]) db.messagesStore[chatKey] = [];
            
            db.messagesStore[chatKey].push({
                fromPhone: sender.phone,
                toPhone: recipient.phone,
                text: data.message,
                time: time,
                status: 'delivered'
            });

            saveDataToGitHub();

            io.to(recipient.id).emit('message', {
                fromPhone: sender.phone,
                text: data.message,
                time: time
            });

            socket.emit('message_status_update', {
                toPhone: recipient.phone,
                status: 'delivered'
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('Пользователь отключился:', socket.id);
        const user = db.users.find(u => u.id === socket.id);
        if (user) {
            user.isOnline = false;
            user.lastSeen = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            user.id = null;

            for (let ownerPhone in db.userContacts) {
                let contact = db.userContacts[ownerPhone].find(c => c.phone === user.phone);
                if (contact) {
                    contact.isOnline = false;
                    contact.lastSeen = user.lastSeen;
                    sendUpdatedContacts(ownerPhone);
                }
            }
            saveDataToGitHub();
        }
    });
});

function sendUpdatedContacts(phone) {
    const userObj = db.users.find(u => u.phone === phone);
    if (userObj && userObj.id) {
        if (db.userContacts[phone]) {
            db.userContacts[phone] = db.userContacts[phone].map(c => {
                const freshUser = db.users.find(u => u.phone === c.phone);
                if (freshUser) {
                    return {
                        ...c,
                        name: freshUser.name,
                        avatar: freshUser.avatar,
                        isOnline: freshUser.isOnline,
                        lastSeen: freshUser.lastSeen
                    };
                }
                return c;
            });
        }
        io.to(userObj.id).emit('contacts_list', db.userContacts[phone] || []);
    }
}

// Запускаем сервер после загрузки данных из GitHub
loadDataFromGitHub().then(() => {
    server.listen(3000, () => {
        console.log('Сервер запущен на http://localhost:3000');
    });
});
