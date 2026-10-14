import { testEnv } from '@freightaudit/db/testing';
import { randomBytes } from 'node:crypto';
import { createStorage } from './storage.ts';

// The test run's MinIO; the bucket is created on first use and shared with the worker's crash test.
const options = { endpoint: testEnv('S3_ENDPOINT'), accessKey: testEnv('S3_ACCESS_KEY'), secretKey: testEnv('S3_SECRET_KEY'), bucket: 'freightaudit-test' };

test('puts and gets objects in MinIO with SigV4-signed requests', async () => {
  const storage = createStorage(options);
  const key = randomBytes(8).toString('hex');
  const body = randomBytes(1_000);
  await storage.put(key, body);
  expect(Buffer.from((await storage.get(key)) ?? [])).toEqual(body);
  expect(await storage.get(`${key}-missing`)).toBeUndefined();

  // A wrong secret fails the signature check.
  await expect(createStorage({ ...options, secretKey: 'wrong-secret' }).get(key)).rejects.toThrow('HTTP 403');
});
