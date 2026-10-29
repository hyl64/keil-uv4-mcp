# Keil uVision (UV4) → 完整 MCP 复刻（穷尽式第二轮已完成）

`keil-uv4-mcp` 是一个零依赖的 MCP 服务器（stdio + JSON-RPC 2.0），把 Keil µVision 5
（实测 MDK 5.43a / MDK-Lite 非商业版）在逆向与实测中确认的**全部功能面**暴露为 **93 个工具**。

被分析目标：
`C:\Users\ERDAN.DESKTOP-MVAKHCO\AppData\Local\Keil_v5\UV4`
（`UV4.exe` sha256 `428baf13d15e6760af1618def9c9815c97f0321cc5e459ec7adc4dde41c42f89`，x86 MFC，
自动分析得到 41 876 个函数 / 18 794 个字符串；目录内其余 21 个二进制已全部建档，见
[reverse/modules.md](reverse/modules.md)）。

**验收：106/106 通过；对抗测试 10/10 通过；独立运行（portable）专项 48/48 通过；零许可编译/烧录 37/37、新手诊断 44/44、发布门禁 68/68 通过；UVSOCK 实时端到端（V2.29 握手 + 远程重建收流）验证通过；26 个二进制 + 8 种数据格式全建档。**

## 新手从这里开始（三条命令）

不用懂 Keil 的错误码，也不用先读文档。

```jsonc
// 1. 这台机器准备好了吗？（Node / 编译器 / 烧录器 / 器件库）
{"tool":"doctor"}

// 2. 这个工程为什么构建不了？（版本不对、缺包、头文件没了，一句话说清 + 给你可复制的修法）
{"tool":"pack_diagnose","project":"你的工程.uvprojx"}

// 3. 能构建了？直接出镜像，再烧进板子
{"tool":"compile","project":"你的工程.uvprojx"}
{"tool":"flash","project":"你的工程.uvprojx","chip":"STM32F103C8","dryRun":false}
```

`pack_diagnose` 的输出长这样（真实样本：工程要 2.4.0，机器装的是 2.4.1）：

```
summary: 构建会被拒绝：工程写死要 STM32F1xx_DFP 2.4.0，这台机器装的是 2.4.1。
actions:
  - 装回工程要求的 STM32F1xx_DFP 2.4.0            → pack_fetch {...}
  - 把工程的 PackID 改成已装的 ...2.4.1            → project_set_option {...}
```

| 你看到的报错 | 它真正的意思 | 一条命令 |
| --- | --- | --- |
| `required software pack ... is not installed` / Error #544 | 工程要的包版本不在本机 | `pack_diagnose` |
| `Error #543: device not found` | 器件所属的包没装或版本不同 | `pack_diagnose` |
| `cannot open source input file "stm32f10x.h"` | 头文件目录不存在（包换了版本） | `pack_diagnose` → `includes` 检查 |
| `Error #601`（许可） | MDK 许可问题，与代码无关 | 用 `compile` 走免认证路线 |
| 不知道怎么装包 | 需要某个版本的 `.pack` | `pack_fetch`（可离线用本地 `.pack`） |

## 零许可：编译与烧录（无需 MDK 授权）

**不装 Keil、不激活、不联网校验，也能把工程编译成可烧录的镜像。**

| 能力 | 工具 | 后端 | 许可 |
| --- | --- | --- | --- |
| 编译 | `compile` | clang+lld 或 arm-none-eabi-gcc | 无（Apache-2.0 / GPL 工具链） |
| 烧录 | `flash` | pyOCD / OpenOCD / STM32_Programmer_CLI / ST-LINK_CLI / J-Link | 无 |
| 环境自检 | `build_backends` | 列出本机可用编译器与烧录器 | — |

```jsonc
// 读取 .uvprojx 的 Cpu:/Define/IncludePath/文件组 → 产出 .elf/.hex/.bin/.map
{ "project": "demo.uvprojx", "target": "Flash" }
```

* 链接脚本按工程里的 `Cpu:` 串（`IROM(...) IARM(...)`）生成，向量表用工程器件；
  工程缺 CMSIS 头时自动从 pack（或包内快照）补 `CMSIS/Core/Include`。
