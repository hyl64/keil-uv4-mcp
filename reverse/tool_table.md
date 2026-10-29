| `uv4_build` | UV4 -b: build the current target (or batch-selected targets of a multi-project) and exit. |
| `uv4_rebuild` | UV4 -r: re-translate (full rebuild) the current target and exit. |
| `uv4_clean` | UV4 -c: clean all targets of the project and exit. |
| `uv4_clean_rebuild` | UV4 -cr: clean all targets and re-translate the current target. |
| `uv4_rebuild_all` | UV4 -z / -q: rebuild all / batch-selected targets of a multi-project file. |
| `uv4_download` | UV4 -f: download the built program to Flash via the configured debug adapter, then exit. |
| `uv4_symbols` | UV4 -X / -X1: generate co-arm_<target>.h/hpp preprocessor symbol files in the output folder (current target or all targets). |
| `uv4_export_cprj` | UV4 -et / -ep: export one target or all targets to <projectName>.<targetName>.cprj (CMSIS solution format). |
| `uv4_convert` | UV4 -5: convert a uVision4 .uvproj project to .uvprojx (optionally -l logfile). |
| `uv4_import` | UV4 -i/-n/-np: create or update a project from an XML import (project_import.xsd) or from a device name. |
| `uv4_run` | Generic UV4 runner: any supported command with any supported option, returning raw argv and structured results. |
| `uv4_job_status` | Status/result of an asynchronous UV4 job. |
| `uv4_job_list` | List asynchronous UV4 jobs (state, project, target, timings). |
| `uv4_job_wait` | Wait for an asynchronous UV4 job to finish (bounded). |
| `uv4_build_log` | Read and summarize any UV4 log: build log, .build_log.htm or an -o output file. |
| `uv4_processes` | List running UV4.exe processes with command lines. |
| `project_read` | Read a µVision project: schema version, every target with normalized options (device, memory model, C/asm/linker settings, RTE components), file groups and batch-build flags. |
| `project_files` | List the files of a target grouped exactly as µVision shows them (group name, file name, type code, path), with resolved absolute paths and existence flags. |
| `project_multiproject` | Expand a multi-project file (.uvmpw/.uvmpwx): project members, their targets, batch-build selection and output folders. |
| `project_set_option` | Set one target option by its XML path, e.g. |
| `project_group_add` | Add a file group to a target (fails when the group exists). |
| `project_group_remove` | Remove a file group (and its files) from a target. |
| `project_file_add` | Add a source file to a group. |
| `project_file_remove` | Remove files from every group of a target by path match. |
| `project_target_clone` | Duplicate a target (all options and file groups) under a new name — the same result as Project→Manage→Project Items→New target from existing. |
| `project_target_remove` | Delete a target from a project. |
| `project_create` | Create a complete µVision project for a device: TargetOption from the .pdsc (memory, core, flash algorithm, SVD, register header), optional startup/system sources copied from the DFP, include paths and defines. |
| `project_validate` | Validate a project against the checks UV4 performs while building: device resolution, memory map presence, startup section, missing files, include dirs, RTE pack availability. |
| `project_diff` | Semantic diff between two project files: targets added/removed, option changes per target (dotted paths), file list changes. |
| `project_create_legacy` | Create a uVision4 ".uvproj" project (SchemaVersion 1.1, project_proj.xsd) usable with UV4 -5 conversion to .uvprojx. |
| `project_create_multi` | Create a µVision multi-project workspace (.uvmpw, project_mpw.xsd) and set the per-target Batch-Build flags inside each member project so UV4 -b actually builds them. |
| `project_multi_add` | Add or update a member project in an existing .uvmpw workspace, optionally enabling its Batch-Build flag. |
| `project_multi_read` | Read a workspace and expand every member project into its targets, project-level batch flag and output folders. |
| `project_batch_flags` | Read or set <SelectedForBatchBuild> for every target of one or more projects (the flag UV4 -b/-z/-q honour). |
| `dep_read` | Parse a µVision dependency database (<Output>/<project>_<target>.dep: F/I records with UV4 file stamps) or a compiler .d file. |
| `dep_graph` | Build the dependency graph of a target: each project file, its include closure from the .d files, stamp (mtime) and existence. |
| `dep_impact` | Impact analysis: given changed files (e.g. |
| `dep_scan` | Toolchain-free #include closure scan of one source using the target include paths and defines. |
| `dep_write` | Regenerate a UV4-compatible dependency database (<project>_<target>.dep): F records carry the file clock time (HHMMSS as 0xHHMMSS) and the exact per-file tool command line (uVision version, RTE device include, defines), I records list the includes from the compiler .d files. |
| `test_build` | Reproduce the per-file command lines µVision would run for a target (armcc/armasm) without building: compile objects, depend files, listings and the linker command with a generated scatter file. |
| `pack_list` | Installed CMSIS-Packs under the RTEPATH roots (vendor, pack, version, device/component counts, .pdsc path). |
| `pack_devices` | Search the device database across installed packs. |
| `pack_device_detail` | Full device record plus the exact TargetOption fragments UV4 would use (Cpu string, flash driver UL2CM3(...), SVD and register header paths, default defines). |
| `pack_components` | Search RTE components (Cclass:Cgroup[:Csub[:Cvariant]]) with file counts and their availability condition. |
| `pack_conditions` | RTE conditions of a pack (<condition id> with its <require> device/core rules) — used to explain Error #540/#542. |
| `pack_rte_validate` | Validate the RTE component list of a project target against installed packs/conditions and return the UV4 error codes that would be raised (#540 component not available, #541 API missing, #542 API version, #543 device, #544 pack). |
| `elf_info` | Inspect the .axf ELF: sections, loadable segments, symbol table (functions/objects with sizes) and code/data totals — without requiring fromelf. |
| `map_info` | Parse the linker map: image totals (RO/RW/ROM), execution regions, per-object section sizes and global symbols. |
| `hex_info` | Intel-HEX analysis: records, contiguous segments, byte count, address range and checksum verification. |
| `memory_usage` | Flash/RAM utilisation: ELF segments mapped onto the target memory model (IROM/IRAM), with fill percentages and region overflow warnings. |
| `symbols_file` | Read the preprocessor symbol file produced by UV4 -X (co-arm_<target>.h) and return defines as key/value pairs. |
| `options_read` | Read the session/options file (.uvoptx, project_optx.xsd) for each target: debug driver (pMon/nTsel), simulation vs hardware, initialisation scripts (sIfile/tIfile), driver registry entries and breakpoint count. |
| `options_set` | Set a value in the .uvoptx of a target (e.g. |
| `options_create` | Create a .uvoptx for a project (targets from the .uvprojx, debug driver from the device flash algorithm). |
| `batch_file` | Generate the batch file µVision writes with Options→Output→Create Batch File (same command line, exit code forwarded). |
| `import_xml_document` | Compose a project_import.xsd document (the format UV4 -i consumes: ToolsetName, Device, Output, IncludePath, CDefines, COptions, Simulator/Target debugger settings, Groups/Files). |
| `import_xml_from_project` | Export an existing project target as a project_import.xsd document (round-trip: re-import with UV4 -i reproduces device/output/includes/defines/debug settings). |
| `batch_generate` | Generate the exact artefacts uVision writes when "Options→Output→Create Batch File" is set: <Target>.BAT in the project root, per-file via files (objects\<name>.__i and ._ia) and the linker <output>.lnp, all carrying the same options as the real UV4 output. |
| `debug_script` | Compute and (optionally) run the UV4 -d debug-session invocation for a debugger initialization script (INCLUDE-style .ini), reporting the exact argv and the log. |
| `debug_command_reference` | Catalogue of the µVision debugger command set recovered from the shipped help (uv4.chm): command, syntax summary, and the group it belongs to (execution, breakpoints, trace, variables, scripting). |
| `debug_pack_generate` | Generate a debugger-agnostic register/bitfield description from the device SVD in the installed pack: core registers plus every peripheral register and its fields (R= / B= RDI-style lines). |
| `debug_peripheral_map` | Structured peripheral memory map of a device (base address, register offsets, bitfields) derived from the pack SVD — for scripting a gdb stub or an external debugger. |
| `cli_reference` | The recovered UV4 command-line contract: commands, options and ERRORLEVEL table (evidence-backed). |
| `keil_install` | Report the detected Keil MDK installation (TOOLS.INI): UV4 path, uVision version, tool variants, toolsets (ARMCC/ARMCLANG), pack roots (RTEPATH), CMSIS-Toolbox binaries and registered debug drivers. |
| `toolchain_versions` | Query the bundled ARM toolchain: product, component and build for armcc, armasm, armlink, fromelf and armclang of the selected toolset. |
| `tool_run` | Run any bundled toolchain binary directly (armcc, armasm, armclang, armlink, fromelf, armar) with explicit arguments, in a chosen working directory. |
| `license_status` | MDK license status: armlm/armlm-ipc/FlexNet files, running daemons, and an optional live build-gate probe that reports UV4 Error #601 (no MDK-ARM license). |
| `uvsock_probe` | Probe the UVSOCK remote-control endpoint used by UV4 -s <port>: TCP reachability, greeting bytes after connect, and (optionally) a port-range scan. |
| `cli_table` | Raw recovered UV4 CLI table (commands, options, ERRORLEVEL) — identical to the cli_reference tool, provided for discoverability from the system group. |
