/**
 * Output Serializer - 输出序列化和限长工具
 *
 * 提供对 JavaScript 执行结果的处理：
 * 1. 输出长度限制（默认 100KB）
 * 2. 深度对象序列化
 */

export const DEFAULT_MAX_OUTPUT_BYTES = 100 * 1024;

export interface OutputSanitizerOptions {
  maxBytes?: number;
  maxDepth?: number;
  maxArrayLength?: number;
  maxObjectKeys?: number;
  maxStringLength?: number;
}

export interface SanitizedOutput {
  text: string;
  truncated: boolean;
  redacted: boolean;
  originalBytes: number;
}

const DEFAULT_MAX_DEPTH = 10;
const DEFAULT_MAX_ARRAY_LENGTH = 500;
const DEFAULT_MAX_OBJECT_KEYS = 500;
const DEFAULT_MAX_STRING_LENGTH = 200_000;

/**
 * 对任意值进行序列化和限长处理（不做脱敏）
 */
export function sanitizeAndLimitOutput(
  value: unknown,
  options: OutputSanitizerOptions = {},
): SanitizedOutput {
  const maxBytes = normalizePositiveInt(options.maxBytes, DEFAULT_MAX_OUTPUT_BYTES);
  const maxDepth = normalizePositiveInt(options.maxDepth, DEFAULT_MAX_DEPTH);
  const maxArrayLength = normalizePositiveInt(options.maxArrayLength, DEFAULT_MAX_ARRAY_LENGTH);
  const maxObjectKeys = normalizePositiveInt(options.maxObjectKeys, DEFAULT_MAX_OBJECT_KEYS);
  const maxStringLength = normalizePositiveInt(options.maxStringLength, DEFAULT_MAX_STRING_LENGTH);

  const serialized = serializeValue(value, {
    maxDepth,
    maxArrayLength,
    maxObjectKeys,
    maxStringLength,
  });

  const formatted = formatValueForOutput(serialized);
  const truncated = truncateTextBytes(formatted, maxBytes);

  return {
    text: truncated.text,
    truncated: truncated.truncated,
    redacted: false,
    originalBytes: truncated.originalBytes,
  };
}

/**
 * 透传字符串，不做脱敏
 */
export function sanitizeText(text: string): { text: string; redacted: boolean } {
  return { text, redacted: false };
}

function serializeValue(
  value: unknown,
  limits: {
    maxDepth: number;
    maxArrayLength: number;
    maxObjectKeys: number;
    maxStringLength: number;
  },
): unknown {
  const { maxDepth, maxArrayLength, maxObjectKeys, maxStringLength } = limits;
  const seen = new WeakMap<object, unknown>();

  const walk = (v: unknown, depth: number): unknown => {
    if (depth < 0) return '[MaxDepth]';

    if (typeof v === 'string') {
      if (v.length > maxStringLength) {
        return `${v.slice(0, maxStringLength)}... [truncated ${v.length - maxStringLength} chars]`;
      }
      return v;
    }

    if (
      v === null ||
      typeof v === 'number' ||
      typeof v === 'boolean' ||
      typeof v === 'bigint' ||
      typeof v === 'undefined'
    ) {
      return v;
    }

    if (typeof v === 'symbol') return v.toString();
    if (typeof v === 'function') return `[Function${v.name ? `: ${v.name}` : ''}]`;

    if (typeof v !== 'object') return String(v);

    const obj = v as Record<string, unknown>;

    if (seen.has(obj)) return '[Circular]';

    if (Array.isArray(obj)) {
      const out: unknown[] = [];
      seen.set(obj, out);
      const len = Math.min(obj.length, maxArrayLength);
      for (let i = 0; i < len; i++) {
        out.push(walk(obj[i], depth - 1));
      }
      if (obj.length > maxArrayLength) out.push('[...truncated]');
      return out;
    }

    const out: Record<string, unknown> = {};
    seen.set(obj, out);

    const keys = Object.keys(obj);
    const len = Math.min(keys.length, maxObjectKeys);
    for (let i = 0; i < len; i++) {
      const key = keys[i];
      out[key] = walk(obj[key], depth - 1);
    }
    if (keys.length > maxObjectKeys) out.__truncated__ = true;

    return out;
  };

  return walk(value, maxDepth);
}

function formatValueForOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'undefined') return 'undefined';

  try {
    return safeJsonStringify(value);
  } catch {
    return String(value);
  }
}

function safeJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === 'bigint') return `${val.toString()}n`;
    if (typeof val === 'symbol') return val.toString();
    if (typeof val === 'function') return `[Function${val.name ? `: ${val.name}` : ''}]`;
    if (val && typeof val === 'object') {
      if (seen.has(val)) return '[Circular]';
      seen.add(val);
    }
    return val;
  });
}

function truncateTextBytes(
  text: string,
  maxBytes: number,
): { text: string; truncated: boolean; originalBytes: number } {
  const originalBytes = byteLength(text);
  if (originalBytes <= maxBytes) {
    return { text, truncated: false, originalBytes };
  }

  const suffix = `\n... [truncated to ${maxBytes} bytes; original ${originalBytes} bytes]`;
  const suffixBytes = byteLength(suffix);
  const budget = Math.max(0, maxBytes - suffixBytes);

  let lo = 0;
  let hi = text.length;

  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = text.slice(0, mid);
    if (byteLength(candidate) <= budget) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  const prefix = text.slice(0, lo);
  return { text: prefix + suffix, truncated: true, originalBytes };
}

function byteLength(text: string): number {
  try {
    return new TextEncoder().encode(text).length;
  } catch {
    return text.length;
  }
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(1, n);
}
