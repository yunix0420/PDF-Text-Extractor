import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_VERSION, APP_VERSION_DATE } from '../version.js';
import { getAppVersion } from './dialogs.js';

test('canonical APP_VERSION and APP_VERSION_DATE constants are populated', () => {
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+/);
  assert.equal(typeof APP_VERSION_DATE, 'string');
  assert.ok(APP_VERSION_DATE.length > 0);
});

test('getAppVersion returns canonical version when backend is not loaded', async () => {
  const ver = await getAppVersion();
  assert.equal(ver.version, APP_VERSION);
  assert.equal(ver.versionDate, APP_VERSION_DATE);
});
