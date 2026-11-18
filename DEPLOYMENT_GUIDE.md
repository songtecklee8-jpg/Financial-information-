# APEX Terminal · 部署指南（Vercel Serverless 全栈版）

本指南用于把 APEX Terminal 从「纯前端」升级后的**云端后台 + 前端**全栈架构部署到 **Vercel**，
实现 **24 小时后台静默同步**（无需打开网页也保持最新）与 **点开新闻即看「AI 摘要 + 完整全文」阅读器**。

架构一览：

| 层级 | 路径 | 作用 |
| --- | --- | --- |
| 后台同步 | `api/cron/sync.ts` → `GET/POST /api/cron/sync` | 多引擎拉行情 + 抓全部新闻源 + `gemini-2.5-flash-lite` 预翻译/摘要/多空标签，写入 Redis |
| 首屏快照 | `api/snapshot.ts` → `GET /api/snapshot` | 前端毫秒级读取云端已备好的行情 + 新闻 |
| 新闻详情 | `api/news/detail.ts` → `POST /api/news/detail` | `@mozilla/readability` 抓正文 + AI 摘要 + 五大资产推演 + 整篇翻译，Redis 缓存 7 天 |

> 所有 API Key **一律通过 Vercel 环境变量注入，源码中无任何硬编码**。
> 未配置任何变量时，后台会自动降级为「内存 / 临时文件」存储与本地启发式推演，本地开发可直接跑通。

---

## 一、需要在 Vercel 填入的环境变量

在 Vercel 项目 **Settings → Environment Variables** 中逐条添加（Production / Preview / Development 都建议勾选）。

### 1. 必填（缺失会导致对应功能降级）

| 变量名 | 说明 | 获取地址 |
| --- | --- | --- |
| `GEMINI_API_KEY` | AI 翻译 / 摘要 / 跨市场推演（`gemini-2.5-flash-lite` / `flash` / `pro`） | https://aistudio.google.com/app/apikey |
| `CRON_SECRET` | 外部定时服务的调用密钥（自行生成一串随机字符串） | 自定义，例如 `openssl rand -hex 24` |

> `CRON_SECRET` 是**安全护栏**：一旦设置，`/api/cron/sync` 必须携带正确密钥才执行；
> 未设置时接口放行（仅供本地开发）。

### 2. 行情与新闻引擎（按需填写，填得越多行情越稳）

| 变量名 | 说明 |
| --- | --- |
| `FINNHUB_API_KEY` | 美股行情 + Finnhub News（https://finnhub.io/register） |
| `ALPACA_API_KEY` | Alpaca 行情（美股快照） |
| `ALPACA_API_SECRET` | 与 `ALPACA_API_KEY` 配套的 Secret（https://app.alpaca.markets/） |
| `ALPHAVANTAGE_API_KEY` | Alpha Vantage 新闻 + 情绪分（https://www.alphavantage.co/support/#api-key） |

> 行情引擎为**多路冗余**：Finnhub / Alpaca / Yahoo Finance（免 Key 代理）/ Binance（免 Key）。
> 即使不配任何 Key，后台仍可用 Yahoo Finance 与 Binance 拉取行情，不会中断。

### 3. 云端持久化：Upstash Redis（强烈建议）

| 变量名 | 说明 |
| --- | --- |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST 地址 |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST Token |

> 兼容 Vercel KV 的别名：`KV_REST_API_URL` / `KV_REST_API_TOKEN`（二选一即可）。
> **未配置时**后台自动降级为「进程内存 + `/tmp` 临时文件」，本地开发可用，但**无法在 Serverless 多实例间共享**，正式环境请务必配置 Upstash。

**获取 Upstash 步骤：**
1. 登录 https://console.upstash.com/ → **Create Database**（选离用户最近的区域，如 Singapore）。
2. 进入数据库详情页，切换到 **REST API** 标签。
3. 复制 `UPSTASH_REDIS_REST_URL` 与 `UPSTASH_REDIS_REST_TOKEN`，填入 Vercel 环境变量。

### 4. 可选：自定义自选池（不填则用内置默认池）

| 变量名 | 默认值 | 格式 |
| --- | --- | --- |
| `WATCHLIST_US` | `AAPL,MSFT,NVDA,TSLA,AMZN,GOOGL,META,JPM,XOM,AMD` | 英文逗号分隔的代码 |
| `WATCHLIST_KL` | `1155.KL,1295.KL,1023.KL,5347.KL,5225.KL,6033.KL` | 马股需带 `.KL` 后缀 |
| `WATCHLIST_CRYPTO` | `BTC,ETH,SOL,BNB,XRP` | 加密资产代码 |

### 5. 可选别名

以下变量也会被识别（优先级低于上面的主名称）：
`GOOGLE_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY`（= Gemini）、`APCA_API_KEY_ID` / `APCA_API_SECRET_KEY`（= Alpaca）。

---

## 二、部署到 Vercel

