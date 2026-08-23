const express = require('express');
const router = express.Router();
const wishesService = require('../services/wishes');

// 发布限流：单 IP 每分钟最多 5 条，防刷墙
const POST_LIMIT_PER_MIN = 5;
const postTimesByIp = new Map();

function allowPost(ip) {
  const now = Date.now();
  const times = (postTimesByIp.get(ip) || []).filter(t => now - t < 60 * 1000);
  if (times.length >= POST_LIMIT_PER_MIN) {
    postTimesByIp.set(ip, times);
    return false;
  }
  times.push(now);
  postTimesByIp.set(ip, times);
  return true;
}

setInterval(() => {
  const now = Date.now();
  postTimesByIp.forEach((times, ip) => {
    const alive = times.filter(t => now - t < 60 * 1000);
    if (alive.length === 0) postTimesByIp.delete(ip);
    else postTimesByIp.set(ip, alive);
  });
}, 60 * 1000).unref();

/**
 * POST /api/wishes
 * 入参: { uid: "匿名id", text: "心愿", birthday: "12-15", city: "上海" }
 * 出参: { success, status: 'published' | 'rejected', wish?, reason? }
 */
router.post('/', async (req, res) => {
  const { uid, text, birthday, city } = req.body || {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: '心愿内容不能为空' });
  }
  if (!allowPost(req.ip)) {
    return res.status(429).json({ error: '发布太频繁了，稍后再试' });
  }

  try {
    const result = await wishesService.addWish({ uid, text, birthday, city });
    if (result.error) return res.status(400).json({ error: result.error });
    if (result.rejected) {
      return res.json({ success: true, status: 'rejected', reason: result.reason });
    }
    res.json({ success: true, status: 'published', wish: result.wish });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/wishes?limit=30&uid=xxx（uid 用于标记哪些是自己发的）
 * 出参: { success, wishes: [...] }
 */
router.get('/', (req, res) => {
  try {
    const wishes = wishesService.listWishes({
      limit: req.query.limit,
      uid: req.query.uid,
      birthday: req.query.birthday
    });
    res.json({ success: true, wishes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
