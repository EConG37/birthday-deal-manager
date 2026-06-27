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

module.exports = router;
