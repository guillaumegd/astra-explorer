import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('lot 5 keeps coordinates local and caps normal telemetry at 2 Hz', () => {
  const page = read('app/page.tsx');
  const galaxy = read('lib/galaxy.ts');
  assert.ok(page.includes('function PointingReadout'));
  assert.ok(
    !page
      .slice(page.indexOf('export default function Home'))
      .includes('const [pointing, setPointing]'),
  );
  assert.ok(galaxy.includes("diagnostics ? 200 : 500"));
  assert.ok(galaxy.includes('lastPointingKey'));
  assert.equal((galaxy.match(/host\.client(?:Width|Height)/g) ?? []).length, 0);
});

test('a paused scene is invalidated by useful inputs then sleeps when settled', () => {
  const galaxy = read('lib/galaxy.ts');
  for (const reason of [
    'pointer',
    'resize',
    'zoom',
    'configuration',
    'language',
    'context-restored',
  ])
    assert.ok(galaxy.includes(`invalidateRender('${reason}')`), reason);
  assert.ok(galaxy.includes('settings.paused'));
  assert.ok(galaxy.includes('cameraSettled'));
  assert.ok(galaxy.includes('stopLoop();'));
});

test('economy avoids panel blur and reduces the optional audio graph', () => {
  const css = read('app/globals.css');
  const audio = read('lib/ambient-audio.ts');
  assert.ok(css.includes('--panel-backdrop: none'));
  assert.ok(audio.includes('economy ? 1.1 : 3.8'));
  assert.ok(audio.includes('economy ? 2 : 5'));
  assert.ok(audio.includes('setEconomy(value: boolean)'));
});

test('the static hosting policy distinguishes HTML and hashed assets', () => {
  const headers = read('public/.htaccess');
  assert.ok(headers.includes('max-age=31536000, immutable'));
  assert.ok(headers.includes('no-cache, max-age=0, must-revalidate'));
  assert.ok(headers.includes('AddType application/javascript .js .mjs'));
});
