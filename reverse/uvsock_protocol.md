# UVSOCK / UVSC.dll — 完整协议逆向档案

> **实时验证修正（2026-10-29，UV4 5.43a `-s4328`，reverse/uvsock_live.md 原始抓取）**：
> 响应帧的 frameId 不是服务号本身。**请求**帧 frameId=serviceId；**响应**帧 frameId=`0x3000`，
> payload=`[u32 serviceId][u32 noticeLen][…]`（noticeLen=0 时数据从 payload[8] 起；>0 时携带提示文本，
> 例如构建进行中收到 status 查询的 "Rebuild started…"）。**事件**帧直接在 frameId 上区分：
> `0x5001`=构建输出行（payload=`[u32 textLen][1B][text…]`）、`0x5000`=构建完成（payload=`[0][u32 code 1=OK 2=警告 3=错误 4=取消]`）、
> `0x4000`=通知帧（如工程关闭文本）。版本应答：payload[8]=`0xE5`=229 → **协议 V2.29**（`UVSOCK=V%d.%d`）。
> 服务端接受而不要求客户端 ACK。以下静态分析保留作证据。

目标：`UV4\UVSC.dll` v2.30.0.0（x86，PDB `UVSC.pdb` GUID 72e182a0-86c6-476e-b77a-eb64d396415b）
sha256 `30416b01ad4b41c1be10d66f457b4348a263d7aa0e5236e93025ff867394a91a`
姊妹模块：`UVSC64.dll`（x64 同 API）、`UVSCWrapper.dll`（JNI，供 Java 工具如 PackInstaller/ApexTeir 使用）。

µVision 侧：`UV4 -s <port>` 启动服务端（CHM “UVSOCK (TCP/IP) Settings”）；UV4.exe 内注册服务字符串
`UVSOCK=V%d.%d`（0xbf2098），命名内核对象 `UVSOCK_Buffer_Mtx` / `UVSOCK_Sync_Sem`。

## 1. 传输层

- 纯 TCP 直传，无加密、无转义、无分块：`FUN_1000b760` = 对 `send()` 的裸循环（部分写时 Sleep(10) 续传）。
- 每个连接上下文对象 0x10e00 字节；socket 存于 `this+0x444`；命令互斥体 `this+0x34`。
- `UVSC_Init(minPort, maxPort)`：登记端口候选表（≤10 个连续端口，`1≤min≤max≤0xFFFE`，跨度≤9），置 `DAT_1002b5d8=1`。
- `UVSC_OpenConnection(displayName, hIdx*, port*?, exePath, port, procHandle, ..., uvmpwPath, autoStart, timeout)`：
  - 若传 `uvmpwPath`（文件存在）：以 `"<exe>" -j%d -s%d`（-j 关闭GUI级别, -s 端口）**自动拉起 UV4**（FUN_10003550 构造命令行，内部即 KSPAWN/CreateProcess）。
  - 连接槽位 ≤10；`UVSC_CloseConnection` 释放。

## 2. 消息帧（所有服务共用）

```
offset  size  field
0x00    u32   totalLen = 0x20 + dataLen          （接收方用于读满整帧）
0x04    u32   serviceId                          （见下表；请求/响应同 ID 回显）
0x08    u32   dataLen                            （payload 字节数，可为 0）
0x0C..1C  u32×5  reserved=0                       （CreateMsg 置零）
0x20    dataLen payload
```
证据：`UVSC_CreateMsg`(0x100034a0)：`hdr[0]=dataLen+0x20; hdr[1]=serviceId; hdr[2]=dataLen; hdr[3..6]=0`，
随后 memcpy payload；`FUN_1000ae90`（统一请求器）把 serviceId 写进 `this+0xda8`，发送后等响应并比对 `this+0xdc4 == serviceId`（不匹配报 "Unexpected message type returned"）。

- 响应 payload 首 4 字节 = 服务端错误码文本长度域 `this+0xdc8`；非零 → `FUN_1000bcd0` 把字符串复制到 `0xdd8`（"Return buffer..."等），调用方返回码 9。
- 每次请求完成后统一发 **0xC = UVSC_ACK** 空帧收尾（同步栅栏，服务端据此推进下一请求）。
- 推流类调用（ENTER/START/RUN_TO/EXIT）：先向“异步等待集”登记期望事件 ID（≤15 个 u32，`this+0x4d4/0x4d8`），循环收帧直到目标帧到达，最后发 ACK。

## 3. 服务 ID 表（从反汇编直接提取；0xGGGG = 组<<8|序号）

