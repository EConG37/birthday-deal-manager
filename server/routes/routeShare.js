const express = require('express');
const router = express.Router();
const routeShare = require('../services/routeShare');

/**
 * GET /api/route/:id
 * 读取分享的路线快照（不含 birthday 等隐私字段）
 */
router.get('/:id', (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[a-f0-9]{36}$/.test(id)) {
    return res.status(400).json({ error: '分享链接无效' });
  }
  const shared = routeShare.get(id);
  if (!shared) {
    return res.status(404).json({ error: '分享的路线已过期，可重新生成一条' });
  }
  res.json({ success: true, route: shared });
});

module.exports = router;
