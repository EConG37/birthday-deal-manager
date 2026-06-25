require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 禁用静态文件缓存，确保每次请求都拿到最新版本
app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// API路由
app.use('/api/plan', require('./routes/plan'));

// 逆地理编码（前端GPS定位后调用）
app.get('/api/regeocode', async (req, res) => {
  const { location } = req.query;
  if (!location) return res.status(400).json({ error: '缺少location参数' });
  try {
    const amap = require('./services/amap');
    const result = await amap.regeocode(location);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    amap_key: process.env.AMAP_KEY ? '已配置' : '未配置',
    deepseek_key: process.env.DEEPSEEK_KEY ? '已配置' : '未配置',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`\n🎂 生日薅羊毛管家服务已启动`);
  console.log(`   本地地址: http://localhost:${PORT}`);
  console.log(`   高德Key:  ${process.env.AMAP_KEY ? '✅ 已配置' : '❌ 未配置（请编辑 .env）'}`);
  console.log(`   DeepSeek: ${process.env.DEEPSEEK_KEY ? '✅ 已配置' : '❌ 未配置（请编辑 .env）'}\n`);
});
