# Keil uVision (UV4) → MCP — full-surface reconstruction

`keil-uv4-mcp` is a dependency-free Model Context Protocol server (stdio, JSON-RPC 2.0)
that exposes the complete functional surface of Keil µVision 5 (MDK 5.43a, MDK-Lite
non-commercial) as reconstructed from the shipped binaries, the shipped help and
controlled runtime probing.

Target installation analysed:
`C:\Users\ERDAN.DESKTOP-MVAKHCO\AppData\Local\Keil_v5\UV4`
(`UV4.exe` sha256 `428baf13d15e6760af1618def9c9815c97f0321cc5e459ec7adc4dde41c42f89`, x86 MFC,
41 876 functions / 18 794 strings after auto-analysis).

**93 MCP tools · 106/106 acceptance · 10/10 adversarial · 48/48 portable · 37/37 licence-free compile · 44/44 beginner diagnostics · 68/68 release gate.**

```
UV4.exe ──CLI/exit codes──▶ uv4cli.mjs      build / rebuild / clean / download / convert / export / symbols
        ──XML model──────▶  project.mjs     .uvprojx / .uvproj / .uvmpw / .uvoptx (byte-faithful)
        ──.dep & .d──────▶  deps.mjs        UV4 dependency database, incremental impact, stamps
        ──device DB──────▶  packs.mjs       CMSIS-Pack .pdsc devices, components, flash algorithms
        ──toolchain──────▶  toolchain.mjs   armcc / armasm / armclang / armlink / fromelf command lines
        ──images─────────▶  image.mjs       .axf ELF, linker .map, Intel-HEX
        ──batch──────────▶  batchgen.mjs    <Target>.BAT + .__i / ._ia / .lnp via files
        ──debugger───────▶  gdbstub.mjs     SVD → register/bitfield description, peripheral map
        ──license────────▶  license.mjs     armlm / armlm-ipc / FlexNet inventory, #601 build gate
        ──remote control─▶  uvscanner.mjs   UVSOCK probe, UV4 process control
```

## Round 2: exhaustive companion coverage

