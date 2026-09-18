import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DRIFT_REST_DELAY,
  REST_DELAY,
  canRest,
  restDelay,
  wakesInterface,
} from '../lib/interface-rest.ts';

const awake = {
  panel: false,
  opening: false,
  focusedControl: false,
  drifting: false,
};

test('the interface rests after a stretch of silence, sooner during a drift', () => {
  assert.equal(restDelay({ drifting: false }), REST_DELAY);
  assert.equal(restDelay({ drifting: true }), DRIFT_REST_DELAY);
  assert.ok(DRIFT_REST_DELAY < REST_DELAY);
});

test('nothing that is being read or focused is taken away', () => {
  assert.equal(canRest(awake), true);
  assert.equal(canRest({ ...awake, panel: true }), false);
  assert.equal(canRest({ ...awake, opening: true }), false);
  assert.equal(canRest({ ...awake, focusedControl: true }), false);
});

test('a drift alone never keeps the interface on screen', () => {
  assert.equal(canRest({ ...awake, drifting: true }), true);
  assert.equal(canRest({ ...awake, drifting: true, panel: true }), false);
});

test('stepping to the next body leaves a cleared screen cleared', () => {
  assert.equal(wakesInterface('ArrowRight'), false);
  assert.equal(wakesInterface('ArrowLeft'), false);
  // Everything else is a visitor taking the controls back.
  const keys = ['Escape', 'Enter', 'Home', ' ', 'ArrowUp', 'ArrowDown', 'a'];
  for (const key of keys) assert.equal(wakesInterface(key), true, key);
});