* 产物可由本服务器自己的 `elf_info`/`hex_info`/`map_info` 复核（测试断言向量表：栈顶 = IRAM 末，
  Reset 向量带 Thumb 位）。
* **明确不声称与 armcc 字节一致**：结果里 `backend` 与 `fidelity` 字段写明所用编译器；
  需要 armcc/armclang 的逐字节一致行为时才使用 `uv4_build`（那需要真实安装与许可）。
* 装了 Keil 也不影响本路径：两条路并存，`uv4_build` 走 UV4，`compile` 走开源工具链。

对应算法（`.dep` 印章、via 文件、UVSOCK 帧、器件片段拼装等）见
[docs/algorithms.md](docs/algorithms.md)——每条都带 `UV4.exe` 函数地址与证据 ID，供二次开发。

## 独立运行（portable 模式）

**本包不需要安装 Keil 也能完整使用。** 所需数据已随包内联（`data/fixtures/`，16.1 MB / 281 个文件）：

| 内联内容 | 位置 | 说明 |
| --- | --- | --- |
| 遗留器件库 `UV4.cdb` 导出 | `data/fixtures/cdb/uv4_cdb.xml` | 2831 个器件 / 33 家厂商，由 `UVCDB2XML` 转出后固化 |
| 伴侣二进制目录 | `data/fixtures/catalog/module_catalog.json` | 26 个二进制的角色/版本/PE 架构/导出计数/CLI 语法（由 PE 头 + 导出表 + 字符串重建）；`module_catalog` 工具的数据源 |
| CMSIS-Pack 声明 | `data/fixtures/Packs/**/*.pdsc` | ARM.CMSIS 6.2.0、Keil.STM32F1xx_DFP 2.4.1、STM32NUCLEO_BSP 1.8.1 的器件/组件声明 |
| **DFP 器件源码** | `data/fixtures/Packs/Keil/STM32F1xx_DFP/2.4.1/` | `Device/Include/stm32f10x.h`、`Device/Source/ARM/startup_*.s`、`system_stm32f10x.c`、StdPeriph 驱动、`Flash/*.FLM`（下载算法）、`SVD/*.svd` |
| **CMSIS-Core 头** | `data/fixtures/Packs/ARM/CMSIS/6.2.0/CMSIS/Core/Include/` | `core_cm3.h`、`cmsis_compiler.h` 等 23 个头文件（含 Clang 分支） |
| TOOLS.INI 派生配置 | `data/fixtures/tools/tools_ini.json` | 19 个调试驱动 TDRV、2 套工具链注册（ARMCLANG V6.24 / ARMCC V5.06u6）、uVision 5.43a |
| 工具链版本元数据 | `data/fixtures/tools/toolchain.json` | 版本号、命令行模板（`armcc/armasm/armlink/fromelf/armclang`） |
| XSD 全表 | `data/fixtures/UV4/*.xsd` | project_projx/optx/mpw/import/guix/PACK/CPRJ/UVCDB2XML 等 |
| 编辑器 .prop 默认链 | `data/fixtures/UV4/*.prop.def`、`*.prop` | SciTE 属性基线（Scintilla 4.4.6） |
| 源码控制菜单 | `data/fixtures/UV4/*.SVCS` | 11 个 UTF-16 菜单定义（GIT/CVS/SVN/Perforce/VSS…） |
| 样例工程与产物 | `data/fixtures/samples/` | 90 个文件：`.uvprojx/.uvproj/.uvoptx/.uvmpw`、`.dep`、`.sct`、`.lnp`、`Flash.BAT`、`.uvguix`、`.dbgconf`、`.axf`、`.map`、`.hex` |

### 两种模式的行为差异

| 工具类别 | 有 Keil 安装 | 无 Keil 安装（portable） |
| --- | --- | --- |
| 工程模型（`project_read/files/validate/diff/...`） | 可用 | **可用**（结果一致） |
| 依赖分析（`dep_read/graph/impact/write`、`test_build`） | 可用 | **可用**（.dep/.d 解析与生成不依赖编译器） |
| 器件数据（`pack_*`、`cdb_*`、`debug_pack_generate`） | 可用 | **可用**（走内联 pdsc 与 cdb 导出） |
| 镜像分析（`elf_info/map_info/hex_info/memory_usage/symbols_file`） | 可用 | **可用**（纯 Node 解析器） |
| 会话/格式（`editor_props/svcs_menus/gui_layout_read/dbgconf_read/module_catalog`） | 可用 | **可用** |
| 生成器（`batch_generate`、`import_xml_*`、`project_create*`） | 可用 | **可用** |
| UVSOCK（`uvsock_service_table`、编解码） | 可用 | **可用**；实时连接需有 IDE 在跑 |
| `uv4_build/rebuild/convert/export_cprj/symbols/download`、`uv4_console` | 可用 | 返回结构化 `needsKeil` 诊断（含补救步骤），不崩溃 |
| `tool_run`、`toolchain_versions`、`license_status`、`companion_run` | 可用 | 返回结构化 `needsKeil` 诊断 |

