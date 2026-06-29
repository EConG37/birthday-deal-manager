const express = require('express');
const router = express.Router();
const cps = require('../services/cps');

/**
 * GET /api/cps/links
 * 获取所有品牌的 CPS 推广链接
 * 可选参数 ?brands=星巴克,瑞幸咖啡,喜茶
 */
router.get('/links', async (req, res) => {
  try {
    let brands = cps.getAvailableBrands().map(b => b.brand);
    
    // 支持按品牌名筛选
    if (req.query.brands) {
      const requested = req.query.brands.split(',').map(b => b.trim());
      brands = brands.filter(b => requested.includes(b));
    }

    const links = await cps.getBatchLinks(brands);
    res.json({
      success: true,
      count: links.length,
      links: links
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/cps/link/:brand
 * 获取单个品牌的 CPS 推广链接
 */
router.get('/link/:brand', async (req, res) => {
  try {
    const link = await cps.getBrandLink(req.params.brand);
    if (!link) {
      return res.status(404).json({ error: '未找到该品牌的CPS活动' });
    }
    res.json({ success: true, brand: req.params.brand, ...link });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/cps/brands
 * 获取所有可用品牌列表
 */
router.get('/brands', (req, res) => {
  res.json({
    success: true,
    brands: cps.getAvailableBrands()
  });
});

module.exports = router;
