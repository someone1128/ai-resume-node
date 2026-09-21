import { deflateSync } from 'node:zlib';

const apiKey = process.env.DOUBAO_API_KEY;
const model = process.env.DOUBAO_IMAGE_MODEL ?? 'doubao-seedream-4-5-251128';
const endpoint =
  process.env.DOUBAO_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/v3/images/generations';

if (!apiKey) throw new Error('DOUBAO_API_KEY is required');

function chunk(type: string, data: Buffer) {
  const typeBytes = Buffer.from(type, 'ascii');
  const crc = Buffer.allocUnsafe(4);
  crc.writeUInt32BE(requireCrc32(Buffer.concat([typeBytes, data])), 0);
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function requireCrc32(value: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createFixturePng(): Buffer {
  const width = 64;
  const height = 64;
  const rows = Buffer.concat(
    Array.from({ length: height }, () =>
      Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0xd8)]),
    ),
  );
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from('\x89PNG\r\n\x1a\n', 'binary'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const image = `data:image/png;base64,${createFixturePng().toString('base64')}`;
const response = await fetch(endpoint, {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model,
    prompt: '生成一张简洁、干净的蓝色证件照背景测试图，不包含文字',
    image,
    size: '2048x2048',
    watermark: false,
    n: 1,
  }),
});
const payload = (await response.json()) as {
  id?: string;
  data?: Array<{ url?: string; b64_json?: string }>;
  error?: { code?: string; message?: string };
};
if (!response.ok) {
  throw new Error(
    `Doubao returned HTTP ${response.status}: ${payload.error?.code ?? 'unknown'} ${payload.error?.message ?? ''}`,
  );
}

const result = payload.data?.[0];
if (!result?.url && !result?.b64_json) throw new Error('Doubao response did not contain an image');

let resultBytes: number;
if (result.b64_json) {
  resultBytes = Buffer.from(result.b64_json, 'base64').byteLength;
} else {
  const imageResponse = await fetch(result.url!);
  if (!imageResponse.ok)
    throw new Error(`generated image download failed: ${imageResponse.status}`);
  resultBytes = (await imageResponse.arrayBuffer()).byteLength;
}

if (resultBytes === 0) throw new Error('generated image is empty');
console.log(JSON.stringify({ model, requestId: payload.id ?? null, resultBytes }));
