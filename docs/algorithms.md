# UV4 算法档案（二次开发用）

本文件把 `UV4.exe` 5.43.1.0 里**已经取证确认**的算法整理成可实现的规则：每条给出
输入、判定规则、产物字节、函数地址/证据 ID，以及本仓库里对应的参考实现。
用于二次开发（自己写 IDE/构建器/CI 插件），不依赖任何 Keil 许可。

证据分级：

| 级别 | 含义 |
| --- | --- |
| **A** | 反编译/反汇编定位到具体函数地址，且有常量/格式串支撑 |
| **B** | 受控运行观察到的字节级产物（日志、生成文件） |
| **C** | 由 A+B 推导出的规则，边界已被测试覆盖 |

复现命令：`REA`（`open_binary` + `analyze_function`）或 `ig5_*` 工具；地址为 VA（image base 0x400000）。

---

## 1. 工程模型（.uvprojx / .uvproj / .uvoptx / .uvmpw）

| 项 | 算法 | 级别 | 参考实现 |
| --- | --- | --- | --- |
| 解析 | Xerces-C 3.0 DOM；SchemaVersion 2.1（`.uvprojx`）/ 1.1（`.uvproj`） | A（导入表 xerces-c_3_0） | [src/xml.mjs](../src/xml.mjs) |
| 写回 | **只重写被修改的子树**，其余元素按原字节输出；缩进 2 空格、CRLF | B（测试断言未修改文件读后完全一致） | `Project.save()` |
| 元素顺序 | 按 XSD 顺序，`<Targets>` → `<Target>` → `<TargetOption>`…；新增元素插到 schema 位置 | B | [src/project.mjs](../src/project.mjs) |
| 布尔/数值 | `<uAC6>1</uAC6>`、`<Optim>2</Optim>`；缺省值需按 UV4 默认补齐而非省略 | B | `readTarget()` |

**二次开发要点**：不要用通用 XML 美化器重排——UV4 的 diff 是字节级的，重排会让所有
`.uvprojx` 在版本控制里变成全文件改动。

---

## 2. 器件 → TargetOption 映射

输入：`.pdsc` 的 `<device>` 节点。输出：`<TargetCommonOption>` 与 `<TargetArmAds>` 片段。

```
Cpu:        IRAM(<start>,<size>) IROM(<start>,<size>) CPUTYPE("<core>") CLOCK(<hz>) ELITTLE
            ↑ IRAM 在前，IROM 在后；大小写固定；顺序固定
FlashDriverDll: UL2CM3(-S0 -C0 -P0 -FD<ram_base> -FC<ram_size_hex> -FN1 -FF0<flm_base>
                        -FS0<flm_start> -FL0<flm_size> -FP0($$Device:<device>$<flm_path>))
SFDFile:    $$Device:<device>$<svd_path>
Define:     <device.define>
```

| 项 | 算法 | 级别 | 证据 |
| --- | --- | --- | --- |
| `Cpu` 串 | 由 pdsc 的 memory 列表拼装，IRAM 优先 | A/B（与 UV4 `-5` 迁移输出逐字符一致） | `src/scaffold.mjs` |
| `UL2CM3(...)` | 参数顺序固定；`-FS0`/`-FL0` 用 8 位十六进制；`$$Device:<name>$` 前缀 | B | 同上 |
| clock | `CLOCK(72000000)` 十进制 | B | 样本工程 |

参考实现：[src/scaffold.mjs](../src/scaffold.mjs)、[src/packs.mjs](../src/packs.mjs)。

---

## 3. 命令行解析

```cpp
// CCommandLineInfo::ParseParam  @0x9d3a11
//  首个非开关参数 = 项目文件；开关大小写不敏感；未知开关进 -o 之后的透传表
```

