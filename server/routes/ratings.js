const express = require('express');
const router = express.Router();
const ratingsService = require('../services/ratings');

// 轻量限流：单 IP 每分钟最多提交 10 条评价，防止刷分
const POST_LIMIT_PER_MIN = 10;
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
 * POST /api/ratings
 * 入参: { brand: "海底捞", score: 1-5, poi_id?, comment? }
 * 出参: { success, count, average }
 */
router.post('/', (req, res) => {
  const { brand, poi_id, score, comment } = req.body || {};
  const normalizedScore = Number(score);

  if (!brand || typeof brand !== 'string') {
    return res.status(400).json({ error: '缺少品牌参数' });
  }
  if (!Number.isInteger(normalizedScore) || normalizedScore < 1 || normalizedScore > 5) {
    return res.status(400).json({ error: '评分需为 1-5 的整数' });
  }
  if (!allowPost(req.ip)) {
    return res.status(429).json({ error: '评价太频繁了，稍后再试' });
  }

  try {
    const summary = ratingsService.addRating({
      brand,
      poiId: poi_id,
      score: normalizedScore,
      comment
    });
    res.json({ success: true, count: summary.count, average: summary.average });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/ratings?brands=海底捞,喜茶
 * 出参: { success, ratings: { 品牌: {count, average} } }
 */
router.get('/', (req, res) => {
  const brands = String(req.query.brands || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 20);
  res.json({ success: true, ratings: ratingsService.getSummaries(brands) });
});

module.exports = router;
