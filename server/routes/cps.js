const crypto = require('crypto');
const express = require('express');
const cps = require('../services/cps');

const router = express.Router();
const ALLOWED_EVENTS = new Set([
  'impression',
  'click',
  'jump_success',
  'jump_fail',
  'copy_success',
  'copy_fail'
]);
const rateBuckets = new Map();

// 不引入新依赖的轻量限流。它适用于当前单实例部署，未来扩容时应替换为共享存储限流。
router.use((req, res, next) => {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const bucket = rateBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + 60 * 1000 });
    if (rateBuckets.size > 5000) {
      for (const [bucketKey, value] of rateBuckets) {
        if (value.resetAt <= now) rateBuckets.delete(bucketKey);
      }
    }
    return next();
  }

  bucket.count += 1;
  if (bucket.count > 120) {
    return res.status(429).json({ success: false, error: '请求太频繁，请稍后再试' });
  }
  return next();
});

function getRequestedBrands(queryValue) {
  const allowed = new Set(cps.getAvailableBrands().map(item => item.brand));
  if (!queryValue) return Array.from(allowed);

  return String(queryValue)
    .split(',')
    .map(brand => brand.trim())
    .filter(brand => allowed.has(brand));
}

function sendServerError(res, error) {
  const notConfigured = error.code === 'CPS_NOT_CONFIGURED';
  const status = notConfigured ? 503 : 500;
  console.error('[cps] request_failed', {
    code: error.code || 'CPS_REQUEST_FAILED',
    message: error.message
  });
  res.status(status).json({
    success: false,
    error: notConfigured ? '优惠服务正在配置中，请稍后再试' : '优惠服务暂时不可用，请稍后再试'
  });
}

/**
 * GET /api/cps/links?brands=星巴克,瑞幸咖啡
 * 获取日常消费频道的归一化活动列表。
 */
router.get('/links', async (req, res) => {
  try {
    const brands = getRequestedBrands(req.query.brands);
    const links = await cps.getBatchLinks(brands);
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    res.json({
      success: true,
      count: links.length,
      categories: cps.getCategories(),
      links
    });
  } catch (error) {
    sendServerError(res, error);
  }
});

/**
 * GET /api/cps/link/:brand
 * 获取单品牌活动，仅接受服务端目录中的白名单品牌。
 */
router.get('/link/:brand', async (req, res) => {
  try {
    const brand = decodeURIComponent(req.params.brand);
    const link = await cps.getBrandLink(brand);
    if (!link) {
      return res.status(404).json({ success: false, error: '暂未找到该品牌的可用活动' });
    }
    return res.json({ success: true, ...link });
  } catch (error) {
    return sendServerError(res, error);
  }
});

/**
 * GET /api/cps/brands
 * 返回频道目录，不包含密钥或任意第三方跳转地址。
 */
router.get('/brands', (req, res) => {
  res.json({
    success: true,
    categories: cps.getCategories(),
    brands: cps.getAvailableBrands()
  });
});

/**
 * POST /api/cps/events
 * 记录匿名的频道曝光与跳转结果。这里记录的是“跳转”，不是订单或佣金到账。
 */
router.post('/events', (req, res) => {
  const event = req.body && req.body.event;
  const brand = req.body && req.body.brand ? String(req.body.brand).slice(0, 40) : '';
  const category = req.body && req.body.category ? String(req.body.category).slice(0, 30) : '';
  const reason = req.body && req.body.reason ? String(req.body.reason).slice(0, 120) : '';
  const allowedBrands = new Set(cps.getAvailableBrands().map(item => item.brand));

  if (!ALLOWED_EVENTS.has(event)) {
    return res.status(400).json({ success: false, error: '无效的事件类型' });
  }
  if (brand && !allowedBrands.has(brand)) {
    return res.status(400).json({ success: false, error: '无效的品牌' });
  }

  const eventId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  console.log(JSON.stringify({
    type: 'cps_event',
    eventId,
    event,
    brand,
    category,
    reason,
    occurredAt: new Date().toISOString()
  }));

  return res.status(202).json({ success: true, eventId });
});

module.exports = router;