### DBG 组（0x20xx）—— 会话/执行控制
| id | 语义（函数） | 证据地址 |
| --- | --- | --- |
| 0x000C | ACK（每请求后的完成帧） | 0x100053c0 尾部 |
| 0x2000 | 进入调试会话（UVSC_DBG_ENTER） | 0x10004fc0 |
| 0x2001 | 退出调试（UVSC_DBG_EXIT，先强制 STOP） | 0x100053c0 |
| 0x2002 | 停止执行（UVSC_DBG_STOP_EXECUTION） | 0x10005eb0 / 5c50 |
| 0x2003 | 开始/恢复执行（UVSC_DBG_START_EXECUTION） | 0x100059f0 |
| 0x2004 | 调试状态查询（UVSC_DBG_STATUS，出参 u32） | 0x10006130 |
| 0x2005 | 复位（UVSC_DBG_RESET） | 0x10005830 |
| 0x2009 | 单步进入（STEP_INTO；0x2106=步进N、0x2107=步过N 同族） | 0x10006350 |
| 0x200B | 内存读（请求=地址+长度，回包=数据覆写请求缓冲） | 0x10005650 |
| 0x200C | 内存写 | 0x100056f0 |
| 0x200F | 串行口读（SERIAL_GET） | 0x100063d0 |
| 0x2010 | 串行口写（SERIAL_PUT） | 0x10006470 |
| 0x2013 | 事件：程序停止（ENTER 等待集成员） | 0x10004fc0 |
| 0x201F | 错误帧（消息文本在 0xdc8 域；所有等待循环都监视它） | 多处 |
| 0x2031 | ITM 读块请求（响应以 0x5061 数据帧 + 0x5062 结束帧流式返回；0x45*4=272B/条记录槽） | 0x10006dc0 |
| 0x2034 | 表达式求值/调试命令文本（UVSC_DBG_EXEC_CMD 族） | 0x100065a0 |
| 0x2102 | 运行到地址（payload=u32 addr + u32 flag） | 0x10005c50 |
| 0x2106 | 高级语言单步（STEP_HLL；payload u32=1） | 0x100061d0 |

### 推流/异步事件 ID（服务端主动帧，登记在等待集）
| id | 语义 |
| --- | --- |
| 0x500D–0x5010 | ENTER 握手期事件流（任务/变量/寄存器/断点表推送） |
| 0x5060 | ITM 流就绪 |
| 0x5061 | ITM 数据记录（272B） |
| 0x5062 | ITM 流结束 |

### 组 0x10xx（GEN/PRJ 会话）与 0xB/0x1（GEN）
| id | 语义（函数） | 证据地址 |
| --- | --- | --- |
| 0x0001 | UVSOCK 协议版本查询（GEN_UVSOCK_VERSION，u32 → major=/100, minor=%100） | 0x10008950 |
| 0x000B | 许可检查（GEN_CHECK_LICENSE，出参 0x2C=44B 结构） | 0x10008a10 |
| 0x000C | ACK 完成帧 | 全部 |
| 0x1000 | 装载工程（PRJ_LOAD；payload=路径字节流；响应同 ID 携带错误文本） | 0x10009c40 |
| 0x1006 / 0x1007 | 构建（PRJ_BUILD；0x1007=Rebuild，`param!=0 → +1`）；先隐式 DBG_EXIT | 0x10009610 |
| 0x100B | 获取调试目标设置（GET_DEBUG_TARGET，出参 44B） | 0x1000ac10 |
| 0x100D | 读选项字符串（GET_OPTITEM；请求/响应缓冲 = "关键字\0值"） | 0x1000aad0 |
| 0x100E | 写选项字符串（SET_OPTITEM） | 0x1000ab70 |
| 0x1015 | 枚举目标（ENUM_TARGETS；流式，见 0x5022/0x5023；记录 stride=0x104=260B） | 0x100092b0 |

### 构建输出与数据流推送 ID
| id | 语义 |
| --- | --- |
| 0x5000 | 构建完成事件（data=u32: 1=OK, 2=Warnings, 3=Errors, 4=Cancelled） |
| 0x5001 | 构建输出文本行（逐帧推送，客户端拼接进 `0x51c` 缓冲；以 "compiling/assembling/linking/Program Size:/Target not created" 触发进度解析 `FUN_1000c620` → 进度条队列） |
| 0x5005 | 数据记录推送（多记录类服务统一数据帧，stride 由记录定义，如 260B/目标） |
| 0x500D–0x5010 | 进入调试握手期推送（任务/变量/断点/监视表） |
| 0x5021/0x5022/0x5023 | 枚举开始/数据/结束 三段式 |
| 0x5060/0x5061/0x5062 | ITM 流：就绪/数据(272B)/结束 |
| 0x5017/0x5018/0x5019 | 变量枚举三段式：开始/数据(记录 stride=0x2D=45B)/结束（FUN_10007170, 请求 ID=0x201A） |

