@echo off
rem headless smoke test of the MCP server (initialize + tools/list + one tool call)
node "%~dp0src\server.mjs" < "%~dp0tests\smoke_frames.jsonl"