| 命令 | 语义 | ERRORLEVEL |
| --- | --- | --- |
| `-b` | 构建当前目标 | 0 成功 / 1 警告 / ≥2 错误 |
| `-r` | 重建 | 同上 |
| `-c` / `-cr` | 清理 / 清理后重建 | 同上 |
| `-z` / `-q` | 批量构建全部 / 选中目标（**仅 `.uvmpw`**） | 同上 |
| `-f` | 下载到 Flash | 同上 |
| `-5` | `.uvproj` → `.uvprojx` 迁移 | 20 = 已是新格式 |
| `-j0` | 关闭 GUI 等待（GUI 子系统必需，否则 stdio 死锁） | — |
| `-s<port>` | 启动 UVSOCK 服务 | — |
| `-X` / `-X1` | 生成 `co-arm_<target>.h/hpp` 符号文件 | — |

级别 A（`CCommandLineInfo::ParseParam` 0x9d3a11，`reverse/cli_matrix.json` 有逐项退出码）。
参考实现：[src/uv4cli.mjs](../src/uv4cli.mjs)。

---

## 4. 构建引擎

```
UV4 -b project.uvprojx
  └─ kspawn "ArmCC ..."        ← 控制台子进程代理（可随时终止）
       └─ armcc/armasm → .o/.d
  └─ kspawn "ArmLink ..."
  └─ fromelf --i32combined     ← 仅当 CreateHexFile=1
```

| 算法 | 规则 | 级别 |
| --- | --- | --- |
| 子进程 | `kspawn "<完整命令行>"`；UV4 轮询 `GetExitCodeProcess`，可中断 | A（strings `*** usage: kspawn "command line"`） |
| 并行 | 每目标并发 ≤ 2（本仓库默认 `maxConcurrentUv4=2`） | C |
| 日志 | 构建输出写 `<project>.build_log.htm`；`-o <file>` 可重定向 | B |
| 退出码 | 累加：错误码取最大；警告单独成 1 | B（`cli_matrix.json`） |

---

## 5. `.dep` 依赖库写入（核心算法）

**生产者：`FUN_00680b10` @0x680b10，1041 字节。**
证据：`ev_f9cfaf795ab7c53d96170c19929cde5954ced6ad804cbf0d07ef62ad71da34fd`，
详见 [reverse/dep_stamp_evidence.json](../reverse/dep_stamp_evidence.json)。

格式（逐字节）：

```
\r\nDependencies for Project '<proj>', Target '<target>': (DO NOT MODIFY !)\r\n
CompilerVersion: <ver>\r\n
F (<path>)(0x%08X)(<command>)\r\n
I (<fullpath>)(0x%08X)\r\n
...
```

| 规则 | 细节 |
| --- | --- |
| 印章（stamp） | `stat.st_mtime` 的**秒**值，按 `0x%08X` 打印。`F`/`I` 都存"依赖文件最后写入时间"，**不是内容哈希** |
| 写入时机 | `.dep` 在工具**运行前**写出，F() 里的 command 是"将要执行"的命令行 |
| 跳过条件 | 文件标志 `&4` 跳过；`.uvpdbg` 跳过；`byte+0x21 & 8` 跳过 |
| I 记录 | 仅对类型字节 `+0x20` ∈ {1,2,8}（C/asm/C++）生成；链表头 `file+0x6c`，节点 `{next@0, fullpath@2, hash@3}` |
| 换行 | 命令行内的 `\n` 在写入前统一改写为 `\r`（循环 0x680cff..0x680f17） |
| 路径 | `F` 保持工程相对形式；`I` 为 UV4 解析出的完整路径 |
| 哈希内核 | `FUN_00a8d486 → FUN_00a8cc1a(mbs→wcs) → FUN_00a8cc9b(_stat64i32)`，取 `st_mtime` 放入返回值高 32 位 |

参考实现：`src/tools/deps.mjs` 的 `dep_write`（内部用 `src/deps.mjs` 的 `uv4Stamp`/`stampHex`）。测试断言生成结果可被 UV4 原样解析。

---

## 6. 增量判定

```
stale(file) ⇔ floor(mtime_ms / 1000) != 记录的 stamp
```

