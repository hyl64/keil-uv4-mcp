# 安全说明

## 这个程序会做什么

`keil-uv4-mcp` 是一个本地 MCP 服务器，按需驱动本机的 Keil µVision / ARM 工具链：

- 读写你指定的 `.uvprojx` / `.uvoptx` / `.dep` 等工程文件；
- 在便携模式下只读 `data/fixtures/` 内的快照数据；
- 安装存在时，通过 `child_process` 启动 `UV4.exe`、`armcc`/`armlink` 等工具；
- 可通过 TCP 连接本机 `UVSOCK` 端口（默认 4328）控制正在运行的 µVision；
- 可选读取进程列表以定位 `UV4.exe`（`uv4_processes`）。

它不会主动联网，不下载任何东西，不写入系统目录。

## 你需要知道的边界

- **`project_set_option` / `project_file_*` / `dep_write` 会改文件**，`dep_write` 与
  `batch_generate` 还会覆盖输出目录里的既有产物。对生产工程请先用 `project_diff` 或
  版本控制留底。
- **`tool_run` 会执行本机可执行文件**。它限制在检测到的工具链 `bin` 目录内，但仍是你机器上的
  真实进程，请勿把不受信任的路径传给它。
- **`uv4_processes { kill: true }` 会结束进程**。
- **`uvsock_request` 会让正在运行的 IDE 编译/下载**，`uv4_download` 会写目标板 Flash。

## 数据快照的许可

`data/fixtures/` 中的 `.pdsc`、器件库导出（`uv4_cdb.xml`）等仍属各自权利人，随包发布只为互操作。
商业再分发前请核对各 `.pdsc` 内的许可条款（详见 `LICENSE` 的第三方声明段）。

## 报告问题

请通过仓库的私有安全通道联系维护者，或在 issue 中只描述现象、不含敏感工程内容。请附上：

- 复现命令（工具名 + 参数，路径可打码）；
- `keil_install` 的输出（含便携模式下探测过的安装根目录）与 `tools/list` 返回的版本信息；
- 期望行为与查询到的反编译证据（若涉及忠实度问题）。
