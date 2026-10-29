# UV4 目录模块档案（穷尽式逆向）

安装根：`%LOCALAPPDATA%\Keil_v5\UV4`。PE 头/版本信息/导入导出实测抓取脚本见 `reverse/` 探针；
子系统 3=控制台（可管道捕获）、2=Windows-GUI（无控制台输出，用消息框）。

## µVision 主体系

| 模块 | 版本 | 角色 | 关键证据 |
| --- | --- | --- | --- |
| **UV4.exe** | 5.43.1.0 “µVision IDE” | IDE 本体：CLI、构建引擎、.dep/.sct/lnp 生成、调试器、UVSOCK 服务、DDE | 首轮完整逆向（uv4_profiles.json、dep_stamp_evidence.json、batch_via_files_evidence.json）；导入表 24 DLL/956 函数（ev_a6e7866a…）：xerces-c DOM 解析、armlm.dll 2 导入、WSOCK32+WSAEnumNameSpaceProviders（UVSOCK 服务）、完整 OLE/自动化 + DDE 字符串（"ddeexec"/topic "System"，DDE 模板注册串 "uVision"） |
| **UV4.dll** | 3.91.55 “**DCOMUTIL30**” | MFC OLE/DCOM 支撑层（ARM 版 oledconf/DOCPROPS 类工具 DLL）；仅 2 个导出，其余走 COM 接口；供 UV4 的 Automation/DDE 服务端 | 导出目录 rva 0x19db30，dll_name "DCOMUTIL.dll"；UV4 内注册模板串 CLSID\%1\ProgID / LocalServer32 / Verb（“uVision Configurator, Keil Software (C) 1997”） |
| **uvision.com** | 223 KB | 控制台壳：转发参数给 UV4 并把输出回显到 stdio（CHM: "-X 想看进度用 uvision.com"） | 与 UV4 同目录，console 子系统 |
| **UvEdit.dll** | 4.4.6 | **Scintilla**（Neil Hodgson）编辑器，UV4 内嵌 | FileDescription "Scintilla.DLL - a Source Editing Component" |
| **UVAC.dll** | 5.36.0.3 | “Dynamic Syntax Checking and Code Completion”（ARM Germany）——编辑器智能补全/语法检查引擎（UvLangBar 类） | 版本串；UV4 字符串“source code translation for editor functionality such as dynamic syntax checking, code completion…” |
| **UvCC.dll** | 3.7.0.0 “LLVM + Keil's Adaptation” | **Arm Compiler 6 集成层**（clang 前端包装），27 MB；GUI 子系统，由 UV4 加载做 AC6 交叉编译服务 | PE32 x86；Product "MDK-ARM Lite 5.43" 血统（编译于同一树）|
| **SysViewer.dll** | 2.30.24.0 | “Display DLL for Special Function Register”——System Viewer 寄存器窗口（SFR 数据由 SfrCC2 预编译） | CHM `uv4_sm_*`（System Viewer 章节 *.sfr 文件过滤） |
| **SfrCC2.Exe** | 2.15.0.0 | SFR 预处理器：`SfrCC2 <base>` → `<base>.LST`（错误格式 “SfrCC2 FATAL-ERROR - ACTION: CREATING FILE FILE:/?.LST”）| 实测 `/?` 被当输入文件名 |
| **UVSC.dll / UVSC64.dll** | 2.30.0.0 “uVision Socket Client DLL” | **UVSOCK 官方客户端库**（x86/x64 同 API，103 导出）；协议完全逆向见 uvsock_protocol.md + uvsock_live.md | 导出表（ev_89962dd0…）；UVSCWrapper.dll = 其 **JNI 包装**（供 Java 工具，如 ApexTeir/EnergyAware 系） |
| **KSPAWN.EXE** | — | 控制台子进程代理：`kspawn "command line"`（隐藏/转发 stdio，GetExitCodeProcess 轮询）；UV4 用它跑编译子进程以便随时终止 | strings：`*** usage: kspawn "command line"` |
| **DoxyIndex.exe** | 1.2.3.0 “Doxygen Index Parser” | 解析 Doxygen `*.tag`/XML 索引生成源码浏览器数据库（Source Browser） | FileDescription |
| **UVCDB2XML.exe** | 4.73.2.1 | **UV4.cdb → XML 转换器**（“µVision component database convertor to xml”，ARM Germany）；无参时直接对同目录 UV4.cdb 输出 `<uvcdb>` XML 到 **stdout**；schema=UVCDB2XML.xsd | 实测 exit 0，4.55 MB XML：2831 器件/33 厂商（reverse/cdb/uv4_cdb.xml） |
| **PackInstaller.exe** | 1.4.1.1 | GUI 包安装器（MFC，ActiveX 检查/SHA 校验/“Required packs not installed for …”依赖提示） | strings 抓取；子系统 2 |
| **PackUnzip.exe** | 1.2.43.0 | 包解压器：`[-i] <InputPath> [-o <OutputPath>] [--no-gui|-l|-p|-v|-h] [--skip-check] [--import]`；-p 抽 PDSC、-l 抽 license、--import 复制进 `.Download` 并解包 | 帮助字符串（PDB 路径 `UV_Installer\PackInstallerGUI`）|
| **xerces-c_3_0.dll / gdiplus / msvcr80/100** | — | 第三方：Xerces-C 3.0 XML 引擎（UV4 全部工程/RTE XML 走它，DOMLSParser 导入证实）、GDI+、VC 运行库 | 导入表 |

