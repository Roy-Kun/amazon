# Amazon + Sorftime / 卖家精灵自动选品 v1

按照“风险识别 → 硬条件淘汰 → 类目内评分 → 父体去重 → AI深度分析 → 前50人工审核”执行美国站前台翻页选品。

## 已实现

- Sorftime与卖家精灵双适配器，使用独立Chrome资料和SQLite数据库；
- 类目最多400页、真实下一页点击、SQLite断点续跑；
- 插件动态渲染等待、懒加载滚动、关键字段重试两次；
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
- Sorftime或卖家精灵浏览器插件及有效账号；
- 可选：`OPENAI_API_KEY`。

当前项目只有浏览器控制依赖需要安装：

```bash
pnpm install
# 或 npm install
```

复制 `.env.example` 为 `.env`，按需填写。数据库、专用Chrome资料和报告默认写入被Git忽略的 `data/` 与 `artifacts/`。

## 卖家精灵版本

卖家精灵官方的“快速预览”允许自定义列表页展示字段。首次使用前，请在快速预览中启用这些列：月销量、父体月销量（若提供）、评分、评分数、品牌、Buy Box卖家、卖家数、变体数、BSR、FBA费、上架日期、包装尺寸和包装重量。缺少硬筛所需字段时，商品会在两次重试后进入人工复核池。

初始化卖家精灵专用浏览器：

```bash
node src/cli.ts profile --provider sellersprite
```

在打开的Chrome中安装并登录卖家精灵、登录Amazon，完成后回到终端按 `Ctrl+C`。

采集类目：

```bash
node src/cli.ts collect --provider sellersprite --url "https://www.amazon.com/你的类目URL" --category "Pet Supplies" --max-pages 400
```

执行原有硬筛、评分、图片风险检查和AI分析：

```bash
node src/cli.ts evaluate --provider sellersprite --url "https://www.amazon.com/你的类目URL" --category "Pet Supplies" --with-browser
```

打开卖家精灵候选审核页：

```bash
node src/cli.ts serve --provider sellersprite --url "https://www.amazon.com/你的类目URL"
```

未设置 `DATABASE_PATH` 时，卖家精灵数据默认保存到 `data/sellersprite-selector.sqlite`，不会覆盖Sorftime数据。

卖家精灵官方参考：[快速预览](https://www.sellersprite.com/v3/knowledge/feature/quick-preview-of-extension)、[插件字段说明](https://www.sellersprite.com/cn/v3/knowledge/feature/product-tips-of-extension)。

## Sorftime版本

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

## 附着已有Chrome

如果Chrome已通过远程调试端口开放（例如 `127.0.0.1:9222`），可直接附着到已登录并安装对应插件的浏览器，而不启动新资料：

```bash
node src/cli.ts collect --provider sellersprite --url "https://www.amazon.com/你的类目URL" --category "Pet Supplies" --max-pages 5 --cdp-url "http://127.0.0.1:9222"
```

打开人工审核页时沿用采集时的 `--provider`：

```bash
node src/cli.ts serve --provider sellersprite --url "https://www.amazon.com/你的类目URL"
```

浏览器访问 `http://127.0.0.1:4310`，可记录入选、观察、淘汰、原因和备注。

## 安全与合规

- 只使用你本人可访问的Amazon、Sorftime或卖家精灵页面和数据；
- 遵守Amazon、Sorftime、卖家精灵及所在地区适用条款；
- 不实现验证码破解、代理轮换、设备指纹伪装或登录绕过；
- 检测到验证码、Robot Check或登录验证时自动暂停并截图；
- 系统不执行采购、付款、创建Listing或自动改价。

## 测试

```bash
node --test
```
