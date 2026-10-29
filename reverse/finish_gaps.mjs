import fs from "node:fs";
const R = new URL("./", import.meta.url);

// ---- 1) protocol doc: name 0x2021 ----
{
  const p = new URL("uvsock_protocol.md", R);
  let t = fs.readFileSync(p, "utf8");
  t = t.replace(
    "| 0x2021 | 60B 结构 in-place（定名待做） | FUN_10007570 |",
    "| 0x2021 | **功耗标尺（PowerScale）代码/能耗标注**：60B（0x3C）in-place 结构（15×u32），silent=0、noAck=0、**无隐式 EXIT**；请求与响应共用同一缓冲。唯一调用者 = `UVSC_POWERSCALE_SHOWCODE`(0x10002220)，`procedure_callers` 实测闭环 | FUN_10007570 ← 0x10002220 |"
  );
  t = t.replace(
    "| 0x2020 | 命令执行完整版",
    "| 0x2020 | 命令执行完整版"
  );
  if (!t.includes("0x2021 定名闭环")) {
    t = t.replace(
      "### 事件帧（frameId 层",
      "### 0x2021 定名闭环（第三轮补齐）\n`FUN_10007570(this, uint* buf)`：`local_8 = 0x3C`（60 字节），`FUN_1000ae90(this, 0x2021, buf, 0x3C, buf, &local_8, '\\0', '\\0')` —— in-place 请求/响应同构、静默关、无隐式 EXIT。Ghidra `procedure_callers` 仅返回 `0x10002220` = `UVSC_POWERSCALE_SHOWCODE`，因此 0x2021 = **PowerScale 显示代码服务**（功耗标尺把能耗/周期标注反查回源码行）。\n\n### 事件帧（frameId 层"
    );
  }
  fs.writeFileSync(p, t);
  console.log("uvsock_protocol.md: 0x2021 named");
}

// ---- 2) modules.md: UvCC + uvision.com + 0x2021 ----
{
  const p = new URL("modules.md", R);
  let t = fs.readFileSync(p, "utf8");
  t += `
## 第三轮补齐（功能级）

### UvCC.dll = libclang 320 导出（无自定义导出）
- sha256 \`80ba4a3a1186a196f82165d4f4c5b837b11cf652e1cdcc8352a7052569d96db4\`，27,831,808 B，PE32 x86，导出目录 rva 0x19CCD0 / 320 项。
- **全部 320 个导出均为 \`clang_*\`，非 clang 前缀导出为 0** —— 它是**静态链接 libclang 的 C API 库**，没有自己的私有接口。
- 家族分布（实测计数，见 \`reverse/uvcc_exports.json\`）：`clang_*`(泛指) 182、`clang_Cursor_*` 28、`clang_index_*` 12、`clang_Type_*` 8、`clang_CompileCommand_*` 7、`clang_Module_*` 7、`clang_constructUSR_*` 6、`clang_ModuleMapDescriptor_*` 5、`clang_ParamCommandComment_*` 5、`clang_VirtualFileOverlay_*` 5、`clang_BlockCommandComment_*` 4、`clang_CXXMethod_*` 4、`clang_Comment_*` 4、`clang_CompilationDatabase_*` 4、`clang_InlineCommandComment_*` 4、`clang_TParamCommandComment_*` 4、`clang_CompileCommands_*` 3、`clang_HTMLStartTag_*` 3、`clang_remap_*` 3、`clang_CXCursorSet_*` 2、`clang_CXIndex_*` 2…
- **编辑器语义索引栈定性**：`UvCC.dll`(libclang 语义层) ← `UVAC.dll`(14 导出：`CheckSyntax` / `GetCodeCompletion` / `getBrowseInfo` / `getIndexCont` / `createDirtyTransUnits` / `updateDep` / `openPrj` / `populatePrj` / `refreshIndexer`) ← `UvEdit.dll`(Scintilla 4.4.6, \`_Scintilla_DirectFunction@16\`) ← UV4 编辑器 UI。即：**动态语法检查与补全 = libclang 的 TU/游标查询**，不是自研解析器。

### uvision.com = uVisionLauncher（µVision command line, 5.36.0.0）
- 单依赖 **KERNEL32.dll（90 个 API）**，无 CRT 之外的第三方依赖。
- 三条 **PID 后缀命名管道**（字符串实测）：\`\\\\.\\pipe\\%dcout\`、\`\\\\.\\pipe\\%dcin\`、\`\\\\.\\pipe\\%dcerr\`；失败串 \`ERROR: Could not create named pipes.\`（伴随 \`Beep\`）。
- 机制链（导入表实证）：\`CreateNamedPipeA\`+\`ConnectNamedPipe\` 建管道 → \`GetModuleFileNameA\` 定位同目录 \`uv4.exe\` → \`GetCommandLineA\` **原样转发命令行** → 挂起创建 + \`ResumeThread\` → \`WaitForSingleObject\`+\`GetExitCodeProcess\` **传播 ERRORLEVEL** → \`SetConsoleCtrlHandler\` 转发 Ctrl+C（硬断用 \`TerminateProcess\`）→ \`ReadConsoleW\`/\`WriteConsoleW\` 回显到调用方控制台。
- 等价实现：\`src/consolewrap.mjs\`（导出 \`UVISION_COM_CONTRACT\` / \`forwardArgv\` / \`runConsole\`）+ MCP 工具 **\`uv4_console\`**（argv 原样转发、stdout/stderr 镜像、退出码传播、超时杀进程树）与 **\`uvision_com_reference\`**（契约表）。
- 实测：\`-b minimal.uvprojx -j0 -sg\` → exitCode **0**；缺失工程 → exitCode **15**（UV4 的“写工程文件错误”码），证明转发与退出码语义一致。
`;
  fs.writeFileSync(p, t);
  console.log("modules.md: appended round 3");
}

