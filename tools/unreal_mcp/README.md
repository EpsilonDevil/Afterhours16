# RIMRIFT Unreal MCP bridge

Lets Claude run Python inside the open Unreal Editor directly (no console typing, no screen control).

## One-time setup (David)
1. Unreal: Project Settings > Plugins > Python > **Enable Remote Execution** = on (done). Leave the
   defaults: multicast group 239.0.0.1:6766, bind address 127.0.0.1. Restart the editor once after enabling.
2. Keep this folder at `C:\Afterhours16\tools\unreal_mcp\`.
3. Double-click `selftest.cmd` with the editor open — it should print `connected to node ...` and
   `hello from C:/Users/trail/Documents/Unreal Projects/RimriftMH/`. (Windows Firewall may ask once: allow.)
4. Claude desktop app: Settings > Developer > **Edit Config** — merge `claude_desktop_config.snippet.json`
   into `claude_desktop_config.json` (if the file already has `mcpServers`, add the `"unreal"` entry inside it).
5. Fully quit and relaunch the Claude desktop app, then re-link the session. The tools appear to Claude as
   `unreal_status`, `unreal_exec`, `unreal_exec_async`, `unreal_job`, `unreal_run_file`, `read_text`, `list_dir`.

## Notes
- Long jobs (auto-rig, exports) go through `unreal_exec_async` + `unreal_job` so nothing times out.
- The server logs every call to `unreal_mcp.log` next to the script.
- Uses only the Python bundled with Unreal (no pip installs).
