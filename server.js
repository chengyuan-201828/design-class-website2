const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY_FILE;
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

/** 「当当」橘猫掌柜 · 系统提示词（仅后端注入，前端不可见） */
const DANGDANG_SYSTEM_PROMPT = `你是「当当」，「当当时间当铺」的橘猫掌柜。你戴着一副金丝圆框眼镜，打算盘算得很精，但面对身心俱疲的本科大学生用户时，你极其耐心、和蔼、温顺，共情力极强。

## 语气与风格
- 多用猫咪语气词与 emoji（如：喵、😼、🐾），像暖心的老朋友，绝不使用冷冰冰、机械式的回答。
- 善于倾听他们的焦虑：赶 DDL、专业课太难、考试内耗、自律太累、拖延 guilt、社交压力等。
- 先共情、再疏导，必要时给出 1～2 条切实可行、低门槛的减压或行动小建议（不要长篇大论说教）。

## 产品背景（供你自然引用，勿生硬推销）
- 用户可以把碎片时间「典当」成时间币，完成自律任务后领取奖励，再去「兑换休息」。
- 你的心理树洞职责是陪伴与疏导；若合适，可温和建议「挂到当铺里，干完去换奖励」。

## 隐藏任务提取机制（核心，必须严格遵守）
当用户在聊天中**抱怨或提到**「有一件具体的事情想做但还没做 / 正在拖延 / 一直拖着」时（例如：「数据结构作业还没写」「今天本来打算跑 3 公里但一直躺着」），你在完成安慰与疏导之后：

1. **必须在回复正文的最末尾，另起一行**，严格附带以下格式的隐藏标签（仅一条）：
   \`||TASK: 任务内容简述 | COINS: 推荐代币值||\`

2. **COINS 规则**：根据任务难度在 5～30 之间的整数，合理预估（简单微习惯 5～10，中等专注块 11～20，较难深度任务 21～30）。

3. **TASK 规则**：用简短可执行的动宾短语概括（10～25 字为宜），便于用户一眼看懂。

4. **何时不输出标签**：用户只是在纯情绪倾诉、没有提到任何具体未完成事项时，**不要**输出该标签。

5. **格式示例**（标签前先有正常回复）：
   "...别太自责喵，慢慢来！要不我们把这件事情挂到当铺里，干完去换奖励？
   ||TASK: 顺一遍数据结构核心公式 | COINS: 15||"

6. 标签对用户界面可能不可见或会被解析，但格式必须精确：以 \`||TASK:\` 开头，以 \`||\` 结尾，中间用 \` | COINS: \` 分隔（注意空格与竖线位置）。`;

/**
 * 组装发往 DeepSeek 的消息：后端硬编码 system 优先，过滤前端传入的 system
 */
function buildChatMessages(clientMessages) {
  const conversation = clientMessages.filter(
    (m) =>
      m &&
      typeof m.content === 'string' &&
      m.content.trim() !== '' &&
      (m.role === 'user' || m.role === 'assistant')
  );

  return [{ role: 'system', content: DANGDANG_SYSTEM_PROMPT }, ...conversation];
}

/** 启动时从本地文件安全读取 API KEY（密钥永不进入前端） */
function loadApiKey() {
  if (!fs.existsSync(API_KEY_FILE)) {
    console.error('\n❌ 错误：找不到密钥文件「设计思维智能体API.txt」');
    console.error('   请在项目根目录创建该文件，并将 DeepSeek API KEY 写入其中（仅一行）。\n');
    process.exit(1);
  }

  const raw = fs.readFileSync(API_KEY_FILE, 'utf8');
  const apiKey = raw.trim();

  if (!apiKey) {
    console.error('\n❌ 错误：「设计思维智能体API.txt」文件为空，请写入有效的 DeepSeek API KEY。\n');
    process.exit(1);
  }

  return apiKey;
}

const API_KEY = loadApiKey();

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

/** 禁止通过静态托管暴露密钥与后端源码 */
const BLOCKED_STATIC_FILES = new Set([
  '设计思维智能体API.txt',
  'server.js',
  'package.json',
  'package-lock.json'
]);

app.use((req, res, next) => {
  const decoded = decodeURIComponent(req.path);
  const basename = path.basename(decoded);
  if (BLOCKED_STATIC_FILES.has(basename) || decoded.startsWith('/node_modules')) {
    return res.status(404).end();
  }
  next();
});

/** 托管静态前端，访问 http://localhost:3000 即可打开页面 */
app.use(express.static(__dirname));

/**
 * POST /api/chat
 * 前端仅发送聊天历史，后端携带密钥代理请求 DeepSeek
 *
 * 请求体示例：
 * { "messages": [{ "role": "user", "content": "你好" }] }
 */
app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: '请求体须包含非空的 messages 数组'
    });
  }

  try {
    const response = await axios.post(
      DEEPSEEK_API_URL,
      {
        model: 'deepseek-chat',
        messages: buildChatMessages(messages)
      },
      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      }
    );

    res.json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    const detail = err.response?.data || { message: err.message };

    console.error('[DeepSeek 代理错误]', status, detail);

    res.status(status).json({
      error: 'DeepSeek API 请求失败',
      detail
    });
  }
});
// 只有在本地电脑运行（非 Vercel 环境）时，才启动端口监听
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n✅ 当当时间当铺后端已启动`);
    console.log(`   前端页面：http://localhost:${PORT}`);
    console.log(`   AI 代理：  http://localhost:${PORT}/api/chat`);
    console.log(`   密钥来源： 环境变量 API_KEY_FILE\n`);
  });
}
module.exports = app;
// 必须加上这一行，把整个 app 导出来给 Vercel 托管
/*module.exports = app;
app.listen(PORT, () => {
  console.log(`\n✅ 当当时间当铺后端已启动`);
  console.log(`   前端页面：http://localhost:${PORT}`);
  console.log(`   AI 代理：  http://localhost:${PORT}/api/chat`);
  console.log(`   密钥来源： 设计思维智能体API.txt（已加载，未暴露给浏览器）\n`);
});*/
