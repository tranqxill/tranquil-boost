"""Builds a browser preview of the UI with the fake backend and screenshots each page."""
import os, shutil, sys
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/tb-shots'
PREV = '/tmp/tb-preview'

shutil.rmtree(PREV, ignore_errors=True)
shutil.copytree(os.path.join(ROOT, 'src', 'renderer'), PREV)
shutil.copy(os.path.join(ROOT, 'dev', 'mock.js'), PREV)
html = open(os.path.join(PREV, 'index.html')).read()
html = html.replace('<script src="icons.js"></script>', '<script src="mock.js"></script>\n  <script src="icons.js"></script>')
open(os.path.join(PREV, 'index.html'), 'w').write(html)
os.makedirs(OUT, exist_ok=True)

pages = sys.argv[2].split(',') if len(sys.argv) > 2 else ['home', 'optimize', 'network', 'cleanup', 'startup', 'stats', 'backups']
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--allow-file-access-from-files'])
    pg = b.new_page(viewport={'width': 1240, 'height': 780}, device_scale_factor=1)
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto('file://' + PREV + '/index.html')
    pg.wait_for_timeout(2500)
    for name in pages:
        pg.click(f'[data-page="{name}"]')
        pg.wait_for_timeout(1800 if name in ('network', 'cleanup', 'startup') else 900)
        if name == 'network':
            pg.click('[data-act="ping"]'); pg.click('[data-act="dnstest"]'); pg.wait_for_timeout(1600)
        if name == 'stats':
            pg.wait_for_timeout(6000)
        pg.screenshot(path=f'{OUT}/{name}.png')
    print('errors:', errs)
    b.close()