## 许可体系（armlm）

| 模块 | 事实 |
| --- | --- |
| **armlm.dll** (x86, 156 KB) | 导出 4：`armlm_request_capabilities` / `armlm_cleanup`（+`armlm_ext_*`）。UV4.exe 导入表直接引用这两个（ev_a6e7866a）。返回能力记录（44B 结构族）供 IDE 门控（Error #601 @0xbf7168） |
| **armlm.exe / armlm-ipc.exe** (x64, Go 1.24.5, 7.8/7.5 MB) | Arm License Manager 新架构：**CGO 包裹 FlexNet Embedded (FNE)** 客户端——CGO_CFLAGS 带 `lm-merge-to-master/native` + `dependencies/fne-client/include`；类型/符号面：`model.License`、licenseStore、memLicenseSource、`doActivation/doReactivation/doActivationNow/getMachineID/ActivationServerURL/ActivationData/Response/proxyActivationData`；FLXERR_* 全谱（trusted storage、capability request/response、host-id callout、tolerance、metered/preview/server 模式）|
| 激活通道 | **`https://api.arm.com/p-software-licensing/v1/activate`**（“Request nonce is mandatory”；“activation client returned HTTPS status code %d”；HTTP/2 栈 go net/http）|
| 本地存储 | `~/.armlm`（日志模板 `~/.armlm/logs/lm_<时间>.log.txt`、usage-analytics cache、“Found %d licenses”）|
| **armlm-gui.exe** (x64) | 激活/托管 GUI（同 Go 栈）|
| **FlexNet/armlmd.exe + armlmdiag.exe** (x86) | 传统 FlexLM 网络许可守护 + 诊断（老协议，与 armlm 并存；本安装未运行）|
| IPC | armlm-ipc.exe 在本地回环 HTTP/2 上代理激活/续期；`ARMLM_INT_TEST_RESET_ACTIVATION_TIME`、`ARMLM_INT_DEBUG_SKIP_IPC_VERSION_CHECK` 两个内部测试环境变量泄露了 IPC 版本校验的存在 |

## 配置与数据格式