## 3c. 全量服务 ID 总表（74 个立即数经字节扫描穷举，`scan_ids.mjs` 可复跑；语义由中层函数反编译定名）

**字节扫描方法**：.text 中 `push imm32; …call rel32` 模式（68 xx xx xx xx … E8），
候选域 0x1..0xFFFF，共 74 个不同立即数（0x80/1000/5000/7000/10000 为超时常量噪声）。

### GEN/PRJ 组
| id | 语义 | 证据 |
| --- | --- | --- |
| 0x0001 | UVSOCK 协议版本（回包 [8]=0xE5 → **V2.29** 实测） | FUN_10008950 |
| 0x000B | 许可检查（44B 能力记录） | FUN_10008a10 |
| 0x000C | ACK（UVSC_CreateMsg case 12 的 0x204 缓冲） | |
| 0x1000 | 装载工程（隐式 EXIT；0x4000 通知帧带 "Closed project…" 文本，实测） | FUN_10009c40 |
| 0x1001 | 工程状态文本查询 | FUN_10009ea8 |
| 0x1002/0x1003 | 文本命令注入（in-buffer，silent） | FUN_1000a7b0/aa30 |
| 0x1004/0x1005 | 文本查询（out-buffer 0x208） | FUN_1000a710/a990 |
| 0x1006 / 0x1007 | **Build / Rebuild**（实测：0x5001 文本流 → 0x5000 [0][code]） | FUN_10009610 |
| 0x1008 | 构建并等待完成（0x5000 收尾，code=5 特判 "No Error (OK)"） | FUN_1000a2f0 |
| 0x100a | **开始调试**（注册 0x500d–0x5010 事件流后等 0x100a 回显） | FUN_10009ee0 |
| 0x100b | 取调试目标设置（44B in-place，silent） | FUN_1000ac10 |
| 0x100c | 同型 44B 结构查询 | FUN_1000acb0 |
| 0x100d / 0x100e | 选项读/写（"KEY\0VALUE\0" 双向缓冲） | FUN_1000aad0/ab70 |
| 0x100f | 断点枚举（流 0x5007/0x5008(260B)/0x5009） | FUN_10008f50 |
| 0x1010 | 观察列表枚举（流 0x500a/0x500b(0x104)/0x500c） | FUN_10008be0 |
| 0x1011 | u32 读/写（in-place） | FUN_10008b40 |
| 0x1012 | u32 结果（请求 4B → 回 4B，如当前目标索引） | FUN_1000a250 |
| 0x1014 | u32 数组读/写 | FUN_1000ad50 |
| 0x1015 | 目标枚举（流 0x5021/0x5022(260B)/0x5023） | FUN_100092b0 |
| 0x1016/0x1018 | 文本输出（0x20C 缓冲，隐式 EXIT） | FUN_1000a850/a8f0 |
| 0x1017 | 键值命令（in-place，silent） | FUN_1000adf0 |

