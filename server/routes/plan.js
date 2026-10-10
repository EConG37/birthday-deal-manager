const express = require('express');
const router = express.Router();
const tencent = require('../services/tencent');
const dealsService = require('../services/deals');
const routeShare = require('../services/routeShare');
const storeDb = require('../services/storeDb');

const MAX_ROUTE_STOPS = 5;
const STORE_QUERY_INTERVAL_MS = 220;

// 轻量限流：单 IP 每分钟最多 6 次规划。/api/plan 每次调用都消耗
// 腾讯地图配额和 LLM token，且请求地址明文在客户端包内可被提取，
// 不加限流等于配额裸奔（照 ratings 的滑动窗口模式实现）。
const PLAN_LIMIT_PER_MIN = 6;
const planTimesByIp = new Map();

function allowPlan(ip) {
  const now = Date.now();
  const times = (planTimesByIp.get(ip) || []).filter(t => now - t < 60 * 1000);
  if (times.length >= PLAN_LIMIT_PER_MIN) {
    planTimesByIp.set(ip, times);
    return false;
  }
  times.push(now);
  planTimesByIp.set(ip, times);
  return true;
}

setInterval(() => {
  const now = Date.now();
  planTimesByIp.forEach((times, ip) => {
    const alive = times.filter(t => now - t < 60 * 1000);
    if (alive.length === 0) planTimesByIp.delete(ip);
    else planTimesByIp.set(ip, alive);
  });
}, 60 * 1000).unref();

// 前端省市区选择器返回"上海市"，种子数据里是"上海"，统一去掉行政后缀
function normalizeCity(city) {
  return String(city || '')
    .replace(/(壮族自治区|回族自治区|维吾尔自治区|自治区|省|市)$/, '');
}

/**
 * POST /api/plan
 * 入参: { birthday: "12-15", city: "上海", origin: "人民广场", origin_location?: "121.475,31.228" }
 * origin_location 可选：前端GPS定位拿到的坐标，有则跳过地理编码
 * 出参: { route: [...], online_deals: [...], summary: "..." }
 */
