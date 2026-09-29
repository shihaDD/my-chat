const axios = require('axios'); // Добавьте в начале файла, если нет

// Временное хранилище кодов (в реальных проектах лучше использовать базу данных или Redis)
const verificationCodes = {}; 

socket.on('request_code', async (data, callback) => {
    const { phone, name } = data;
    const cleanPhone = phone.replace(/\D/g, ''); // Очищаем номер от плюсов и скобок (например, 79679074999)

    // Генерируем случайный 4-значный код
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    verificationCodes[cleanPhone] = code;

    console.log(`[SMS] Код для ${phone} (${name}): ${code}`); // Дублируем в консоль на всякий случай

    try {
        // Пример отправки через бесплатный/тестовый или реальный API сервиса SMS.ru
        const apiId = 'ВАШ_API_ID_ОТ_SMS_RU'; // Получите на сайте sms.ru
        
        // Если вы пока тестируете без реального шлюза, можете закомментировать строчку с axios, 
        // тогда код будет просто писаться в консоль (как раньше), но логика будет готова к подключению.
        
        await axios.get(`https://sms.ru/sms/send`, {
            params: {
                api_id: apiId,
                to: cleanPhone,
                msg: `Ваш код авторизации WhatsApp: ${code}`,
                json: 1
            }
        });

        callback({ success: true });
    } catch (error) {
        console.error('Ошибка отправки СМС:', error.message);
        
        // Если шлюз недоступен, но вам нужно, чтобы приложение работало локально:
        // Возвращаем success: true, чтобы код можно было посмотреть в консоли сервера.
        callback({ 
            success: true, 
            message: 'СМС-шлюз не настроен, посмотрите код в консоли сервера' 
        });
    }
});

// Проверка кода остаётся прежней:
socket.on('verify_code', (data, callback) => {
    const { phone, name, code } = data;
    const cleanPhone = phone.replace(/\D/g, '');

    // Обход для быстрого входа, если сессия уже сохранена
    if (code === 'bypass') {
        let user = { phone, name };
        return callback({ success: true, user });
    }

    if (verificationCodes[cleanPhone] === code) {
        delete verificationCodes[cleanPhone]; // Код использован
        let user = { phone, name };
        callback({ success: true, user });
    } else {
        callback({ success: false, message: 'Неверный код из СМС' });
    }
});
