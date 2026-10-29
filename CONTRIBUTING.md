# 贡献指南

这个项目的规则比其他 MCP 服务器严一些，因为它的价值全在**忠实度**上：每个行为都要能指向
真实的反编译结果或受控实测记录。请先读完再动手。

## 1. 第一原则：功能忠于原版

- 任何输出格式、命令拼装、字段名、默认值，都应当能在 `reverse/` 里的证据（或 REA 对
  `UV4.exe`/`UVSC.dll` 的反编译记录）里找到依据。
- 不确定的行为**不要猜**。要么补证据，要么让工具返回结构化诊断（例如 `needsKeil`、
  `parseError`、`issues[]`），而不是给出看起来合理的假结果。
- 不做“兼容一下应该也行”的静默改写。µVision 的字节（CRLF、缩进、元素顺序）本身就是契约。

## 2. 证据优先级

1. 受控运行观察到的输出（`reverse/*.log`、`reverse/*_evidence.json`）
2. 反编译/反汇编得到的逻辑（REA + Ghidra，记录函数地址）
3. 官方 schema / `.pdsc` 声明
4. 文档字符串

冲突时以更高优先级为准，并在代码注释里写清楚地址或日志文件名。

## 3. 目录约定

| 路径 | 作用 | 是否随包发布 |
| --- | --- | --- |
| `src/` | 运行时全部代码 | 是 |
| `data/fixtures/` | 运行必需的快照数据（器件库、`.pdsc`、样例产物、模块目录） | 是 |
| `tests/` | 测试与发布门禁 | 否 |
| `reverse/` | 反编译脚本、证据、回归探针 | 否 |

**规则**：`src/` 里任何在模块加载期（import/顶层）读取的文件，都必须位于 `data/fixtures/`，
否则复制发布包会启动即崩。`tests/pack_test.mjs` 会用 `npm pack` 产物验证这一点。

## 4. 开发流程

```bash
node src/server.mjs            # 直接跑服务器（stdio MCP）
npm test                       # 主测试套件
npm run test:portable          # 便携模式断言（无 Keil）
npm run test:fuzz              # 畸形输入/鲁棒性
npm run test:pack              # 发布门禁：npm pack → 解包 → 冷启动
npm run test:all               # 全部
```

提交前至少跑 `npm run test:all`。Windows 上跑完整套件；Linux/macOS 上便携与发布门禁也应当通过。

## 5. 新增一个工具

1. 在 `src/tools/<领域>.mjs` 里 `register(ctx, { name, description, inputSchema, handler })`。
2. `name` 用 `snake_case`，与 µVision 概念对齐（`uv4_*` 表示直接驱动 UV4.exe 的命令）。
3. `description` 写清“它能回答什么”，并注明证据来源（函数地址/日志/`.pdsc` 字段）。
4. `handler` 返回普通对象；错误走 `{ ok:false, ... }`，需要真实安装时用
   `ctx.data.needsKeil('feature')`。
5. 在 `tests/run_tests.mjs`（功能）与 `tests/portable_test.mjs`（无安装场景）各加断言；
   若涉及打包数据，补 `tests/pack_test.mjs`。
6. 更新 `README.md` / `README.zh-CN.md` 的工具表与 `CHANGELOG.md`。

## 6. 修改数据快照

`data/fixtures/` 是产品的一部分，改动必须有可复现来源：

- `.cdb` 器件库：`UVCDB2XML.exe` 导出（`reverse/snapshot_toolsini.mjs` 等脚本）；
- `.pdsc`：来自对应 DFP 版本，保留原始字节；
- 样例工程与产物：`reverse/build_fixtures.mjs` 生成，保留 CRLF；
- `catalog/module_catalog.json`：由 PE 头、导出表与字符串扫描重建（见 `reverse/write_catalog.mjs`）。

改完跑 `npm run test:all`，并确认 `tests/pack_test.mjs` 里对数量/字段的断言仍然成立
（若数量确实变了，改断言并在 CHANGELOG 说明原因）。

## 7. 提交信息

```
<area>: <一句话说明>

证据: <函数地址 / reverse 下文件 / 日志>
测试: <跑过的命令与结果>
```

## 8. 许可

贡献即表示同意以 MIT 许可发布。第三方数据（`.pdsc`、器件库文本）的归属见 `LICENSE` 末尾说明。
