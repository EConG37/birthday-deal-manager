/**
 * 门店库同步脚本（方案A）：按 品牌 × 城市 把腾讯地点搜索结果沉淀到 server/data/stores.json。
 * 之后 /api/plan 优先查库，地点搜索配额消耗降为零。
 *
 * 用法：
 *   node scripts/sync-stores.js                      # 默认城市列表
 *   node scripts/sync-stores.js 上海 北京             # 指定城市
 *   node scripts/sync-stores.js --keyword 喜茶 上海   # 只同步单个品牌
 *
 * 依赖 TENCENT_LBS_KEY（地点搜索配额），建议每周跑一次。
 */
const path = require('path');
// 脚本独立运行，必须自己加载 .env（server/index.js 的 dotenv 不会执行）
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const tencent = require(path.join(__dirname, '..', 'server', 'services', 'tencent'));
const storeDb = require(path.join(__dirname, '..', 'server', 'services', 'storeDb'));
const dealsService = require(path.join(__dirname, '..', 'server', 'services', 'deals'));

const DEFAULT_CITIES = ['上海', '北京', '深圳', '广州', '成都', '杭州', '重庆', '武汉', '南京', '西安', '天津', '长沙'];
const QUERY_INTERVAL_MS = 300;
const STORES_PER_CITY = 8;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  if (!process.env.TENCENT_LBS_KEY) {
    console.error('TENCENT_LBS_KEY 未配置（app/.env），同步中止。');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const keywordFilter = args.includes('--keyword')
    ? args[args.indexOf('--keyword') + 1]
    : '';
  const cities = args.filter(arg => !arg.startsWith('--') && arg !== keywordFilter);
  const cityList = cities.length > 0 ? cities : DEFAULT_CITIES;

  const offlineDeals = dealsService.loadDeals().filter(deal => !deal.is_online);
  const keywords = (keywordFilter
    ? offlineDeals.filter(deal => deal.store_query_hint === keywordFilter)
    : offlineDeals
  ).map(deal => deal.store_query_hint);

  if (keywords.length === 0) {
    console.log('没有需要同步的品牌（检查 --keyword 参数）');
    return;
  }

  console.log(`开始同步：${keywords.length} 个品牌 × ${cityList.length} 个城市`);
  let ok = 0;
  let fail = 0;
  let empty = 0;

  for (const keyword of keywords) {
    for (const city of cityList) {
      try {
        const pois = await tencent.textSearch(`${keyword}`, city);
        const stores = pois.slice(0, STORES_PER_CITY)
          .filter(poi => poi.location)
          .map(poi => ({
            name: poi.name,
            address: poi.address || '',
            location: poi.location,
            tel: poi.tel || '',
            poiId: poi.id
          }));

        if (stores.length === 0) {
          // 拿到0家通常是配额/网络异常（textSearch内部吞错返回空数组），不写库、按失败计
          empty += 1;
          console.log(`  ✗ ${keyword} @ ${city}: 0 家（疑似配额或网络异常，跳过不写库）`);
          continue;
        }

        storeDb.upsert(keyword, city, stores);
        ok += 1;
        console.log(`  ✓ ${keyword} @ ${city}: ${stores.length} 家`);
      } catch (err) {
        fail += 1;
        console.log(`  ✗ ${keyword} @ ${city}: ${err.message}`);
      }
      await wait(QUERY_INTERVAL_MS);
    }
  }

  console.log(`同步完成：成功 ${ok} 组，空结果 ${empty} 组，失败 ${fail} 组，已写入 server/data/stores.json`);
  if (ok === 0) process.exit(1);
}

main().catch(err => {
  console.error('同步脚本异常:', err);
  process.exit(1);
});
