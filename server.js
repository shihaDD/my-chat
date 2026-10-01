// server.js — Мессенджер (Node.js + Express + MongoDB + WebSocket + WebRTC)
// Зависимости: npm install express mongoose bcrypt jsonwebtoken ws cors dotenv multer
// Запуск: node server.js
// .env: MONGO_URI, JWT_SECRET, PORT

require("dotenv").config();

const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);

// ─── Middleware ──────────────────────────────────────────────
app.use(cors({ origin: "*", credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ─── Multer (загрузка аватаров / медиа) ──────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "uploads");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ─── MongoDB Connection ─────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/messenger";
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("[MongoDB] Connected"))
  .catch((err) => {
    console.error("[MongoDB] Connection error:", err);
    process.exit(1);
  });

// ─── Mongoose Schemas ──────────────────────────────────────

const userSchema = new mongoose.Schema({
  login:      { type: String, required: true, unique: true, trim: true },
  name:       { type: String, required: true, trim: true },
  password:   { type: String, required: true },
  avatar:     { type: String, default: "" },
  bio:        { type: String, default: "" },
  email:      { type: String, default: "" },
  globalRole: { type: String, enum: ["user", "moderator", "admin"], default: "user" },
  isMuted:    { type: Boolean, default: false },
  muteReason: { type: String, default: "" },
  muteUntil:  { type: Date, default: null },
  friends:    [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  friendRequests:     [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  friendRequestsSent: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  createdAt:  { type: Date, default: Date.now },
  lastSeen:   { type: Date, default: Date.now },
});

const messageSchema = new mongoose.Schema({
  chatId:    { type: mongoose.Schema.Types.ObjectId, required: true },
  sender:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  text:      { type: String, default: "" },
  attachments: [{ type: String }],
  replyTo:   { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
  edited:    { type: Boolean, default: false },
  deleted:   { type: Boolean, default: false },
  pinned:    { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

const chatSchema = new mongoose.Schema({
  type:       { type: String, enum: ["direct", "group", "channel"], default: "direct" },
  name:       { type: String, default: "" },
  groupId:    { type: mongoose.Schema.Types.ObjectId, ref: "Group", default: null },
  channelId:   { type: mongoose.Schema.Types.ObjectId, default: null },
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  pinnedMessageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
  createdAt:  { type: Date, default: Date.now },
});

const groupSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  avatar:      { type: String, default: "" },
  description: { type: String, default: "" },
  isPrivate:   { type: Boolean, default: false },
  owner:       { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  members:     [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  joinRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  roles: [{
    name:       { type: String, required: true },
    color:      { type: String, default: "#99aab5" },
    permissions: {
      post:    { type: Boolean, default: false },
      delete:  { type: Boolean, default: false },
      news:    { type: Boolean, default: false },
      voice:   { type: Boolean, default: false },
    },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  }],
  textChannels: [{
    name:      { type: String, required: true },
    accessRole: { type: String, default: "all" },
  }],
  voiceChannels: [{
    name: { type: String, required: true },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  }],
  isVerified:  { type: Boolean, default: false },
  verificationRequested: { type: Boolean, default: false },
  createdAt:   { type: Date, default: Date.now },
});

const newsSchema = new mongoose.Schema({
  author:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  text:      { type: String, default: "" },
  media:     [{ type: String }],
  groupId:   { type: mongoose.Schema.Types.ObjectId, ref: "Group", default: null },
  createdAt: { type: Date, default: Date.now },
});

const violationSchema = new mongoose.Schema({
  user:      { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  reason:    { type: String, required: true },
  reporter:  { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  createdAt: { type: Date, default: Date.now },
  resolved:  { type: Boolean, default: false },
});

const sessionSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  token:     { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
});

const User = mongoose.model("User", userSchema);
const Message = mongoose.model("Message", messageSchema);
const Chat = mongoose.model("Chat", chatSchema);
const Group = mongoose.model("Group", groupSchema);
const News = mongoose.model("News", newsSchema);
const Violation = mongoose.model("Violation", violationSchema);
const Session = mongoose.model("Session", sessionSchema);

// ─── JWT Helpers ────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-change-me";

function generateToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "No token" });
  const token = auth.replace("Bearer ", "");
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

// ─── WebSocket Server ───────────────────────────────────────
const wss = new WebSocketServer({ server, path: "/ws" });

// userId → Set<ws>
const onlineClients = new Map();

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const token = url.searchParams.get("token");
  let userId = null;

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    userId = decoded.userId;
  } catch {
    ws.close(4001, "Invalid token");
    return;
  }

  // Register
  if (!onlineClients.has(userId)) onlineClients.set(userId, new Set());
  onlineClients.get(userId).add(ws);
  User.findByIdAndUpdate(userId, { lastSeen: new Date() }).exec();
  broadcastPresence(userId, "online");

  ws.on("message", async (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    switch (data.type) {
      // ── Chat message ──
      case "message": {
        const { chatId, text, attachments, replyTo } = data;
        const msg = await Message.create({
          chatId, sender: userId, text: text || "",
          attachments: attachments || [], replyTo: replyTo || null,
        });
        const populated = await Message.findById(msg._id).populate("sender", "login name avatar");
        const chat = await Chat.findById(chatId);
        chat.participants.forEach((p) => sendToUser(p.toString(), {
          type: "message", message: populated,
        }));
        break;
      }

      // ── Typing indicator ──
      case "typing": {
        const { chatId } = data;
        const chat = await Chat.findById(chatId);
        chat.participants.forEach((p) => {
          if (p.toString() !== userId) {
            sendToUser(p.toString(), { type: "typing", chatId, userId });
          }
        });
        break;
      }

      // ── Message edit ──
      case "edit_message": {
        const { messageId, text } = data;
        const msg = await Message.findById(messageId);
        if (!msg || msg.sender.toString() !== userId) return;
        msg.text = text;
        msg.edited = true;
        await msg.save();
        const chat = await Chat.findById(msg.chatId);
        chat.participants.forEach((p) => sendToUser(p.toString(), {
          type: "edit_message", messageId, text, chatId: msg.chatId,
        }));
        break;
      }

      // ── Message delete ──
      case "delete_message": {
        const { messageId } = data;
        const msg = await Message.findById(messageId);
        if (!msg) return;
        // Only sender or group moderator/admin can delete
        const chat = await Chat.findById(msg.chatId);
        const isMember = chat.participants.some((p) => p.toString() === userId);
        const isOwner = msg.sender.toString() === userId;
        if (!isOwner && !isMember) return;
        msg.deleted = true;
        await msg.save();
        chat.participants.forEach((p) => sendToUser(p.toString(), {
          type: "delete_message", messageId, chatId: msg.chatId,
        }));
        break;
      }

      // ── Pin message ──
      case "pin_message": {
        const { messageId, chatId } = data;
        await Chat.findByIdAndUpdate(chatId, { pinnedMessageId: messageId });
        await Message.findByIdAndUpdate(messageId, { pinned: true });
        const chat = await Chat.findById(chatId);
        chat.participants.forEach((p) => sendToUser(p.toString(), {
          type: "pin_message", messageId, chatId,
        }));
        break;
      }

      // ── Voice call: WebRTC signaling ──
      case "webrtc_offer":
      case "webrtc_answer":
      case "webrtc_ice":
      case "call_end": {
        const { targetUserId } = data;
        sendToUser(targetUserId, {
          type: data.type,
          fromUserId: userId,
          data: data.data,
        });
        break;
      }

      // ── Voice channel join/leave ──
      case "voice_join": {
        const { groupId, channelId } = data;
        const group = await Group.findById(groupId);
        if (!group) return;
        const vc = group.voiceChannels.id(channelId);
        if (!vc) return;
        if (!vc.members.includes(userId)) vc.members.push(userId);
        await group.save();
        group.members.forEach((m) => sendToUser(m.toString(), {
          type: "voice_update", groupId, channelId, members: vc.members,
        }));
        break;
      }

      case "voice_leave": {
        const { groupId, channelId } = data;
        const group = await Group.findById(groupId);
        if (!group) return;
        const vc = group.voiceChannels.id(channelId);
        if (!vc) return;
        vc.members = vc.members.filter((m) => m.toString() !== userId);
        await group.save();
        group.members.forEach((m) => sendToUser(m.toString(), {
          type: "voice_update", groupId, channelId, members: vc.members,
        }));
        break;
      }

      // ── Voice channel WebRTC relay ──
      case "voice_signal": {
        const { groupId, channelId, targetUserId, signal } = data;
        sendToUser(targetUserId, {
          type: "voice_signal", groupId, channelId, fromUserId: userId, signal,
        });
        break;
      }
    }
  });

  ws.on("close", () => {
    const clients = onlineClients.get(userId);
    if (clients) {
      clients.delete(ws);
      if (clients.size === 0) {
        onlineClients.delete(userId);
        User.findByIdAndUpdate(userId, { lastSeen: new Date() }).exec();
        broadcastPresence(userId, "offline");
      }
    }
  });
});

function sendToUser(userId, payload) {
  const clients = onlineClients.get(userId);
  if (!clients) return;
  const msg = JSON.stringify(payload);
  clients.forEach((ws) => {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  });
}

function broadcastPresence(userId, status) {
  // Notify all friends
  User.findById(userId).then((user) => {
    if (!user) return;
    user.friends.forEach((f) => {
      sendToUser(f.toString(), { type: "presence", userId, status });
    });
  });
}

// ─── REST API: Auth ─────────────────────────────────────────

app.post("/api/register", async (req, res) => {
  const { login, name, password, confirmPassword } = req.body;
  if (!login || !name || !password) return res.status(400).json({ error: "Заполните все поля" });
  if (password !== confirmPassword) return res.status(400).json({ error: "Пароли не совпадают" });
  const exists = await User.findOne({ login });
  if (exists) return res.status(409).json({ error: "Логин занят" });
  const hash = await bcrypt.hash(password, 10);
  const user = await User.create({ login, name, password: hash });
  const token = generateToken(user._id);
  res.json({ token, user: sanitizeUser(user) });
});

app.post("/api/login", async (req, res) => {
  const { login, password, saveSession } = req.body;
  const user = await User.findOne({ login });
  if (!user) return res.status(401).json({ error: "Неверный логин или пароль" });
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: "Неверный логин или пароль" });
  const token = generateToken(user._id);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await Session.create({ userId: user._id, token, expiresAt });
  res.json({ token, user: sanitizeUser(user), saveSession: !!saveSession });
});

app.get("/api/me", authMiddleware, async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) return res.status(404).json({ error: "Not found" });
  res.json({ user: sanitizeUser(user) });
});

