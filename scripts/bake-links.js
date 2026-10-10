/**
 * 把聚推客最新推广链接"烘焙"成静态快照 public/links.json。
 *
 * 用途：
 *  1. 兜底——线上 /api/cps/links 万一故障，页面自动读这份快照，卡片链接不失效；
 *  2. 纯静态部署（不走 Node 服务器）时，这就是唯一的链接来源。
 *
 * 用法：node scripts/bake-links.js   （建议每次部署前跑一下，或每周跑一次）
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const cps = require('../server/services/cps');

(async () => {
  const brands = cps.getAvailableBrands().map(b => b.brand);
  const links = await cps.getBatchLinks(brands);
  if (!links.length) {
    console.error('❌ 一个链接都没拉到（检查 .env 里的 JUTUIKE_APIKEY / JUTUIKE_PUB_ID）');
    process.exit(1);
  }
  const out = {
    updatedAt: new Date().toISOString(),
    links: links.map(l => ({ brand: l.brand, h5: l.h5 || (l.fallback && l.fallback.url) || '' }))
  };
  const file = path.join(__dirname, '..', 'public', 'links.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`✅ 已烘焙 ${out.links.length} 条链接 → public/links.json`);
})();
