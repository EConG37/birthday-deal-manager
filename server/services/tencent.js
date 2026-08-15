const fetch = require('node-fetch');

const TENCENT_LBS_KEY = process.env.TENCENT_LBS_KEY;
const BASE = 'https://apis.map.qq.com/ws';

/**
 * 腾讯位置服务 WebService API 适配层（替代原高德服务）。
 *
 * 坐标约定：
 * - 腾讯与高德、微信小程序 map 组件同为 GCJ-02 坐标系，坐标数值可直接互换；
 * - 但腾讯接口的坐标顺序一律「纬度在前」（lat,lng），本项目对外契约沿用
 *   「经度在前」的 "lng,lat" 字符串，顺序转换统一收敛在下面的工具函数里。
 * - 成功判定为 status === 0（腾讯惯例，区别于高德的字符串 '1'）。
 */

// "lng,lat" -> {latitude, longitude}，非法输入返回 null
function toTencentCoord(location) {
  const [longitude, latitude] = String(location || '').split(',').map(Number);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return { latitude, longitude };
}

// {lat, lng} -> "lng,lat"，字段缺失返回 null
function fromTencentLocation(location) {
  if (!location) return null;
  const lat = Number(location.lat);
  const lng = Number(location.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return `${lng},${lat}`;
}

async function callTencent(path, params) {
  if (!TENCENT_LBS_KEY) {
    throw new Error('TENCENT_LBS_KEY 未配置，请在 .env 中填入腾讯位置服务 WebService key');
  }
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  const res = await fetch(`${BASE}${path}?${query}&key=${TENCENT_LBS_KEY}`);
  const data = await res.json();
  if (data.status !== 0) {
    throw new Error(`腾讯位置服务请求失败(${data.status}): ${data.message || '未知错误'}`);
  }
  return data;
}

function toPoi(p) {
  return {
    id: p.id,
    name: p.title,
    address: p.address || '',
    // 腾讯搜索接口直接返回电话（可能多号，分号分隔），无需再查详情
    tel: p.tel || '',
    category: p.category || '',
    location: fromTencentLocation(p.location)
  };
}

/**
 * 查询缓存：门店/路线/地理编码结果按天复用，降低 key 配额消耗。
 * - 门店缓存按 ~1.1km 网格（2位小数）取整，同商圈的用户共享结果；
 * - 步行/逆地理按 ~110m 网格（3位小数），同一用户重新生成路线时几乎全命中。
 */
const QUERY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const QUERY_CACHE_MAX_ENTRIES = 800;
const queryCache = new Map();

function cacheGet(key) {
  const entry = queryCache.get(key);
  if (!entry) return { hit: false };
  if (Date.now() - entry.time > QUERY_CACHE_TTL_MS) {
    queryCache.delete(key);
    return { hit: false };
  }
  return { hit: true, value: entry.value };
}

function cacheSet(key, value) {
  if (queryCache.size >= QUERY_CACHE_MAX_ENTRIES) {
    // Map 迭代顺序即写入顺序，淘汰最旧条目
    const oldest = queryCache.keys().next().value;
    queryCache.delete(oldest);
  }
  queryCache.set(key, { time: Date.now(), value });
}

function grid({ latitude, longitude }, decimals) {
  return `${latitude.toFixed(decimals)},${longitude.toFixed(decimals)}`;
}

/**
 * 地理编码：地址文本 -> 坐标
 * 如果地理编码失败，自动降级用POI关键词搜索
 */
async function geocodeUncached(address, city) {
  const data = await callTencent('/geocoder/v1/', { address });
  const result = data.result || {};
  const location = fromTencentLocation(result.location);

  if (location) {
    const comp = result.address_components || {};
    const province = comp.province || '';
    const cityText = comp.city || province;
    const district = comp.district || '';
    return {
      location: location,
      formatted: `${province}${cityText === province ? '' : cityText}${district}${comp.street || ''}${comp.street_number || ''}`,
      province: province,
      city: cityText,
      district: district
    };
  }

  // 地理编码失败 -> 降级用POI关键词搜索（对简称/模糊地名更友好）
  console.log('[腾讯地理编码] 降级为POI搜索:', address);
  const pois = await textSearch(address, city);
  if (pois.length > 0 && pois[0].location) {
    console.log('[POI搜索] 命中:', pois[0].name, pois[0].location);
    return {
      location: pois[0].location,
      formatted: pois[0].name + ' ' + (pois[0].address || ''),
      province: '',
      city: city || '',
      district: ''
    };
  }

  // POI搜索也没location -> 查详情拿坐标
  if (pois.length > 0) {
    try {
      const detail = await searchDetail(pois[0].id);
      if (detail.location) {
        console.log('[详情查询] 命中:', detail.name, detail.location);
        return {
          location: detail.location,
          formatted: detail.name + ' ' + (detail.address || ''),
          province: '',
          city: city || '',
          district: ''
        };
      }
    } catch (e) { /* 忽略，继续报错 */ }
  }

  throw new Error(`找不到"${address}"的位置，请尝试输入更详细的地址（如"杭州师范大学仓前校区"）`);
}

/**
 * 关键词搜索POI（拿POI ID列表），限定在城市内
 */
async function textSearch(keywords, city) {
  try {
    const data = await callTencent('/place/v1/search', {
      keyword: keywords,
      boundary: `region(${city || '全国'},1)`,
      page_size: 5,
      page_index: 1
    });
    return (data.data || []).map(toPoi);
  } catch (e) {
    console.log('[腾讯地点搜索] 失败:', e.message);
    return [];
  }
}

/**
 * 周边搜索POI（以坐标为中心，搜附近门店，按距离由近到远）
 */
async function aroundSearch(keywords, location, radius = 5000) {
  const center = toTencentCoord(location);
  if (!center) return [];
  const data = await callTencent('/place/v1/search', {
    keyword: keywords,
    boundary: `nearby(${center.latitude},${center.longitude},${radius})`,
    orderby: '_distance',
    page_size: 5,
    page_index: 1
  });
  return (data.data || []).map(toPoi);
}

/**
 * POI详情查询（拿坐标+名称+地址）
 * 注：腾讯地点详情基础数据不含评分/人均/营业时间，相关字段留空降级展示
 */
async function searchDetail(poiId) {
  const data = await callTencent('/place/v1/detail', { id: poiId });
  const list = data.data || data.detail || [];
  const p = list[0];
  if (!p) {
    throw new Error(`详情查询失败: ${poiId}`);
  }
  return {
    id: p.id,
    name: p.title,
    location: fromTencentLocation(p.location),
    address: p.address || '',
    tel: p.tel || '',
    rating: '',
    cost: '',
    opentime: '',
    photo: ''
  };
}

/**
 * 3步链路：周边搜索 -> 详情查询 -> 拿到门店完整信息
 * 如果周边搜索返回了location就直接用，否则查详情
 */
async function findNearestStoreUncached(keywords, originLocation, radius = 5000) {
  const pois = await aroundSearch(keywords, originLocation, radius);
  if (pois.length === 0) return null;

  // 取第一个（最近的）
  const poi = pois[0];

  // 如果周边搜索已返回location，直接用
  if (poi.location) {
    return {
      poiId: poi.id,
      name: poi.name,
      address: poi.address,
      tel: poi.tel,
      location: poi.location
    };
  }

  // 否则查详情拿坐标
  const detail = await searchDetail(poi.id);
  return {
    poiId: detail.id,
    name: detail.name,
    address: detail.address,
    tel: detail.tel,
    location: detail.location,
    rating: detail.rating,
    cost: detail.cost,
    opentime: detail.opentime
  };
}

/**
 * 腾讯路线规划的 polyline 为压缩格式：首对为起点绝对坐标（纬度,经度），
 * 之后每对为相对上一点的位置增量（单位为百万分之一度），逐点累加还原。
 * @returns [{longitude, latitude}] 按本项目契约顺序输出
 */
function decodePolyline(flat) {
  const points = [];
  let latitude = null;
  let longitude = null;

  for (let i = 0; i + 1 < flat.length; i += 2) {
    const deltaLat = Number(flat[i]);
    const deltaLng = Number(flat[i + 1]);
    if (!Number.isFinite(deltaLat) || !Number.isFinite(deltaLng)) continue;

    if (latitude === null) {
      latitude = deltaLat;
      longitude = deltaLng;
    } else {
      latitude += deltaLat / 1e6;
      longitude += deltaLng / 1e6;
    }
    // 差分累加存在浮点误差，收敛回6位小数（与增量精度一致）
    points.push({
      longitude: Math.round(longitude * 1e6) / 1e6,
      latitude: Math.round(latitude * 1e6) / 1e6
    });
  }
  return points;
}

/**
 * 步行路径规划：返回沿道路的折线、距离和预计耗时（秒）。
 */
async function walkingRouteUncached(origin, destination) {
  const from = toTencentCoord(origin);
  const to = toTencentCoord(destination);
  if (!from || !to) {
    throw new Error('步行路线规划失败: 坐标格式错误');
  }

  const data = await callTencent('/direction/v1/walking/', {
    from: `${from.latitude},${from.longitude}`,
    to: `${to.latitude},${to.longitude}`
  });
  const route = data.result && data.result.routes && data.result.routes[0];
  if (!route) {
    throw new Error(`步行路线规划失败: ${data.message || '未返回可用路径'}`);
  }

  const points = decodePolyline(route.polyline || []);
  if (points.length < 2) {
    throw new Error('步行路线规划失败: 道路折线为空');
  }

  return {
    distance: Number(route.distance || 0),
    duration: Number(route.duration || 0) * 60,  // 腾讯返回分钟，契约要求秒
    points: points
  };
}

/**
 * 逆地理编码：坐标 -> 地址文本（用于GPS定位后获取地名）
 * 失败时返回空字段对象而非抛错，与原高德版本行为一致。
 */
async function regeocodeUncached(location) {
  const empty = { address: '', formatted: '', province: '', city: '', district: '' };
  const center = toTencentCoord(location);
  if (!center) return empty;

  let result = {};
  try {
    const data = await callTencent('/geocoder/v1/', {
      location: `${center.latitude},${center.longitude}`
    });
    result = data.result || {};
  } catch (e) {
    console.log('[腾讯逆地理编码] 失败:', e.message);
    return empty;
  }

  // 逆地理编码字段为 address_component（单数），区别于正向编码的 address_components
  const comp = result.address_component || result.address_components || {};
  const province = comp.province || '';
  const city = comp.city || province;
  const district = comp.district || '';
  const formatted = (result.formatted_addresses && (result.formatted_addresses.recommend || result.formatted_addresses.rough)) || result.address || '';

  // 从 formatted 中截取区名之后的部分，包含具体地点/建筑名
  let shortName = '';
  if (formatted && district && formatted.includes(district)) {
    shortName = formatted.substring(formatted.indexOf(district));
  }
  // 兜底：district + street + street_number
  if (!shortName) {
    shortName = (district + (comp.street || '') + (comp.street_number || '')) || '';
  }

  // 搜索附近住宅/建筑 POI，找到更精确的小区/地标名（比逆地理编码更具体）
  let poiName = '';
  try {
    for (const keyword of ['小区', '大厦']) {
      const pois = await aroundSearch(keyword, location, 500);
      const nearest = pois.find(p => p.location && p.name);
      if (nearest) {
        poiName = nearest.name;
        break;
      }
    }
  } catch (e) {
    // POI 搜索失败不影响主流程
  }

  return {
    address: poiName || shortName || formatted,
    formatted: formatted,
    province: province,
    city: city,
    district: district
  };
}

/** ===== 带缓存的对外函数（失败不缓存，成功/无结果缓存24h）===== */

async function geocode(address, city) {
  const cacheKey = `geo|${city || ''}|${address}`;
  const cached = cacheGet(cacheKey);
  if (cached.hit) return cached.value;
  const value = await geocodeUncached(address, city);
  cacheSet(cacheKey, value);
  return value;
}

async function findNearestStore(keywords, originLocation, radius = 5000) {
  const center = toTencentCoord(originLocation);
  // 中心点缺失时无法建网格 key，直接透传（也不会有正常调用走到这里）
  if (!center) return findNearestStoreUncached(keywords, originLocation, radius);
  const cacheKey = `store|${keywords}|${grid(center, 2)}`;
  const cached = cacheGet(cacheKey);
  // null 命中也算有效：当天该商圈确实没有该品牌门店
  if (cached.hit) return cached.value;
  const value = await findNearestStoreUncached(keywords, originLocation, radius);
  cacheSet(cacheKey, value);
  return value;
}

async function walkingRoute(origin, destination) {
  const from = toTencentCoord(origin);
  const to = toTencentCoord(destination);
  if (!from || !to) return walkingRouteUncached(origin, destination);
  const cacheKey = `walk|${grid(from, 3)}|${grid(to, 3)}`;
  const cached = cacheGet(cacheKey);
  if (cached.hit) return cached.value;
  const value = await walkingRouteUncached(origin, destination);
  cacheSet(cacheKey, value);
  return value;
}

async function regeocode(location) {
  const center = toTencentCoord(location);
  if (!center) return { address: '', formatted: '', province: '', city: '', district: '' };
  const cacheKey = `regeo|${grid(center, 3)}`;
  const cached = cacheGet(cacheKey);
  if (cached.hit) return cached.value;
  const value = await regeocodeUncached(location);
  // 失败降级产生的空结果不缓存
  if (value.address || value.formatted) cacheSet(cacheKey, value);
  return value;
}

module.exports = {
  geocode,
  regeocode,
  textSearch,
  aroundSearch,
  searchDetail,
  findNearestStore,
  walkingRoute
};