All 21 companion binaries are profiled in [reverse/modules.md](reverse/modules.md): UVSC.dll/UVSC64
(103-export UVSOCK client library -> full wire protocol decoded, re-implemented in
`src/uvsock.mjs`, and verified live end-to-end: V2.29 handshake, remote rebuild with event
streaming), UVCDB2XML (2831-device legacy .cdb), SfrCC2, SVDConv 3.3.48,
uv2csolution 1.6.0 (Go; AC6-only guard verified), PackInstaller/PackUnzip plus a native
.pack ZIP reader, Scintilla *.prop / UTF-16 *.SVCS config formats, armlm.exe +
armlm-ipc.exe (Go 1.24.5 wrapping FlexNet Embedded; activation via
https://api.arm.com/p-software-licensing/v1/activate, store ~/.armlm), KSPAWN
console spawner, DCOMUTIL (UV4.dll) OLE/DDE registration strings, UvCC.dll (LLVM AC6
integration layer), UVAC code-completion engine.

New tools: uvsock_connect / uvsock_request / uvsock_disconnect / uvsock_service_table,
cdb_devices / cdb_vendors, editor_props, svcs_menus, pack_file_inspect /
pack_file_extract, companion_run, license_architecture.

## Quick start

```powershell
cd keil-uv4-mcp
node src/server.mjs            # MCP server on stdio
node tests/run_tests.mjs       # 106 acceptance checks (builds real projects with UV4)
node tests/fuzz_test.mjs       # 10 adversarial checks
node tests/pack_test.mjs       # 68 release-gate checks (npm pack -> unpack -> cold start -> real build)
npm run test:all               # all six suites (313 checks)
```

No Keil installation and no `npm install` are required: `dependencies: {}` and the data the
server needs ships in `data/fixtures/`. Copy the directory (or `npm pack` / `npm i -g`) onto
any machine with Node >= 20 and start it.

```bash
npm pack                       # keil-uv4-mcp-<version>.tgz  (source + fixture snapshot)
npm i -g ./keil-uv4-mcp-*.tgz && keil-uv4-mcp
```

## Start here (three commands)

You do not need to know any Keil error code.

```jsonc
{"tool":"doctor"}                                                   // is this machine ready?
{"tool":"pack_diagnose","project":"your.uvprojx"}                    // why won't it build, and how to fix it
{"tool":"compile","project":"your.uvprojx"}                         // build without any licence
{"tool":"flash","project":"your.uvprojx","chip":"STM32F103C8"}      // dry run first, then dryRun:false
```

`pack_diagnose` answers in plain language and returns copy-paste fixes:

```
summary: 构建会被拒绝：工程写死要 STM32F1xx_DFP 2.4.0，这台机器装的是 2.4.1。
actions:
  - 装回工程要求的 STM32F1xx_DFP 2.4.0      -> pack_fetch {...}
  - 把工程的 PackID 改成已装的 ...2.4.1      -> project_set_option {...}
```

## Licence-free build and flash

A µVision project can be compiled and programmed **without an MDK licence, without
activation and without UV4.exe**. Nothing on this path calls armlm or checks Error #601.

| capability | tool | backend | licence |
| --- | --- | --- | --- |
| compile | `compile` | clang+lld or arm-none-eabi-gcc | none |
| flash | `flash` | pyOCD / OpenOCD / STM32_Programmer_CLI / ST-LINK_CLI / J-Link | none |
| probe | `build_backends` | reports what is installed | — |

* The linker script is generated from the project's own `Cpu:` string (`IROM(...) IRAM(...)`);
  when the project omits CMSIS, `CMSIS/Core/Include` is resolved from the pack roots or the
  bundled snapshot automatically.
* Outputs are `.elf` + `.hex` + `.bin` + `.map`, and the server's own `elf_info`/`hex_info`/
  `map_info` re-validate them (tests assert the vector table: initial SP = top of IRAM,
  Reset vector in flash with the Thumb bit).
* **No byte-parity claim with armcc**: every result carries `backend` and `fidelity`. Use
  `uv4_build` only when armcc/armclang behaviour is required (that needs a real install).
* Both paths coexist: `uv4_build` drives UV4 when present, `compile` never does.

The underlying algorithms (`.dep` stamps, via files, UVSOCK frames, device-fragment assembly)
are documented with function addresses in [docs/algorithms.md](docs/algorithms.md).

Client registration (any stdio MCP client):

```json
{ "mcpServers": { "keil-uv4": {
    "command": "node",
    "args": ["C:\\path\\to\\keil-uv4-mcp\\src\\server.mjs"]
} } }
```

| environment | default | meaning |
| --- | --- | --- |
| `KEIL_MDK_ROOT` | `%LOCALAPPDATA%\Keil_v5`, `C:\Keil_v5` | installation root (TOOLS.INI owner) |
| `KEIL_UVSOCK_PORT` | `4328` | default UVSOCK port for `uvsock_probe` |
| `UV4_TIMEOUT_MS` | `900000` | default per-invocation timeout; the process tree is killed on expiry |

## Recovered contract (evidence first)

### Command line — `UV4.exe [command] [projectfile] [options]`

| command | effect | verified |
| --- | --- | --- |
| `-b` | build current target (batch-selected targets for `.uvmpw`) | exit 0/1/2 |
| `-r` | re-translate current target | exit 0/1/2 |
| `-c` | clean all targets ("deleting intermediate output files…") | exit 0 |
| `-cr` | clean + rebuild | exit 0 |
| `-z` / `-q` | rebuild all / batch-selected targets of a **multi-project** | hangs on a single project (documented; refused unless `force`) |
| `-f` | download to Flash | requires a configured adapter |
| `-5` | convert `.uvproj` → `.uvprojx` (+ `.saved_uv4` backup) | exit 0, log "Migration completed" |
| `-et` / `-ep` | export `.cprj` (target / all) | exit 0 |
| `-X` / `-X1` | `co-arm_<target>.h` symbol files | file produced |

Options: `-j0` (headless, mandatory for automation), `-o` log, `-t` target, `-s` UVSOCK
port, `-sg` ignore `uvguix`, `-i` import XML, `-n`/`-np` create device project,
`-l` logfile (with `-5`), `-x`/`-y` DDE (with `-d`).
ERRORLEVEL: 0 none, 1 warnings, 2 errors, 3 fatal, 11 cannot write project,
12 unknown device, 13 write error, 15 import XML error, 20 conversion error.

Multi-project facts discovered by probing: the workspace is `<ProjectWorkspace>` with
`<project><PathAndName/>` members (`UV4\project_mpw.xsd`), and Batch Build selection is
the **per-target** `<SelectedForBatchBuild>` inside each member — UV4 -b reports
`Batch-Build summary: N succeeded, M failed, K skipped`.

### Project / dependency formats

* `.uvprojx` (`project_projx.xsd`) and `.uvoptx` (`project_optx.xsd`) are read **and
  written byte-faithfully**: an untouched file round-trips identically, edits rewrite
  only the affected subtree (`node src/xml.mjs` round-trip test in the suite).
* `<Output>\<project>_<target>.dep` writer is `FUN_00680b10`; the `(0x%08X)` column is
  the dependency file's **clock time written as decimal HHMMSS and printed in hex**
  (`main.c` 15:52:13 → `0x00155213`); `F` records hold the exact tool command
  (`-IC:\…\Device\Include`, `-D__UVISION_VERSION="543"`, defines, `-o`, `--depend`),
  `I` records the include closure produced by `armcc --depend`.
* Per-file depend files (`*.d`) are literally `"<obj>: <dep>\r\n"` lines emitted by the
  compiler; UV4 and this server both parse that format.
* Batch build artefacts (`Create Batch File`): `<Target>.BAT` with `SET PATH/ARMCC5_*OPT/
  CPU_TYPE/CPU_VENDOR/UV2_TARGET/CPU_CLOCK`, per-file `ArmAsm --Via .\objects\x._ia` /
  `ArmCC --Via .\objects\x.__i`, `ArmLink --Via .\Objects\out.lnp`, then `fromelf`.

### Device data

`pack_devices`, `pack_device_detail`, `pack_components`, `pack_conditions` and
`pack_rte_validate` parse the installed `.pdsc` (also `UV4\PACK.xsd` layout). The
generated `Cpu:` string, `FlashDriverDll` (`UL2CM3(… -FS08000000 -FL020000 …)`) and
`SFDFile`/`RegisterFile` are **byte-identical to UV4's own `-5` migration output**
(asserted in the acceptance suite).

## Tool catalogue (93)

| group | tools |
| --- | --- |
| CLI reproduction | `uv4_build`, `uv4_rebuild`, `uv4_clean`, `uv4_clean_rebuild`, `uv4_rebuild_all`, `uv4_download`, `uv4_symbols`, `uv4_export_cprj`, `uv4_convert`, `uv4_import`, `uv4_run`, `uv4_job_status`, `uv4_job_list`, `uv4_job_wait`, `uv4_build_log`, `uv4_processes` |
| project model | `project_read`, `project_files`, `project_multiproject`, `project_set_option`, `project_group_add`, `project_group_remove`, `project_file_add`, `project_file_remove`, `project_target_clone`, `project_target_remove`, `project_validate`, `project_diff`, `project_create`, `project_create_legacy`, `project_create_multi`, `project_multi_add`, `project_multi_read`, `project_batch_flags` |
| dependencies | `dep_read`, `dep_graph`, `dep_impact`, `dep_scan`, `dep_write`, `test_build` |
| packs | `pack_list`, `pack_devices`, `pack_device_detail`, `pack_components`, `pack_conditions`, `pack_rte_validate` |
| images | `elf_info`, `map_info`, `hex_info`, `memory_usage`, `symbols_file` |
| session options | `options_read`, `options_set`, `options_create` |
| scaffolding / batch | `batch_file`, `batch_generate`, `import_xml_document`, `import_xml_from_project` |
| debugger | `debug_script`, `debug_command_reference`, `debug_pack_generate`, `debug_peripheral_map` |
| installation | `keil_install`, `toolchain_versions`, `tool_run`, `license_status`, `uvsock_probe`, `cli_reference`, `cli_table` |

Generated short table: [tool_table.md](reverse/tool_table.md).

## Evidence kept under `reverse/`

| file | content |
| --- | --- |
| `cli_matrix.json` | every command probed, exit codes, `-z`/`-q` hang, timings |
| `dep_stamp_evidence.json` | `F/I` records, producer function `FUN_00680b10`, stamp semantics |
| `rte_injection_evidence.json` | implicit RTE include / `__UVISION_VERSION` / define injection, ordering |
| `batch_via_files_evidence.json` | the byte-exact `Flash.BAT`, `main.__i`, `startup._ia`, `main.lnp` |
| `uv4_profiles.json` | binary identity, CLI contract, side effects, UVSOCK / armlm artefacts |
| `acceptance_results.json` | latest acceptance run (106/106) |
| `samples/` | `Minimal` (verified build), `Gen2` (scaffolded, builds), `Legacy` (converted by UV4), `Multi*` (workspaces), `Scaffold`, `Import` |
| `hashprobe*.mjs`, `pdsc_probe*.mjs`, `stamp_decode*.mjs` | the probes used to pin the formats |

## Behaviour notes and limits

* UV4 is a GUI-subsystem binary: without `-j0` a shell waiting on stdio deadlocks.
  Every invocation rewrites `<project>.uvoptx` (current target, debug options).
* `-z`/`-q` only exist for `.uvmpw`; the wrapper refuses them on single projects and
  kills the process tree on timeout (`uv4_processes {kill:true}` recovers stale runs).
* RTE components are validated structurally (pack presence, class/group/sub match).
  UV4 additionally applies `condition` rules; mismatches are reported as `#540`,
  missing packs as `#544` — the same codes UV4 logs.
* Scaffolded projects use AC5-safe include sets: CMSIS 6.x ships `cmsis_compiler.h`
  whose AC5 section ends in `#error Unknown compiler.` (verified at
  `Core/Include/cmsis_compiler.h:279`), therefore `project_create` prefers CMSIS ≤ 5
  or omits it and writes a self-contained `sysinit.c`. Passing `addSystem:true` copies
  the DFP `system_*.c` when CMSIS 5 is installed.
* `armlm.exe` / `armlm-ipc.exe` / FlexNet daemons are treated as black boxes: the server
  reports their files, running instances and the live `Error #601` build gate; it never
  edits license data.
* The UVSOCK protocol (frames over the `-s` port) is probed and reported (reachability,
  greeting bytes, listener inventory). Frame-level command encoding is not published by
  Arm; the debugger command surface itself is fully exposed through `-d` scripts
  (`debug_script`, `debug_command_reference`).
* `tool_run` never leaves the toolset `bin` directory (path traversal is rejected).
* The bundled DFP snapshot contains `.pdsc` declarations only — no device sources
  (`Device/Include/*.h`, `startup_*.s`, `.FLM` payloads). Without Keil, `project_create`
  still emits the exact `<Device>/<Vendor>/<PackID>/Cpu/FlashDriverDll` fragments, and
  `project_validate` truthfully reports `NO_STARTUP` / `INCLUDE_MISSING`: those files really
  are absent, and the validator is not allowed to pretend otherwise.

## Release and open source

### Why the release gate exists

A working checkout is not a working package. Two defects only appear after `npm pack`:

1. **Data read at import time from the development tree.** `module_catalog.json` lived in
   `reverse/`, which is not in `files:`, so a published package died with `ENOENT` on startup.
   It now ships at `data/fixtures/catalog/module_catalog.json`, is loaded lazily on first use,
   and degrades to a structured error instead of taking the server down.
2. **Main-module detection by string comparison.** 8.3 short paths (`C:\Users\ERDAN~1.DES\…`),
   symlinks and case differences made `isMain` false: the process imported cleanly and exited
   silently. Detection now uses `realpathSync.native` with Windows case folding.

`tests/pack_test.mjs` runs `npm pack`, unpacks the tarball outside the repository, blanks
`LOCALAPPDATA`/`KEIL_MDK_ROOT` to simulate a machine without Keil, cold-starts the server and
asserts the device DB (2831 devices / 33 vendors), the three `.pdsc` packs, STM32F103C8's
64 KiB flash / 20 KiB RAM / `STM32F10X_MD` / `SVD/STM32F103xx.svd` / `STM32F10x_128.FLM`,
`module_catalog` resolving inside the package, `.axf`/`.map`/`.hex` parsing, `uv4_build`
returning `needsKeil`, and startup through an 8.3 short path.

### Repository layout

| directory | contents | shipped |
| --- | --- | --- |
| `src/` | all runtime code (22 modules + 14 tool registrars) | yes |
| `data/fixtures/` | runtime snapshot (134 files / 6.44 MB) | yes |
| `tests/` | 313 assertions + release gate | no |
| `reverse/` | decompilation scripts, evidence JSON, controlled-run logs | no |

### Licence and attribution

MIT (see `LICENSE`). The `.pdsc` files and the `UV4.cdb` dump under `data/fixtures/` remain the
property of their respective owners and are included for interoperability; review the licence
terms inside each `.pdsc` before commercial redistribution. This project contains no vendor
binary code.

### Contributing

Read `CONTRIBUTING.md` first. The governing rule is **fidelity to the original, decompilation
first**: every behaviour must point at a function address in `UV4.exe`/`UVSC.dll` or a
controlled-run record under `reverse/`. When the evidence is missing, return a structured
diagnostic — never a plausible-looking guess.
