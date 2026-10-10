/**
 * 聚推客联盟 CPS 转链服务。
 *
 * 密钥只保存在服务端；小程序只会收到经过白名单校验和归一化后的跳转数据。
 * 上游接口地址可通过 JUTUIKE_API_BASE 覆盖，确认聚推客支持 HTTPS 后应在部署环境中切换。
 */

const fetch = require('node-fetch');

const API_BASE = process.env.JUTUIKE_API_BASE || 'http://api.jutuike.com';
const APIKEY = process.env.JUTUIKE_APIKEY || '';
const PUB_ID = process.env.JUTUIKE_PUB_ID || '';
const REQUEST_TIMEOUT_MS = Number(process.env.CPS_TIMEOUT_MS || 8000);
const CACHE_TTL = 6 * 60 * 60 * 1000;

// 日常消费目录同时承担白名单作用，避免客户端传入任意活动 ID 或跳转目标。
const CPS_CATALOG = [
  { brand: '美团外卖', actId: 1, category: 'delivery', categoryName: '外卖', icon: '🥡', subtitle: '外卖红包与日常餐饮优惠' },
  { brand: '饿了么', actId: 3, category: 'delivery', categoryName: '外卖', icon: '🛵', subtitle: '外卖红包与配送优惠' },
  { brand: '美团到店', actId: 9, category: 'local', categoryName: '到店', icon: '📍', subtitle: '餐饮、休闲与到店团购优惠' },
  { brand: '星巴克', actId: 34, category: 'food', categoryName: '餐饮', icon: '☕', subtitle: '咖啡到店与外送活动' },
  { brand: '瑞幸咖啡', actId: 33, category: 'food', categoryName: '餐饮', icon: '🥤', subtitle: '咖啡饮品日常活动' },
  { brand: '喜茶', actId: 37, category: 'food', categoryName: '餐饮', icon: '🧋', subtitle: '茶饮到店与外送活动' },
  { brand: '肯德基', actId: 38, category: 'food', categoryName: '餐饮', icon: '🍗', subtitle: '快餐套餐与会员活动' },
  { brand: '必胜客', actId: 64, category: 'food', categoryName: '餐饮', icon: '🍕', subtitle: '披萨套餐与外送活动' },
  { brand: '奈雪的茶', actId: 32, category: 'food', categoryName: '餐饮', icon: '🍵', subtitle: '茶饮与烘焙日常活动' },
  { brand: '汉堡王', actId: 46, category: 'food', categoryName: '餐饮', icon: '🍔', subtitle: '汉堡套餐与会员活动' },
  { brand: '百果园', actId: 31, category: 'food', categoryName: '餐饮', icon: '🍎', subtitle: '水果到家与门店活动' },
  { brand: '滴滴打车', actId: 42, category: 'travel', categoryName: '出行', icon: '🚕', subtitle: '日常打车与出行活动' },
  { brand: '花小猪打车', actId: 49, category: 'travel', categoryName: '出行', icon: '🚗', subtitle: '日常打车优惠活动' },
  { brand: '电影票', actId: 76, category: 'fun', categoryName: '娱乐', icon: '🎬', subtitle: '电影票与影院活动' },
  { brand: '美团酒店', actId: 28, category: 'hotel', categoryName: '酒旅', icon: '🏨', subtitle: '酒店预订与出游活动' }
];

const BRAND_ACT_MAP = Object.fromEntries(CPS_CATALOG.map(item => [item.brand, item.actId]));
const CATALOG_BY_BRAND = new Map(CPS_CATALOG.map(item => [item.brand, item]));

// Map<actId, { data, expireAt }>
const cache = new Map();

function assertConfigured() {
  if (!APIKEY) {
    const error = new Error('CPS 服务尚未配置，请在服务端设置 JUTUIKE_APIKEY');
    error.code = 'CPS_NOT_CONFIGURED';
    throw error;
  }
}

function sanitizePath(path) {
  if (!path || typeof path !== 'string') return '';
  return path.replace(/^\/+/, '');
}

/**
 * 把上游字段归一化成小程序可直接消费的数据模型，同时保留旧 H5 使用的兼容字段。
 * @param {string} brand
 * @param {object} rawLink
 */
