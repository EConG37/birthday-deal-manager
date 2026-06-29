/**
 * 聚推客联盟 CPS 转链服务
 * 
 * 接口文档: https://www.jutuike.com/doc/48
 * 统一转链接口: http://api.jutuike.com/union/act
 * 
 * 缓存策略: 转链结果缓存 6 小时，减少 API 调用
 */

const API_BASE = 'http://api.jutuike.com';
const APIKEY = process.env.JUTUIKE_APIKEY || '';
const PUB_ID = process.env.JUTUIKE_PUB_ID || '';

// 品牌 → 聚推客活动ID 映射
const BRAND_ACT_MAP = {
  '星巴克': 34,
  '瑞幸咖啡': 33,
  '喜茶': 37,
  '肯德基': 38,
  '必胜客': 64,
  '奈雪的茶': 32,
  '汉堡王': 46,
  '美团外卖': 1,
  '饿了么': 3,
  '美团到店': 9,
  '滴滴打车': 42,
  '花小猪打车': 49,
  '电影票': 76,
  '美团酒店': 28,
  '百果园': 31
};

// 缓存: Map<act_id, { data, expireAt }>
const cache = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6小时

/**
 * 获取某个品牌的 CPS 推广链接
 * @param {string} brandName - 品牌名（中文）
 * @returns {Promise<{h5, miniCode, act_name}|null>}
 */
async function getBrandLink(brandName) {
  const actId = BRAND_ACT_MAP[brandName];
  if (!actId) return null;
  return await getActLink(actId);
}

/**
 * 通过 act_id 获取推广链接（带缓存）
 */
async function getActLink(actId) {
  // 检查缓存
  const cached = cache.get(actId);
  if (cached && cached.expireAt > Date.now()) {
    return cached.data;
  }

  // 调用聚推客转链接口
  const url = `${API_BASE}/union/act?apikey=${APIKEY}&sid=${PUB_ID}&act_id=${actId}`;
  const res = await fetch(url);
  const json = await res.json();

  if (json.code !== 1 || !json.data) {
    return null;
  }

  const data = {
    act_id: actId,
    act_name: json.data.act_name || '',
    h5: json.data.h5 || json.data.long_h5 || '',
    long_h5: json.data.long_h5 || '',
    miniCode: json.data.we_app_info?.miniCode || '',
    app_id: json.data.we_app_info?.app_id || '',
    page_path: json.data.we_app_info?.page_path || ''
  };

  // 写入缓存
  cache.set(actId, { data, expireAt: Date.now() + CACHE_TTL });

  return data;
}

/**
 * 批量获取所有品牌的 CPS 链接
 * @param {string[]} brandNames - 品牌名数组
 * @returns {Promise<Array<{brand, act_id, h5, miniCode, act_name}>>}
 */
async function getBatchLinks(brandNames) {
  const results = [];
  const tasks = brandNames.map(async (brand) => {
    const actId = BRAND_ACT_MAP[brand];
    if (!actId) return null;
    try {
      const link = await getActLink(actId);
      if (link) {
        return { brand, ...link };
      }
    } catch (e) {
      // 单个品牌失败不影响其他
    }
    return null;
  });

  const settled = await Promise.all(tasks);
  for (const item of settled) {
    if (item) results.push(item);
  }
  return results;
}

/**
 * 获取所有可用的品牌列表
 */
function getAvailableBrands() {
  return Object.keys(BRAND_ACT_MAP).map(brand => ({
    brand,
    act_id: BRAND_ACT_MAP[brand]
  }));
}

module.exports = {
  getBrandLink,
  getActLink,
  getBatchLinks,
  getAvailableBrands,
  BRAND_ACT_MAP
};
