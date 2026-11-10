"""Tiny no-cache static server for reviewing the Phase 0 prototype.

Usage: python3 scripts/serve.py [port]   (defaults to 4173, serves ./public)
"""
import functools
import http.server
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4173
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"Serving prototype on http://localhost:{port}")
        httpd.serve_forever()
