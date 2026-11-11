"""Serve hub/site read-only on port 5230 for other computers on the network.

    python3 /Users/ls/Claude-Workspace/personal/portage/hub/serve.py

Use this, not `python3 -m http.server`: the stock server queues only 5 connections,
so three pages loading at once drop requests and one comes up blank.
"""
import functools
import http.server
import pathlib

SITE = pathlib.Path(__file__).resolve().parent / "site"
PORT = 5230

http.server.ThreadingHTTPServer.request_queue_size = 128
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(SITE))
print(f"Portage hub: serving {SITE} on port {PORT}")
http.server.ThreadingHTTPServer(("0.0.0.0", PORT), handler).serve_forever()