| 文件 | 格式事实 |
| --- | --- |
| **UV4.cdb** | 内置器件库（Pack 时代之前，仍服务 Generic/遗留工程）。XML 导出结构：`<uvcdb schemaVersion="1.0"><vendor name="厂商:ID"><device name core family>` + `startup/system/includeFile/includePath/description`。示例：STM32F103C8 → `STARTUP\ST\STM32F10x\startup_stm32f10x_md.s`、`stm32f10x.h`、厂商 `STMicroelectronics:13` |
| **global.prop(.def) / arm.prop / a51.prop.def …** | SciTE 风格属性（UvEdit=Scintilla 4.4.6）：`#` 注释、`key=value`、`$(var)` 展开、`file.patterns.asm=*.asm;*.s;*.A51;*.A66;*.A251;*.inc;*.sct`、`keywords0..8.$(file.patterns.*)` 分类高亮（0=默认 1=关键词 3=数字 4=字 5=串…）；`.def`=出厂默认、无 .def=用户覆盖（global.prop 实测含 `code.page=936`）|
| **\*.SVCS** (11 个) | **UTF-16LE INI**：`[SVCS] DataBase=<id>` + 重复 `MenuItem=标签（%F=当前文件）/ Command / Arguments（git diff 等，#F 无引号参）/ Environment / RunMinimized / QueryComment / QueryRevision / QueryCheckPoint / Initial_Folder`；`MenuItem=----…` 为分隔线。UVSC.dll 按此驱动任意 VCS（GIT/CVS/SVN/Perforce/VSS/MKS/ClearCase/PVCS/RCS…）。QueryComment=1 时 µVision 弹注释框 |
| **pack-requirements.yml** | RTE 依赖映射：`Keil::MDK-Middleware: Keil::MDK-Middleware_Graphics@1.3.1`，`ARM::CMSIS: [CMSIS-NN@^4.0.0, CMSIS-DSP@^1.10.1]`（semver 范围由 PackInstaller 解析）|
| **PACK.xsd / project_proj(x).xsd / project_opt(x).xsd / project_mpw.xsd / project_import.xsd / project_gui(x).xsd / UVCDB2XML.xsd / Component_Viewer.xsd / CPRJ.xsd** | 官方 schema 全集（首轮已用于校验；CPRJ.xsd=csolution 工程描述）|
| **.pack** | 纯 ZIP（deflate）+ 顶层 `.pdsc`；自研读取器 `src/packfile.mjs`（EOCD→中央目录→inflateRaw；zip-slip 防护），与 PackUnzip 行为等价 |
| **uv2csolution.exe** | **Go 1.x 控制台** v1.6.0：`uv2csolution <uvprojx|uvmpw> [-d outdir]` → `<proj>.csolution.yml` + `<proj>.<target>.cproject.yml` + `vcpkg-configuration.json`；**AC5 目标直接拒绝**（“The target "X" is configured to use Arm Compiler 5… AC6 only”，实测 exit≠0；AC6 化后成功 “1 out of 1 target(s) converted”）|
| **SVDConv.exe** | v3.3.48 CMSIS-SVD 校验/生成：`--generate header/partition/sdf`、`--fields enum/macro/struct/struct-ansic`、`--strict`、`-b log` 等（帮助全量抓取）|
| **uv4.chm / uv4jp.chm** | 官方手册（英文/日文），首轮已解包 1120 文件到 `uv4_htm/`（含 DDE 主题章节、UVSOCK 应用笔记链接、调试命令全表）|

## DDE/自动化面（UV4.exe 字符串证实）

- MFC OLE 自动化服务端完整存在：`CLSID\…\LocalServer32`、`ProgID`、`Verb`、`Insertable` 注册模板与
  `AfxOleSetUserCtrl`、`-Embedding/-Automation/-Regserver/-Unregserver` MFC 命令串（ParseParamFlag 0x9d3a62 实测在 UV4 内）→
  **UV4 注册为 COM/OLE 自动化服务器**（`CreateObject("uVision.Application")` 路线，CHM “Remote Control of IDE” 应用笔记族）。
- 经典 **DDE**：服务名 `uVision`、话题 `System`/`Control`、`ddeexec`、`-x/-y` 开启“DDE mode”（首轮 CLI 矩阵已证实 -x/-y 与 -d 组合有效）。
- **UVSOCK TCP**：`-s<port>` 起服，实测 `0.0.0.0:4328 LISTENING`（v2.29 帧协议，上文）。

## 汇总：新逆向并入 MCP 的能力

`src/uvsock.mjs`（线协议客户端）+ `src/cdb.mjs` + `src/editor.mjs` + `src/packfile.mjs` + `src/tools/modules.mjs`
→ 工具 69 → **81**：`uvsock_service_table / uvsock_connect / uvsock_request / uvsock_disconnect`、
`cdb_devices / cdb_vendors`、`editor_props`、`svcs_menus`、`pack_file_inspect / pack_file_extract`、
`companion_run`（uv2csolution/UVCDB2XML/SfrCC2/SVDConv/PackUnzip/DoxyIndex/KSPAWN）、`license_architecture`。

## Round 6 追加：全导出目录 + module_catalog 工具

- `UVAC.dll` 导出 14：编辑器智能 API 全表（CheckSyntax/GetCodeCompletion/getBrowseInfo/openPrj/populatePrj/refreshIndexer/updateDep…）→ 证实“动态语法检查/补全/浏览”由 UVAC 独立进程内索引引擎提供，输入 = `createDirtyTransUnit` 增量翻译单元（对应 UV4 字符串 source-code translation 提示）。
- `UvEdit.dll` 导出仅 1：`_Scintilla_DirectFunction@16` —— 标准 Scintilla DirectFunction 单入口，UV4 全部编辑消息走 `SendMessage` 风格转发。
- `SysViewer.dll` 导出仅 1：`BootDll` —— 锚点式加载（installanchorservice.exe 注册），配合 SfrCC2 预处理过的 .sfr。
- `UVSCWrapper.dll` 导出 275：C++ 类面（UVSCWrapper/UVSCCallback/UVSCLogCallback），方法级 API = UVSOCK 的对象封装（Create{Line,Exec,Watch}point / EvaluateWatchExpression / Enum{Variables,StackFrames,Tasks,Menus} / Command / AddressToFileLine / Event 回调）—— Java 工具经 JNI 使用。
- `armlm.dll` 导出 4（armlm_request_capabilities/cleanup + ext 变体），UV4 导入证实。

