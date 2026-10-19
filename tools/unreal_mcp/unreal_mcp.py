"""RIMRIFT Unreal MCP bridge — a dependency-free MCP (stdio) server that forwards Python to a
running Unreal Editor through the Python plugin's Remote Execution (Project Settings > Plugins >
Python > Enable Remote Execution must be on in the project).

Run with any Python 3.8+ (the one bundled with Unreal works):
  "C:\\Program Files\\Epic Games\\UE_5.8\\Engine\\Binaries\\ThirdParty\\Python3\\Win64\\python.exe" unreal_mcp.py

Tools exposed:
  unreal_status()                      -> editor nodes found on the network
  unreal_exec(code, mode)              -> run Python in the editor, return its output (blocks until done)
  unreal_exec_async(code, mode)        -> start a long job, returns a job id
  unreal_job(job_id)                   -> poll / fetch the job's output
  unreal_run_file(path)                -> run a .py file that is on this PC
  read_text(path, tail)                -> read a text file on this PC (logs, result files)
  list_dir(path)                       -> list a folder on this PC
Everything is logged to unreal_mcp.log next to this file.
"""
import sys, os, json, glob, threading, time, traceback, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = open(os.path.join(HERE, 'unreal_mcp.log'), 'a', encoding='utf-8')
def log(*a):
    LOG.write(time.strftime('%H:%M:%S ') + ' '.join(str(x) for x in a) + '\n'); LOG.flush()

# ---------------------------------------------------------------- find Unreal's remote_execution.py
def find_remote_execution():
    cands = []
    for root in ('C:/Program Files/Epic Games', 'D:/Program Files/Epic Games', 'C:/Epic Games', 'D:/Epic Games'):
        cands += glob.glob(root + '/UE_*/Engine/Plugins/Experimental/PythonScriptPlugin/Content/Python/remote_execution.py')
        cands += glob.glob(root + '/UE_*/Engine/Plugins/PythonScriptPlugin/Content/Python/remote_execution.py')
    env = os.environ.get('UE_REMOTE_EXECUTION')
    if env: cands.insert(0, env)
    for c in cands:
        if os.path.exists(c): return c
    return None

REMOTE = None
def remote_module():
    global REMOTE
    if REMOTE is None:
        p = find_remote_execution()
        if not p: raise RuntimeError('remote_execution.py not found under Epic Games; set UE_REMOTE_EXECUTION')
        sys.path.insert(0, os.path.dirname(p))
        import remote_execution
        REMOTE = remote_execution
        log('remote_execution from', p)
    return REMOTE

_lock = threading.Lock()
def with_editor(fn, wait=4.0):
    """open a command connection to the first editor node, run fn(remote_exec), close"""
    remote = remote_module()
    with _lock:
        rx = remote.RemoteExecution()
        rx.start()
        try:
            t0 = time.time()
            while not rx.remote_nodes and time.time() - t0 < wait:
                time.sleep(0.25)
            if not rx.remote_nodes:
                raise RuntimeError('no Unreal Editor with Remote Execution enabled was found (is the editor running with the project open? multicast 239.0.0.1:6766)')
            node = rx.remote_nodes[0]
            rx.open_command_connection(node['node_id'])
            try:
                return fn(rx, node)
            finally:
                try: rx.close_command_connection()
                except Exception: pass
        finally:
            rx.stop()

MODES = {'file': 'ExecuteFile', 'statement': 'ExecuteStatement', 'eval': 'EvaluateStatement'}
def run_code(code, mode='file'):
    exec_mode = MODES.get(mode, 'ExecuteFile')
    def go(rx, node):
        res = rx.run_command(code, unattended=True, exec_mode=exec_mode, raise_on_failure=False)
        out = []
        for o in res.get('output', []) or []:
            typ = o.get('type', ''); txt = o.get('output', '')
            out.append(('[%s] ' % typ if typ and typ != 'Info' else '') + txt)
        text = '\n'.join(out)
        if res.get('result') not in (None, '', 'None'): text += ('\n' if text else '') + 'result: ' + str(res.get('result'))
        if not res.get('success', True): text = 'FAILED\n' + text
        return text or '(no output)'
    return with_editor(go)

def status():
    def go(rx, node):
        return 'connected to node %s (%s, %s)\n%d node(s): %s' % (node.get('node_id'), node.get('machine'), node.get('project_name'), len(rx.remote_nodes), json.dumps(rx.remote_nodes, default=str)[:1500])
    return with_editor(go)

JOBS = {}
def start_job(code, mode):
    jid = uuid.uuid4().hex[:8]
    JOBS[jid] = {'state': 'running', 'started': time.time(), 'output': None}
    def worker():
        try:
            JOBS[jid]['output'] = run_code(code, mode); JOBS[jid]['state'] = 'done'
        except Exception as e:
            JOBS[jid]['output'] = 'ERROR ' + str(e) + '\n' + traceback.format_exc(); JOBS[jid]['state'] = 'error'
        JOBS[jid]['finished'] = time.time()
    threading.Thread(target=worker, daemon=True).start()
    return jid

def read_text(path, tail=0):
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        data = f.read()
    if tail and tail > 0:
        lines = data.splitlines()
        data = '\n'.join(lines[-int(tail):])
    if len(data) > 60000: data = data[-60000:]
    return data

