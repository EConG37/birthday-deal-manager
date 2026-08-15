const fs = require('fs');
const path = require('path');

/**
 * 用户打卡评价（自有评分数据，替代高德/点评的第三方评分）。
 * 内存为主、data/ratings.json 落盘兜底：本地/单实例重启不丢，
 * 多实例或重新部署后需要迁到正式数据库（云开发/Redis，见 doc 13）。
 */
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'ratings.json');
const MAX_ENTRIES = 10000;
const FLUSH_DELAY_MS = 3000;

let ratings = [];
let loaded = false;
let flushTimer = null;

function load() {
  if (loaded) return;
  try {
    ratings = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!Array.isArray(ratings)) ratings = [];
  } catch (e) {
    ratings = [];
  }
  loaded = true;
}

function flushSoon() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(ratings));
    } catch (e) {
      console.log('[评价服务] 落盘失败:', e.message);
    }
  }, FLUSH_DELAY_MS);
}

function summaryOf(brand) {
  const entries = ratings.filter(entry => entry.brand === brand);
  if (entries.length === 0) return { count: 0, average: 0 };
  const total = entries.reduce((sum, entry) => sum + entry.score, 0);
  return {
    count: entries.length,
    average: Math.round((total / entries.length) * 10) / 10
  };
}

/**
 * 新增一条评价
 * @returns 该品牌的聚合 {count, average}
 */
function addRating({ brand, poiId, score, comment }) {
  load();
  ratings.push({
    brand: brand,
    poi_id: poiId || '',
    score: Number(score),
    comment: String(comment || '').slice(0, 200),
    ts: Date.now()
  });
  if (ratings.length > MAX_ENTRIES) {
    ratings = ratings.slice(ratings.length - MAX_ENTRIES);
  }
  flushSoon();
  return summaryOf(brand);
}

/**
 * 批量查询品牌聚合分
 * @returns { 品牌: {count, average} }
 */
function getSummaries(brands) {
  load();
  const result = {};
  (brands || []).forEach(brand => {
    if (brand) result[brand] = summaryOf(brand);
  });
  return result;
}

module.exports = { addRating, getSummaries };
