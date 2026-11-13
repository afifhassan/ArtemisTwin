"""Local preview only: python serve.py --port 8080."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=8080)
args = parser.parse_args()
site = Path(__file__).resolve().parent / 'site'
if not (site / 'index.html').is_file():
    raise SystemExit('Extract the frontend ZIP first: site/index.html must be beside this script.')

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.avif': 'image/avif', '.mjs': 'text/javascript'}
    def end_headers(self):
        if self.path.split('?', 1)[0].endswith(('/', '.html')):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(Handler, directory=str(site)))
print(f'ArtemisTwin local preview: http://127.0.0.1:{args.port}/')
try:
    server.serve_forever()
except KeyboardInterrupt:
    server.server_close()