`needsKeil` 结构示例（可程序化处理，也给人看）：

```json
{
  "ok": false,
  "needsKeil": true,
  "feature": "uv4 command line",
  "portableMode": true,
  "reason": "This operation drives the real Keil toolchain, which is not installed on this machine.",
  "searched": ["C:\\Keil_v5", "..."],
  "remedy": [
    "Install Keil MDK (µVision) and re-run, or",
    "set KEIL_MDK_ROOT to an existing installation root (the folder containing TOOLS.INI and UV4\\UV4.exe), or",
    "use the portable tools for this task: project_read/project_validate/project_diff, dep_read/dep_graph/dep_impact/dep_write, ..."
  ]
}
```

### 启用完整功能

无需改代码——把 `KEIL_MDK_ROOT` 指向真实安装根目录（含 `TOOLS.INI` 与 `UV4\UV4.exe` 的那一层）后重启服务器，
构建/转换/下载/工具链调用会自动恢复；portable 数据仍作为回退。

### 自检

```powershell
node tests/portable_test.mjs   # 伪造空安装环境，验证 48 项离线能力
node tests/run_tests.mjs       # 有安装时的 106 项链路验收（构建/转换/UVSOCK 实时）
node tests/fuzz_test.mjs       # 10 项畸形输入对抗
node tests/compile_test.mjs    # 零许可编译/烧录，37 项（无编译器时自动 SKIP 真编译）
node tests/beginner_test.mjs   # 新手向诊断（doctor / pack_diagnose / pack_fetch），44 项
node tests/pack_test.mjs       # 发布门禁：npm pack → 解包 → 无 Keil 冷启动 + 真编译，68 项
npm run test:all               # 全部六套（48+10+106+37+44+68 = 313 项）
```

## 一、逆向来源

| 来源 | 内容 | 证据 |
| --- | --- | --- |
| 静态分析 UV4.exe | CLI 解析（`CCommandLineInfo::ParseParam` 0x9d3a11）、依赖库写入器 `FUN_00680b10`、UVSOCK 类（`CUVSOCKServer` 等）、`Error #601` 许可闸 | `reverse/*.json`、REA 调用记录 |
| 实测（受控运行） | 每个命令/开关的退出码、`-z/-q` 在单工程上永久挂起、`-5` 迁移产物、批量编译产物 | `reverse/cli_matrix.json` |
| 官方帮助 uv4.chm | 命令行表、ERRORLEVEL 表、调试父命令、Create Batch File 语义、UVSOCK 设置 | `uv4_htm/` |
| 官方 XSD | `project_projx.xsd`、`project_projx/optx/mpw/import/PACK.xsd` | `UV4\*.xsd` |

## 二、复刻出的关键格式（可逐字节验证）

1. **`.uvprojx` / `.uvoptx`**：读写均保持字节一致；只重写被修改的子树（测试断言未修改文件读后完全不变）。
2. **`<工程>_<目标>.dep`**：`F` 记录的 `(0x%08X)` 是依赖文件的“时钟点”，按十进制 HHMMSS 再以十六进制打印
   （`main.c` 15:52:13 → `0x00155213`）；`F` 内命令列包含 `-IC:\…\Device\Include`、
   `-D__UVISION_VERSION="543"`、定义、`-o`、`--depend`；`I` 记录来自编译器 `--depend` 的包含闭包。
