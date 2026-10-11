#!/usr/bin/env python3
r"""Call Blender MCP tools directly (for reviewing agy's Blender work).

Usage: blender_mcp_call.py <outdir> <tool> '<json args>' [<tool> '<json args>' ...]

- Text results are printed; image results (e.g. from `look`) are saved to <outdir>/img<N>_<j>.png
  so they can be viewed with the Read tool.
- For execute_blender_code, `{"code": "@/path/to/script.py"}` loads the code from a file.

The server is the Windows build at E:\Tools\blender-mcp-venv (WSL can't reach Windows
localhost on this Win10 machine, so the MCP server must run on the Windows side).
"""
import base64, json, os, subprocess, sys

SERVER = "/mnt/e/Tools/blender-mcp-venv/Scripts/blender-mcp.exe"

if len(sys.argv) < 4 or len(sys.argv[2:]) % 2:
    sys.exit(__doc__)
out, calls = sys.argv[1], sys.argv[2:]

msgs = [
    {"jsonrpc": "2.0", "id": 0, "method": "initialize",
     "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "review", "version": "1"}}},
    {"jsonrpc": "2.0", "method": "notifications/initialized"},
]
for i in range(0, len(calls), 2):
    args = json.loads(calls[i + 1])
    if calls[i] == "execute_blender_code" and args.get("code", "").startswith("@"):
        args["code"] = open(args["code"][1:]).read()
    msgs.append({"jsonrpc": "2.0", "id": i // 2 + 1, "method": "tools/call",
                 "params": {"name": calls[i], "arguments": args}})

pr = subprocess.Popen([SERVER], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                      stderr=subprocess.DEVNULL, text=True, cwd="/mnt/c")


def send(m):
    pr.stdin.write(json.dumps(m) + "\n")
    pr.stdin.flush()


# Wait for each response before sending the next call (closing stdin early drops results).
lines = []
send(msgs[0]); lines.append(pr.stdout.readline()); send(msgs[1])
for m in msgs[2:]:
    send(m); lines.append(pr.stdout.readline())
pr.stdin.close(); pr.wait(timeout=30)

for line in lines:
    d = json.loads(line)
    if not d.get("id"):
        continue
    for j, c in enumerate(d.get("result", {}).get("content", []) or [{"type": "text", "text": str(d)}]):
        if c["type"] == "text":
            print(f"[{d['id']}]", c["text"][:5000])
        elif c["type"] == "image":
            f = os.path.join(out, f"img{d['id']}_{j}.png")
            open(f, "wb").write(base64.b64decode(c["data"]))
            print(f"[{d['id']}] image ->", f)
