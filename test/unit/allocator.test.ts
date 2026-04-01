import test from "node:test";
import assert from "node:assert/strict";

import { allocate } from "../../src/util/allocator.ts";
import { config } from "../../src/util/config.ts";
import type { DesktopRecord } from "../../src/util/store.ts";

function desktop(display: number): DesktopRecord {
  const offset = display - config.displayMin;
  const wsPort = config.wsPortMin + offset;
  const cdpPort = config.cdpPortMin + offset;
  const aabPort = config.aabPortMin + offset;

  return {
    id: `desk-${display}`,
    createdAt: Date.now(),
    status: "running",
    display,
    vncPort: 5900 + display,
    wsPort,
    cdpPort,
    aabPort,
    novncUrl: `https://example.test/desktop/${display}/`,
    aabUrl: `http://127.0.0.1:${aabPort}`,
  };
}

test("allocator returns display-derived ports from first free display", () => {
  const existing = [desktop(config.displayMin), desktop(config.displayMin + 1)];
  const alloc = allocate(existing);

  const expectedDisplay = config.displayMin + 2;
  const offset = expectedDisplay - config.displayMin;
  assert.equal(alloc.display, expectedDisplay);
  assert.equal(alloc.vncPort, 5900 + expectedDisplay);
  assert.equal(alloc.wsPort, config.wsPortMin + offset);
  assert.equal(alloc.cdpPort, config.cdpPortMin + offset);
  assert.equal(alloc.aabPort, config.aabPortMin + offset);
});

test("allocator throws when all displays are exhausted", () => {
  const existing: DesktopRecord[] = [];
  for (let d = config.displayMin; d <= config.displayMax; d++) {
    existing.push(desktop(d));
  }

  assert.throws(() => allocate(existing), /no_free_display/);
});
