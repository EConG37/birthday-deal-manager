const express = require('express');
const router = express.Router();

/**
 * 生辰局 · 同城同日生日匹配
 * 
 * 存储：内存 Map（进程重启会清空，初赛 Demo 够用）
 * 身份：前端 localStorage 存 userId，无需登录
 * 
 * 数据结构：
 * users = Map<userId, {
 *   userId, nickname, avatarColor, birthday, city,
 *   routeCount, currentStop, createdAt, lastActiveAt
 * }>
 */

const users = new Map();
const AVATAR_COLORS = ['#FF6B35', '#E63946', '#2A9D8F', '#C9962E', '#7B4F3A', '#5B7553', '#D4A574', '#A0522D'];

/**
 * POST /api/squad/join
 * 注册/更新用户信息，返回匹配到的队友列表
 * 
 * Body: { userId, nickname, birthday, city, routeCount?, currentStop? }
 * Response: { userId, teammates: [...] }
 */
router.post('/join', (req, res) => {
  const { userId, nickname, birthday, city, routeCount, currentStop } = req.body;

  if (!nickname || !birthday || !city) {
    return res.status(400).json({ error: '缺少必要参数：nickname, birthday, city' });
  }

  const uid = userId || ('u_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));
  const now = Date.now();

  // 更新或创建用户
  const existing = users.get(uid) || {};
  const user = {
    userId: uid,
    nickname: nickname.trim().substring(0, 20),
    avatarColor: existing.avatarColor || AVATAR_COLORS[users.size % AVATAR_COLORS.length],
    birthday,
    city: city.replace(/市$/, ''),
    routeCount: routeCount != null ? routeCount : (existing.routeCount || 0),
    currentStop: currentStop || (existing.currentStop || ''),
    createdAt: existing.createdAt || now,
    lastActiveAt: now
  };
  users.set(uid, user);

  // 匹配同城同生日的其他用户（排除自己，最近7天活跃过）
  const teammates = [];
  for (const [id, u] of users) {
    if (id === uid) continue;
    if (u.birthday === birthday && u.city === user.city && (now - u.lastActiveAt) < 7 * 24 * 60 * 60 * 1000) {
      teammates.push({
        userId: u.userId,
        nickname: u.nickname,
        avatarColor: u.avatarColor,
        birthday: u.birthday,
        city: u.city,
        routeCount: u.routeCount,
        currentStop: u.currentStop,
        isOnline: (now - u.lastActiveAt) < 30 * 60 * 1000 // 30分钟内活跃算在线
      });
    }
  }

  // 按最后活跃时间排序
  teammates.sort((a, b) => b.lastActiveAt - a.lastActiveAt);

  res.json({
    userId: uid,
    nickname: user.nickname,
    avatarColor: user.avatarColor,
    teammates: teammates.slice(0, 12) // 最多返回12个队友
  });
});

/**
 * GET /api/squad/match?birthday=MM-DD&city=上海
 * 查询匹配的队友（不注册，只查询）
 */
router.get('/match', (req, res) => {
  const { birthday, city } = req.query;
  if (!birthday || !city) {
    return res.status(400).json({ error: '缺少参数：birthday, city' });
  }

  const cleanCity = city.replace(/市$/, '');
  const now = Date.now();
  const teammates = [];

  for (const [id, u] of users) {
    if (u.birthday === birthday && u.city === cleanCity && (now - u.lastActiveAt) < 7 * 24 * 60 * 60 * 1000) {
      teammates.push({
        userId: u.userId,
        nickname: u.nickname,
        avatarColor: u.avatarColor,
        birthday: u.birthday,
        city: u.city,
        routeCount: u.routeCount,
        currentStop: u.currentStop,
        isOnline: (now - u.lastActiveAt) < 30 * 60 * 1000
      });
    }
  }

  res.json({
    count: teammates.length,
    teammates: teammates.slice(0, 12)
  });
});

/**
 * POST /api/squad/update
 * 更新用户打卡进度
 * 
 * Body: { userId, routeCount?, currentStop? }
 */
router.post('/update', (req, res) => {
  const { userId, routeCount, currentStop } = req.body;
  if (!userId) return res.status(400).json({ error: '缺少 userId' });

  const user = users.get(userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  if (routeCount != null) user.routeCount = routeCount;
  if (currentStop != null) user.currentStop = currentStop;
  user.lastActiveAt = Date.now();

  res.json({ success: true });
});

// ============================================================
// 房间制生辰局（小程序专用，基于微信生态）
// 
// 数据结构：
// rooms = Map<roomId, {
//   roomId, roomCode, leaderId, leaderName, leaderAvatar,
//   birthday, city, routeSummary, routeCount,
//   members: [{ userId, nickname, avatar, joinedAt, routeCount, currentStop }],
//   createdAt, expireAt
// }>
// ============================================================

const rooms = new Map();
const ROOM_TTL = 7 * 24 * 60 * 60 * 1000; // 房间7天过期

function genRoomCode() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

function genRoomId() {
  return 'r_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
}

function getRoomPublicInfo(room) {
  const now = Date.now();
  return {
    roomId: room.roomId,
    roomCode: room.roomCode,
    leaderName: room.leaderName,
    leaderAvatar: room.leaderAvatar,
    birthday: room.birthday,
    city: room.city,
    routeSummary: room.routeSummary,
    routeCount: room.routeCount,
    memberCount: room.members.length,
    members: room.members.map(m => ({
      userId: m.userId,
      nickname: m.nickname,
      avatar: m.avatar,
      routeCount: m.routeCount,
      currentStop: m.currentStop,
      isLeader: m.userId === room.leaderId,
      isOnline: (now - m.lastActiveAt) < 30 * 60 * 1000,
      joinedAt: m.joinedAt
    })),
    createdAt: room.createdAt,
    expireAt: room.expireAt
  };
}

/**
 * POST /api/squad/room/create
 * 创建生日局房间（发起人调用）
 * 
 * Body: { userId, nickname, avatar, birthday, city, routeSummary?, routeCount? }
 * Response: { roomId, roomCode, ...roomInfo }
 */
router.post('/room/create', (req, res) => {
  const { userId, nickname, avatar, birthday, city, routeSummary, routeCount } = req.body;

  if (!nickname || !birthday || !city) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  const now = Date.now();
  const roomId = genRoomId();
  const uid = userId || ('wx_' + now + '_' + Math.random().toString(36).substr(2, 6));

  const room = {
    roomId,
    roomCode: genRoomCode(),
    leaderId: uid,
    leaderName: nickname.trim().substring(0, 20),
    leaderAvatar: avatar || '',
    birthday,
    city: city.replace(/市$/, ''),
    routeSummary: routeSummary || '',
    routeCount: routeCount || 0,
    members: [{
      userId: uid,
      nickname: nickname.trim().substring(0, 20),
      avatar: avatar || '',
      routeCount: routeCount || 0,
      currentStop: '',
      joinedAt: now,
      lastActiveAt: now
    }],
    createdAt: now,
    expireAt: now + ROOM_TTL
  };

  rooms.set(roomId, room);
  res.json({ roomId, userId: uid, ...getRoomPublicInfo(room) });
});

/**
 * POST /api/squad/room/join
 * 加入生日局房间（通过分享链接/小程序码加入）
 * 
 * Body: { roomId, userId, nickname, avatar }
 * Response: { userId, ...roomInfo }
 */
router.post('/room/join', (req, res) => {
  const { roomId, roomCode, userId, nickname, avatar } = req.body;

  if (!nickname) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  // 支持 roomId 或 roomCode 查找房间
  let room = null;
  if (roomId) {
    room = rooms.get(roomId);
  } else if (roomCode) {
    for (const [id, r] of rooms) {
      if (r.roomCode === roomCode.toUpperCase()) {
        room = r;
        break;
      }
    }
  }

  if (!room) return res.status(404).json({ error: '房间不存在或邀请码无效' });
  if (Date.now() > room.expireAt) {
    rooms.delete(room.roomId);
    return res.status(404).json({ error: '房间已过期' });
  }

  const now = Date.now();
  const uid = userId || ('wx_' + now + '_' + Math.random().toString(36).substr(2, 6));

  // 检查是否已加入
  let member = room.members.find(m => m.userId === uid);
  if (!member) {
    // 新成员加入
    member = {
      userId: uid,
      nickname: nickname.trim().substring(0, 20),
      avatar: avatar || '',
      routeCount: 0,
      currentStop: '',
      joinedAt: now,
      lastActiveAt: now
    };
    room.members.push(member);
  } else {
    member.lastActiveAt = now;
    if (avatar) member.avatar = avatar;
  }

  res.json({ userId: uid, ...getRoomPublicInfo(room) });
});

/**
 * GET /api/squad/room/info?roomId=xxx
 * 查询房间信息（进入小程序时调用）
 */
router.get('/room/info', (req, res) => {
  const { roomId } = req.query;
  if (!roomId) return res.status(400).json({ error: '缺少 roomId' });

  const room = rooms.get(roomId);
  if (!room) return res.status(404).json({ error: '房间不存在或已过期' });
  if (Date.now() > room.expireAt) {
    rooms.delete(roomId);
    return res.status(404).json({ error: '房间已过期' });
  }

  res.json(getRoomPublicInfo(room));
});

/**
 * POST /api/squad/room/heartbeat
 * 心跳：更新成员在线状态和进度
 * 
 * Body: { roomId, userId, routeCount?, currentStop? }
 */
router.post('/room/heartbeat', (req, res) => {
  const { roomId, userId, routeCount, currentStop } = req.body;
  if (!roomId || !userId) return res.status(400).json({ error: '缺少参数' });

  const room = rooms.get(roomId);
  if (!room) return res.status(404).json({ error: '房间不存在' });

  const member = room.members.find(m => m.userId === userId);
  if (!member) return res.status(404).json({ error: '不在房间中' });

  member.lastActiveAt = Date.now();
  if (routeCount != null) member.routeCount = routeCount;
  if (currentStop != null) member.currentStop = currentStop;

  res.json({ success: true, ...getRoomPublicInfo(room) });
});

/**
 * GET /api/squad/room/list?userId=xxx
 * 查询用户参与的所有房间
 */
router.get('/room/list', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.json({ rooms: [] });

  const now = Date.now();
  const myRooms = [];
  for (const [id, room] of rooms) {
    if (now > room.expireAt) {
      rooms.delete(id);
      continue;
    }
    if (room.members.some(m => m.userId === userId)) {
      myRooms.push(getRoomPublicInfo(room));
    }
  }

  myRooms.sort((a, b) => b.createdAt - a.createdAt);
  res.json({ rooms: myRooms });
});

module.exports = router;