后果（重要）：同一秒内的两次写入，UV4 认为是"未变"；复制文件会改变 mtime 从而触发重编。
级别 C（由第 5 节算法直接推出，测试覆盖）。

---

## 7. `.d` 依赖文件

不是 UV4 生成，是**编译器** `--depend <file>.d` 的产物：

```
<obj>: <source>
<obj>: <header>      ← 编译器实际打开过的每个头文件，一行一条
```

UV4 只负责把 `<obj>.<ext>` 与 `--depend .\objects\<name>.d` 塞进命令行（见第 8 节）。

---

## 8. 批量构建产物（`.BAT` / `.__i` / `._ia` / `.lnp`）

证据：[reverse/batch_via_files_evidence.json](../reverse/batch_via_files_evidence.json)。

`<Target>.BAT`（写在工程根）：

```
SET PATH=<toolchain bin>;<inherited PATH>
SET ARMCC5_ASMOPT=--diag_suppress=9931
SET ARMCC5_CCOPT=--diag_suppress=9931
SET ARMCC5_LINKOPT=--diag_suppress=9931
SET CPU_TYPE=<device>
SET CPU_VENDOR=<vendor>
SET UV2_TARGET=<target>
SET CPU_CLOCK=0x00B71B00          ← 器件时钟，十六进制（72MHz → 0x00B71B00）
"<toolset>\ArmAsm"  --Via ".\objects\startup._ia"
"<toolset>\ArmCC"   --Via ".\objects\main.__i"
"<toolset>\ArmLink" --Via ".\Objects\main.lnp"
"<toolset>\fromelf.exe" ".\Objects\main.axf" --i32combined --output ".\Objects\main.hex"
```

`.objects\<name>.__i`（编译器 via）：

```
--c99 -c --cpu Cortex-M3 -D__EVAL -g -O<n> --apcs=interwork -I<user paths>
-I<RTE Device\Include> -D__UVISION_VERSION="543" -D<defines>
-o .\objects\<name>.o --depend .\objects\<name>.d "<source>"
```

`.\objects\<name>._ia`（汇编 via）：同上但用 `--pd "X SETA 1"` 代替 `-D`，
并带 `--list .\listings\<name>.lst --xref`。

`.\Objects\<out>.lnp`（链接 via）：`--cpu` → 每个 `.o` 一行 → `--scatter "<out>.sct"`
→ `--summary_stderr --info summarysizes --map --load_addr_map_info --xref --callgraph --symbols`
→ `--info sizes --info totals --info unused --info veneers`
→ `--list "<listings>\<out>.map" -o "<objects>\<out>.axf"`。

注入顺序（每个 F 记录内）：`--cpu → __EVAL → -g → -O<n> → --apcs → 用户 include →
RTE include → __UVISION_VERSION → defines → misc → --list → --xref → -o → --depend`。

参考实现：`src/tools/batchgen.mjs`（`viaLines`）与 `src/toolchain.mjs`（`buildCompileCommand`）。

---

## 9. UVSOCK 协议

| 项 | 算法 | 级别 |
| --- | --- | --- |
| 帧头 | 32 字节小端：`u32 totalLen(=0x20+dataLen)`、`u32 serviceId`、`u32 dataLen`、`u32[5] reserved=0` | A（`UVSC.dll` FUN_1000ae90/FUN_1000b760） |
| 应答 | 每个请求后跟 `ACK = 0xC` | A |
| 错误帧 | serviceId `0x201F` | A |
| 构建事件 | `0x5000` / `0x5001` 流式输出 | A |
| 服务号 | 1=version、0xB=checkLicense、prj_load/prj_build/prj_rebuild/enum_targets/get_optitem/set_optitem/mem_read/status/exec_cmd | A |

详见 [reverse/uvsock_protocol.md](../reverse/uvsock_protocol.md)、
[reverse/uvsock_live.md](../reverse/uvsock_live.md)（V2.29 实测握手 + 远程重建）。
参考实现：[src/uvsock.mjs](../src/uvsock.mjs)。

