/* Экран входа */
#auth-screen {
 background: white;
 padding: 2.5rem;
 border-radius: 12px;
 box-shadow: 0 8px 24px rgba(0,0,0,0.1);
 width: 340px;
 text-align: center;
}
#auth-screen h2 {
 margin-bottom: 8px;
 color: #333;
}
#auth-screen p {
 font-size: 13px;
 color: #666;
 margin-bottom: 20px;
}
#auth-screen input {
 width: 100%;
 padding: 12px;
 margin-bottom: 15px;
 border: 1px solid #ddd;
 border-radius: 6px;
 font-size: 14px;
 outline: none;
}
#auth-screen button {
 width: 100%;
 padding: 12px;
 background: #007bff;
 color: white;
 border: none;
 border-radius: 6px;
 font-size: 16px;
 cursor: pointer;
 transition: background 0.2s;
 font-weight: 600;
}
#auth-screen button:hover {
 background: #0056b3;
}

/* Главный экран чата */
#chat-screen {
 display: none;
 width: 900px;
 height: 600px;
 background: white;
 border-radius: 12px;
 box-shadow: 0 8px 24px rgba(0,0,0,0.1);
 overflow: hidden;
}

.sidebar {
 width: 280px;
 background: #f7f9fa;
 border-right: 1px solid #e6ecf0;
 display: flex;
 flex-direction: column;
}
.sidebar-header {
 padding: 20px;
 font-weight: bold;
 border-bottom: 1px solid #e6ecf0;
 background: #fff;
 color: #333;
}
.users-list {
 flex: 1;
 overflow-y: auto;
 padding: 10px;
}
.user-item {
 padding: 12px;
 border-radius: 8px;
 cursor: pointer;
 margin-bottom: 4px;
 transition: background 0.2s;
 font-size: 15px;
}
.user-item:hover {
 background: #e8f0fe;
}
.user-item.active {
 background: #007bff;
 color: white;
}

.chat-area {
 flex: 1;
 display: flex;
 flex-direction: column;
 background: #fff;
}
.chat-header {
 padding: 20px;
 border-bottom: 1px solid #e6ecf0;
 font-weight: 600;
 font-size: 16px;
 color: #333;
}

.messages {
 flex: 1;
 padding: 20px;
 overflow-y: auto;
 display: flex;
 flex-direction: column;
 gap: 12px;
 background: #fafafa;
}
.msg {
 max-width: 65%;
 padding: 10px 14px;
 border-radius: 12px;
 font-size: 14px;
 line-height: 1.4;
 word-wrap: break-word;
}
.msg.incoming {
 background: #ffffff;
 align-self: flex-start;
 border: 1px solid #e6ecf0;
 color: #333;
}
.msg.outgoing {
 background: #007bff;
 color: white;
 align-self: flex-end;
}

.input-area {
 display: flex;
 padding: 15px;
 border-top: 1px solid #e6ecf0;
 gap: 10px;
 background: #fff;
}
.input-area input {
 flex: 1;
 padding: 12px;
 border: 1px solid #ddd;
 border-radius: 6px;
 outline: none;
 font-size: 14px;
}
.input-area button {
 padding: 12px 24px;
 background: #007bff;
 color: white;
 border: none;
 border-radius: 6px;
 cursor: pointer;
 font-weight: 600;
}

<div class="chat-area">
 <div class="chat-header" id="chat-header">Выберите пользователя из списка слева</div>
 <div class="messages" id="messages-box"></div>
 <div class="input-area">
   <input type="text" id="message-input" placeholder="Напишите сообщение..." onkeydown="if(event.key==='Enter') sendMessage()" />
   <button onclick="sendMessage()">Отправить</button>
 </div>
</div>
