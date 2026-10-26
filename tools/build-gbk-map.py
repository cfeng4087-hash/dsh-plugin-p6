"""Regenerate data/gbk-map.json (char -> 2-byte GBK hex).

P6 Professional on a Chinese Windows reads XER in the system ANSI codepage
(GBK/CP936), so the plugin needs a GBK encoder. Node has no built-in one and
we do not want a dependency, hence this bundled table.
"""
import json
import os
import sys

mapping = {}
for hi in range(0x81, 0xFF):
    for lo in range(0x40, 0xFF):
        try:
            ch = bytes([hi, lo]).decode('gbk')
        except UnicodeDecodeError:
            continue
        if len(ch) == 1 and ch not in mapping:
            mapping[ch] = '%02X%02X' % (hi, lo)

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = os.path.join(root, 'data', 'gbk-map.json')
with open(out, 'w', encoding='utf-8') as f:
    json.dump(mapping, f, ensure_ascii=False, separators=(',', ':'))
print(len(mapping), out, file=sys.stdout)
