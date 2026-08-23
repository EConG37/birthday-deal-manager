const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

/**
 * 留言墙（生日心愿墙）：UGC 社区内容，必须先过内容审核再展示。
 * 审核策略分层：
 *   1. 内置敏感词基线（永远生效）；
 *   2. 微信官方 msgSecCheck（配置 WECHAT_APPID/WECHAT_APP_SECRET 后生效，
 *      未配置时跳过 —— 上线前建议配置，社区内容是审核重点）。
 * 存储：内存 + server/data/wishes.json 落盘（单实例方案，多实例需迁数据库）。
 */
const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'wishes.json');
const MAX_ENTRIES = 5000;
const TEXT_MAX_LENGTH = 60;

// 敏感词基线：命中即拒绝（政治/色情/赌博/诈骗引流/平台违规词，宁可误杀）
const BASELINE_BLOCKED_WORDS = [
  '反动', '颠覆', '法轮', '六四', '赌博', '博彩', '六合彩', '色情', '约炮', '一夜情',
  '裸聊', '招嫖', '毒品', '冰毒', '大麻', '枪支', '弹药', '代开发票', '刷单',
  '转账', '汇款', '打款', '保证金', '解冻费', '加微信', '加V', '加微', '私聊',
  '代购', '高仿', 'A货', '复制卡', '银行卡收购', '回收银行卡', '身份证收购',
  '兼职日结', '点赞员', '打字员', '引流', '涨粉'
];

let wishes = [];
let loaded = false;
let flushTimer = null;

// 微信 access_token 缓存（msgSecCheck 用）
let accessTokenCache = { token: '', expiresAt: 0 };

function load() {
  if (loaded) return;
  try {
    wishes = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!Array.isArray(wishes)) wishes = [];
  } catch (e) {
    wishes = [];
  }
  loaded = true;
}

function flushSoon() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(wishes));
    } catch (e) {
      console.log('[留言墙] 落盘失败:', e.message);
    }
  }, 3000);
}

function containsBlockedWord(text) {
  return BASELINE_BLOCKED_WORDS.some(word => text.includes(word));
}

async function getWxAccessToken() {
  const appid = process.env.WECHAT_APPID;
  const secret = process.env.WECHAT_APP_SECRET;
  if (!appid || !secret) return '';
  if (accessTokenCache.token && Date.now() < accessTokenCache.expiresAt) {
    return accessTokenCache.token;
  }
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${secret}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.access_token) {
    console.log('[留言墙] 获取access_token失败:', data.errcode, data.errmsg);
    return '';
  }
  accessTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in || 7200) - 300) * 1000
  };
  return data.access_token;
}

/**
 * 内容审核。返回 { status: 'approved' | 'rejected', reason }
 */
async function moderateText(text) {
  if (containsBlockedWord(text)) {
    return { status: 'rejected', reason: '内容包含敏感词，请修改后重新发布' };
  }

  const token = await getWxAccessToken();
  if (token) {
    try {
      const res = await fetch(`https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text })
      });
      const data = await res.json();
      if (data.errcode === 87014) {
        return { status: 'rejected', reason: '内容未通过微信安全检测，请修改后重新发布' };
      }
      if (data.errcode !== 0) {
        console.log('[留言墙] msgSecCheck异常:', data.errcode, data.errmsg);
        // 审核接口异常时放行（已过敏感词基线），不因微信侧故障阻塞用户
      }
    } catch (e) {
      console.log('[留言墙] msgSecCheck请求失败:', e.message);
    }
  }

  return { status: 'approved', reason: '' };
}

function publicWish(entry) {
  return {
    id: entry.id,
    uid: entry.uid,
    text: entry.text,
    birthday: entry.birthday,
    city: entry.city,
    ts: entry.ts
  };
}

/**
 * 发布心愿（先审核，拒绝的不入库）
 */
async function addWish({ uid, text, birthday, city }) {
  load();
  const normalized = String(text || '').trim().slice(0, TEXT_MAX_LENGTH);
  if (!normalized) {
    return { error: '心愿内容不能为空' };
  }

  const verdict = await moderateText(normalized);
  if (verdict.status === 'rejected') {
    return { rejected: true, reason: verdict.reason };
  }

  const entry = {
    id: `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
    uid: String(uid || '').slice(0, 64),
    text: normalized,
    birthday: String(birthday || '').slice(0, 8),
    city: String(city || '').slice(0, 16),
    status: 'approved',
    ts: Date.now()
  };
  wishes.push(entry);
  if (wishes.length > MAX_ENTRIES) {
    wishes = wishes.slice(wishes.length - MAX_ENTRIES);
  }
  flushSoon();
  return { wish: publicWish(entry) };
}

/**
 * 拉取已通过审核的心愿墙（最新在前）
 * birthday（"MM-DD"）可选：只看同月同日生的心愿
 */
function listWishes({ limit = 30, uid = '', birthday = '' } = {}) {
  load();
  const approved = wishes
    .filter(entry => entry.status === 'approved')
    .filter(entry => !birthday || entry.birthday === birthday)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, Math.min(Number(limit) || 30, 50))
    .map(publicWish);
  if (uid) {
    // 自己的标记 mine，前端区分展示
    return approved.map(w => Object.assign(w, { mine: w.uid === uid }));
  }
  return approved;
}

module.exports = { addWish, listWishes };
