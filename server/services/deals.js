const fs = require('fs');
const path = require('path');

let dealsCache = null;

/**
 * 读取优惠种子数据（JSONL格式）
 */
function loadDeals() {
  if (dealsCache) return dealsCache;

  const jsonlPath = path.join(__dirname, '..', 'data', 'deals.jsonl');
  const content = fs.readFileSync(jsonlPath, 'utf-8');
  dealsCache = content
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
  return dealsCache;
}

/**
 * 按生日日期 + 城市过滤优惠
 * birthday: "MM-DD" 格式，如 "12-15"
 * city: 城市名，如 "上海"
 */
function filterDeals(birthday, city) {
  const deals = loadDeals();

  return deals.filter(deal => {
    // 只取线下品牌（is_online: false）
    if (deal.is_online) return false;

    // 城市过滤
    if (deal.store_coverage !== 'all_cities') {
      if (Array.isArray(deal.store_coverage) && !deal.store_coverage.includes(city)) {
        return false;
      }
    }

    // 生日窗口过滤（简化：全部返回，因为valid_window包含birthday_day/month等，实际使用时用户生日当天都能用）
    // birthday_day: 生日当天
    // birthday_month: 生日当月
    // birthday_minus7_to_plus7: 生日前后7天
    // 这里不做严格过滤，全部返回，让前端展示时标注有效窗口

    return true;
  });
}

/**
 * 获取线上优惠（单独展示）
 */
function getOnlineDeals() {
  const deals = loadDeals();
  return deals.filter(deal => deal.is_online);
}

module.exports = { loadDeals, filterDeals, getOnlineDeals };
