# Amazon + Sorftime 自动选品 v1

按照“风险识别 → 硬条件淘汰 → 类目内评分 → 父体去重 → AI深度分析 → 前50人工审核”执行美国站前台翻页选品。

## 已实现

- 带Sorftime专用Chrome用户目录和Amazon登录状态持久化；
- 类目最多400页、真实下一页点击、SQLite断点续跑；
- Sorftime动态渲染等待、懒加载滚动、关键字段重试两次；
- 液体/膏体/粉末/儿童用品、价格、销量、评论、尺寸重量、Amazon自营、FBA费率硬规则；
- 类目内百分位评分、强势品牌扣分、详情页父ASIN识别与父体最佳子体去重；
- OpenAI Responses API图像风险和低星评论微创新分析；
- 无API密钥时的本地启发式降级；
- JSON、CSV前50报告和本地人工审核页面；
- 验收边界自动测试。

AI调用使用Responses API的图片输入和严格JSON Schema结构化输出。网页文字、标题和评论均作为不可信数据，不会被当成系统指令。

## 环境

- Node.js 22.5或更高；
- Google Chrome；
- Sorftime浏览器插件及有效账号；
- 可选：`OPENAI_API_KEY`。

当前项目只有浏览器控制依赖需要安装：

```bash
pnpm install
# 或 npm install
```

复制 `.env.example` 为 `.env`，按需填写。数据库、专用Chrome资料和报告默认写入被Git忽略的 `data/` 与 `artifacts/`。

## 使用

首次初始化专用浏览器：

```bash
node src/cli.ts profile
```

在打开的Chrome中安装并登录Sorftime、登录Amazon，完成后回到终端按 `Ctrl+C`。

采集类目：

```bash
node src/cli.ts collect --url "https://www.amazon.com/你的类目URL" --category "Pet Supplies" --max-pages 400
```

执行规则、评分、图片风险检查和AI分析：

```bash
node src/cli.ts evaluate --url "https://www.amazon.com/你的类目URL" --category "Pet Supplies" --with-browser
```

`--with-browser` 会读取前100个候选的1–3星评论。未设置 `OPENAI_API_KEY` 时仍可运行，但图片判断和结构创新建议不会自动生成。

打开人工审核页：

```bash
node src/cli.ts serve --url "https://www.amazon.com/你的类目URL"
```

浏览器访问 `http://127.0.0.1:4310`，可记录入选、观察、淘汰、原因和备注。

## 安全与合规

- 只使用你本人可访问的Amazon与Sorftime页面和数据；
- 遵守Amazon、Sorftime及所在地区适用条款；
- 不实现验证码破解、代理轮换、设备指纹伪装或登录绕过；
- 检测到验证码、Robot Check或登录验证时自动暂停并截图；
- 系统不执行采购、付款、创建Listing或自动改价。

## 测试

```bash
node --test
```
