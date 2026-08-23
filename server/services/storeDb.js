const fs = require('fs');
const path = require('path');

/**
 * 自有门店库（方案A）：把"品牌×城市"的门店检索结果沉淀到本地，
 * /api/plan 优先查库，把地点搜索的 LBS 配额消耗降到接近零。
 * 数据由 scripts/sync-stores.js 定期（建议每周）同步写入。
 * 文件结构 server/data/stores.json:
 *   { "<store_query_hint>": { "syncedAt": ISO, "stores": [ {name,address,location,tel,poiId,city} ] } }
 */
const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'stores.json');
const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

let cache = { data: null, mtimeMs: 0 };

function load() {
  try {
    const stat = fs.statSync(DATA_FILE);
    if (cache.data && stat.mtimeMs === cache.mtimeMs) return cache.data;
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    cache = { data: parsed, mtimeMs: stat.mtimeMs };
    return parsed;
  } catch (e) {
    return {};
  }
}

function save(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  cache = { data: null, mtimeMs: 0 };
}

// "lng,lat" -> {latitude, longitude}
function parseLocation(location) {
  const [longitude, latitude] = String(location || '').split(',').map(Number);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return { latitude, longitude };
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * 查最近门店。库内无该品牌、或数据过期时返回 null（调用方降级到实时搜索）。
 * @returns {poiId, name, address, tel, location} | null
 */
function findNearestStore(keyword, originLocation, radius = 5000) {
  const origin = parseLocation(originLocation);
  if (!origin) return null;

  const entry = load()[keyword];
  if (!entry || !Array.isArray(entry.stores) || entry.stores.length === 0) return null;
  if (Date.now() - new Date(entry.syncedAt).getTime() > STALE_AFTER_MS) return null;

  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  entry.stores.forEach(store => {
    const point = parseLocation(store.location);
    if (!point) return;
    const distance = haversine(origin.latitude, origin.longitude, point.latitude, point.longitude);
    if (distance < bestDistance && distance <= radius) {
      bestDistance = distance;
      best = store;
    }
  });

  if (!best) return null;
  return {
    poiId: best.poiId,
    name: best.name,
    address: best.address || '',
    tel: best.tel || '',
    location: best.location
  };
}

/**
 * 同步脚本写入：keyword -> 城市门店列表（按城市合并进同一品牌条目）
 */
function upsert(keyword, city, stores, syncedAt) {
  const data = load();
  const existing = data[keyword] && Array.isArray(data[keyword].stores)
    ? data[keyword].stores.filter(store => store.city !== city)
    : [];
  data[keyword] = {
    syncedAt: syncedAt || new Date().toISOString(),
    stores: existing.concat(stores.map(store => Object.assign({ city }, store)))
  };
  save(data);
}

function allKeywords() {
  return Object.keys(load());
}

module.exports = { findNearestStore, upsert, allKeywords };