function normalizeLink(brand, rawLink) {
  const meta = CATALOG_BY_BRAND.get(brand);
  if (!meta || !rawLink) return null;

  const h5 = rawLink.h5 || rawLink.long_h5 || '';
  const appId = rawLink.app_id || '';
  const path = sanitizePath(rawLink.page_path);
  const jump = appId
    ? { type: 'mini_program', appId, path, envVersion: 'release' }
    : h5
      ? { type: 'copy', url: h5 }
      : null;

  if (!jump) return null;

  return {
    brand,
    actId: meta.actId,
    category: meta.category,
    categoryName: meta.categoryName,
    icon: meta.icon,
    title: rawLink.act_name || `${brand}日常优惠`,
    subtitle: meta.subtitle,
    disclosure: '推广 · 活动内容与价格以跳转后的页面为准',
    jump,
    fallback: h5 ? { type: 'copy', url: h5 } : null,
    verifiedAt: rawLink.verifiedAt,
    refreshAfter: rawLink.refreshAfter,

    // 兼容既有 H5 / uni-app 页面，后续迁移完成后可移除。
    act_id: meta.actId,
    act_name: rawLink.act_name || '',
    h5,
    long_h5: rawLink.long_h5 || '',
    miniCode: rawLink.miniCode || '',
    app_id: appId,
    page_path: path
  };
}

/**
 * 获取某个品牌的归一化 CPS 活动。
 * @param {string} brandName
 */
async function getBrandLink(brandName) {
  const actId = BRAND_ACT_MAP[brandName];
  if (!actId) return null;
  const rawLink = await getActLink(actId);
  return normalizeLink(brandName, rawLink);
}

/**
 * 通过活动 ID 获取推广链接，带 6 小时缓存和 8 秒默认超时。
 * @param {number} actId
 */
async function getActLink(actId) {
  assertConfigured();

  const cached = cache.get(actId);
  if (cached && cached.expireAt > Date.now()) {
    return cached.data;
  }

  const query = new URLSearchParams({
    apikey: APIKEY,
    sid: PUB_ID,
    act_id: String(actId)
  });
  const response = await fetch(`${API_BASE}/union/act?${query.toString()}`, {
    timeout: REQUEST_TIMEOUT_MS,
    headers: { Accept: 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`CPS 上游服务返回 ${response.status}`);
  }

  const json = await response.json();
  if (json.code !== 1 || !json.data) return null;

  const now = Date.now();
  const data = {
    act_id: actId,
    act_name: json.data.act_name || '',
    h5: json.data.h5 || json.data.long_h5 || '',
    long_h5: json.data.long_h5 || '',
    miniCode: json.data.we_app_info?.miniCode || '',
    app_id: json.data.we_app_info?.app_id || '',
    page_path: json.data.we_app_info?.page_path || '',
    verifiedAt: new Date(now).toISOString(),
    refreshAfter: new Date(now + CACHE_TTL).toISOString()
  };

  cache.set(actId, { data, expireAt: now + CACHE_TTL });
  return data;
}

/**
 * 批量获取品牌活动。单个上游活动失败不会拖垮整个频道。
 * @param {string[]} brandNames
 */
async function getBatchLinks(brandNames) {
  assertConfigured();
  const tasks = brandNames.map(async brand => {
    try {
      return await getBrandLink(brand);
    } catch (error) {
      console.error('[cps] activity_fetch_failed', {
        brand,
        message: error.message,
        code: error.code || 'UPSTREAM_ERROR'
      });
      return null;
    }
  });

  const settled = await Promise.all(tasks);
  return settled.filter(Boolean);
}

function getAvailableBrands() {
  return CPS_CATALOG.map(item => ({ ...item, act_id: item.actId }));
}

function getCategories() {
  const seen = new Set();
  return CPS_CATALOG.reduce((list, item) => {
    if (!seen.has(item.category)) {
      seen.add(item.category);
      list.push({ key: item.category, name: item.categoryName });
    }
    return list;
  }, []);
}

module.exports = {
  getBrandLink,
  getActLink,
  getBatchLinks,
  getAvailableBrands,
  getCategories,
  BRAND_ACT_MAP,
  CPS_CATALOG
};