router.post('/', async (req, res) => {
  const { birthday, city, origin, origin_location } = req.body;

  if (!birthday || !city || !origin) {
    return res.status(400).json({ error: '缺少参数: birthday, city, origin 必填' });
  }

  if (!allowPlan(req.ip)) {
    return res.status(429).json({ error: '路线生成太频繁了，稍等一分钟再试' });
  }

  try {
    console.log(`[规划开始] 生日:${birthday} 城市:${city} 出发地:${origin}`);

    // ===== 步骤1: 过滤优惠数据 =====
    const normalizedCity = normalizeCity(city);
    const offlineDeals = dealsService.filterDeals(birthday, normalizedCity);
    const onlineDeals = dealsService.getOnlineDeals();
    console.log(`[步骤1] 筛选出 ${offlineDeals.length} 个线下品牌, ${onlineDeals.length} 个线上平台`);

    // ===== 步骤2: 获取起点坐标 =====
    let originLocation;
    if (origin_location) {
      // 前端GPS定位直传坐标，跳过地理编码
      originLocation = origin_location;
      console.log(`[步骤2] 使用GPS定位坐标: ${originLocation}`);
    } else {
      // 文本地址 → 坐标
      const originGeo = await tencent.geocode(origin, city);
      originLocation = originGeo.location;
      console.log(`[步骤2] 地理编码坐标: ${originLocation}`);
    }

    // ===== 步骤3: 优先查自有门店库，库中没有/过期再实时搜索 =====
    // 门店库由 scripts/sync-stores.js 每周同步，把地点搜索的配额消耗降到接近零。
    const storeResults = [];
    for (const deal of offlineDeals) {
      let fromLocalDb = true;
      try {
        // 本地库命中时零配额、零等待；未命中才实时搜索并节流
        let store = storeDb.findNearestStore(deal.store_query_hint, originLocation, 5000);
        if (!store) {
          fromLocalDb = false;
          store = await tencent.findNearestStore(
            deal.store_query_hint,
            originLocation,
            5000
          );
        }
        if (store && store.location) {
          // 算距离
          const [oLon, oLat] = originLocation.split(',').map(Number);
          const [sLon, sLat] = store.location.split(',').map(Number);
          const distance = haversine(oLat, oLon, sLat, sLon);

          const result = {
            brand: deal.brand,
            deal: deal,
            store: store,
            distance: Math.round(distance)
          };
          console.log(`  ✓ ${deal.brand} → ${store.name} (${Math.round(distance)}m${fromLocalDb ? ' · 本地库' : ' · 实时'})`);
          storeResults.push(result);
        } else {
          console.log(`  ✗ ${deal.brand} → 未找到附近门店`);
        }
      } catch (err) {
        console.log(`  ✗ ${deal.brand} → 查询失败: ${err.message}`);
      }
      await wait(fromLocalDb ? 0 : STORE_QUERY_INTERVAL_MS);
    }
    console.log(`[步骤3] 成功查询 ${storeResults.length} 个品牌门店`);

    if (storeResults.length === 0) {
      return res.status(404).json({ error: '附近暂未找到可用门店，请换一个出发位置再试' });
    }

    // ===== 步骤4: 本地规则挑选 5 站，再按地理位置优化访问顺序 =====
    // 精确枚举 5 站的全部顺序，以少折返为主，时段先后只作为轻量约束。
    const selectedStores = selectRouteStops(storeResults, MAX_ROUTE_STOPS);
    const optimizedStores = optimizeVisitOrder(selectedStores, originLocation);
    const route = optimizedStores.map((store, index) => {
      return {
        seq: index + 1,
        suggested_time: getVisitTime(index),
        reason: getSlotLabel(store.deal.meal_slot),
        meal_slot: store.deal.meal_slot,
        brand: store.brand,
        perk_title: store.deal.perk_title,
        perk_detail: store.deal.perk_detail,
        estimated_value: store.deal.estimated_value,
        need_member: store.deal.need_member,
        claim_method: store.deal.claim_method,
        valid_window: store.deal.valid_window,
        store_name: store.store.name,
        store_address: store.store.address,
        store_location: store.store.location,
        store_poiId: store.store.poiId,
        store_tel: store.store.tel || '',
        store_rating: store.store.rating || '',
        store_opentime: store.store.opentime || '',
        distance: store.distance
      };
    });

    // ===== 步骤5: 逐段获取腾讯真实步行道路折线 =====
    const walking = await buildWalkingGeometry(originLocation, route);

    const totalEstimatedValue = route.reduce((sum, stop) => sum + Number(stop.estimated_value || 0), 0);
    const summary = `已从附近${storeResults.length}个品牌中挑选${route.length}站，步行约${formatDistance(walking.totalDistance)}，预估价值约${totalEstimatedValue}元`;

    // 生成腾讯地图导航链接（URI API，坐标顺序为 名称,纬度,经度）。
    // 小程序端实际使用 wx.openLocation，此字段仅供 H5 端兜底。
    const navLinks = route.map(r => {
      const [lon, lat] = r.store_location.split(',');
      return `https://apis.map.qq.com/uri/v1/route?to=${encodeURIComponent(r.store_name)},${lat},${lon}&policy=1&referer=${encodeURIComponent('生日薅羊毛管家')}`;
    });

    const result = {
      birthday: birthday,
      city: city,
      origin: origin,
      origin_location: originLocation,
      route: route,
      nav_links: navLinks,
      online_deals: onlineDeals.map(d => ({
        brand: d.brand,
        perk_title: d.perk_title,
        perk_detail: d.perk_detail,
        estimated_value: d.estimated_value,
        claim_method: d.claim_method
      })),
      total_estimated_value: totalEstimatedValue,
      total_distance: walking.totalDistance,
      total_duration: walking.totalDuration,
      route_polyline: walking.points,
      route_geometry_source: walking.complete ? 'tencent_walking' : 'mixed_fallback',
      summary: summary,
      candidate_count: storeResults.length,
      planning_mode: 'distance_optimized_v2',
      generated_at: new Date().toISOString()
    };

    // 生成分享快照：好友通过 /pages/route/route?share=<id> 打开同一条路线。
    // 快照剔除 birthday 等隐私字段。
    const share = routeShare.create({
      city: result.city,
      origin: result.origin,
      origin_location: result.origin_location,
      route: result.route,
      online_deals: result.online_deals,
      total_estimated_value: result.total_estimated_value,
      total_distance: result.total_distance,
      total_duration: result.total_duration,
      route_polyline: result.route_polyline,
      route_geometry_source: result.route_geometry_source,
      summary: result.summary,
      generated_at: result.generated_at
    });
    result.share_id = share.id;
    result.share_expires_at = share.expiresAt;

    console.log(`[规划完成] 共${route.length}站, 预估价值¥${result.total_estimated_value}`);
    res.json(result);

  } catch (err) {
    console.error('[规划失败]', err);
    res.status(500).json({ error: err.message });
  }
});

// Haversine公式算直线距离（米）
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getVisitTime(index) {
  return ['09:30', '11:30', '14:00', '16:30', '19:00'][index] || '19:30';
}

function getSlotLabel(mealSlot) {
  const labels = {
    morning: '上午咖啡',
    lunch: '午餐',
    afternoon_tea: '下午茶',
    anytime: '灵活打卡',
    dinner: '晚餐',
    night: '晚间场'
  };
  return labels[mealSlot] || '顺路打卡';
}

