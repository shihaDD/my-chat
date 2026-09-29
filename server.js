const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let users = []; // Все зарегистрированные пользователи системы
let userContacts = {}; // Сохраненные контакты пользователей { userPhone: [ {phone, name, avatar, isOnline, lastSeen} ] }

io.on('connection', (socket) => {
    console.log('Пользователь подключился:', socket.id);

    // Авторизация / вход пользователя
    socket.on('verify_code', (userData) => {
        socket.userPhone = userData.phone;
        
        let existingUser = users.find(u => u.phone === userData.phone);

        if (existingUser) {
            existingUser.id = socket.id;
            existingUser.name = userData.name;
            if (userData.avatar) existingUser.avatar = userData.avatar;
            existingUser.isOnline = true;
        } else {
            users.push({
                phone: userData.phone,
                name: userData.name,
                avatar: userData.avatar || null,
                id: socket.id,
                isOnline: true,
                lastSeen: null
            });
            if (!userContacts[userData.phone]) {
                userContacts[userData.phone] = [];
            }
        }

        // Отправляем пользователю его актуальный список контактов с учетом текущего статуса
        sendUpdatedContacts(userData.phone);
    });

    // Обновление профиля
    socket.on('update_profile', (data) => {
        const user = users.find(u => u.phone === data.oldPhone || u.phone === data.phone);
        if (user) {
            user.name = data.name;
            user.phone = data.phone;
            user.avatar = data.avatar;
            socket.userPhone = data.phone;

            // Обновляем данные этого пользователя во всех чужих контактных книгах
            for (let ownerPhone in userContacts) {
                let contact = userContacts[ownerPhone].find(c => c.phone === data.oldPhone || c.phone === data.phone);
                if (contact) {
                    contact.name = data.name;
                    contact.phone = data.phone;
                    contact.avatar = data.avatar;
                    sendUpdatedContacts(ownerPhone);
                }
            }
            sendUpdatedContacts(data.phone);
        }
    });

    // Добавление контакта по номеру
    socket.on('add_contact', (data) => {
        // data.myPhone — кто добавляет, data.targetPhone — чей номер ищут
        const ownerPhone = data.myPhone;
        const targetPhone = data.targetPhone.trim();

        if (ownerPhone === targetPhone) {
            socket.emit('add_contact_response', { success: false, message: 'Нельзя добавить свой собственный номер!' });
            return;
        }

        const targetUser = users.find(u => u.phone === targetPhone);
        if (!targetUser) {
            socket.emit('add_contact_response', { success: false, message: 'Пользователь с таким номером не зарегистрирован!' });
            return;
        }

        if (!userContacts[ownerPhone]) {
            userContacts[ownerPhone] = [];
        }

        // Проверяем, есть ли уже этот контакт
        const alreadyExists = userContacts[ownerPhone].some(c => c.phone === targetPhone);
        if (alreadyExists) {
            socket.emit('add_contact_response', { success: false, message: 'Этот контакт уже есть в вашем списке!' });
            return;
        }

        // Добавляем контакт
        userContacts[ownerPhone].push({
            phone: targetUser.phone,
            name: targetUser.name,
            avatar: targetUser.avatar,
            isOnline: targetUser.isOnline,
            lastSeen: targetUser.lastSeen
        });

        socket.emit('add_contact_response', { success: true, message: 'Контакт успешно добавлен!' });
        sendUpdatedContacts(ownerPhone);
    });

    // Отправка личного сообщения
    socket.on('private_message', (data) => {
        const recipient = users.find(u => u.phone === data.toPhone);
        const sender = users.find(u => u.id === socket.id);

        if (recipient && sender) {
            const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
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

    // Прочтение сообщений
    socket.on('mark_as_read', (data) => {
        const sender = users.find(u => u.phone === data.fromPhone);
        const reader = users.find(u => u.id === socket.id);

        if (sender && reader) {
            io.to(sender.id).emit('message_status_update', {
                toPhone: reader.phone,
                status: 'read'
            });
        }
    });

    // Отключение
    socket.on('disconnect', () => {
        console.log('Пользователь отключился:', socket.id);
        const user = users.find(u => u.id === socket.id);
        if (user) {
            user.isOnline = false;
            user.lastSeen = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            user.id = null;

            // Обновляем статусы онлайн/офлайн для всех, у кого он в контактах
            for (let ownerPhone in userContacts) {
                let contact = userContacts[ownerPhone].find(c => c.phone === user.phone);
                if (contact) {
                    contact.isOnline = false;
                    contact.lastSeen = user.lastSeen;
                    sendUpdatedContacts(ownerPhone);
                }
            }
        }
    });
});

// Вспомогательная функция для отправки актуального списка контактов конкретному пользователю
function sendUpdatedContacts(phone) {
    const userObj = users.find(u => u.phone === phone);
    if (userObj && userObj.id) {
        // Подтягиваем актуальные данные статусов для каждого контакта из общего пула users
        if (userContacts[phone]) {
            userContacts[phone] = userContacts[phone].map(c => {
                const freshUser = users.find(u => u.phone === c.phone);
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
        io.to(userObj.id).emit('contacts_list', userContacts[phone] || []);
    }
}

server.listen(3000, () => {
    console.log('Сервер запущен на http://localhost:3000');
});