1. 把本仓库推送到 GitHub（已配置好 `vercel.json`）。
2. 打开 https://vercel.com/new → 导入该 GitHub 仓库。
3. **Framework Preset** 选 `Vite`；Build Command = `npm run build`，Output Directory = `dist`（`vercel.json` 已声明，通常自动识别）。
4. 在 **Environment Variables** 里按上面的清单逐条填入 Key。
5. 点击 **Deploy**。部署完成后：
   - 打开站点首页，新闻页顶部应出现 **`CLOUD SYNC`** 徽章，状态条显示「云端同步 · Upstash / 本地降级」。
   - 首次部署后云端尚无数据，**先手动触发一次**：
     ```
     curl -X POST "https://<你的域名>/api/cron/sync?key=<CRON_SECRET>"
     ```
     返回 `{"ok":true,...}` 即表示行情 + 新闻 + AI 预处理已写入 Redis。
   - 验证首屏数据：浏览器访问 `https://<你的域名>/api/snapshot`，应返回 `{"ok":true,"ready":true,...}`。

> **本地开发**：安装 Vercel CLI（`npm i -g vercel`）后执行 `vercel dev`，
> 并在项目根目录建 `.env` 写入同样的变量名，即可在本地复现完整后台链路。

---

## 三、配置 cron-job.org 每 5 分钟自动触发后台更新

Vercel 官方 Cron 在 **Hobby（免费）计划**下**每天仅触发 1 次**（`vercel.json` 已配置 `0 0 * * *` 作为基础兜底）。
要实现「**每 5 分钟**自动同步」，请用外部定时服务唤醒 `/api/cron/sync`。

> 也支持 **Upstash QStash**（每分钟级）或任意可发 HTTP 请求的调度器，逻辑同理：向 `/api/cron/sync` 带密钥发请求即可。

### cron-job.org 配置步骤

1. 打开 https://cron-job.org/ → 注册 / 登录。
2. 右上角头像 → **Cronjobs** → 点击 **CREATE CRONJOB**。
3. **Title**：填 `APEX Terminal Sync`。
4. **URL**：填写（把 `<你的域名>` 与 `<CRON_SECRET>` 换成真实值）：
   ```
   https://<你的域名>/api/cron/sync?key=<CRON_SECRET>
   ```
5. **Schedule**：选 **Every 5 minutes**（*Every* `5` *minutes*）。
6. 展开 **Advanced**：
   - **Request method**：选 `POST`（`GET` 亦可，接口同时支持）。
   - **Request headers**（可选，二选一即可，两种密钥方式都支持）：
     - `Authorization: Bearer <CRON_SECRET>`，或
     - `x-cron-secret: <CRON_SECRET>`
7. 点击 **CREATE**，然后点 **TEST RUN** 验证：返回 HTTP **200** 且响应体为 `{"ok":true,...}` 即配置成功。

> **安全提示**：URL 中带 `key=<CRON_SECRET>` 即等同于密钥。请勿把该 URL 公开分享；
> 如担心泄露，改用上面的 `Authorization: Bearer` 请求头方式，URL 里不带 key。

### 可选：Upstash QStash（更细粒度）

1. 进入 Upstash 控制台 → **QStash** → **Schedules** → **Create Schedule**。
2. **Destination**：`https://<你的域名>/api/cron/sync`。
3. **Method**：`POST`；**Headers**：`Authorization: Bearer <CRON_SECRET>`。
4. **Cron**：填 `*/5 * * * *`（每 5 分钟）→ 创建。

**推荐的唤醒频率：**
- 交易时段密、休市时段疏可直接用固定 `*/5 * * * *`；
- 若想省 API 额度，可设交易时段 `*/5 9-23 * * 1-5`，其余时段整点触发。

---

## 四、环境变量速查清单（直接复制粘贴）

```bash
# --- 必填 ---
GEMINI_API_KEY=你的_Google_AI_Studio_Key
CRON_SECRET=请自行生成一串随机字符串

# --- 行情 / 新闻引擎（按需，越多越稳）---
FINNHUB_API_KEY=
ALPACA_API_KEY=
ALPACA_API_SECRET=
ALPHAVANTAGE_API_KEY=

# --- 云端持久化（正式环境强烈建议）---
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# --- 可选：自定义自选池 ---
WATCHLIST_US=AAPL,MSFT,NVDA,TSLA,AMZN,GOOGL,META,JPM,XOM,AMD
WATCHLIST_KL=1155.KL,1295.KL,1023.KL,5347.KL,5225.KL,6033.KL
WATCHLIST_CRYPTO=BTC,ETH,SOL,BNB,XRP
```

---

## 五、常见问题

- **新闻页一直显示 `BASELINE`？** 说明 `/api/*` 未就绪：检查是否在 Vercel 部署（而非 GitHub Pages 静态托管），并已手动触发过一次 `/api/cron/sync`。
- **没有 `CLOUD SYNC` 徽章？** 打开 `/api/snapshot` 看返回；若 `ready:false`，多为 Redis 未配置或尚未同步，先手动 sync 一次。
- **提示 `unauthorized`？** `CRON_SECRET` 与环境变量不一致，或外部触发器未携带 `key` / 请求头。
- **AI 摘要/翻译缺失？** 检查 `GEMINI_API_KEY` 是否有效；额度不足时系统会自动向下降级到 `gemini-flash-latest`，仍失败则回落本地推演（卡片显示「本地降级」）。
- **新闻详情抓不到全文？** 部分源站（付费墙 / 强反爬）会拦截抓取，此时阅读器显示导语并给出「前往原文」链接，属正常降级。
- **实时性问题？** 云端快照有 30–120 分钟 TTL；外部每 5 分钟唤醒一次即可让首屏始终接近最新。