### DBG 组（0x2000–0x2108 全谱）
| id | 语义 | 证据 |
| --- | --- | --- |
| 0x2000 | 进入调试会话（等 0x500d-0x5010 + 0x2013 停止事件，实测） | FUN_10004fc0 |
| 0x2001 | 退出调试（先 STOP(0x2003) 再发，等自身回显+0x200d） | FUN_100053c0 |
| 0x2002 | 停止执行（等 0x2002 回显，30s；"Rebuild is in progress" busy 文本实测） | FUN_10005eb0/5c50 |
| 0x2003 | 开始执行（等 0x2003） | FUN_100059f0 |
| 0x2004 | 状态查询（非调试态返回 notice，payload[4]>0=文本长） | FUN_10006130 |
| 0x2005 | 复位（等 0x5011..0x5013 三事件） | FUN_10005830 |
| 0x2009 | 单步进入（等 0x2013 停止事件） | FUN_10006350 |
| 0x200a | 数据图 in-place 缓冲 | FUN_100040a0 |
| 0x200b / 0x200c | 内存读（响应覆写请求缓冲，实测）/ 内存写 | FUN_10005650/56f0 |
| 0x2011/0x2012 | 复位核/复位系统 变体（空请求） | FUN_100058b0/5950 |
| 0x2014/0x2015 | 数据窗批读/批写（0x2016 流） | FUN_100049a0/4c70 |
| 0x2016 | 数据窗条目读（0x14-0x17 长文本流，180s） | FUN_100046d0 |
| 0x2018 | 40B 结构读/写（ITM/串口配置记录） | FUN_10006630 |
| 0x2019 | ITM 流读（32B 请求；0x5014 开始 / 0x5015 数据(记录=0x30) / 0x5016 结束） | FUN_10006770 |
| 0x201a | 调用栈枚举（0x5017/0x5018/0x5019 三段式） | FUN_10007170 |
| 0x2020 | 命令执行完整版（文本流 0x5020→echo，含 0x4000 状态改写；180s） | FUN_10007720 |
| 0x2021 | **功耗标尺（PowerScale）显示代码/能耗标注**：60B（0x3C）in-place 结构（15×u32），silent=0、noAck=0、**无隐式 EXIT**；请求与响应共用同一缓冲。唯一调用者 = UVSC_POWERSCALE_SHOWCODE(0x10002220)，procedure_callers 实测闭环 | FUN_10007570 <- 0x10002220 |
| 0x2024 | 表达式求值→字符串（in-place，静默，无隐式 EXIT） | FUN_10004630 |
| 0x2025 | 监视表达式添加 | FUN_100066d0 |
| 0x2026 | 菜单枚举（0x5024/0x5025(65B)/0x5026） | FUN_10007ac0 |
| 0x2027 | 内存映射（0x5027 数据(记录 0x14)/0x5028 结束） | FUN_10007dd0 |
| 0x2028 | 寄存器组枚举（0x5029/0x502a(64B)/0x502b） | FUN_100084f0 |
| 0x2029 | 单寄存器组块（0x502c/0x502d/0x502e） | FUN_100085b0 |
| 0x202a | 静默控制 | FUN_10005790 |
| 0x202b | watch 求值（in-place 0x208） | FUN_10004140 |
| 0x202c | watch 移除 | FUN_100041e0 |
| 0x202d | 变量写入（key=value in-place） | FUN_10004270 |
| 0x202e/0x202f | 地址↔文件行（A2L / L2A） | FUN_1000435b/4590 |
| 0x2030 | 显示对象读（0x20C 缓冲） | FUN_10006aa0 |
| 0x2031 | ITM 块读（等待集 0x2031 自回显） | FUN_10006ea3 |
| 0x2032 | SCVD 文件枚举（数据 0x502f stride 0x104 / 结束 0x5030） | FUN_100070e0 |
| 0x2033 | 文本命令流（0x5020 分片 → echo；180s） | FUN_10007dd0?（FUN_10006510 邻域） |
| 0x2034 | 调试命令行执行（EXEC_CMD，实测） | FUN_100065a0 |
| 0x2035/0x2036 | EventRecorder 注册/注销 | FUN_100080e0/8160 |
| 0x2038 | ITM 注销 | FUN_100081e0 |
| 0x2102 | 运行到地址（隐式 EXIT + u32 地址参数） | FUN_10005c00 |
| 0x2106/0x2107/0x2108 | HLL 步过/步进计数/其它步进（u32=1） | FUN_10006210/62d0/61d0 |

### 0x2021 定名闭环（第三轮补齐）
FUN_10007570(this, uint* buf)：local_8 = 0x3C（60 字节），FUN_1000ae90(this, 0x2021, buf, 0x3C, buf, &local_8, 0, 0) —— in-place 请求/响应同构、静默关、无隐式 EXIT。
Ghidra procedure_callers 仅返回 0x10002220 = UVSC_POWERSCALE_SHOWCODE，故 0x2021 = PowerScale 显示代码服务（把能耗/周期标注反查回源码行）。

### 事件帧（frameId 层，实时验证 + 反编译注册集）
0x5000 构建完成（payload[4]=1 OK/2 警告/3 错误/4 取消/5 特例"无错误"）· 0x5001 输出行
· 0x5007-0x5009 断点流 · 0x500a-0x500c 观察流 · 0x500d-0x5010 启动调试推送 ·
0x5014-0x5016 ITM 读流 · 0x5017-0x5019 调用栈 · 0x5020/0x5021 EXEC 文本流 ·
0x5021-0x5023 目标枚举 · 0x5024-0x5026 菜单 · 0x5027/0x5028 内存映射 ·
0x5029-0x502b 寄存器组 · 0x502c-0x502e 寄存器块 · 0x502f/0x5030 SCVD · 0x5060-0x5062 ITM 旧流
· 0x4000 通知（LOAD 状态文本、EXEC 进度）· 0x201F 错误帧（全函数监视注册集含 0xd1d8 标志）。

