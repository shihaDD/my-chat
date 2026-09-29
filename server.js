const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static(path.join(__dirname, 'public')));

const users = {}; // socket.id -> { phone, name }
const pendingCodes = {}; // phone -> code (временные коды для входа)

io.on('connection', (socket) => {
    console.log('Пользователь подключился:', socket.id);

    // Шаг 1: Запрос на отправку СМС-кода
    socket.on('request_code', (data, callback) => {
        const cleanPhone = data.phone ? data.phone.replace(/\D/g, '') : '';
        const name = data.name ? data.name.trim() : '';

        if (cleanPhone.length < 10) {
            return callback({ success: false, message: 'Введите корректный номер телефона!' });
        }
        if (!name) {
            return callback({ success: false, message: 'Введите ваше имя!' });
        }

        // Генерируем случайный 4-значный код (например: 1234)
        const smsCode = Math.floor(1000 + Math.random() * 9000).toString();
        pendingCodes[cleanPhone] = smsCode;

        // В реальном проекте здесь вызов API СМС-шлюза. 
        // Для примера выводим код в консоль сервера:
        console.log(`\n========================================`);
        console.log(`[SMS СЕРВИС] Код для номера ${data.phone}: ${smsCode}`);
        console.log(`========================================\n`);

        callback({ success: true, message: 'Код отправлен (проверьте консоль сервера)' });
    });

    // Шаг 2: Проверка кода и успешный вход
    socket.on('verify_code', (data, callback) => {
        // data = { phone, name, code }
        const cleanPhone = data.phone ? data.phone.replace(/\D/g, '') : '';
        
        if (pendingCodes[cleanPhone] && pendingCodes[cleanPhone] === data.code) {
            // Код верный, очищаем его и авторизуем пользователя
            delete pendingCodes[cleanPhone];

            users[socket.id] = { phone: data.phone.trim(), name: data.name.trim() };
            socket.userData = users[socket.id];

            callback({ success: true, user: users[socket.id] });
            updateUsersList();
        } else {
            callback({ success: false, message: 'Неверный код подтверждения!' });
        }
    });

    // Обработка личных сообщений
    socket.on('private_message', (data) => {
        const recipientSocketId = Object.keys(users).find(
            key => users[key].phone === data.toPhone
        );

        if (recipientSocketId) {
            io.to(recipientSocketId).emit('message', {
                fromPhone: socket.userData.phone,
                fromName: socket.userData.name,
                text: data.message,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('Пользователь отключился:', socket.id);
        delete users[socket.id];
        updateUsersList();
    });

    function updateUsersList() {
        const userList = Object.values(users);
        io.emit('users_list', userList);
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
