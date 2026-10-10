/* ============================================================
 *  生日薅羊毛管家 · 商品数据（唯一需要维护的文件）
 * ------------------------------------------------------------
 *  【你只需要改这里】
 *  1. url 为 '' 的商品是占位：点击会提示"链接配置中"。
 *     拿到链接后填上即生效。
 *  2. jtk 字段 = 聚推客目录里的品牌名（如 '美团外卖'）：
 *     填了它，页面打开时会自动从服务器拉取该品牌的最新
 *     推广链接，无需手动填 url。（需服务器已配置 JUTUIKE_APIKEY）
 *  3. 品牌 logo：把方形图片放进 app/public/logos/，
 *     然后填 logo: '/logos/xxx.png'；不填则显示品牌色单字图标。
 *  4. 上架新商品：复制任意一段 { ... } 改内容；下架：整段删掉
 *     或加一行 off: true 。
 *  5. kefuWechat 改成你的客服微信号（显示在「我的」页）。
 *
 *  字段说明：
 *    cat    所属 Tab：birthday 生日 / flash 限时捡漏 / vip 会员中心
 *                    / waimai 外卖 / food 餐饮 / movie 电影 / life 话费出行
 *    sub    仅 cat='vip' 时用：top 旗舰位 / video 影视
 *                              / music 音乐 / work 办公生活
 *    expire 仅 cat='flash' 时用：下架日期 '2026-10-25'，
 *           卡片自动显示倒计时，过期自动隐藏
 *    price 现价：数字（0 显示「免费」）或字符串如 '4.6折起'
 *    was   官方原价（数字，显示划线价，可省）
 *    unit  价格后缀，如 '/月' '/年'，可省略
 *    hot   true = 标题前显示 HOT 角标
 * ============================================================ */

window.PRODUCTS_META = {
  updatedAt: '2026-10-09',          // 页脚「每日人工更新于」会用到
  kefuWechat: 'YOUR_WECHAT_ID',     // TODO: 改成你的客服微信号
};

/* 聚推客会员商城（单页）地址 —— 2026-10-09 已开通 */
var JTK_STORE = 'https://kurl04.cn/tDxg0Q';