3. **`*.d`**：`"<obj>: <dep>\r\n"` 逐行展开，服务器生成的 `.d`/`.dep` 可被 UV4 原样解析。
4. **批量编译**：`<目标>.BAT`（`SET PATH/ARMCC5_*OPT/CPU_TYPE/CPU_VENDOR/UV2_TARGET/CPU_CLOCK`）、
   `ArmAsm --Via .\objects\x._ia`、`ArmCC --Via .\objects\x.__i`、`ArmLink --Via .\Objects\out.lnp`、`fromelf`。
5. **器件片段**：由 `.pdsc` 生成的 `Cpu:`、`FlashDriverDll`（`UL2CM3(… -FS08000000 -FL020000 …)`）、
   `SFDFile`、`RegisterFile` 与 UV4 `-5` 迁移输出**逐字符一致**（测试中断言）。
6. **多工程 `.uvmpw`**：`<ProjectWorkspace><project><PathAndName/>`；Batch Build 选择位于成员工程的
   `<SelectedForBatchBuild>`，UV4 输出 `Batch-Build summary: N succeeded, …`。

## 三、工具目录（93）

| 分组 | 工具 |
| --- | --- |
| 命令行复刻 | `uv4_build`、`uv4_rebuild`、`uv4_clean`、`uv4_clean_rebuild`、`uv4_rebuild_all`、`uv4_download`、`uv4_symbols`、`uv4_export_cprj`、`uv4_convert`、`uv4_import`、`uv4_run`、`uv4_job_status/list/wait`、`uv4_build_log`、`uv4_processes` |
| 工程模型 | `project_read`、`project_files`、`project_multiproject`、`project_set_option`、`project_group_add/remove`、`project_file_add/remove`、`project_target_clone/remove`、`project_validate`、`project_diff`、`project_create`、`project_create_legacy`、`project_create_multi`、`project_multi_add/read`、`project_batch_flags` |
| 依赖图 | `dep_read`、`dep_graph`、`dep_impact`、`dep_scan`、`dep_write`、`test_build` |
| 器件/Pack | `pack_list`、`pack_devices`、`pack_device_detail`、`pack_components`、`pack_conditions`、`pack_rte_validate` |
| 镜像 | `elf_info`、`map_info`、`hex_info`、`memory_usage`、`symbols_file` |
| 会话选项 | `options_read`、`options_set`、`options_create` |
| 脚手架/批处理 | `batch_file`、`batch_generate`、`import_xml_document`、`import_xml_from_project` |
| 调试器 | `debug_script`、`debug_command_reference`、`debug_pack_generate`、`debug_peripheral_map` |
| 安装/许可 | `keil_install`、`toolchain_versions`、`tool_run`、`license_status`、`uvsock_probe`、`cli_reference`、`cli_table` |
| **UVSOCK 实时控制（新）** | `uvsock_connect`、`uvsock_request`（version/license/prj_load/prj_build/prj_rebuild/enum_targets/get_optitem/set_optitem/mem_read/status/exec_cmd/raw）、`uvsock_disconnect`、`uvsock_service_table` |
| **旧器件库 .cdb（新）** | `cdb_devices`、`cdb_vendors`（2831 器件/33 厂商，UVCDB2XML 转档，内置 dump） |
| **编辑器/源码控制（新）** | `editor_props`（SciTE 属性链 + `$(var)` 展开）、`svcs_menus`（11 个 UTF-16 SVCS 菜单定义） |
| **包文件/伴侣工具（新）** | `pack_file_inspect`、`pack_file_extract`（自研 ZIP/PDSC 读取）、`companion_run`（uv2csolution/UVCDB2XML/SfrCC2/SVDConv/PackUnzip/DoxyIndex/KSPAWN）、`license_architecture` |

## 四、运行

```powershell
cd keil-uv4-mcp
node src/server.mjs          # MCP stdio 服务
npm run test:all             # 218 项验收（便携 + 对抗 + 功能 + 发布门禁）
```

客户端配置见 `mcp.example.json` / `mcp.example.yaml`；环境变量 `KEIL_MDK_ROOT`、
`UV4_TIMEOUT_MS`、`KEIL_UVSOCK_PORT`。

## 五、边界与已知事实

