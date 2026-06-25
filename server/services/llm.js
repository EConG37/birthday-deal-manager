const fetch = require('node-fetch');

const DEEPSEEK_KEY = process.env.DEEPSEEK_KEY;
const BASE_URL = 'https://api.deepseek.com/v1';

/**
 * 调用DeepSeek LLM进行路线排序
 * 输入：门店列表（含坐标、品类、权益、营业时间）+ 起点坐标
 * 输出：排好序的访问路线（含时间建议）
 */
async function planRoute(stores, originLocation) {
  const storeList = stores.map((s, i) => ({
    index: i,
    brand: s.brand,
    category: s.deal.category,
    perk_title: s.deal.perk_title,
    meal_slot: s.deal.meal_slot,
    location: s.store.location,
    distance_from_origin: s.distance,
    opentime: s.store.opentime || '未知',
    estimated_value: s.deal.estimated_value
  }));

  const prompt = `你是一个生日薅羊毛路线规划专家。用户要从${originLocation}出发，打卡以下品牌门店领取生日福利。

请根据以下规则排出最优访问顺序：
1. 按时段匹配：早上(7-10点)配咖啡类，中午(11-14点)配正餐类，下午(14-17点)配茶饮/甜品类，晚上(17点后)配娱乐类
2. 距离聚类：距离近的门店尽量连续访问，减少来回跑
3. 营业时间：必须在门店营业时间内访问
4. 价值优先：同等条件下，预估价值高的优先

门店列表（JSON）：
${JSON.stringify(storeList, null, 2)}

请返回JSON格式（不要markdown代码块，直接返回纯JSON）：
{
  "route": [
    {
      "index": 0,
      "suggested_time": "09:00",
      "reason": "距离起点最近，早上适合喝咖啡"
    }
  ],
  "total_estimated_value": 300,
  "summary": "今天可以打卡8个品牌，预计总价值约300元"
}`;

  const url = `${BASE_URL}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_KEY}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: '你是路线规划专家，只返回JSON格式数据，不要多余文字。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 2000
    })
  });

  const data = await res.json();

  if (data.error) {
    throw new Error(`DeepSeek API错误: ${data.error.message}`);
  }

  const content = data.choices[0].message.content.trim();

  // 尝试解析JSON（兼容模型可能返回markdown代码块的情况）
  let jsonStr = content;
  if (content.includes('```')) {
    const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) jsonStr = match[1].trim();
  }

  return JSON.parse(jsonStr);
}

module.exports = { planRoute };