window.PRODUCTS = [

  /* ========== 限时捡漏（明显低于市价的短寿命货源，expire 到期自动下架） ========== */
  {
    id: 'duo-super', cat: 'flash',
    brand: '多邻国', mono: '多', color: '#58CC02', logo: '',
    title: 'Super 会员 · 年卡', desc: '家庭席位 · 到期可续',
    price: 88, was: 588, unit: '/年',
    expire: '2026-10-25',           // TODO: 改成这批货源的实际失效日期
    tags: ['自动发货', '低价'],
    cta: '去开通', url: '',   // TODO: 链动小铺商品链接
    hot: true,
  },


  /* ========== 会员中心 · 旗舰位 ========== */
  {
    id: 'vip-store', cat: 'vip', sub: 'top',
    brand: '会员充值中心', mono: '充', color: '#E6392B', logo: '',
    title: '会员充值中心 · 全场低价', desc: '腾讯/爱奇艺/优酷/芒果/网盘/音乐 一站充',
    price: '2.5折起', was: null,
    tags: ['官方渠道', '极速到账'],
    cta: '进店逛逛', url: JTK_STORE,
    hot: true,
  },

  /* ========== 会员中心 · 影视会员 ========== */
  {
    id: 'tx-svip', cat: 'vip', sub: 'video',
    brand: '腾讯视频', mono: '腾', color: '#FF6022', logo: '',
    title: '超级影视SVIP · 年卡', desc: '电视/手机/Pad 多端通用',
    price: 260.9, was: 488, unit: '/年',
    tags: ['官方渠道', '省227元'],
    cta: '去充值', url: JTK_STORE,
    hot: true,
  },
  {
    id: 'iqiyi-vip', cat: 'vip', sub: 'video',
    brand: '爱奇艺', mono: '爱', color: '#1CC749', logo: '',
    title: '黄金VIP · 年卡', desc: '手机/电脑/Pad 通用',
    price: '4.6折起', was: null,
    tags: ['官方渠道'],
    cta: '去充值', url: JTK_STORE,
  },
  {
    id: 'youku-vip', cat: 'vip', sub: 'video',
    brand: '优酷视频', mono: '优', color: '#0A9BFF', logo: '',
    title: 'VIP会员 · 年卡', desc: '官方直充 · 1-5分钟到账',
    price: '5.2折起', was: 258, unit: '/年',
    tags: ['官方渠道'],
    cta: '去充值', url: JTK_STORE,
  },
  {
    id: 'mgtv-vip', cat: 'vip', sub: 'video',
    brand: '芒果TV', mono: '芒', color: '#FF8A00', logo: '',
    title: '芒果TV会员 · 年卡', desc: '官方直充 · 极速到账',
    price: '4.4折起', was: null,
    tags: ['官方渠道'],
    cta: '去充值', url: JTK_STORE,
  },

  /* ========== 会员中心 · 音乐音频 ========== */
  {
    id: 'qqmusic-vip', cat: 'vip', sub: 'music',
    brand: 'QQ音乐', mono: 'Q', color: '#31C27C', logo: '',
    title: '豪华绿钻 · 年卡', desc: '无损音质 · 付费曲库',
    price: '6.4折起', was: 210, unit: '/年',
    tags: ['官方渠道'],
    cta: '去充值', url: JTK_STORE,
  },
  {
    id: 'ximalaya-vip', cat: 'vip', sub: 'music',
    brand: '喜马拉雅', mono: '喜', color: '#F86442', logo: '',
    title: '喜马拉雅 · 会员年卡', desc: '有声书/播客/课程畅听',
    price: '7.4折起', was: null,
    tags: ['官方渠道'],
    cta: '去充值', url: JTK_STORE,
  },

  /* ========== 会员中心 · 办公生活 ========== */
  {
    id: 'wps-vip', cat: 'vip', sub: 'work',
    brand: 'WPS', mono: 'W', color: '#EA3E23', logo: '',
    title: '超级会员 · 年卡', desc: '办公全家桶 · PDF/模板全解锁',
    price: '2.5折起', was: 360, unit: '/年',   /* 折扣以商城实际售价为准 */
    tags: ['官方渠道', '低价'],
    cta: '去充值', url: JTK_STORE,
  },
  {
    id: 'baidupan-vip', cat: 'vip', sub: 'work',
    brand: '百度网盘', mono: '盘', color: '#06A7FF', logo: '',
    title: '百度网盘 · SVIP', desc: '极速下载 · 大空间',
    price: '5.8折起', was: null,
    tags: ['官方渠道'],
    cta: '去充值', url: JTK_STORE,
  },
  {
    id: 'jd-plus', cat: 'vip', sub: 'work',
    brand: '京东PLUS', mono: '京', color: '#E1251B', logo: '',
    title: '京东PLUS · 年卡', desc: '每月运费券 · 专属折扣',
    price: '5.1折起', was: 149, unit: '/年',
    tags: ['官方渠道'],
    cta: '去充值', url: JTK_STORE,
  },
  {
    id: 'keep-vip', cat: 'vip', sub: 'work',
    brand: 'Keep', mono: 'K', color: '#24C6B7', logo: '',
    title: 'Keep 会员 · 月卡', desc: '健身课程全解锁',
    price: '4.1折起', was: 25, unit: '/月',
    tags: ['官方渠道'],
    cta: '去充值', url: JTK_STORE,
  },

  /* ========== 首页 · 外卖红包（聚推客自动注入链接） ========== */
  {
    id: 'mt-shenquan', cat: 'waimai',
    brand: '美团外卖', mono: '美', color: '#FFC300', logo: '',
    title: '品质好店红包 · 天天可领', desc: '每日可领 · 下单立减',
    price: 0, was: null,
    tags: ['官方直充', '每日可领'],
    cta: '领红包', url: '', jtk: '美团外卖',
    hot: true,
  },
  {
    id: 'elm-hongbao', cat: 'waimai',
    brand: '饿了么', mono: '饿', color: '#1296DB', logo: '',
    title: '天天领红包 · 最高30元', desc: '新客加码 · 每日可领',
    price: 0, was: null,
    tags: ['官方直充', '每日可领'],
    cta: '领红包', url: '', jtk: '饿了么',
  },

  /* ========== 首页 · 餐饮茶饮 ========== */
  {
    id: 'starbucks-cps', cat: 'food',
    brand: '星巴克', mono: '星', color: '#00754A', logo: '',
    title: '饮品券 · 到店外送优惠', desc: '官方活动 · 每日更新',
    price: 0, was: null,
    tags: ['官方直充'],
    cta: '领优惠', url: '', jtk: '星巴克',
  },
  {
    id: 'luckin-cps', cat: 'food',
    brand: '瑞幸咖啡', mono: '瑞', color: '#232D4B', logo: '',
    title: '瑞幸咖啡 · 日常优惠', desc: '每周9.9 · 券包活动',
    price: 0, was: null,
    tags: ['官方直充'],
    cta: '领优惠', url: '', jtk: '瑞幸咖啡',
  },
  {
    id: 'heytea-cps', cat: 'food',
    brand: '喜茶', mono: '喜', color: '#D9A566', logo: '',
    title: '喜茶 · 到店外送优惠', desc: '官方活动 · 每日更新',
    price: 0, was: null,
    tags: ['官方直充'],
    cta: '领优惠', url: '', jtk: '喜茶',
  },
  {
    id: 'kfc-cps', cat: 'food',
    brand: '肯德基', mono: '肯', color: '#E4002B', logo: '',
    title: '肯德基 · 套餐会员活动', desc: '官方活动 · 每日更新',
    price: 0, was: null,
    tags: ['官方直充'],
    cta: '领优惠', url: '', jtk: '肯德基',
  },

  /* ========== 首页 · 电影演出 ========== */
  {
    id: 'jtk-movie', cat: 'movie',
    brand: '聚推客', mono: '影', color: '#7C5CFC', logo: '',
    title: '特惠电影票 · 全国影院', desc: '官方渠道 · 在线选座',
    price: 0, was: null,
    tags: ['官方渠道'],
    cta: '去买票', url: '', jtk: '电影票',
    hot: true,
  },
  {
    id: 'tpp-ticket', cat: 'movie',
    brand: '淘票票', mono: '淘', color: '#FF4D4F', logo: '',
    title: '电影通兑券 · 全国通用', desc: '周末可用 · 即买即用',
    price: 19.9, was: 45,
    tags: ['自动发货', '低价'],
    cta: '去抢购', url: '',   // TODO: 淘票票 CPS 链接
  },

  /* ========== 首页 · 话费出行 ========== */
  {
    id: 'huafei-92', cat: 'life',
    brand: '全国三网', mono: '话', color: '#0E9F6E', logo: '',
    title: '话费 92 折 · 充100得100', desc: '慢充优惠 · 24小时内到账',
    price: 92, was: 100,
    tags: ['低价', '24h到账'],
    cta: '去充值', url: '',   // TODO: 话费 CPS 链接
  },
  {
    id: 'didi-quan', cat: 'life',
    brand: '滴滴出行', mono: '滴', color: '#FF7C4C', logo: '',
    title: '打车券包 · 每日可领', desc: '通勤必备 · 立减券组合',
    price: 0, was: null,
    tags: ['每日可领'],
    cta: '领券', url: '', jtk: '滴滴打车',
  },
  {
    id: 'huaxiaozhu', cat: 'life',
    brand: '花小猪', mono: '花', color: '#FF5F6D', logo: '',
    title: '花小猪打车 · 优惠入口', desc: '新人加码 · 每日可领',
    price: 0, was: null,
    tags: ['每日可领'],
    cta: '领券', url: '', jtk: '花小猪打车',
  },

  /* ========== 生日 Tab · 生日专属 ========== */
  {
    id: 'starbucks-bd', cat: 'birthday',
    brand: '星巴克', mono: '星', color: '#00754A', logo: '',
    title: '生日赠饮券 · 中杯任选', desc: '金星会员 · 生日当月有效',
    price: 0, was: 38,
    tags: ['生日加码', '需会员'],
    cta: '看攻略', url: '',   // TODO: 攻略或跳转链接
  },
  {
    id: 'heytea-bd', cat: 'birthday',
    brand: '喜茶', mono: '喜', color: '#D9A566', logo: '',
    title: '生日买一送一', desc: '生日当天 · 凭本人身份证',
    price: 0, was: 30,
    tags: ['生日加码'],
    cta: '看攻略', url: '',   // TODO
  },
  {
    id: 'haidilao-bd', cat: 'birthday',
    brand: '海底捞', mono: '捞', color: '#E60012', logo: '',
    title: '生日长寿面 + 果盘', desc: '生日当周 · 到店出示',
    price: 0, was: 58,
    tags: ['生日加码'],
    cta: '看攻略', url: '',   // TODO
  },
  {
    id: 'ikea-bd', cat: 'birthday',
    brand: '宜家家居', mono: '宜', color: '#0058AB', logo: '',
    title: '生日蛋糕券', desc: '会员生日月 · 餐厅领取',
    price: 0, was: 25,
    tags: ['需会员'],
    cta: '看攻略', url: '',   // TODO
  },
];
