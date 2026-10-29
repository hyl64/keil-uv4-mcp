# UVSOCK 实时抓取（原始证据）

会话：UV4 5.43a pid 26224，`UV4.exe -j0 -s4328 minimal.uvprojx -sg`（project opened, hidden GUI）
抓取脚本：`reverse/uvsock_trace.mjs`；原始帧日志如下。

```
$ node reverse/uvsock_trace.mjs
+11ms    frame=0x3000 inner=0x1    dl=12  payload: 01000000 00000000 e5000000        ; VERSION → V2.29 (0xE5=229)
+539ms   frame=0x3000 inner=0x1006 dl=8   payload: 06100000 00000000                  ; BUILD accepted (no notice)
+542ms   frame=0x5001 inner=0x1f  dl=40  "Build started: Project: minimal."           ; 文本行 textLen=0x1f(31) @payload[4]
+551ms   frame=0x5001 inner=0x7d  dl=134 "*** Using Compiler 'V5.06 update 6 (build 750)', folder: …"
+552ms   frame=0x5001 inner=0x14  dl=29  "Build target 'Flash'."
+556ms   frame=0x5001 inner=0x30  dl=57  ".\Objects\main.axf" - 0 Error(s), 0 Warning(s)."
+558ms   frame=0x5001 inner=0x1d  dl=38  "Build Time Elapsed:  00:00:00"
+558ms   frame=0x5000 inner=0x0   dl=8   payload: 00000000 01000000                  ; BUILD_DONE code=1 (OK) @payload[4]
+13543ms frame=0x3000 inner=0x1007 dl=8  payload: 07100000 00000000                  ; REBUILD accepted
+13545ms frame=0x5001 dl=42  "Rebuild started: Project: minimal."
+13554ms frame=0x5001 dl=134 "*** Using Compiler …"
+13555ms frame=0x5001 dl=31  "Rebuild target 'Flash'."
+13647ms frame=0x5001 dl=32  "assembling startup.s..."
+13697ms frame=0x5001 dl=28  "compiling main.c..."
+13699ms frame=0x5001 dl=19  "linking..."
+13817ms frame=0x5001 dl=65  "Program Size: Code=340 RO-data=40 RW-data=4 ZI-data=96"
+13823ms frame=0x5001 dl=38  "FromELF: creating hex file..."
+13902ms frame=0x5001 dl=57  ".\Objects\main.axf" - 0 Error(s), 0 Warning(s)."
+13904ms frame=0x5001 dl=38  "Build Time Elapsed:  00:00:00"
+13904ms frame=0x5000 dl=8   payload: 00000000 01000000                              ; BUILD_DONE code=1
```

早期探针（首次连接）还观察到：
- `PRJ_LOAD(0x1000)` 在工程已打开时返回 `frame=0x4000 inner=0x1001` 通知帧，文本
  `"Closed project 'C:\…\minimal.uvprojx'"`，随后 `frame=0x3000 inner=0x1000` 完成响应 —
  即 LOAD 是切换语义（先关后开）。
- 构建进行中查询 `DBG_STATUS(0x2004)` → `frame=0x3000 inner=0x2004 payload[4]=6 "Rebuild "`
  （busy notice，不是错误帧）。
- 构建进行中 `CHECK_LICENSE(0xb)` → inner=0xb payload[4]=36 "Build st…" notice。
- 0x201F 错误帧在本次会话未出现（所有请求均成功）。

MCP 服务器（uvsock_connect / uvsock_request ops: version/license/prj_build/prj_rebuild/…）
已通过端到端验证：CONNECT V2.29、REBUILD done={code:1,OK}、10 行输出捕获、raw 服务转发。
