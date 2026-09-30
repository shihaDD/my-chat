<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Мессенджер</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #090d16; }
        ::-webkit-scrollbar-thumb { background: #1f2937; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #374151; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

        .mobile-back-btn { display: none; }

        @keyframes gradientShift {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
        }
        .verified-gradient-name {
            background: linear-gradient(270deg, #38bdf8, #a855f7, #ec4899, #38bdf8);
            background-size: 300% 300%;
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            animation: gradientShift 6s ease infinite;
        }

        .speaking-glow {
            border: 2px solid #22c55e !important;
            box-shadow: 0 0 12px rgba(34, 197, 94, 0.85) !important;
            animation: pulse 1.2s infinite;
        }

        .muted-user-style {
            color: #ef4444 !important;
            text-decoration: line-through;
            font-weight: bold;
        }

        @media (max-width: 768px) {
            body { overflow: hidden; height: 100dvh; }
            #main-app { flex-direction: row !important; height: 100dvh !important; }
            .nav-sidebar {
                width: 56px !important;
                height: 100dvh !important;
                flex-direction: column !important;
                position: relative !important;
                z-index: 100;
                background: #090d16 !important;
                border-right: 1px solid #1f2937 !important;
                padding: 10px 0 !important;
                justify-content: space-between !important;
            }
            .nav-sidebar button {
                width: 100% !important;
                padding: 8px 0 !important;
                display: flex !important;
                flex-direction: column !important;
                align-items: center !important;
                justify-content: center !important;
                position: relative !important;
            }
            .nav-sidebar span:last-child { display: none !important; }
            .content-wrapper { height: 100dvh !important; margin-bottom: 0 !important; }
            .chat-list-panel {
                width: 100% !important;
                position: absolute !important;
                height: 100% !important;
                z-index: 10;
                transition: transform 0.3s ease;
                background: #090d16 !important;
            }
            .chat-list-panel.mobile-hidden { transform: translateX(-100%); }
            .active-chat-panel { width: 100% !important; position: absolute !important; height: 100% !important; z-index: 5; }
            .mobile-back-btn { display: inline-block !important; }
        }
    </style>
</head>
<body class="bg-gray-950 text-gray-100 h-screen overflow-hidden font-sans select-none">

    <!-- КАСТОМНОЕ УВЕДОМЛЕНИЕ -->
    <div id="custom-modal" class="fixed inset-0 z-[99999] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 hidden">
        <div class="bg-gray-900 border border-purple-500/50 p-5 rounded-3xl w-[92%] max-w-sm shadow-2xl text-center space-y-4">
            <div id="custom-modal-icon" class="text-3xl">✨</div>
            <h3 class="text-lg font-bold text-white" id="custom-modal-title">Уведомление</h3>
            <p class="text-sm text-gray-300" id="custom-modal-text"></p>
            <div id="custom-modal-buttons" class="flex space-x-3 justify-center pt-2">
                <button onclick="closeCustomModal(true)" id="custom-modal-ok" class="bg-purple-600 hover:bg-purple-500 text-white px-5 py-2.5 rounded-xl font-bold transition">ОК</button>
            </div>
        </div>
    </div>

    <!-- ОКНО АВТОРИЗАЦИИ И РЕГИСТРАЦИИ -->
    <div id="auth-screen" class="fixed inset-0 z-50 bg-gray-950/90 backdrop-blur-md flex items-center justify-center p-4">
        <div class="bg-gray-900 border border-purple-500/40 p-6 sm:p-8 rounded-3xl w-[95%] max-w-md shadow-2xl relative">
            <h1 class="text-2xl sm:text-3xl font-extrabold text-center mb-6 text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-500">
                Добро пожаловать
            </h1>
            <div id="auth-alert" class="mb-4 p-3 rounded-xl text-xs font-semibold hidden"></div>
            <div class="flex border-b border-gray-800 mb-6">
                <button id="tab-login" onclick="switchAuthTab('login')" class="w-1/2 pb-2 text-center font-bold border-b-2 border-purple-500 text-purple-400 transition">Вход</button>
                <button id="tab-register" onclick="switchAuthTab('register')" class="w-1/2 pb-2 text-center font-bold text-gray-400 transition">Регистрация</button>
            </div>
            <form id="form-login" onsubmit="handleLogin(event)" class="space-y-4">
                <div>
                    <label class="block text-xs font-semibold text-gray-400 uppercase mb-1">Логин</label>
                    <input type="text" id="login-input" required class="w-full bg-gray-800 border border-gray-700 rounded-xl p-3 text-white focus:outline-none focus:border-purple-500">
                </div>
                <div>
                    <label class="block text-xs font-semibold text-gray-400 uppercase mb-1">Пароль</label>
                    <input type="password" id="password-input" required class="w-full bg-gray-800 border border-gray-700 rounded-xl p-3 text-white focus:outline-none focus:border-purple-500">
                </div>
                <button type="submit" class="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold py-3 rounded-xl shadow-lg transition">Войти</button>
            </form>
            <form id="form-register" onsubmit="handleRegister(event)" class="space-y-3 hidden">
                <div>
                    <label class="block text-xs font-semibold text-gray-400 uppercase mb-1">Логин</label>
                    <input type="text" id="reg-login-input" required class="w-full bg-gray-800 border border-gray-700 rounded-xl p-2.5 text-white focus:outline-none focus:border-purple-500">
                </div>
                <div>
                    <label class="block text-xs font-semibold text-gray-400 uppercase mb-1">Имя</label>
                    <input type="text" id="reg-name-input" required class="w-full bg-gray-800 border border-gray-700 rounded-xl p-2.5 text-white focus:outline-none focus:border-purple-500">
                </div>
                <div>
                    <label class="block text-xs font-semibold text-gray-400 uppercase mb-1">Пароль</label>
                    <input type="password" id="reg-password-input" required class="w-full bg-gray-800 border border-gray-700 rounded-xl p-2.5 text-white focus:outline-none focus:border-purple-500">
                </div>
                <button type="submit" class="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold py-3 rounded-xl shadow-lg transition">Зарегистрироваться</button>
            </form>
        </div>
    </div>

    <!-- ОСНОВНОЕ ПРИЛОЖЕНИЕ -->
    <div id="main-app" class="flex h-screen w-screen hidden">
        
        <!-- Сайдбар Навигации -->
        <div id="nav-sidebar" class="w-24 bg-gray-900 border-r border-gray-800 flex flex-col items-center py-4 justify-between flex-shrink-0 z-20 nav-sidebar">
            <div class="space-y-3 flex flex-col items-center w-full">
                <button onclick="switchTab('profile')" id="nav-profile" title="Профиль" class="w-10 h-10 md:w-12 md:h-12 rounded-2xl p-0.5 bg-gradient-to-tr from-purple-600 to-pink-500 flex items-center justify-center mb-2 hover:scale-105 transition relative">
                    <img id="my-avatar-icon" src="" class="w-full h-full rounded-[14px] object-cover">
                </button>
                <button onclick="switchTab('chats')" id="nav-chats" title="Чаты" class="flex flex-col items-center w-full py-2 hover:bg-gray-800 text-gray-400 transition relative">
                    <span class="text-lg mb-0.5">💬</span>
                    <span class="text-[10px]">Чаты</span>
                </button>
                <button onclick="switchTab('friends')" id="nav-friends" title="Друзья" class="flex flex-col items-center w-full py-2 hover:bg-gray-800 text-gray-400 transition relative">
                    <span class="text-lg mb-0.5">👥</span>
                    <span class="text-[10px]">Друзья</span>
                </button>
                <button onclick="switchTab('groups')" id="nav-groups" title="Сообщества" class="flex flex-col items-center w-full py-2 hover:bg-gray-800 text-gray-400 transition relative">
                    <span class="text-lg mb-0.5">🏢</span>
                    <span class="text-[10px]">Группы</span>
                </button>
                <button onclick="switchTab('news')" id="nav-news" title="Новости" class="flex flex-col items-center w-full py-2 hover:bg-gray-800 text-gray-400 transition relative">
                    <span class="text-lg mb-0.5">📰</span>
                    <span class="text-[10px]">Новости</span>
                </button>
                <button onclick="switchTab('music')" id="nav-music" title="Радио" class="flex flex-col items-center w-full py-2 hover:bg-gray-800 text-gray-400 transition">
                    <span class="text-lg mb-0.5">📻</span>
                    <span class="text-[10px]">Радио</span>
                </button>
            </div>
            <div class="flex flex-col items-center w-full">
                <button onclick="openSettingsModal()" title="Настройки" class="flex flex-col items-center w-full py-3 hover:bg-gray-800 text-gray-400 transition">
                    <span class="text-lg mb-0.5">⚙</span>
                    <span class="text-[10px]">Настройки</span>
                </button>
            </div>
        </div>

        <!-- Центральная Панель Контента -->
        <div class="flex-1 flex overflow-hidden content-wrapper relative">
            
            <!-- Вкладка: ЧАТЫ -->
            <div id="tab-content-chats" class="flex-1 flex w-full relative overflow-hidden">
                <div id="chat-list-panel" class="w-80 bg-gray-900/60 border-r border-gray-800 flex flex-col flex-shrink-0 chat-list-panel">
                    <div class="p-4 border-b border-gray-800">
                        <input type="text" id="chat-search" placeholder="Поиск по чатам..." class="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500">
                    </div>
                    <div id="chats-list" class="flex-1 overflow-y-auto p-2 space-y-1"></div>
                </div>

                <div id="active-chat-area" class="flex-1 flex flex-col bg-gray-950 relative active-chat-panel">
                    <div id="no-chat-selected" class="flex-1 flex flex-col items-center justify-center text-gray-500 p-4 text-center">
                        <div class="text-6xl mb-4 opacity-40">💬</div>
                        <div class="text-lg">Выберите чат или друга для начала общения</div>
                    </div>

                    <div id="chat-window" class="flex-1 flex flex-col hidden h-full">
                        <div class="p-4 bg-gray-900 border-b border-gray-800 flex items-center justify-between z-10">
                            <div class="flex items-center space-x-3">
                                <button onclick="backToChatList()" class="mobile-back-btn bg-gray-800 text-white px-3 py-1.5 rounded-xl text-xs font-bold">← Назад</button>
                                <img id="active-chat-avatar" src="" class="w-10 h-10 rounded-full object-cover border border-purple-500/50">
                                <div>
                                    <div id="active-chat-name" class="font-bold text-white"></div>
                                    <div id="active-chat-status" class="text-xs text-gray-400">онлайн</div>
                                </div>
                            </div>
                            <div id="chat-actions" class="flex items-center space-x-2">
                                <button onclick="startDirectCall()" class="p-2 px-3 bg-green-600 hover:bg-green-500 rounded-xl text-white font-bold text-xs flex items-center space-x-1">
                                    <span>📞 Звонок</span>
                                </button>
                            </div>
                        </div>

                        <div id="messages-container" class="flex-1 overflow-y-auto p-4 space-y-3"></div>

                        <div class="p-3 md:p-4 bg-gray-900 border-t border-gray-800 flex items-center space-x-2">
                            <input type="text" id="message-input" onkeydown="if(event.key==='Enter') sendMessage()" placeholder="Сообщение..." class="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-purple-500">
                            <button onclick="sendMessage()" class="bg-purple-600 hover:bg-purple-500 text-white px-5 py-2 rounded-xl font-bold">Отправить</button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Вкладка: ДРУЗЬЯ -->
            <div id="tab-content-friends" class="flex-1 p-6 overflow-y-auto hidden h-full">
                <h2 class="text-2xl font-bold mb-6 text-purple-400">Управление Друзьями</h2>
                <div class="bg-gray-900 border border-gray-800 p-5 rounded-2xl mb-6 max-w-xl">
                    <h3 class="text-sm font-semibold mb-2 text-gray-300">Добавить друга по логину</h3>
                    <div class="flex space-x-2">
                        <input type="text" id="add-friend-login" placeholder="Логин пользователя..." class="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500">
                        <button onclick="sendFriendRequest()" class="bg-purple-600 hover:bg-purple-500 px-4 py-2 rounded-xl font-bold">Отправить</button>
                    </div>
                </div>
                <div id="friend-requests-section" class="mb-6 max-w-xl hidden">
                    <h3 class="text-sm font-semibold mb-2 text-yellow-400">📥 Входящие заявки</h3>
                    <div id="friend-requests-list" class="space-y-2"></div>
                </div>
                <div class="max-w-xl">
                    <h3 class="text-sm font-semibold mb-3 text-gray-300">👥 Мои Друзья</h3>
                    <div id="friends-list" class="space-y-2"></div>
                </div>
            </div>

            <!-- Вкладка: СООБЩЕСТВА -->
            <div id="tab-content-groups" class="flex-1 flex overflow-hidden hidden h-full">
                <div id="groups-main-view" class="flex-1 p-6 overflow-y-auto space-y-6 h-full pb-12">
                    <h2 class="text-2xl font-bold text-purple-400">Сообщества и Группы</h2>
                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-7xl">
                        <div class="space-y-6">
                            <div class="bg-gray-900 border border-gray-800 p-5 rounded-2xl space-y-3">
                                <h3 class="text-sm font-semibold text-gray-300">Создать новое сообщество</h3>
                                <input type="text" id="new-group-name" placeholder="Название группы..." class="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500">
                                <label class="flex items-center space-x-2 text-xs text-gray-300 cursor-pointer">
                                    <input type="checkbox" id="new-group-closed" class="accent-purple-500 w-4 h-4 rounded">
                                    <span>🔒 Закрытая группа (требуется запрос на вступление)</span>
                                </label>
                                <button onclick="createNewGroup()" class="w-full bg-purple-600 hover:bg-purple-500 py-2.5 rounded-xl font-bold text-sm">Создать Группу</button>
                            </div>
                            <div class="bg-gray-900 border border-gray-800 p-5 rounded-2xl">
                                <h3 class="text-sm font-semibold mb-3 text-gray-300">🏢 Все Сообщества</h3>
                                <div id="groups-list" class="space-y-2 overflow-y-auto max-h-[400px]"></div>
                            </div>
                        </div>
                        <div class="space-y-6">
                            <div class="bg-gray-900 border border-purple-500/30 p-5 rounded-2xl space-y-3 h-full flex flex-col">
                                <h3 class="text-sm font-bold text-purple-300 uppercase">📢 Лента постов сообществ</h3>
                                <div class="space-y-2">
                                    <select id="group-post-select" class="w-full bg-gray-800 border border-gray-700 rounded-xl p-2.5 text-sm text-white"></select>
                                    <textarea id="group-post-text" placeholder="Поделитесь новостью в группе..." class="w-full bg-gray-800 border border-gray-700 rounded-xl p-3 text-white h-20 resize-none"></textarea>
                                    <label class="text-xs text-purple-300 flex items-center space-x-2 cursor-pointer">
                                        <input type="checkbox" id="group-post-announcement" class="accent-purple-500 w-4 h-4 rounded">
                                        <span>📢 Дублировать как пост в ленту новостей</span>
                                    </label>
                                    <button onclick="publishGroupPost()" class="bg-purple-600 hover:bg-purple-500 px-5 py-2 rounded-xl font-bold text-xs">Опубликовать в группу</button>
                                </div>
                                <div id="groups-feed-list" class="space-y-3 pt-2 flex-1 overflow-y-auto max-h-[400px]"></div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Рабочая область группы -->
                <div id="group-workspace-view" class="flex-1 flex overflow-hidden hidden">
                    <div class="w-64 bg-gray-900 border-r border-gray-800 flex flex-col flex-shrink-0">
                        <div class="p-4 border-b border-gray-800 flex items-center justify-between">
                            <button onclick="closeGroupWorkspace()" class="text-xs text-gray-400 hover:text-white font-bold">← К списку</button>
                            <span id="ws-group-sidebar-name" class="font-bold text-white truncate text-xs">Группа</span>
                            <button onclick="openActiveGroupSettings()" class="text-xs text-gray-400 hover:text-white p-1.5 bg-purple-600/30 rounded-lg" title="Настройки">⚙</button>
                        </div>
                        <div class="flex-1 overflow-y-auto p-3 space-y-4">
                            <div>
                                <div class="text-xs font-bold text-gray-400 uppercase mb-2">Текстовые каналы</div>
                                <div id="ws-sidebar-text-channels" class="space-y-1"></div>
                            </div>
                            <div>
                                <div class="text-xs font-bold text-gray-400 uppercase mb-2">Голосовые каналы</div>
                                <div id="ws-sidebar-voice-channels" class="space-y-1"></div>
                            </div>
                        </div>
                    </div>

                    <div class="flex-1 flex flex-col bg-gray-950 relative">
                        <div class="p-4 bg-gray-900 border-b border-gray-800 flex items-center justify-between">
                            <div id="ws-active-chat-name" class="font-bold text-white">Канал</div>
                        </div>
                        <div id="ws-messages-container" class="flex-1 overflow-y-auto p-4 space-y-3"></div>
                        <div class="p-4 bg-gray-900 border-t border-gray-800 flex items-center space-x-2">
                            <input type="text" id="ws-message-input" onkeydown="if(event.key==='Enter') sendMessage()" placeholder="Сообщение..." class="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2 text-sm text-white">
                            <button onclick="sendMessage()" class="bg-purple-600 hover:bg-purple-500 text-white px-5 py-2 rounded-xl font-bold">Отправить</button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Вкладка: НОВОСТИ -->
            <div id="tab-content-news" class="flex-1 p-6 overflow-y-auto hidden h-full">
                <div class="max-w-2xl mx-auto space-y-6 pb-12">
                    <h2 class="text-2xl font-bold text-purple-400">Лента Новостей</h2>
                    <div id="news-feed-list" class="space-y-4"></div>
                </div>
            </div>

            <!-- Вкладка: РАДИО -->
            <div id="tab-content-music" class="flex-1 p-6 overflow-y-auto hidden h-full">
                <div class="max-w-3xl mx-auto space-y-6">
                    <h2 class="text-2xl font-bold text-purple-400">📻 Онлайн Радио</h2>
                    <div id="radio-stations-list" class="space-y-3"></div>
                </div>
            </div>

            <!-- Вкладка: ПРОФИЛЬ -->
            <div id="tab-content-profile" class="flex-1 p-6 overflow-y-auto hidden h-full">
                <div class="max-w-md mx-auto bg-gray-900 border border-gray-800 rounded-3xl p-6 shadow-2xl space-y-6">
                    <h2 class="text-2xl font-bold text-purple-400 text-center">Мой Профиль</h2>
                    <div class="flex flex-col items-center">
                        <img id="profile-avatar-preview" src="" class="w-24 h-24 rounded-full border-4 border-purple-500 object-cover mb-3">
                        <div id="profile-username" class="text-xl font-bold text-white"></div>
                    </div>
                    <div class="space-y-4">
                        <div>
                            <label class="block text-xs text-gray-400 uppercase mb-1">Имя</label>
                            <input type="text" id="profile-name-input" class="w-full bg-gray-800 border border-gray-700 rounded-xl p-2.5 text-white">
                        </div>
                        <button onclick="saveProfile()" class="w-full bg-purple-600 hover:bg-purple-500 py-3 rounded-xl font-bold text-white">Сохранить</button>
                        <button onclick="logout()" class="w-full bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white py-2.5 rounded-xl font-bold">Выйти</button>
                    </div>
                </div>
            </div>

        </div>
    </div>

    <!-- ВХОДЯЩИЙ ВЫЗОВ (Всплывающее окно) -->
    <div id="incoming-call-modal" class="fixed bottom-6 right-6 z-[999999] bg-gray-900 border border-green-500 p-5 rounded-3xl w-80 shadow-2xl text-center space-y-4 hidden">
        <img id="incoming-caller-avatar" src="" class="w-16 h-16 rounded-full object-cover border-2 border-green-500 mx-auto">
        <h3 class="text-base font-bold text-white" id="incoming-caller-title">Входящий вызов...</h3>
        <div class="flex space-x-3 justify-center">
            <button onclick="acceptIncomingCall()" class="flex-1 bg-green-600 hover:bg-green-500 text-white py-2.5 rounded-xl font-bold text-xs">Принять</button>
            <button onclick="rejectIncomingCall()" class="flex-1 bg-red-600 hover:bg-red-500 text-white py-2.5 rounded-xl font-bold text-xs">Сбросить</button>
        </div>
    </div>

    <!-- АКТИВНЫЙ ЗВОНОК -->
    <div id="single-call-modal" class="fixed bottom-6 right-6 z-[99999] w-80 bg-gray-900 border border-purple-500 rounded-3xl shadow-2xl p-5 flex flex-col space-y-4 hidden">
        <div class="flex justify-between items-center">
            <span class="text-xs font-bold text-purple-400 uppercase">🎙 Аудиосвязь</span>
            <button onclick="hangUpCall()" class="text-gray-400 hover:text-white font-bold text-sm">✕</button>
        </div>
        <h2 id="call-partner-name" class="text-sm font-bold text-white">Вызов...</h2>
        <div id="remote-audio-container"></div>
        <button onclick="hangUpCall()" class="w-full bg-red-600 hover:bg-red-500 text-white py-2 rounded-xl text-xs font-bold">Завершить</button>
    </div>

    <!-- МОДАЛЬНОЕ ОКНО НАСТРОЕК ГРУППЫ -->
    <div id="group-settings-modal" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 hidden">
        <div class="bg-gray-900 border border-purple-500 p-6 rounded-3xl w-full max-w-lg space-y-4">
            <div class="flex justify-between items-center border-b border-gray-800 pb-3">
                <h3 class="text-lg font-bold text-white">⚙ Настройки группы</h3>
                <button onclick="document.getElementById('group-settings-modal').classList.add('hidden')" class="text-gray-400 hover:text-white font-bold">✕</button>
            </div>
            <div id="group-settings-content" class="space-y-3"></div>
            <div class="flex justify-end pt-2">
                <button onclick="document.getElementById('group-settings-modal').classList.add('hidden')" class="bg-purple-600 hover:bg-purple-500 px-5 py-2 rounded-xl font-bold text-xs text-white">Закрыть</button>
            </div>
        </div>
    </div>

    <script>
        const socket = io();

        let currentUser = null;
        let db = { users: {}, messagesStore: {}, groups: {}, groupPosts: {}, news: [], friendRequests: {}, outgoingRequests: {}, friends: [], mutedUsers: {}, verificationRequests: {}, violations: [] };
        let activeChat = null;
        let activeGroupWorkspaceId = null;
        let activeSubgroup = 'main';

        let localStream = null;
        let peerConnections = {};
        let callTargetUser = null;
        let incomingOffer = null;
        let incomingCallerLogin = null;
        let activeVoiceRoomKey = null;

        // Web Audio API для рингтонов и звуков вызова
        let audioCtx = null;
        function initAudioContext() {
            if (!audioCtx) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
        }

        function playBeep(freq = 440, type = 'sine', duration = 0.2) {
            try {
                initAudioContext();
                if (audioCtx.state === 'suspended') audioCtx.resume();
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = type;
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start();
                osc.stop(audioCtx.currentTime + duration);
            } catch (e) { console.error(e); }
        }

        let ringInterval = null;
        function startRingSound() {
            stopRingSound();
            ringInterval = setInterval(() => {
                playBeep(520, 'sine', 0.4);
                setTimeout(() => playBeep(620, 'sine', 0.4), 300);
            }, 1500);
        }

        function stopRingSound() {
            if (ringInterval) {
                clearInterval(ringInterval);
                ringInterval = null;
            }
        }

        const radioStations = [
            { name: 'Европа Плюс', genre: 'Поп / Хит', url: 'https://ep256.europaplus.ru/ep256_aac', logo: '🌐' },
            { name: 'Авторадио', genre: 'Дорожное / Ретро', url: 'https://pub0102.101.ru:8443/stream/air/aac/64/101', logo: '🚗' },
            { name: 'Наше Радио', genre: 'Рок', url: 'https://nashe3.hostingradio.ru/nashe-128.mp3', logo: '🎸' }
        ];

        function switchAuthTab(tab) {
            if (tab === 'login') {
                document.getElementById('form-login').classList.remove('hidden');
                document.getElementById('form-register').classList.add('hidden');
                document.getElementById('tab-login').className = 'w-1/2 pb-2 text-center font-bold border-b-2 border-purple-500 text-purple-400';
                document.getElementById('tab-register').className = 'w-1/2 pb-2 text-center font-bold text-gray-400';
            } else {
                document.getElementById('form-login').classList.add('hidden');
                document.getElementById('form-register').classList.remove('hidden');
                document.getElementById('tab-register').className = 'w-1/2 pb-2 text-center font-bold border-b-2 border-purple-500 text-purple-400';
                document.getElementById('tab-login').className = 'w-1/2 pb-2 text-center font-bold text-gray-400';
            }
        }

        function handleLogin(e) {
            e.preventDefault();
            socket.emit('login', {
                login: document.getElementById('login-input').value.trim(),
                password: document.getElementById('password-input').value
            });
        }

        function handleRegister(e) {
            e.preventDefault();
            socket.emit('register', {
                login: document.getElementById('reg-login-input').value.trim(),
                name: document.getElementById('reg-name-input').value.trim(),
                password: document.getElementById('reg-password-input').value
            });
        }

        socket.on('auth_success', (user) => {
            currentUser = user;
            document.getElementById('auth-screen').classList.add('hidden');
            document.getElementById('main-app').classList.remove('hidden');
            document.getElementById('my-avatar-icon').src = user.avatar;
            renderRadioStations();
            switchTab('chats');
        });

        socket.on('auth_error', (msg) => {
            const alert = document.getElementById('auth-alert');
            alert.textContent = msg;
            alert.className = 'mb-4 p-3 rounded-xl text-xs font-semibold bg-red-600/20 text-red-400 border border-red-500/50';
            alert.classList.remove('hidden');
        });

        socket.on('sync_app_data', (data) => {
            db = data;
            if (currentUser && db.users[currentUser.login]) {
                currentUser = db.users[currentUser.login];
            }
            refreshActiveViews();
        });

        function switchTab(tabName) {
            ['chats', 'friends', 'groups', 'news', 'music', 'profile'].forEach(t => {
                const el = document.getElementById(`tab-content-${t}`);
                if (el) el.classList.add('hidden');
            });
            const target = document.getElementById(`tab-content-${tabName}`);
            if (target) target.classList.remove('hidden');

            if (tabName === 'chats') renderChatsList();
            if (tabName === 'friends') renderFriendsView();
            if (tabName === 'groups') renderGroupsView();
            if (tabName === 'news') renderNewsFeed();
            if (tabName === 'profile') renderProfileView();
        }

        function refreshActiveViews() {
            if (activeChat) renderMessages();
            renderChatsList();
            renderFriendsView();
            renderGroupsView();
            renderNewsFeed();
        }

        // Рендеринг чатов и друзей
        function renderChatsList() {
            const list = document.getElementById('chats-list');
            if (!list || !currentUser) return;
            list.innerHTML = '';

            const friends = db.friends[currentUser.login] || [];
            friends.forEach(fLogin => {
                const fUser = db.users[fLogin];
                if (!fUser) return;
                const chatKey = [currentUser.login, fLogin].sort().join('_');
                const div = document.createElement('div');
                div.className = `p-3 rounded-2xl flex items-center space-x-3 cursor-pointer transition ${activeChat === chatKey ? 'bg-purple-600/20 border border-purple-500/50' : 'hover:bg-gray-800/50'}`;
                div.onclick = () => openChat(chatKey, fUser.name, fUser.avatar);
                div.innerHTML = `
                    <img src="${fUser.avatar}" class="w-10 h-10 rounded-full object-cover">
                    <div class="flex-1 min-w-0">
                        <div class="font-bold text-white truncate text-sm">${fUser.name}</div>
                        <div class="text-xs text-gray-400 truncate">@${fUser.login}</div>
                    </div>
                `;
                list.appendChild(div);
            });
        }

        function openChat(chatKey, name, avatar) {
            activeChat = chatKey;
            activeGroupWorkspaceId = null;
            document.getElementById('no-chat-selected').classList.add('hidden');
            document.getElementById('chat-window').classList.remove('hidden');
            document.getElementById('active-chat-name').textContent = name;
            document.getElementById('active-chat-avatar').src = avatar;
            renderMessages();
            if (window.innerWidth <= 768) {
                document.getElementById('chat-list-panel').classList.add('mobile-hidden');
            }
        }

        function backToChatList() {
            document.getElementById('chat-list-panel').classList.remove('mobile-hidden');
        }

        function renderMessages() {
            const container = document.getElementById('messages-container');
            if (!container || !activeChat) return;
            container.innerHTML = '';
            const messages = db.messagesStore[activeChat] || [];
            messages.forEach(msg => {
                const isMe = msg.sender === currentUser.login;
                const senderObj = db.users[msg.sender] || { name: msg.sender };
                const div = document.createElement('div');
                div.className = `flex flex-col ${isMe ? 'items-end' : 'items-start'} space-y-1`;
                div.innerHTML = `
                    <div class="max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${isMe ? 'bg-purple-600 text-white rounded-br-none' : 'bg-gray-800 text-gray-100 rounded-bl-none'}">
                        ${!isMe ? `<div class="text-[10px] font-bold text-purple-300 mb-0.5">${senderObj.name}</div>` : ''}
                        <div>${escapeHtml(msg.text)}</div>
                    </div>
                `;
                container.appendChild(div);
            });
            container.scrollTop = container.scrollHeight;
        }

        function sendMessage() {
            const input = document.getElementById('message-input');
            const wsInput = document.getElementById('ws-message-input');
            const text = (input && !input.parentElement.classList.contains('hidden') ? input.value : wsInput?.value || '').trim();
            if (!text || !activeChat) return;

            socket.emit('send_message', {
                chatKey: activeChat,
                text,
                isGroup: !!activeGroupWorkspaceId
            });

            if (input) input.value = '';
            if (wsInput) wsInput.value = '';
        }

        // Друзья
        function renderFriendsView() {
            const list = document.getElementById('friends-list');
            const reqSection = document.getElementById('friend-requests-section');
            const reqList = document.getElementById('friend-requests-list');
            if (!currentUser) return;

            const myReqs = db.friendRequests[currentUser.login] || [];
            if (myReqs.length > 0) {
                reqSection.classList.remove('hidden');
                reqList.innerHTML = '';
                myReqs.forEach(senderLogin => {
                    const sender = db.users[senderLogin];
                    if (!sender) return;
                    const div = document.createElement('div');
                    div.className = 'bg-gray-800/80 p-3 rounded-xl flex items-center justify-between';
                    div.innerHTML = `
                        <div class="flex items-center space-x-2">
                            <img src="${sender.avatar}" class="w-8 h-8 rounded-full object-cover">
                            <span class="text-sm font-bold text-white">${sender.name} (@${sender.login})</span>
                        </div>
                        <div class="space-x-2">
                            <button onclick="socket.emit('accept_friend_request', '${senderLogin}')" class="bg-green-600 px-3 py-1 rounded-lg text-xs font-bold text-white">Принять</button>
                            <button onclick="socket.emit('reject_friend_request', '${senderLogin}')" class="bg-red-600 px-3 py-1 rounded-lg text-xs font-bold text-white">Отклонить</button>
                        </div>
                    `;
                    reqList.appendChild(div);
                });
            } else {
                reqSection.classList.add('hidden');
            }

            list.innerHTML = '';
            const friends = db.friends[currentUser.login] || [];
            friends.forEach(fLogin => {
                const f = db.users[fLogin];
                if (!f) return;
                const div = document.createElement('div');
                div.className = 'bg-gray-900 border border-gray-800 p-3 rounded-xl flex items-center justify-between';
                div.innerHTML = `
                    <div class="flex items-center space-x-3">
                        <img src="${f.avatar}" class="w-10 h-10 rounded-full object-cover">
                        <div>
                            <div class="font-bold text-white text-sm">${f.name}</div>
                            <div class="text-xs text-gray-400">@${f.login}</div>
                        </div>
                    </div>
                    <button onclick="openChat('${[currentUser.login, fLogin].sort().join('_')}', '${f.name}', '${f.avatar}'); switchTab('chats')" class="bg-purple-600/30 hover:bg-purple-600 text-purple-300 hover:text-white px-3 py-1.5 rounded-xl text-xs font-bold transition">Написать</button>
                `;
                list.appendChild(div);
            });
        }

        function sendFriendRequest() {
            const login = document.getElementById('add-friend-login').value.trim();
            if (!login) return;
            socket.emit('send_friend_request', login);
            document.getElementById('add-friend-login').value = '';
        }

        // Сообщества
        function renderGroupsView() {
            const list = document.getElementById('groups-list');
            const select = document.getElementById('group-post-select');
            if (!list || !select) return;

            list.innerHTML = '';
            select.innerHTML = '';

            Object.values(db.groups).forEach(g => {
                const isMember = g.members.includes(currentUser.login);
                const isOwner = g.owner === currentUser.login;

                // Селект для постов
                if (isMember) {
                    const opt = document.createElement('option');
                    opt.value = g.id;
                    opt.textContent = g.name;
                    select.appendChild(opt);
                }

                const div = document.createElement('div');
                div.className = 'bg-gray-800/80 p-3 rounded-xl flex items-center justify-between';
                div.innerHTML = `
                    <div class="flex items-center space-x-3">
                        <img src="${g.avatar}" class="w-10 h-10 rounded-xl object-cover">
                        <div>
                            <div class="font-bold text-white text-sm">${g.name}</div>
                            <div class="text-xs text-gray-400">${g.members.length} участников</div>
                        </div>
                    </div>
                    <div>
                        ${isMember ? `<button onclick="openGroupWorkspace('${g.id}')" class="bg-purple-600 px-3 py-1.5 rounded-xl text-xs font-bold text-white">Открыть</button>` : `<button onclick="socket.emit('join_group', '${g.id}')" class="bg-green-600 px-3 py-1.5 rounded-xl text-xs font-bold text-white">Вступить</button>`}
                    </div>
                `;
                list.appendChild(div);
            });

            renderGroupsFeed();
        }

        function createNewGroup() {
            const name = document.getElementById('new-group-name').value.trim();
            const closed = document.getElementById('new-group-closed').checked;
            if (!name) return;
            socket.emit('create_group', { name, closed });
            document.getElementById('new-group-name').value = '';
        }

        function openGroupWorkspace(groupId) {
            const group = db.groups[groupId];
            if (!group) return;
            activeGroupWorkspaceId = groupId;
            activeChat = groupId;

            document.getElementById('groups-main-view').classList.add('hidden');
            document.getElementById('group-workspace-view').classList.remove('hidden');
            document.getElementById('ws-group-sidebar-name').textContent = group.name;

            renderGroupChannels(group);
            openGroupChannel('main');
        }

        function closeGroupWorkspace() {
            activeGroupWorkspaceId = null;
            document.getElementById('group-workspace-view').classList.add('hidden');
            document.getElementById('groups-main-view').classList.remove('hidden');
        }

        function renderGroupChannels(group) {
            const textDiv = document.getElementById('ws-sidebar-text-channels');
            const voiceDiv = document.getElementById('ws-sidebar-voice-channels');
            textDiv.innerHTML = '';
            voiceDiv.innerHTML = '';

            group.channels.text.forEach(ch => {
                const btn = document.createElement('button');
                btn.className = `w-full text-left px-3 py-1.5 rounded-xl text-xs font-bold transition ${activeSubgroup === ch.id ? 'bg-purple-600 text-white' : 'text-gray-400 hover:bg-gray-800'}`;
                btn.textContent = `# ${ch.name}`;
                btn.onclick = () => openGroupChannel(ch.id);
                textDiv.appendChild(btn);
            });

            group.channels.voice.forEach(ch => {
                const btn = document.createElement('button');
                btn.className = 'w-full text-left px-3 py-1.5 rounded-xl text-xs font-bold text-gray-400 hover:bg-gray-800';
                btn.textContent = `🎙 ${ch.name}`;
                btn.onclick = () => joinVoiceChannel(group.id, ch.id);
                voiceDiv.appendChild(btn);
            });
        }

        function openGroupChannel(channelId) {
            activeSubgroup = channelId;
            document.getElementById('ws-active-chat-name').textContent = `# ${channelId}`;
            renderGroupMessages();
        }

        function renderGroupMessages() {
            const container = document.getElementById('ws-messages-container');
            if (!container || !activeGroupWorkspaceId) return;
            container.innerHTML = '';
            const messages = db.messagesStore[activeGroupWorkspaceId] || [];
            messages.forEach(msg => {
                const senderObj = db.users[msg.sender] || { name: msg.sender };
                const div = document.createElement('div');
                div.className = 'flex flex-col items-start space-y-1';
                div.innerHTML = `
                    <div class="max-w-[75%] bg-gray-800 text-gray-100 rounded-2xl rounded-bl-none px-4 py-2.5 text-sm">
                        <div class="text-[10px] font-bold text-purple-300 mb-0.5">${senderObj.name}</div>
                        <div>${escapeHtml(msg.text)}</div>
                    </div>
                `;
                container.appendChild(div);
            });
            container.scrollTop = container.scrollHeight;
        }

        function publishGroupPost() {
            const groupId = document.getElementById('group-post-select').value;
            const text = document.getElementById('group-post-text').value.trim();
            const duplicateToNews = document.getElementById('group-post-announcement').checked;
            if (!text || !groupId) return;

            socket.emit('publish_group_post', { groupId, text, duplicateToNews });
            document.getElementById('group-post-text').value = '';
        }

        function renderGroupsFeed() {
            const feed = document.getElementById('groups-feed-list');
            if (!feed) return;
            feed.innerHTML = '';

            let allPosts = [];
            Object.values(db.groupPosts).forEach(posts => {
                allPosts.push(...posts);
            });
            allPosts.sort((a, b) => b.timestamp - a.timestamp);

            allPosts.forEach(post => {
                const author = db.users[post.author] || { name: post.author };
                const group = db.groups[post.groupId] || { name: 'Группа' };
                const div = document.createElement('div');
                div.className = 'bg-gray-800/60 p-3 rounded-xl space-y-2';
                div.innerHTML = `
                    <div class="flex items-center space-x-2">
                        <img src="${author.avatar}" class="w-7 h-7 rounded-full object-cover">
                        <div>
                            <div class="text-xs font-bold text-white">${author.name} <span class="text-purple-400 font-normal">в ${group.name}</span></div>
                        </div>
                    </div>
                    <div class="text-xs text-gray-200">${escapeHtml(post.text)}</div>
                `;
                feed.appendChild(div);
            });
        }

        // Новости
        function renderNewsFeed() {
            const feed = document.getElementById('news-feed-list');
            if (!feed) return;
            feed.innerHTML = '';

            const news = db.news || [];
            news.forEach(item => {
                const author = db.users[item.author] || { name: item.author };
                const div = document.createElement('div');
                div.className = 'bg-gray-900 border border-gray-800 p-4 rounded-2xl space-y-2';
                div.innerHTML = `
                    <div class="flex items-center space-x-2">
                        <img src="${author.avatar}" class="w-8 h-8 rounded-full object-cover">
                        <div class="text-sm font-bold text-white">${author.name}</div>
                    </div>
                    <div class="text-sm text-gray-200 whitespace-pre-wrap">${escapeHtml(item.text)}</div>
                `;
                feed.appendChild(div);
            });
        }

        // Радио
        function renderRadioStations() {
            const list = document.getElementById('radio-stations-list');
            if (!list) return;
            list.innerHTML = '';
            radioStations.forEach(st => {
                const div = document.createElement('div');
                div.className = 'bg-gray-900 border border-gray-800 p-4 rounded-xl flex items-center justify-between';
                div.innerHTML = `
                    <div class="flex items-center space-x-3">
                        <span class="text-2xl">${st.logo}</span>
                        <div>
                            <div class="font-bold text-white text-sm">${st.name}</div>
                            <div class="text-xs text-gray-400">${st.genre}</div>
                        </div>
                    </div>
                    <audio controls src="${st.url}" class="h-10"></audio>
                `;
                list.appendChild(div);
            });
        }

        // Профиль
        function renderProfileView() {
            if (!currentUser) return;
            document.getElementById('profile-avatar-preview').src = currentUser.avatar;
            document.getElementById('profile-username').textContent = currentUser.name;
            document.getElementById('profile-name-input').value = currentUser.name;
        }

        function saveProfile() {
            const name = document.getElementById('profile-name-input').value.trim();
            if (!name) return;
            socket.emit('update_profile', { name });
            showCustomModal('Успешно', 'Профиль обновлен!');
        }

        function logout() {
            location.reload();
        }

        // Веб-звонки (WebRTC)
        function startDirectCall() {
            if (!activeChat) return;
            const participants = activeChat.split('_');
            callTargetUser = participants.find(p => p !== currentUser.login);
            if (!callTargetUser) return;

            document.getElementById('call-partner-name').textContent = db.users[callTargetUser]?.name || callTargetUser;
            document.getElementById('single-call-modal').classList.remove('hidden');

            navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(stream => {
                localStream = stream;
                const pc = createPeerConnection(callTargetUser);
                localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

                pc.createOffer().then(offer => pc.setLocalDescription(offer)).then(() => {
                    socket.emit('call_user', { to: callTargetUser, offer: pc.localDescription });
                });
            }).catch(err => alert('Нет доступа к микрофону: ' + err));
        }

        function createPeerConnection(partnerLogin) {
            if (peerConnections[partnerLogin]) return peerConnections[partnerLogin];
            const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    socket.emit('webrtc_ice_candidate', { to: partnerLogin, candidate: event.candidate });
                }
            };

            pc.ontrack = (event) => {
                const container = document.getElementById('remote-audio-container');
                container.innerHTML = '';
                const audio = document.createElement('audio');
                audio.srcObject = event.streams[0];
                audio.autoplay = true;
                container.appendChild(audio);
            };

            peerConnections[partnerLogin] = pc;
            return pc;
        }

        socket.on('incoming_call', ({ from, offer }) => {
            incomingCallerLogin = from;
            incomingOffer = offer;
            const caller = db.users[from] || { name: from, avatar: '' };
            document.getElementById('incoming-caller-avatar').src = caller.avatar;
            document.getElementById('incoming-caller-title', `Входящий вызов от ${caller.name}`);
            document.getElementById('incoming-call-modal').classList.remove('hidden');
            startRingSound();
        });

        function acceptIncomingCall() {
            stopRingSound();
            document.getElementById('incoming-call-modal').classList.add('hidden');
            document.getElementById('single-call-modal').classList.remove('hidden');
            document.getElementById('call-partner-name').textContent = db.users[incomingCallerLogin]?.name || incomingCallerLogin;
            callTargetUser = incomingCallerLogin;

            navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(stream => {
                localStream = stream;
                const pc = createPeerConnection(callTargetUser);
                localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

                pc.setRemoteDescription(new RTCSessionDescription(incomingOffer)).then(() => {
                    return pc.createAnswer();
                }).then(answer => {
                    return pc.setLocalDescription(answer);
                }).then(() => {
                    socket.emit('make_call_answer', { to: callTargetUser, answer: pc.localDescription });
                });
            });
        }

        function rejectIncomingCall() {
            stopRingSound();
            document.getElementById('incoming-call-modal').classList.add('hidden');
            if (incomingCallerLogin) {
                socket.emit('hang_up_call', { to: incomingCallerLogin });
            }
        }

        socket.on('call_answered', ({ from, answer }) => {
            const pc = peerConnections[from];
            if (pc) {
                pc.setRemoteDescription(new RTCSessionDescription(answer));
            }
        });

        socket.on('webrtc_ice_candidate', ({ from, candidate }) => {
            const pc = peerConnections[from];
            if (pc && candidate) {
                pc.addIceCandidate(new RTCIceCandidate(candidate));
            }
        });

        socket.on('call_hung_up', () => {
            hangUpCall(true);
        });

        function hangUpCall(remote = false) {
            stopRingSound();
            if (!remote && callTargetUser) {
                socket.emit('hang_up_call', { to: callTargetUser });
            }
            if (localStream) {
                localStream.getTracks().forEach(t => t.stop());
                localStream = null;
            }
            Object.values(peerConnections).forEach(pc => pc.close());
            peerConnections = {};
            callTargetUser = null;
            document.getElementById('single-call-modal').classList.add('hidden');
            document.getElementById('incoming-call-modal').classList.add('hidden');
        }

        // Голосовой канал (конференция)
        function joinVoiceChannel(groupId, channelId) {
            activeVoiceRoomKey = `${groupId}_${channelId}`;
            socket.emit('join_voice_room', { groupId, channelId });
            showCustomModal('Голосовой канал', 'Вы подключились к голосовому каналу.');
        }

        socket.on('voice_room_participants_update', ({ roomKey, participants }) => {
            console.log('Участники голосового канала:', participants);
        });

        // Вспомогательные модалки
        function showCustomModal(title, text) {
            document.getElementById('custom-modal-title').textContent = title;
            document.getElementById('custom-modal-text').textContent = text;
            document.getElementById('custom-modal').classList.remove('hidden');
        }

        function closeCustomModal() {
            document.getElementById('custom-modal').classList.add('hidden');
        }

        function openSettingsModal() {
            showCustomModal('Настройки', 'Все параметры аудио работают по умолчанию.');
        }

        function openActiveGroupSettings() {
            const group = db.groups[activeGroupWorkspaceId];
            if (!group) return;
            const content = document.getElementById('group-settings-content');
            content.innerHTML = `
                <div><b>Название:</b> ${group.name}</div>
                <div><b>Создатель:</b> ${group.owner}</div>
                <div><b>Участников:</b> ${group.members.length}</div>
            `;
            document.getElementById('group-settings-modal').classList.remove('hidden');
        }

        function escapeHtml(text) {
            const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
            return text.replace(/[&<>"']/g, m => map[m]);
        }
    </script>
</body>
</html>
