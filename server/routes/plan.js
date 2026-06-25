const express = require('express');
const router = express.Router();
const amap = require('../services/amap');
const llm = require('../services/llm');
const dealsService = require('../services/deals');

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

  try {
    console.log(`[规划开始] 生日:${birthday} 城市:${city} 出发地:${origin}`);

    // ===== 步骤1: 过滤优惠数据 =====
    const offlineDeals = dealsService.filterDeals(birthday, city);
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
      const originGeo = await amap.geocode(origin, city);
      originLocation = originGeo.location;
      console.log(`[步骤2] 地理编码坐标: ${originLocation}`);
    }

    // ===== 步骤3: 查询每个品牌的最近门店 =====
    const storeResults = [];
    for (const deal of offlineDeals) {
      try {
        const store = await amap.findNearestStore(
          deal.store_query_hint,
          originLocation,
          5000
        );
        if (store && store.location) {
          // 算距离
          const [oLon, oLat] = originLocation.split(',').map(Number);
          const [sLon, sLat] = store.location.split(',').map(Number);
          const distance = haversine(oLat, oLon, sLat, sLon);

          storeResults.push({
            brand: deal.brand,
            deal: deal,
            store: store,
            distance: Math.round(distance)
          });
          console.log(`  ✓ ${deal.brand} → ${store.name} (${Math.round(distance)}m)`);
        } else {
          console.log(`  ✗ ${deal.brand} → 未找到附近门店`);
        }
      } catch (err) {
        console.log(`  ✗ ${deal.brand} → 查询失败: ${err.message}`);
      }

      // 控制QPS，避免高德限流
      await sleep(200);
    }
    console.log(`[步骤3] 成功查询 ${storeResults.length} 个品牌门店`);

    // ===== 步骤4: 调DeepSeek LLM 排序 =====
    let planResult;
    try {
      planResult = await llm.planRoute(storeResults, originLocation);
      console.log(`[步骤4] LLM排序完成: ${planResult.route.length} 站`);
    } catch (err) {
      console.log(`[步骤4] LLM排序失败，降级为距离排序: ${err.message}`);
      // 降级：按距离排序
      const sorted = [...storeResults].sort((a, b) => a.distance - b.distance);
      planResult = {
        route: sorted.map((s, i) => ({
          index: i,
          suggested_time: getDefaultTime(s.deal.meal_slot),
          reason: `距离${s.distance}m`
        })),
        total_estimated_value: sorted.reduce((sum, s) => sum + s.deal.estimated_value, 0),
        summary: `共${sorted.length}个品牌（LLM降级，按距离排序）`
      };
    }

    // ===== 步骤5: 组装返回结果 =====
    const route = planResult.route.map(stop => {
      const store = storeResults[stop.index];
      if (!store) return null;
      return {
        seq: stop.index + 1,
        suggested_time: stop.suggested_time,
        reason: stop.reason,
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
        store_rating: store.store.rating || '',
        store_opentime: store.store.opentime || '',
        distance: store.distance
      };
    }).filter(r => r !== null);

    // 生成高德地图导航链接（URI Scheme，无需MCP）
    const navLinks = route.map(r => {
      const [lon, lat] = r.store_location.split(',');
      return `https://uri.amap.com/navigation?to=${lon},${lat},${encodeURIComponent(r.store_name)}&mode=walk&coordinate=wgs84`;
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
      total_estimated_value: planResult.total_estimated_value,
      summary: planResult.summary,
      generated_at: new Date().toISOString()
    };

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

function getDefaultTime(mealSlot) {
  const times = {
    morning: '09:00',
    lunch: '12:00',
    afternoon_tea: '14:30',
    dinner: '18:00',
    night: '20:00',
    anytime: '10:00'
  };
  return times[mealSlot] || '10:00';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = router;