// ---- 3) catalog: fix the two shallow entries ----
{
  const p = new URL("module_catalog.json", R);
  const c = JSON.parse(fs.readFileSync(p, "utf8"));
  c.modules["UvCC.dll"] = {
    role: "静态链接 libclang 的语义索引库（编辑器语法检查/补全的底座）",
    version: "3.7.0.0 (LLVM + Keil adaptation)",
    size: 27831808,
    sha256: "80ba4a3a1186a196f82165d4f4c5b837b11cf652e1cdcc8352a7052569d96db4",
    exports: 320,
    exportsAreAllClangCAPI: true,
    exportFamilies: { "clang_(generic)": 182, "clang_Cursor": 28, "clang_index": 12, "clang_Type": 8, "clang_CompileCommand": 7, "clang_Module": 7, "clang_constructUSR": 6, "clang_ModuleMapDescriptor": 5, "clang_ParamCommandComment": 5, "clang_VirtualFileOverlay": 5, "clang_BlockCommandComment": 4, "clang_CXXMethod": 4, "clang_Comment": 4, "clang_CompilationDatabase": 4, "clang_InlineCommandComment": 4, "clang_TParamCommandComment": 4 },
    stack: "UvCC(libclang) <- UVAC.dll(CheckSyntax/GetCodeCompletion/getBrowseInfo/refreshIndexer) <- UvEdit.dll(Scintilla 4.4.6)",
    notes: "非 clang 前缀导出为 0：无私有接口，功能面即 libclang C API；详见 reverse/uvcc_exports.json",
  };
  c.modules["uvision.com"] = {
    role: "µVision command line (uVisionLauncher)：转发命令行给 uv4.exe 并回显",
    version: "5.36.0.0",
    size: 223224,
    imports: "KERNEL32.dll 仅 90 个 API（无其它依赖）",
    pipes: ["\\\\.\\pipe\\%dcout", "\\\\.\\pipe\\%dcin", "\\\\.\\pipe\\%dcerr"],
    mechanism: "CreateNamedPipeA+ConnectNamedPipe 建三条 PID 管道 -> GetCommandLineA 原样转发 -> 挂起创建+ResumeThread -> WaitForSingleObject/GetExitCodeProcess 传播 ERRORLEVEL -> SetConsoleCtrlHandler 转发 Ctrl+C -> ReadConsoleW/WriteConsoleW 回显",
    equivalent: "src/consolewrap.mjs + MCP 工具 uv4_console / uvision_com_reference；实测 -b => exit 0，缺失工程 => exit 15",
  };
  fs.writeFileSync(p, JSON.stringify(c, null, 2));
  console.log("module_catalog.json: UvCC + uvision.com upgraded to functional level");
}