### 会话行为（FUN_1000ae90）
- 请求前统一清错误槽（FUN_1000bc30）；等待事件 `0xd8c` 超时两档：**常规 10s / 构建·执行类 180s**（0x2020/0x2033/0x2031/ITM）
- 响应匹配 `payload[0]==serviceId`；不匹配且非注册事件 → "Unexpected message type returned"（0x201f 处理路径）
- 部分服务带**隐式 EXIT**（先 DBG_EXIT 0x2001 再请求：LOAD/文本类/RUN_TO）；部分标记 silent(0x201f 抑制)
- 每个收流函数结束前发 `ACK=0xC`；错误槽 stride 0x104=[tid][lastId][code][1KB 文本]
- `UVSC_Init(min,max)` 端口候选表 ≤10；OpenConnection 可用 `"<exe>" -j<N> -s<port>` + `.uvmpw` 自动拉起 IDE（FUN_10003550 命令行构造实测于反编译）
- 全部 103 个导出的包装层统一：`DAT_1002b5d8==0→返回3(未初始化)`；槽位<10；线程==owner→返回5(死锁保护)

---

1. 客户端取连接互斥体 `this+0x34` → 清错误槽（FUN_1000bc30）。
2. `FUN_1000ae90(ctx, serviceId, reqBuf, reqLen, outBuf, outLenPtr, silent, noAck)` 发送请求帧；
   阻塞在“响应事件”`this+0xd8c`（10 s 常规 / 180 s 构建·装载类超时），收帧线程把帧拷进
   `this+0xda4` 环并 SetEvent。
3. 简单请求：等到 `frame.id == serviceId` 即完成（响应与请求同 ID 回显；payload 首 u32=服务端错误码）。
4. 状态类请求（EXIT 0x2001 / START 0x2002 / STOP 0x2003 / RESET 0x2005 / RUN_TO 0x2102 等）：请求发出后
   等待的是**新状态 ID 帧**（EXIT 等 0x2001；START 等 0x2003=“已运行”回执事件；STOP 等 0x2002=“已停止”），
   且这些状态帧同时是广播事件（多客户端可见）。
5. 构建 PRJ_BUILD：先发隐式 EXIT(0x2001)，再发 0x1006/0x1007(Rebuild=+1)，
   循环收 0x5001 输出文本行（每行一帧，客户端拼接并识别 "compiling/assembling/linking/Program Size:/Target not created"
   驱动进度），直到收到 0x5000 完成事件：`1=No Error (OK), 2=Warnings, 3=Errors, 4=Cancelled`。
6. 每个多帧服务结束时统一发 `ACK=0xC` 空帧；`FUN_1000ae90` 的 `noAck` 参数控制是否跳过。
7. 错误帧 0x201F：payload=`u32 errCode + 文本`，客户端存每线程槽（stride 0x104: tid, lastId, code, 1KB text）。

## 3c. 其它已确认 ID
| id | 语义 |
| --- | --- |
| 0x200D | 停止执行（等待集成员，FUN_100053c0 EXIT 序列） |
| 0x2014/0x2016 | 读内存映射/watch 批量数据（0x2014 请求，0x2016 数据帧，dataLen=0x16/0x13 特判） |
| 0x201A | 变量枚举请求（流式，见 0x5017/18/19） |
| 0x2025 | 缓冲区型请求-响应（FUN_100066d0：in/out 同缓冲） |
| 0x2108 | 带 u32 参数的执行控制（FUN_10006250，无等待集，纯请求/响应） |

## 4. 错误码（客户端返回）
`0=OK, 1=内部错误, 3=未 Init, 4=超时(默认 10s/180s 两档), 5=调用线程=UI线程(死锁保护), 6=参数非法, 7=缓冲过小, 9=远端错误文本(0x201F)`
服务端错误文本存于每线程错误槽（stride 0x104：tid, lastId, code, 1KB text），`UVSC_GetLastError` 读取。

## 5. 与 UV4.exe 侧的对应
UV4.exe 内 `CUVSOCKServer/CUVSOCKConnection/CUVSOCKTaskItem/CUVSOCKVariableContainerItem/CUVSOCKStackFrameItem/CUVSOCKWatchList/...`（RTTI，证据 ev_dd8d9b18…）即服务端帧装配类；`UVSOCK_Buffer_Mtx`/`UVSOCK_Sync_Sem` 命名对象在 GUI 外线程与服务线程间共享帧缓冲 —— 与客户端 `this+0x14/0x18/0x20` 环形队列（0x8020=32800B 槽深）互为镜像。
