const fetch = require('node-fetch');

const AMAP_KEY = process.env.AMAP_KEY;
const BASE_V3 = 'https://restapi.amap.com/v3';
const BASE_V5 = 'https://restapi.amap.com/v5';

/**
 * 地理编码：地址文本 → 坐标
 * 如果地理编码失败，自动降级用POI关键词搜索
 */
async function geocode(address, city) {
  // 先尝试地理编码
  const url = `${BASE_V3}/geocode/geo?address=${encodeURIComponent(address)}&city=${encodeURIComponent(city || '')}&key=${AMAP_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status === '1' && data.geocodes && data.geocodes.length > 0) {
    return {
      location: data.geocodes[0].location,
      formatted: data.geocodes[0].formatted_address,
      province: data.geocodes[0].province,
      city: data.geocodes[0].city,
      district: data.geocodes[0].district
    };
  }

  // 地理编码失败 → 降级用POI关键词搜索（对简称/模糊地名更友好）
  console.log('[高德地理编码] 降级为POI搜索:', address);
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

  // POI搜索也没location → 查详情拿坐标
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

  console.error('[高德地理编码] 完全失败:', JSON.stringify(data));
  throw new Error(`找不到"${address}"的位置，请尝试输入更详细的地址（如"杭州师范大学仓前校区"）`);
}

/**
 * 关键词搜索POI（拿POI ID列表）
 */
async function textSearch(keywords, city) {
  const url = `${BASE_V5}/place/text?keywords=${encodeURIComponent(keywords)}&city=${encodeURIComponent(city || '')}&key=${AMAP_KEY}&page_size=5&page_num=1`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status === '1' && data.pois && data.pois.length > 0) {
    return data.pois.map(p => ({
      id: p.id,
      name: p.name,
      address: p.address,
      location: p.location || null
    }));
  }
  return [];
}

/**
 * 周边搜索POI（以坐标为中心，搜附近门店）
 */
async function aroundSearch(keywords, location, radius = 5000) {
  const url = `${BASE_V5}/place/around?keywords=${encodeURIComponent(keywords)}&location=${location}&radius=${radius}&key=${AMAP_KEY}&page_size=5&page_num=1`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status === '1' && data.pois && data.pois.length > 0) {
    return data.pois.map(p => ({
      id: p.id,
      name: p.name,
      address: p.address,
      location: p.location || null
    }));
  }
  return [];
}

/**
 * POI详情查询（拿坐标+评分+营业时间）
 */
async function searchDetail(poiId) {
  const url = `${BASE_V5}/place/detail?id=${poiId}&key=${AMAP_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status === '1' && data.pois && data.pois.length > 0) {
    const p = data.pois[0];
    return {
      id: p.id,
      name: p.name,
      location: p.location,
      address: p.address,
      rating: p.business_rating || '',
      cost: p.business_cost || '',
      opentime: p.business_opentime || '',
      photo: p.photos && p.photos.length > 0 ? p.photos[0].url : ''
    };
  }
  throw new Error(`详情查询失败: ${poiId}`);
}

/**
 * 3步链路：周边搜索 → 详情查询 → 拿到门店完整信息
 * 如果周边搜索返回了location就直接用，否则查详情
 */
async function findNearestStore(keywords, originLocation, radius = 5000) {
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
      location: poi.location
    };
  }

  // 否则查详情拿坐标
  const detail = await searchDetail(poi.id);
  return {
    poiId: detail.id,
    name: detail.name,
    address: detail.address,
    location: detail.location,
    rating: detail.rating,
    cost: detail.cost,
    opentime: detail.opentime
  };
}

/**
 * 距离测量（批量）
 */
async function measureDistance(origins, destination, type = '0') {
  const url = `${BASE_V3}/distance?origins=${origins.join('|')}&destination=${destination}&type=${type}&key=${AMAP_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status === '1' && data.results) {
    return data.results.map(r => ({
      origin: r.origin_id,
      distance: parseInt(r.distance),
      duration: parseInt(r.duration)
    }));
  }
  return [];
}

/**
 * 逆地理编码：坐标 → 地址文本（用于GPS定位后获取地名）
 */
async function regeocode(location) {
  const url = `${BASE_V3}/geocode/regeo?location=${location}&key=${AMAP_KEY}&extensions=base`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status === '1' && data.regeocode) {
    const addr = data.regeocode.addressComponent;
    const formatted = data.regeocode.formatted_address || '';
    // 返回简洁的地名：区+道路 或 格式化地址
    const shortName = addr.neighborhood || addr.building || addr.street || '';
    return {
      address: shortName || formatted,
      formatted: formatted,
      province: addr.province || '',
      city: addr.city || '',
      district: addr.district || ''
    };
  }
  return { address: '', formatted: '', province: '', city: '', district: '' };
}

module.exports = {
  geocode,
  regeocode,
  textSearch,
  aroundSearch,
  searchDetail,
  findNearestStore,
  measureDistance
};
