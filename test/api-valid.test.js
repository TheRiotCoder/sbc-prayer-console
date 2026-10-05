import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Pure validation helpers mirrored from index.js
const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && (() => { try { return new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s; } catch { return false; } })();
const clampLimit = raw => { const n = Math.floor(+raw || 40); if (!Number.isFinite(n)) return 40; return Math.max(1, Math.min(n, 100)); };
function safeIso(raw) { try { const d = decodeURIComponent(raw || ''); return /^[A-Za-z]{2}$/.test(d) ? d.toUpperCase() : null; } catch { return null; } }

describe('API validation', () => {
  it('rejects impossible dates', () => {
    assert.equal(validDate('2026-02-31'), false);
    assert.equal(validDate('2026-10-05'), true);
  });
  it('clamps limit', () => {
    assert.equal(clampLimit('-3'), 1);
    assert.equal(clampLimit('999'), 100);
    assert.equal(clampLimit('40'), 40);
  });
  it('malformed URI → null iso (400)', () => {
    assert.equal(safeIso('%E0'), null);
    assert.equal(safeIso('ng'), 'NG');
  });
});
