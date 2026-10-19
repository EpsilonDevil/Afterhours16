@echo off
rem Checks that the bridge can see the running Unreal Editor (editor must be open with RimriftMH loaded).
set PY="C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\ThirdParty\Python3\Win64\python.exe"
echo {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"selftest","version":"1"}}}> "%TEMP%\mcp_in.txt"
echo {"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"unreal_status","arguments":{}}}>> "%TEMP%\mcp_in.txt"
echo {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"unreal_exec","arguments":{"code":"import unreal; print('hello from', unreal.SystemLibrary.get_project_directory())"}}}>> "%TEMP%\mcp_in.txt"
%PY% "%~dp0unreal_mcp.py" < "%TEMP%\mcp_in.txt"
echo.
echo (If you see "connected to node" and "hello from" above, the bridge works.)
pause
