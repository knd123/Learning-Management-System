import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import { MemoryStore, type Store } from '../server/db/store.ts';
import { firestoreTestStore } from './helpers.ts';

/** Every Store implementation must behave the same; Firestore runs when the emulator is available. */
function contract(name: string, make: () => Promise<Store>) {
  describe(`${name} store contract`, () => {
    it('puts, gets, patches and removes documents', async () => {
      const store = await make();
      await store.put('things', { id: 'a', n: 1, tags: ['x', 'y'], nested: { deep: true } });
      assert.deepEqual(await store.get('things', 'a'), { id: 'a', n: 1, tags: ['x', 'y'], nested: { deep: true } });
      assert.equal(await store.get('things', 'missing'), null);
      const patched = await store.patch<{ id: string; n: number; extra?: string; nested?: unknown }>('things', 'a', { n: 2, extra: 'e', nested: undefined });
      assert.equal(patched?.n, 2);
      assert.equal(patched?.extra, 'e');
      assert.equal('nested' in (patched || {}), false, 'undefined in a patch removes the field');
      assert.equal(await store.patch('things', 'missing', { n: 1 }), null);
      await store.remove('things', 'a');
      assert.equal(await store.get('things', 'a'), null);
    });

    it('finds by equality and array-contains', async () => {
      const store = await make();
      await store.put('people', { id: '1', role: 'student', active: true, classes: ['c1', 'c2'] });
      await store.put('people', { id: '2', role: 'student', active: false, classes: ['c2'] });
      await store.put('people', { id: '3', role: 'mentor', active: true, classes: [] });
      const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id).sort();
      assert.deepEqual(ids(await store.find('people', { role: 'student' })), ['1', '2']);
      assert.deepEqual(ids(await store.find('people', { role: 'student', active: true })), ['1']);
      assert.deepEqual(ids(await store.find('people', {}, { arrayContains: { field: 'classes', value: 'c2' } })), ['1', '2']);
      assert.deepEqual(ids(await store.find('people')), ['1', '2', '3']);
    });

    it('createIfAbsent only creates once', async () => {
      const store = await make();
      assert.equal(await store.createIfAbsent('locks', { id: 'job', at: 1 }), true);
      assert.equal(await store.createIfAbsent('locks', { id: 'job', at: 2 }), false);
      assert.deepEqual(await store.get('locks', 'job'), { id: 'job', at: 1 });
    });
  });
}

contract('memory', async () => new MemoryStore());
if (process.env.FIRESTORE_EMULATOR_HOST) contract('firestore', async () => firestoreTestStore(`demo-${crypto.randomUUID().slice(0, 8)}`));