---

## 10. 许可闸（Error #601）

```
UV4.exe ──imports──▶ armlm.dll
                       ├─ armlm_request_capabilities   (44B 能力记录)
                       └─ armlm_cleanup
构建前检查 → 失败则弹 "Error #601: ..." 并终止（0xbf7168 附近）
```

- `armlm` 是黑盒：本仓库只**观测**（文件、进程、#601 触发条件），不修改许可数据。
- **免认证路径**：不使用 UV4/armcc，用 clang 或 arm-none-eabi-gcc 编译（见
  `compile` 工具），完全绕开 armlm 与 #601。这是本项目的默认开源路径。
- 级别 A（导入表 + 字符串 + 受控触发），见 [src/license.mjs](../src/license.mjs)。

---

## 11. 迁移（`-5`）

`.uvproj`(SchemaVersion 1.1) → `.uvprojx`(2.1)：元素重命名 + 默认值补齐 + SchemaVersion 改写；
`Error 20` = 已经是 `.uvprojx`。级别 B（产物逐字符比对）。
参考实现：`src/uv4cli.mjs`；测试见 `tests/run_tests.mjs` 的 convert 用例。

---

## 12. 二次开发接口

### 12.1 直接 import（Node ≥ 20，零依赖）

```js
import { Project } from './src/project.mjs';        // 读写 .uvprojx（字节保真）
import { loadCdb, cdbFind } from './src/cdb.mjs';   // 2831 器件遗留库
import { listPackCatalog, findDevices } from './src/packs.mjs';
import { readDep } from './src/deps.mjs';          // .dep 解析/图/影响面
import { buildCompileCommand } from './src/toolchain.mjs'; // 编译命令行
import { UvsockClient } from './src/uvsock.mjs';    // UVSOCK 客户端
import { portableCompile, detectBackends } from './src/build.mjs'; // 免认证编译
```

### 12.2 MCP 工具映射

| 需求 | 工具 |
| --- | --- |
| 读/改工程 | `project_read`、`project_set_option`、`project_file_add`、`project_diff` |
| 依赖分析 | `dep_read`、`dep_graph`、`dep_impact`、`dep_write` |
| 器件查询 | `pack_devices`、`pack_device_detail`、`cdb_devices` |
| **免认证编译** | **`compile`**（clang/gcc → .elf/.hex/.bin/.map） |
| **免认证烧录** | **`flash`**（pyOCD/OpenOCD/ST-LINK/J-Link，默认 dryRun） |
| 环境自检 | `build_backends` |
| 有 Keil 时 | `uv4_build`、`uv4_rebuild`、`uv4_download` |

### 12.3 复刻新算法的工作流

1. `REA open_binary` 打开 `%LOCALAPPDATA%\Keil_v5\UV4\UV4.exe`（image base 0x400000）。
2. 用字符串/导入表定位候选 → `analyze_function` / `inspect_native_api`。
3. 在 `reverse/` 下记录：函数地址、关键常量、格式串地址、证据 ID。
4. 在 `src/` 写参考实现，并在 `tests/` 加字节级断言（对照受控运行产物）。
5. 更新本文件对应条目（级别 + 证据）。

---

## 13. 已知未知（不要猜）

| 区域 | 状态 |
| --- | --- |
| Xerces-C 内部 DOM 行为 | 第三方库，不逆向；只按 XSD 与产物验证 |
| 调试器（`-d` 脚本）协议 | 命令面通过 CHM + 实测覆盖；底层 GDI/JTAG 时序未逆向 |
| `armlm` 能力记录 44B 的位域语义 | 只观测到触发条件，位含义未知 |
| UV4 代码生成（armcc 内部） | 属 ARM 编译器，不在 UV4.exe 内；免认证路径改用 clang/gcc |
| `.uvguix` 布局算法 | 结构已解析（DockMan），无算法性内容 |

遇到本表未覆盖的行为，正确做法是补证据，或在工具里返回结构化诊断——不要用"看起来合理"的默认值。