function formatDistance(distance) {
  return distance >= 1000 ? `${(distance / 1000).toFixed(1)}km` : `${distance}m`;
}

function candidateScore(store) {
  const valueBonus = Math.min(Number(store.deal.estimated_value || 0), 80) * 10;
  return store.distance - valueBonus;
}

function selectRouteStops(storeResults, limit) {
  const slotOrder = ['morning', 'lunch', 'afternoon_tea', 'anytime', 'dinner', 'night'];
  const selected = [];

  // 先保证一天各时段尽量都有内容，再用附近的高价值门店补足。
  for (const slot of slotOrder) {
    const best = storeResults
      .filter(store => store.deal.meal_slot === slot && !selected.includes(store))
      .sort((a, b) => candidateScore(a) - candidateScore(b))[0];
    if (best) selected.push(best);
    if (selected.length >= limit) break;
  }

  if (selected.length < limit) {
    const remaining = storeResults
      .filter(store => !selected.includes(store))
      .sort((a, b) => candidateScore(a) - candidateScore(b));
    selected.push(...remaining.slice(0, limit - selected.length));
  }

  return selected;
}

function parseLocation(location) {
  const [longitude, latitude] = String(location || '').split(',').map(Number);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return { longitude, latitude };
}

function distanceBetweenLocations(from, to) {
  const start = parseLocation(from);
  const end = parseLocation(to);
  if (!start || !end) return Number.MAX_SAFE_INTEGER;
  return haversine(start.latitude, start.longitude, end.latitude, end.longitude);
}

function getSlotRank(store) {
  const order = ['morning', 'lunch', 'afternoon_tea', 'anytime', 'dinner', 'night'];
  const rank = order.indexOf(store.deal.meal_slot);
  return rank >= 0 ? rank : 3;
}

function routeScore(stores, originLocation) {
  let totalDistance = 0;
  let previousLocation = originLocation;
  let timeOrderPenalty = 0;

  stores.forEach(store => {
    totalDistance += distanceBetweenLocations(previousLocation, store.store.location);
    previousLocation = store.store.location;
  });

  // 每出现一次时段倒序只增加轻量惩罚，避免为了时段跨城折返。
  for (let i = 0; i < stores.length; i += 1) {
    for (let j = i + 1; j < stores.length; j += 1) {
      if (getSlotRank(stores[i]) > getSlotRank(stores[j])) timeOrderPenalty += 350;
    }
  }

  return totalDistance + timeOrderPenalty;
}

function permutations(items) {
  if (items.length <= 1) return [items];
  const result = [];
  items.forEach((item, index) => {
    const rest = items.slice(0, index).concat(items.slice(index + 1));
    permutations(rest).forEach(order => result.push([item].concat(order)));
  });
  return result;
}

function optimizeVisitOrder(stores, originLocation) {
  let best = stores;
  let bestScore = Number.POSITIVE_INFINITY;
  permutations(stores).forEach(order => {
    const score = routeScore(order, originLocation);
    if (score < bestScore) {
      best = order;
      bestScore = score;
    }
  });
  return best;
}

function appendUniquePoints(target, points) {
  points.forEach(point => {
    const previous = target[target.length - 1];
    if (!previous || previous.longitude !== point.longitude || previous.latitude !== point.latitude) {
      target.push(point);
    }
  });
}

async function buildWalkingGeometry(originLocation, route) {
  const points = [];
  let currentLocation = originLocation;
  let totalDistance = 0;
  let totalDuration = 0;
  let complete = true;

  for (let index = 0; index < route.length; index += 1) {
    const stop = route[index];
    const directDistance = Math.round(distanceBetweenLocations(currentLocation, stop.store_location));

    try {
      const segment = await tencent.walkingRoute(currentLocation, stop.store_location);
      stop.leg_distance = segment.distance || directDistance;
      stop.leg_duration = segment.duration || Math.ceil(stop.leg_distance / 1.2);
      appendUniquePoints(points, segment.points);
    } catch (error) {
      complete = false;
      stop.leg_distance = directDistance;
      stop.leg_duration = Math.ceil(directDistance / 1.2);
      const start = parseLocation(currentLocation);
      const end = parseLocation(stop.store_location);
      appendUniquePoints(points, [start, end].filter(Boolean));
      console.log(`  ✗ ${stop.brand} → 步行道路查询失败，使用直线兜底: ${error.message}`);
    }

    totalDistance += stop.leg_distance;
    totalDuration += stop.leg_duration;
    currentLocation = stop.store_location;
    if (index < route.length - 1) await wait(STORE_QUERY_INTERVAL_MS);
  }

  return { points, totalDistance, totalDuration, complete };
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = router;