def list_dir(path):
    rows = []
    for n in sorted(os.listdir(path)):
        p = os.path.join(path, n)
        if os.path.isdir(p): rows.append('[dir]  ' + n)
        else: rows.append('%10d  %s  %s' % (os.path.getsize(p), time.strftime('%H:%M:%S', time.localtime(os.path.getmtime(p))), n))
    return '\n'.join(rows) or '(empty)'

# ---------------------------------------------------------------- MCP (stdio, JSON-RPC)
TOOLS = [
    {'name': 'unreal_status', 'description': 'Find the running Unreal Editor (Remote Execution) and report the node.', 'inputSchema': {'type': 'object', 'properties': {}}},
    {'name': 'unreal_exec', 'description': 'Run Python inside the Unreal Editor and return its output. mode: file (default, multi-line script), statement, or eval (returns the expression value). Blocks until the code finishes; use unreal_exec_async for anything longer than ~1 minute.', 'inputSchema': {'type': 'object', 'properties': {'code': {'type': 'string'}, 'mode': {'type': 'string', 'enum': ['file', 'statement', 'eval']}}, 'required': ['code']}},
    {'name': 'unreal_exec_async', 'description': 'Start Python in the Unreal Editor as a background job (for auto-rig, exports, long captures). Returns a job id; poll with unreal_job.', 'inputSchema': {'type': 'object', 'properties': {'code': {'type': 'string'}, 'mode': {'type': 'string', 'enum': ['file', 'statement', 'eval']}}, 'required': ['code']}},
    {'name': 'unreal_job', 'description': 'State and output of a job started with unreal_exec_async.', 'inputSchema': {'type': 'object', 'properties': {'job_id': {'type': 'string'}}, 'required': ['job_id']}},
    {'name': 'unreal_run_file', 'description': 'Run a .py file that already exists on this PC inside the Unreal Editor (same as the console `py` command) and return its output.', 'inputSchema': {'type': 'object', 'properties': {'path': {'type': 'string'}, 'async': {'type': 'boolean'}}, 'required': ['path']}},
    {'name': 'read_text', 'description': 'Read a text file on this PC (editor logs, script result files). tail = last N lines.', 'inputSchema': {'type': 'object', 'properties': {'path': {'type': 'string'}, 'tail': {'type': 'integer'}}, 'required': ['path']}},
    {'name': 'list_dir', 'description': 'List a folder on this PC.', 'inputSchema': {'type': 'object', 'properties': {'path': {'type': 'string'}}, 'required': ['path']}},
]

def call_tool(name, args):
    if name == 'unreal_status': return status()
    if name == 'unreal_exec': return run_code(args['code'], args.get('mode', 'file'))
    if name == 'unreal_exec_async': return 'job ' + start_job(args['code'], args.get('mode', 'file'))
    if name == 'unreal_job':
        j = JOBS.get(args['job_id'])
        if not j: return 'unknown job'
        el = (j.get('finished') or time.time()) - j['started']
        return '%s after %ds\n%s' % (j['state'], el, j['output'] or '')
    if name == 'unreal_run_file':
        code = 'exec(open(r"%s", encoding="utf-8").read())' % args['path']
        if args.get('async'): return 'job ' + start_job(code, 'file')
        return run_code(code, 'file')
    if name == 'read_text': return read_text(args['path'], args.get('tail', 0))
    if name == 'list_dir': return list_dir(args['path'])
    raise RuntimeError('unknown tool ' + name)

def send(msg):
    data = json.dumps(msg)
    sys.stdout.write(data + '\n'); sys.stdout.flush()

def main():
    log('server start', sys.executable)
    for line in sys.stdin:
        line = line.strip()
        if not line: continue
        try: req = json.loads(line)
        except Exception as e:
            log('bad json', e, line[:200]); continue
        mid = req.get('id'); method = req.get('method'); params = req.get('params') or {}
        log('<-', method, str(params)[:300])
        try:
            if method == 'initialize':
                send({'jsonrpc': '2.0', 'id': mid, 'result': {'protocolVersion': params.get('protocolVersion', '2024-11-05'), 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'rimrift-unreal', 'version': '0.1'}}})
            elif method == 'notifications/initialized' or method.startswith('notifications/'):
                pass
            elif method == 'ping':
                send({'jsonrpc': '2.0', 'id': mid, 'result': {}})
            elif method == 'tools/list':
                send({'jsonrpc': '2.0', 'id': mid, 'result': {'tools': TOOLS}})
            elif method == 'tools/call':
                name = params.get('name'); args = params.get('arguments') or {}
                try:
                    text = call_tool(name, args); is_err = False
                except Exception as e:
                    text = 'ERROR: %s\n%s' % (e, traceback.format_exc()); is_err = True
                log('->', name, 'error' if is_err else 'ok', len(text))
                send({'jsonrpc': '2.0', 'id': mid, 'result': {'content': [{'type': 'text', 'text': text}], 'isError': is_err}})
            elif mid is not None:
                send({'jsonrpc': '2.0', 'id': mid, 'error': {'code': -32601, 'message': 'method not found: %s' % method}})
        except Exception as e:
            log('handler error', e, traceback.format_exc())
            if mid is not None:
                send({'jsonrpc': '2.0', 'id': mid, 'error': {'code': -32000, 'message': str(e)}})

if __name__ == '__main__':
    main()
