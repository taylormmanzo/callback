#!/bin/zsh
# Headless runner using macOS JavaScriptCore (no Node needed). Exit code 1 on any failure.
cd "$(dirname "$0")/.." || exit 1
osascript -l JavaScript - <<'JXA'
ObjC.import('Foundation'); ObjC.import('stdlib');
const read = (p) => ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null));
const cwd = ObjC.unwrap($.NSFileManager.defaultManager.currentDirectoryPath);
const src = ['data.js', 'logic.js', 'tests/tests.js'].map((f) => read(cwd + '/' + f)).join('\n;\n');
const results = (0, eval)(src + '\n;MW_RUN_TESTS();');
let out = results.map((t) => (t.ok ? 'PASS ' : 'FAIL ') + t.name + (t.err ? '\n     ' + t.err : '')).join('\n');
const passed = results.filter((t) => t.ok).length;
out += `\n\n${passed}/${results.length} passed`;
$.NSFileHandle.fileHandleWithStandardOutput.writeData($(out + '\n').dataUsingEncoding($.NSUTF8StringEncoding));
if (passed !== results.length) $.exit(1);
JXA
