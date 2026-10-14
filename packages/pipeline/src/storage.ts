import { createHash, createHmac } from 'node:crypto';

// PDFs by content hash. One object per key; writing the same key again stores the same bytes.
export type Storage = {
  put(key: string, body: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
};

export type StorageOptions = { endpoint: string; accessKey: string; secretKey: string; bucket: string; region?: string };

// For tests and runs without MinIO: objects live in this process only.
export function createMemoryStorage(): Storage {
  const objects = new Map<string, Uint8Array>();
  return { put: async (key, body) => void objects.set(key, body), get: async (key) => objects.get(key) };
}

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();

// Minimal S3 client for MinIO: path-style requests signed with AWS Signature V4, no SDK.
export function createStorage({ endpoint, accessKey, secretKey, bucket, region = 'us-east-1' }: StorageOptions): Storage {
  function send(method: 'GET' | 'PUT', path: string, body?: Uint8Array) {
    const url = new URL(path, endpoint);
    const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
    const scope = `${amzDate.slice(0, 8)}/${region}/s3/aws4_request`;
    const payloadHash = sha256(body ?? '');
    // Signed headers in sorted order; fetch sends Host itself.
    const signed = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
    const names = Object.keys(signed).join(';');
    const canonical = [method, url.pathname, '', ...Object.entries(signed).map(([name, value]) => `${name}:${value}`), '', names, payloadHash];
    const key = [region, 's3', 'aws4_request'].reduce((derived, part) => hmac(derived, part), hmac(`AWS4${secretKey}`, amzDate.slice(0, 8)));
    const signature = hmac(key, ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical.join('\n'))].join('\n')).toString('hex');
    return fetch(url, {
      method,
      body,
      signal: AbortSignal.timeout(10_000),
      headers: {
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
        authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names}, Signature=${signature}`,
      },
    });
  }

  async function check(response: Response, action: string) {
    await response.body?.cancel();
    if (!response.ok) throw new Error(`object storage ${action} failed: HTTP ${response.status}`);
  }

  return {
    async put(key, body) {
      let response = await send('PUT', `/${bucket}/${key}`, body);
      if (response.status === 404) {
        // NoSuchBucket on first use: create it (409 means another process just did) and try again.
        await response.body?.cancel();
        const created = await send('PUT', `/${bucket}`);
        if (created.status !== 409) await check(created, 'create bucket');
        else await created.body?.cancel();
        response = await send('PUT', `/${bucket}/${key}`, body);
      }
      await check(response, 'put');
    },
    async get(key) {
      const response = await send('GET', `/${bucket}/${key}`);
      if (response.status === 404) {
        await response.body?.cancel();
        return undefined;
      }
      if (!response.ok) await check(response, 'get');
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}
