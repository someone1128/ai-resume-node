type BenchResult = {
  durationMs: number;
  status: number | null;
  error?: string;
};

const target = process.env.BENCH_URL ?? 'http://127.0.0.1:8823/health';
const requests = positiveInteger('BENCH_REQUESTS', 100);
const concurrency = Math.min(requests, positiveInteger('BENCH_CONCURRENCY', 10));
const timeoutMs = positiveInteger('BENCH_TIMEOUT_MS', 5_000);

const parsedTarget = new URL(target);
if (!['http:', 'https:'].includes(parsedTarget.protocol)) {
  throw new Error('BENCH_URL must use http or https');
}

function positiveInteger(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

async function requestOnce(): Promise<BenchResult> {
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(parsedTarget, { signal: controller.signal });
    await response.arrayBuffer();
    return { durationMs: performance.now() - started, status: response.status };
  } catch (error) {
    return {
      durationMs: performance.now() - started,
      status: null,
      error: error instanceof Error ? error.name : 'unknown',
    };
  } finally {
    clearTimeout(timeout);
  }
}

const results: BenchResult[] = [];
let next = 0;
async function worker() {
  while (true) {
    const index = next++;
    if (index >= requests) return;
    results[index] = await requestOnce();
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));

const durations = results.map((result) => result.durationMs).sort((a, b) => a - b);
const successful = results.filter((result) => result.status !== null && result.status < 500);
const percentile = (value: number) =>
  durations[Math.min(durations.length - 1, Math.floor(value * durations.length))] ?? 0;
const statusCounts = results.reduce<Record<string, number>>((counts, result) => {
  const key = result.status === null ? `error:${result.error ?? 'unknown'}` : String(result.status);
  counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}, {});

console.log(
  JSON.stringify(
    {
      target: parsedTarget.origin + parsedTarget.pathname,
      requests,
      concurrency,
      timeoutMs,
      successful: successful.length,
      failed: requests - successful.length,
      statusCounts,
      latencyMs: {
        min: durations[0] ?? 0,
        p50: percentile(0.5),
        p95: percentile(0.95),
        p99: percentile(0.99),
        max: durations.at(-1) ?? 0,
      },
      process: {
        node: process.version,
        rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
      note: 'Read-only GET benchmark. It does not create or modify application data.',
    },
    null,
    2,
  ),
);

if (successful.length !== requests) process.exitCode = 1;