全部 26 模块 + 8 数据格式固化到 `reverse/module_catalog.json`，服务器新工具 **`module_catalog`**（filter=模块名子串）在线查询；`gui_layout_read`（.uvguix 真实文件 79 窗口验证）与 `dbgconf_read`（STM32F10x .dbgconf 23 选项验证）同轮并入。工具 84，验收 101/101。

UVSC64.dll 103 导出经 REA 直接复核（amd64, sha256 ed1898af…, Evidence ev_d2afc677）；UVSC.dll 会话快照存 uvsc_snapshot.rea（16 workflow entries / 23 evidence records）。

## 第三轮补齐（功能级）

### UvCC.dll = 静态链接 libclang，320 导出全是 clang_* C API
- sha256 80ba4a3a1186a196f82165d4f4c5b837b11cf652e1cdcc8352a7052569d96db4，27,831,808 B，PE32 x86，导出目录 rva 0x19CCD0，320 项。
- 全部 320 个导出均为 clang_* 前缀，非 clang 前缀导出为 0 —— 它是静态链接 libclang 的 C API 库，没有私有接口面。
- 家族分布（实测，明细见 reverse/uvcc_exports.json）：clang_*(泛指) 182、clang_Cursor 28、clang_index 12、clang_Type 8、clang_CompileCommand 7、clang_Module 7、clang_constructUSR 6、clang_ModuleMapDescriptor 5、clang_ParamCommandComment 5、clang_VirtualFileOverlay 5、clang_BlockCommandComment 4、clang_CXXMethod 4、clang_Comment 4、clang_CompilationDatabase 4、clang_InlineCommandComment 4、clang_TParamCommandComment 4、clang_CompileCommands 3、clang_HTMLStartTag 3、clang_remap 3、clang_CXCursorSet 2、clang_CXIndex 2 等。
- 编辑器语义索引栈：UvCC.dll(libclang 语义层) <- UVAC.dll(14 导出：CheckSyntax / GetCodeCompletion / getBrowseInfo / getIndexCont / createDirtyTransUnits / updateDep / openPrj / populatePrj / refreshIndexer) <- UvEdit.dll(Scintilla 4.4.6 单导出 _Scintilla_DirectFunction@16) <- UV4 编辑器 UI。
- 结论：动态语法检查/补全/浏览信息由 libclang 的 TU 与游标查询实现，不是自研解析器。

### uvision.com = uVisionLauncher（µVision command line 5.36.0.0）
- 单依赖 KERNEL32.dll（90 个 API），无第三方依赖。
- 三条 PID 后缀命名管道（字符串实测）：`\\.\pipe\%dcout`、`\\.\pipe\%dcin`、`\\.\pipe\%dcerr`；失败串 ERROR: Could not create named pipes.（伴随 Beep）。
- 机制链（导入表实证）：CreateNamedPipeA + ConnectNamedPipe 建管道 -> GetModuleFileNameA 定位同目录 uv4.exe -> GetCommandLineA 原样转发命令行 -> 挂起创建 + ResumeThread -> WaitForSingleObject + GetExitCodeProcess 传播 ERRORLEVEL -> SetConsoleCtrlHandler 转发 Ctrl+C（硬断 TerminateProcess）-> ReadConsoleW / WriteConsoleW 回显到调用方控制台。
- 等价实现：src/consolewrap.mjs（UVISION_COM_CONTRACT / forwardArgv / runConsole）+ MCP 工具 uv4_console 与 uvision_com_reference。
- 实测：-b minimal.uvprojx -j0 -sg -> exitCode 0；缺失工程 -> exitCode 15（UV4 写工程文件错误码），转发与退出码语义一致。

### UVSOCK 0x2021 定名
- FUN_10007570(this, buf)：0x3C=60 字节 in-place 结构（15×u32），silent=0、noAck=0、无隐式 EXIT。
- procedure_callers(0x10007570) = [0x10002220] = UVSC_POWERSCALE_SHOWCODE => 0x2021 = PowerScale 显示代码服务。