// ─── REST API: Profile ──────────────────────────────────────

app.put("/api/profile", authMiddleware, async (req, res) => {
  const { name, bio, email, avatar } = req.body;
  const update = {};
  if (name) update.name = name;
  if (bio !== undefined) update.bio = bio;
  if (email !== undefined) update.email = email;
  if (avatar !== undefined) update.avatar = avatar;
  const user = await User.findByIdAndUpdate(req.userId, update, { new: true });
  res.json({ user: sanitizeUser(user) });
});

app.put("/api/password", authMiddleware, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6)
    return res.status(400).json({ error: "Минимум 6 символов" });
  const hash = await bcrypt.hash(newPassword, 10);
  await User.findByIdAndUpdate(req.userId, { password: hash });
  res.json({ ok: true });
});

app.post("/api/upload", authMiddleware, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// ─── REST API: Friends ──────────────────────────────────────

app.post("/api/friends/request", authMiddleware, async (req, res) => {
  const { login } = req.body;
  const target = await User.findOne({ login });
  if (!target) return res.status(404).json({ error: "Пользователь не найден" });
  if (target._id.equals(req.userId)) return res.status(400).json({ error: "Нельзя добавить себя" });
  if (target.friendRequests.includes(req.userId))
    return res.status(400).json({ error: "Заявка уже отправлена" });
  if (target.friends.includes(req.userId))
    return res.status(400).json({ error: "Уже в друзьях" });
  target.friendRequests.push(req.userId);
  await target.save();
  const me = await User.findById(req.userId);
  me.friendRequestsSent.push(target._id);
  await me.save();
  sendToUser(target._id.toString(), { type: "friend_request", from: sanitizeUser(me) });
  res.json({ ok: true });
});

app.post("/api/friends/accept", authMiddleware, async (req, res) => {
  const { userId: fromId } = req.body;
  const me = await User.findById(req.userId);
  const from = await User.findById(fromId);
  if (!from) return res.status(404).json({ error: "Not found" });
  me.friendRequests = me.friendRequests.filter((r) => r.toString() !== fromId);
  me.friends.push(fromId);
  await me.save();
  from.friendRequestsSent = from.friendRequestsSent.filter((r) => r.toString() !== me._id.toString());
  from.friends.push(me._id);
  await from.save();
  // Create direct chat
  let chat = await Chat.findOne({
    type: "direct",
    participants: { $all: [me._id, fromId], $size: 2 },
  });
  if (!chat) {
    chat = await Chat.create({ type: "direct", participants: [me._id, fromId] });
  }
  sendToUser(fromId, { type: "friend_accepted", from: sanitizeUser(me) });
  res.json({ ok: true, chatId: chat._id });
});

app.post("/api/friends/decline", authMiddleware, async (req, res) => {
  const { userId: fromId } = req.body;
  await User.findByIdAndUpdate(req.userId, {
    $pull: { friendRequests: fromId },
  });
  await User.findByIdAndUpdate(fromId, {
    $pull: { friendRequestsSent: req.userId },
  });
  res.json({ ok: true });
});

app.get("/api/friends", authMiddleware, async (req, res) => {
  const me = await User.findById(req.userId).populate("friends friendRequests", "login name avatar lastSeen");
  res.json({
    friends: me.friends.map(sanitizeUser),
    requests: me.friendRequests.map(sanitizeUser),
  });
});

app.delete("/api/friends/:userId", authMiddleware, async (req, res) => {
  const targetId = req.params.userId;
  await User.findByIdAndUpdate(req.userId, { $pull: { friends: targetId } });
  await User.findByIdAndUpdate(targetId, { $pull: { friends: req.userId } });
  res.json({ ok: true });
});

// ─── REST API: Direct & Group Chats ─────────────────────────

app.get("/api/chats", authMiddleware, async (req, res) => {
  const chats = await Chat.find({ participants: req.userId })
    .populate("participants", "login name avatar lastSeen")
    .populate({
      path: "pinnedMessageId",
      populate: { path: "sender", select: "login name avatar" },
    });
  res.json({ chats });
});

app.get("/api/chats/:chatId/messages", authMiddleware, async (req, res) => {
  const { chatId } = req.params;
  const { limit = 50, before } = req.query;
  const filter = { chatId, deleted: false };
  if (before) filter.createdAt = { $lt: new Date(before) };
  const messages = await Message.find(filter)
    .sort({ createdAt: -1 })
    .limit(parseInt(limit))
    .populate("sender", "login name avatar")
    .populate("replyTo");
  res.json({ messages: messages.reverse() });
});

// ─── REST API: Groups ──────────────────────────────────────

app.post("/api/groups", authMiddleware, async (req, res) => {
  const { name, description, isPrivate } = req.body;
  const group = await Group.create({
    name, description, isPrivate: !!isPrivate,
    owner: req.userId,
    members: [req.userId],
    roles: [{
      name: "Owner", color: "#e74c3c",
      permissions: { post: true, delete: true, news: true, voice: true },
      members: [req.userId],
    }],
  });
  let chat = await Chat.create({
    type: "group", name, groupId: group._id, participants: [req.userId],
  });
  group.textChannels.push({ name: "general", accessRole: "all" });
  group.voiceChannels.push({ name: "General", members: [] });
  await group.save();
  res.json({ group, chat });
});

app.get("/api/groups", authMiddleware, async (req, res) => {
  const groups = await Group.find({
    $or: [{ isPrivate: false }, { members: req.userId }],
  }).populate("owner", "login name avatar");
  res.json({ groups });
});

app.get("/api/groups/:groupId", authMiddleware, async (req, res) => {
  const group = await Group.findById(req.params.groupId)
    .populate("members", "login name avatar lastSeen")
    .populate("owner", "login name avatar")
    .populate("joinRequests", "login name avatar");
  if (!group) return res.status(404).json({ error: "Not found" });
  res.json({ group });
});

app.post("/api/groups/:groupId/join", authMiddleware, async (req, res) => {
  const group = await Group.findById(req.params.groupId);
  if (!group) return res.status(404).json({ error: "Not found" });
  if (group.isPrivate) {
    if (!group.joinRequests.includes(req.userId)) {
      group.joinRequests.push(req.userId);
      await group.save();
    }
    return res.json({ status: "requested" });
  }
  if (!group.members.includes(req.userId)) {
    group.members.push(req.userId);
    await group.save();
  }
  res.json({ status: "joined", group });
});

app.post("/api/groups/:groupId/leave", authMiddleware, async (req, res) => {
  const group = await Group.findById(req.params.groupId);
  if (!group) return res.status(404).json({ error: "Not found" });
  group.members = group.members.filter((m) => m.toString() !== req.userId);
  await group.save();
  res.json({ ok: true });
});

app.put("/api/groups/:groupId", authMiddleware, async (req, res) => {
  const group = await Group.findById(req.params.groupId);
  if (!group) return res.status(404).json({ error: "Not found" });
  if (!group.owner.equals(req.userId) && !hasPermission(group, req.userId, "delete"))
    return res.status(403).json({ error: "Нет прав" });
  const { name, description, avatar, isPrivate } = req.body;
  if (name) group.name = name;
  if (description !== undefined) group.description = description;
  if (avatar !== undefined) group.avatar = avatar;
  if (isPrivate !== undefined) group.isPrivate = isPrivate;
  await group.save();
  res.json({ group });
});

app.delete("/api/groups/:groupId", authMiddleware, async (req, res) => {
  const group = await Group.findById(req.params.groupId);
  if (!group) return res.status(404).json({ error: "Not found" });
  if (!group.owner.equals(req.userId))
    return res.status(403).json({ error: "Только владелец может удалить группу" });
  await Chat.deleteMany({ groupId: group._id });
  await Group.deleteOne({ _id: group._id });
  res.json({ ok: true });
});

// ─── Group: Channels ───────────────────────────────────────

app.post("/api/groups/:groupId/channels", authMiddleware, async (req, res) => {
  const { name, type, accessRole } = req.body;
  const group = await Group.findById(req.params.groupId);
  if (!group) return res.status(404).json({ error: "Not found" });
  if (!group.owner.equals(req.userId) && !hasPermission(group, req.userId, "voice"))
    return res.status(403).json({ error: "Нет прав" });
  if (type === "voice") {
    group.voiceChannels.push({ name, members: [] });
  } else {
    group.textChannels.push({ name, accessRole: accessRole || "all" });
  }
  await group.save();
  res.json({ group });
});

// ─── Group: Roles & Members ───────────────────────────────

app.post("/api/groups/:groupId/roles", authMiddleware, async (req, res) => {
  const group = await Group.findById(req.params.groupId);
  if (!group) return res.status(404).json({ error: "Not found" });
  if (!group.owner.equals(req.userId))
    return res.status(403).json({ error: "Только владелец" });
  const { name, color, permissions } = req.body;
  group.roles.push({ name, color: color || "#99aab5", permissions: permissions || {} });
  await group.save();
  res.json({ group });
});

app.put("/api/groups/:groupId/members/:userId", authMiddleware, async (req, res) => {
  const group = await Group.findById(req.params.groupId);
  if (!group) return res.status(404).json({ error: "Not found" });
  if (!group.owner.equals(req.userId))
    return res.status(403).json({ error: "Нет прав" });
  const { roleId } = req.body;
  group.roles.forEach((r) => {
    r.members = r.members.filter((m) => m.toString() !== req.params.userId);
  });
  if (roleId) {
    const role = group.roles.id(roleId);
    if (role) role.members.push(req.params.userId);
  }
  await group.save();
  res.json({ group });
});

app.post("/api/groups/:groupId/join-requests/:userId/accept", authMiddleware, async (req, res) => {
  const group = await Group.findById(req.params.groupId);
  if (!group) return res.status(404).json({ error: "Not found" });
  if (!group.owner.equals(req.userId))
    return res.status(403).json({ error: "Нет прав" });
  group.joinRequests = group.joinRequests.filter((r) => r.toString() !== req.params.userId);
  if (!group.members.includes(req.params.userId)) group.members.push(req.params.userId);
  await group.save();
  res.json({ group });
});

function hasPermission(group, userId, perm) {
  if (group.owner.equals(userId)) return true;
  return group.roles.some((r) =>
    r.members.includes(userId) && r.permissions && r.permissions[perm]
  );
}

// ─── REST API: News Feed ───────────────────────────────────

app.get("/api/news", authMiddleware, async (req, res) => {
  const news = await News.find()
    .sort({ createdAt: -1 })
    .limit(50)
    .populate("author", "login name avatar")
    .populate("groupId", "name avatar");
  res.json({ news });
});

app.post("/api/news", authMiddleware, async (req, res) => {
  const { text, media, groupId } = req.body;
  const item = await News.create({
    author: req.userId, text: text || "", media: media || [],
    groupId: groupId || null,
  });
  const populated = await News.findById(item._id)
    .populate("author", "login name avatar")
    .populate("groupId", "name avatar");
  res.json({ news: populated });
});

// ─── REST API: Moderation ──────────────────────────────────

app.get("/api/moderation/violations", authMiddleware, async (req, res) => {
  const me = await User.findById(req.userId);
  if (me.globalRole !== "moderator" && me.globalRole !== "admin")
    return res.status(403).json({ error: "Нет доступа" });
  const violations = await Violation.find({ resolved: false })
    .populate("user", "login name avatar")
    .populate("reporter", "login name")
    .sort({ createdAt: -1 });
  res.json({ violations });
});

app.get("/api/moderation/muted", authMiddleware, async (req, res) => {
  const me = await User.findById(req.userId);
  if (me.globalRole !== "moderator" && me.globalRole !== "admin")
    return res.status(403).json({ error: "Нет доступа" });
  const muted = await User.find({
    isMuted: true,
    $or: [{ muteUntil: null }, { muteUntil: { $gt: new Date() } }],
  }).select("login name avatar muteReason muteUntil");
  res.json({ muted });
});

app.post("/api/moderation/mute", authMiddleware, async (req, res) => {
  const me = await User.findById(req.userId);
  if (me.globalRole !== "moderator" && me.globalRole !== "admin")
    return res.status(403).json({ error: "Нет доступа" });
  const { userId, reason, durationMinutes } = req.body;
  const muteUntil = durationMinutes
    ? new Date(Date.now() + durationMinutes * 60 * 1000)
    : null;
  await User.findByIdAndUpdate(userId, {
    isMuted: true, muteReason: reason || "Нарушение правил", muteUntil,
  });
  await Violation.create({ user: userId, reason, reporter: req.userId });
  sendToUser(userId, { type: "muted", reason, muteUntil });
  res.json({ ok: true });
});

app.post("/api/moderation/unmute", authMiddleware, async (req, res) => {
  const me = await User.findById(req.userId);
  if (me.globalRole !== "moderator" && me.globalRole !== "admin")
    return res.status(403).json({ error: "Нет доступа" });
  const { userId } = req.body;
  await User.findByIdAndUpdate(userId, { isMuted: false, muteReason: "", muteUntil: null });
  sendToUser(userId, { type: "unmuted" });
  res.json({ ok: true });
});

app.post("/api/moderation/role", authMiddleware, async (req, res) => {
  const me = await User.findById(req.userId);
  if (me.globalRole !== "admin")
    return res.status(403).json({ error: "Только админ" });
  const { userId, role } = req.body;
  await User.findByIdAndUpdate(userId, { globalRole: role });
  res.json({ ok: true });
});

app.get("/api/moderation/verification-requests", authMiddleware, async (req, res) => {
  const me = await User.findById(req.userId);
  if (me.globalRole !== "moderator" && me.globalRole !== "admin")
    return res.status(403).json({ error: "Нет доступа" });
  const groups = await Group.find({ verificationRequested: true, isVerified: false })
    .populate("owner", "login name avatar");
  res.json({ groups });
});

app.post("/api/groups/:groupId/request-verification", authMiddleware, async (req, res) => {
  const group = await Group.findById(req.params.groupId);
  if (!group) return res.status(404).json({ error: "Not found" });
  if (!group.owner.equals(req.userId))
    return res.status(403).json({ error: "Нет прав" });
  group.verificationRequested = true;
  await group.save();
  res.json({ ok: true });
});

app.post("/api/moderation/verify/:groupId", authMiddleware, async (req, res) => {
  const me = await User.findById(req.userId);
  if (me.globalRole !== "moderator" && me.globalRole !== "admin")
    return res.status(403).json({ error: "Нет доступа" });
  const group = await Group.findById(req.params.groupId);
  if (!group) return res.status(404).json({ error: "Not found" });
  group.isVerified = true;
  group.verificationRequested = false;
  await group.save();
  res.json({ ok: true });
});

// ─── Helper: sanitize user ─────────────────────────────────
function sanitizeUser(user) {
  if (!user) return null;
  const obj = user.toObject ? user.toObject() : user;
  delete obj.password;
  delete obj.friendRequests;
  delete obj.friendRequestsSent;
  return obj;
}

// ─── Health check ──────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", online: onlineClients.size, uptime: process.uptime() });
});

// ─── Static frontend (если HTML/CSS/JS лежит в /public) ────
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ─── Start ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[Server] Running on port ${PORT}`);
  console.log(`[WebSocket] ws://localhost:${PORT}/ws`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  server.close(() => {
    mongoose.connection.close(false, () => process.exit(0));
  });
});
