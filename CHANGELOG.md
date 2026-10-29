# Changelog

所有重要变更记录在此文件。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.2.1] — 2026-10-29

跨平台修复：Linux/macOS 上读工程、找产物、分析依赖现在能跑通（CI 首次在 Ubuntu 上暴露）。

### Fixed

- **Windows 风格路径在 POSIX 上失效**：工程里存的是 `.\Objects\`、`..\CMSIS`，
  `path.resolve()` 在 Linux 把反斜杠当文件名字符，导致 `memory_usage` 报
  `image not found: …/.\Objects\/main.axf`、`project_validate` 误报头文件缺失、
  `dep_impact` 找不到变更单元。新增 `util.resolveWin()` 统一折叠分隔符与 `./` 前缀，
  并在 `project.mjs`、`deps.mjs`、`tools/project.mjs`、`tools/image.mjs` 的路径解析处替换
  （共 19 处）。
- 工程文件里的 `C:\...` 绝对路径在 POSIX 上仍按"不存在"处理——这是如实结果，不再拼出
  带反斜杠的伪路径。

## [1.2.0] — 2026-10-29

面向初学者：把"缺库/版本不对"从人工猜变成一条命令，并且说人话。

### Added

- **`doctor`**：一条命令检查环境（Node 版本、免许可编译器、烧录器、pack 根目录、已装包、
  内置快照），每个缺项都带一句"装什么"。
- **`pack_diagnose`**：输入工程，输出「为什么构建不了」——PackID 精确版本 vs 已装版本、
  器件来自哪个包、RTE 包缺失、头文件目录失效；每条 check 有 `what`（人话）/`why`（机制）/
  `fix`，并给出可直接执行的 `actions`（装包 或 改工程 PackID）。
- **`pack_fetch`**：按 vendor/pack/version 安装——支持本地 `.pack`（离线）或 keil.com 下载；
  默认 `dryRun`，只报告 URL 与目标目录；坐标做路径安全校验。
- **`pack_versions`**：从本地 `.Web` 索引缓存回答"这个包有哪些版本存在"，不联网。
- **`tests/beginner_test.mjs`（44 项）**：断言诊断结论是人话（summary 不以错误码开头）、
  每个阻塞项都有可执行修复、健康工程不啰嗦、PackID 从右解析（`Keil.STM32F1xx_DFP.2.4.0`
  不会被拆成 version `0`）、坐标路径穿越被拒。
- README 新增「新手从这里开始」：三条命令 + 常见报错对照表。

### Fixed

- PackID 解析改为从右切分：之前 `Keil.STM32F1xx_DFP.2.4.0` 会被正则贪婪拆成
  vendor `…DFP.2.4` + version `0`，导致诊断给出错误的安装建议。
- 同一 pack 在「已装目录 + 内置快照」各出现一次时，`doctor`/`pack_versions`/`pack_diagnose`
  只显示一行（之前重复，看起来像装了两份）。

### Changed

- 工具总数 89 → 93。

## [1.1.0] — 2026-10-29

零许可路线：不装 Keil、不激活，也能编译与烧录；算法档案开放给二次开发。

### Added

- **`compile`**：读取 `.uvprojx`（`Cpu:` 串、define、include、文件组），用 **clang+lld** 或
  **arm-none-eabi-gcc** 产出 `.elf/.hex/.bin/.map`。链接脚本由工程的 IROM/IRAM 生成，向量表
  由器件决定；工程缺 CMSIS 时自动解析 `CMSIS/Core/Include`（安装的 pack 优先，包内快照兜底）。
  结果带 `backend` 与 `fidelity`，明确不声称与 armcc 字节一致。**不触碰 armlm / Error #601。**
- **`flash`**：pyOCD / OpenOCD / STM32_Programmer_CLI / ST-LINK_CLI / J-Link；`dryRun` 默认
  true，只返回将执行的命令行，`dryRun:false` 才真正烧录。
- **`build_backends`**：列出本机可用编译器（含 `licence: none`）与烧录器。
- **`tests/compile_test.mjs`（37 项）**：CPU 串→编译参数映射、反汇编级断言（初始 SP = IRAM 末、
  Reset 向量带 Thumb 位）、`hex_info`/`elf_info` 复核产物、flash dryRun、缺编译器时的结构化诊断。
- **[docs/algorithms.md](docs/algorithms.md)**：`UV4.exe` 算法档案——工程模型字节保真、器件片段
  （`Cpu:`/`UL2CM3(...)`）、CLI 解析（0x9d3a11）、构建引擎（kspawn）、`.dep` 写入
  （`FUN_00680b10`，stamp = `floor(mtime/1000)` 按 `0x%08X`）、增量判定、`.d`、via 文件、
  UVSOCK 帧、许可闸。每条带证据级别与参考实现位置，供二次开发。
- **DFP 器件源码纳入快照**：`Device/Include`（`stm32f10x.h` 等）、`Device/Source/ARM`
  （`startup_*.s`、`system_stm32f10x.c`）、StdPeriph 驱动、`Flash/*.FLM`、`SVD/*.svd`、
  `CMSIS 6.2.0 Core/Include`。字节与原安装逐文件 sha256 一致。快照从 134 文件 / 6.44 MB
  增至 **281 文件 / 16.09 MB**。
- 发布门禁新增断言：DFP 头文件/启动文件/FLM/SVD/CMSIS 在包内；**从 `npm pack` 解包副本、
  无 Keil 环境下真实编译出 `.hex`**，且 CMSIS 来自包内。

### Changed

- `project_create` 生成的工程现在能被 `project_validate` 零问题通过（`NO_STARTUP` /
  `INCLUDE_MISSING` 消失），因为快照里确实有对应文件。
- 工具总数 86 → 89。

## [1.0.1] — 2026-10-29

发布可用性修复：让 `npm pack` 产物（而不是开发目录）真正能独立运行。

### Fixed

- **发布包启动即崩**：`src/tools/modules.mjs` 在模块加载阶段读取 `reverse/module_catalog.json`，
  而 `reverse/` 不在 `files:` 里。现在目录清单随包发布到
  `data/fixtures/catalog/module_catalog.json`，并由 `portable.mjs::moduleCatalogPath()` 按
  `KEIL_MCP_MODULE_CATALOG` → 包内副本 → 开发树 `reverse/` 的顺序解析；读取失败降级为
  `module_catalog` 工具返回结构化错误，不再拖垮整个服务器。
- **入口判定误判导致静默退出**：`server.mjs` 用字符串拼接比较 `process.argv[1]` 与
  `import.meta.url`，遇到 8.3 短路径（`C:\Users\ERDAN~1.DES\…`）、符号链接或大小写差异时判定失败，
  进程导入成功却什么都不做。改为 `fs.realpathSync.native` + Windows 大小写归一后比较。
- `cdb_devices` 描述把内置器件库位置写成 `reverse/cdb`，改为实际的
  `data/fixtures/cdb/uv4_cdb.xml`。

### Added

- `tests/pack_test.mjs`（`npm run test:pack`）：发布门禁。`npm pack` → 解包到仓库外的临时目录 →
  在无 Keil 的环境下冷启动 → 断言 2831 器件 / 33 厂商、3 个 `.pdsc`、STM32F103C8 的
  内存/define/SVD/FLM、`module_catalog` 来自包内、`.axf`/`.map`/`.hex` 解析、
  `uv4_build` 返回 `needsKeil`、以及 8.3 短路径与 `KEIL_MCP_AUTOSTART=1` 两种启动方式。
- `LICENSE`（MIT，含第三方数据快照归属说明）、`CONTRIBUTING.md`、`SECURITY.md`、
  `.gitattributes`（锁定 µVision 产物的 CRLF 字节）、`.editorconfig`、`.gitignore`。
- GitHub Actions（`.github/workflows/ci.yml`）：Windows 上跑完整套件，Linux 上跑便携与发布门禁。

## [1.0.0] — 2026-10-29

- 首个完整版本：86 个 MCP 工具覆盖 UV4 命令行、工程模型（读写/克隆/校验/语义 diff）、
  依赖库 `.dep`（读/图/影响面/回写）、CMSIS-Pack 与遗留 `.cdb` 器件库、`elf/map/hex` 与内存占用、
  UVSOCK 远程控制、批处理与导入导出、选项/调试配置、GUID/布局与 `.SVCS` 解析。
- 便携模式：无 Keil 安装时从 `data/fixtures/`（133 个文件、6.43 MB）回答元数据类问题；
  真正需要 `UV4.exe`/工具链的操作返回 `needsKeil` 诊断而非伪造结果。