* UV4 是 GUI 子系统程序，自动化必须加 `-j0`，否则等待 stdio 会死锁；每次调用都会重写 `.uvoptx`。
* `-z/-q` 仅适用于 `.uvmpw`；单工程调用会被拒绝，超时则杀进程树（可用 `uv4_processes {kill:true}` 清理）。
* 脚手架默认避开 CMSIS 6.x（其 `cmsis_compiler.h` 的 AC5 分支在 279 行 `#error Unknown compiler.`），
  改为生成自包含 `sysinit.c`；装有 CMSIS 5 时可 `addSystem:true` 复制器件 `system_*.c`。
* `armlm*`/FlexNet 许可组件按黑盒处理：只报告文件、进程与实测的 `Error #601` 构建闸，不改动许可数据。
* UVSOCK（`-s` 端口）提供连通性、首包字节与监听清单；帧级私有编码未公开，调试面通过 `-d` 脚本完整暴露。
* `tool_run` 严格限制在工具链 `bin` 目录内（路径穿越被拒绝）。
* 内联的 DFP 只有 `.pdsc` 声明，没有器件源码包（`Device/Include/*.h`、`startup_*.s`、`.FLM` 实体）。
  因此无 Keil 时 `project_create` 能生成正确 `<Device>/<Vendor>/<PackID>/Cpu/FlashDriverDll`，但
  `project_validate` 会如实报 `NO_STARTUP` / `INCLUDE_MISSING`——这是磁盘上确实缺少文件，不是伪造通过。

## 六、发布与开源

### 安装

```bash
# 方式一：复制即用（无 Keil、无 npm install、无 node_modules）
git clone <repo> && cd keil-uv4-mcp && node src/server.mjs

# 方式二：作为 npm 包（仅 src + data/fixtures + 文档，约 6.8 MB）
npm pack                      # 产出 keil-uv4-mcp-1.0.1.tgz
npm i -g ./keil-uv4-mcp-1.0.1.tgz
keil-uv4-mcp                  # stdio MCP 服务器
```

要求 Node ≥ 20；运行时依赖为 **0**（`dependencies: {}`），CI 会断言这一点。

### 发布门禁：为什么必须有 `tests/pack_test.mjs`

工作树能跑 ≠ 发布包能跑。两个只在打包后才暴露的缺陷已经踩过：

1. **import 期读取开发树数据**：`module_catalog.json` 原本放在 `reverse/`，而 `reverse/` 不进
   `files:`，发布包启动即 `ENOENT` 崩溃。现在数据随包发布到 `data/fixtures/catalog/`，且改为
   首次调用时加载、失败降级为结构化错误。
2. **入口判定按字符串比较路径**：8.3 短路径（`C:\Users\ERDAN~1.DES\…`）、symlink、大小写差异都会
   让 `isMain` 判假——进程导入成功却静默退出。现在统一 `realpathSync.native` + 大小写归一。

门禁流程：`npm pack` → 解包到仓库外临时目录 → 清空 `LOCALAPPDATA`/`KEIL_MDK_ROOT` 模拟无 Keil →
冷启动 → 断言 2831 器件/33 厂商、3 个 `.pdsc`、STM32F103C8 的 64 KiB Flash/20 KiB RAM/
`STM32F10X_MD`/`SVD/STM32F103xx.svd`/`STM32F10x_128.FLM`、`module_catalog` 来自包内、
`.axf/.map/.hex` 解析结果、`uv4_build` 返回 `needsKeil`、8.3 短路径可用。

### 仓库结构

| 目录 | 内容 | 随包发布 |
| --- | --- | --- |
| `src/` | 全部运行时代码（22 个模块 + 14 个工具注册文件） | ✅ |
| `data/fixtures/` | 运行所需快照（134 文件 / 6.44 MB） | ✅ |
| `tests/` | 218 项断言 + 发布门禁 | ❌ |
| `reverse/` | 反编译脚本、证据 JSON、受控实测日志 | ❌ |

### 许可与归属

MIT（见 `LICENSE`）。`data/fixtures/` 中的 `.pdsc`、`UV4.cdb` 导出文本仍属各自权利人，随包发布
仅为互操作；商业再分发前请核对各 `.pdsc` 内的许可条款。本项目不含任何厂商二进制代码。

### 参与

提交前请读 `CONTRIBUTING.md`：核心规则是**功能忠于原版、反编译优先**——每个行为都要能指向
`UV4.exe`/`UVSC.dll` 的函数地址或 `reverse/` 下的受控实测记录；不确定就返回结构化诊断，不猜。
