const express = require('express');
const router = express.Router();
const dealsService = require('../services/deals');

// 地图组件/省市区选择器返回"上海市"，种子数据里是"上海"，统一去掉行政后缀
function normalizeCity(city) {
  return String(city || '')
    .replace(/(壮族自治区|回族自治区|维吾尔自治区|自治区|省|市)$/, '');
}

/**
 * GET /api/deals?birthday=12-15&city=上海市
 * 打卡页数据源：当前城市可用的线下品牌权益 + 线上平台权益
 */
router.get('/', (req, res) => {
  const birthday = String(req.query.birthday || '');
  const city = normalizeCity(req.query.city);
  if (!birthday || !city) {
    return res.status(400).json({ error: '缺少 birthday / city 参数' });
  }
  if (!/^\d{2}-\d{2}$/.test(birthday)) {
    return res.status(400).json({ error: 'birthday 需为 MM-DD 格式' });
  }

  try {
    const offline = dealsService.filterDeals(birthday, city);
    const online = dealsService.getOnlineDeals();
    const deals = offline.map(deal => ({
      brand: deal.brand,
      perk_title: deal.perk_title,
      perk_detail: deal.perk_detail,
      estimated_value: deal.estimated_value,
      claim_method: deal.claim_method,
      need_member: deal.need_member,
      valid_window: deal.valid_window,
      meal_slot: deal.meal_slot
    }));
    const onlineDeals = online.map(deal => ({
      brand: deal.brand,
      perk_title: deal.perk_title,
      perk_detail: deal.perk_detail,
      estimated_value: deal.estimated_value,
      claim_method: deal.claim_method
    }));
    const totalValue = deals.reduce((sum, deal) => sum + Number(deal.estimated_value || 0), 0);
    res.json({
      success: true,
      city: city,
      deals: deals,
      online_deals: onlineDeals,
      total_estimated_value: totalValue,
      generated_at: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
