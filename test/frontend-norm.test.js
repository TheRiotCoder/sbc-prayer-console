import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Load just the norm helpers from app.js in a sandbox
const src = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const start = src.indexOf('const STATUS_OK');
const end = src.indexOf('function loadArr');
const slice = src.slice(start, end);
const sandbox = { console, Date, Math, Object, Array, String, Number, RegExp, JSON, parseInt, isFinite: Number.isFinite };
sandbox.Number = Number;
vm.createContext(sandbox);
// Provide todayStr/uid used by norms
vm.runInContext('const todayStr = () => "2026-10-05"; const uid = () => "abcdef12"; const hasOwn = (o,k) => Object.prototype.hasOwnProperty.call(o,k);', sandbox);
vm.runInContext(slice, sandbox);

describe('import/localStorage schema', () => {
  it('rejects null/wrong types and __proto__ iso', () => {
    assert.equal(sandbox.normMissionary(null, { NG: {} }), null);
    assert.equal(sandbox.normMissionary({ name: 'x', iso2: '__proto__' }, { NG: {} }), null);
    assert.equal(sandbox.normPrayer({ title: 'x', id: 'okid01', prayed: 'nope' }, {}).prayed.length, 0);
    const ok = sandbox.normMissionary({ name: 'A', iso2: 'NG', sensitive: false, status: 'active' }, { NG: {} });
    assert.equal(ok.iso2, 'NG');
    assert.equal(ok.sensitive, false);
    const def = sandbox.normMissionary({ name: 'B', iso2: 'NG' }, { NG: {} });
    assert.equal(def.sensitive, true); // default ON
  });
});
