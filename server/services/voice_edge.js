/**
 * 微软 Edge TTS — 通过 Python edge-tts 调用
 * 免费、无需 API Key、音质好
 *
 * 稳定性加固（解决偶发「TTS 合成失败」）：
 *  1. 超时从 15s 放宽到 45s —— 长话术在服务器有负载时会超过 15s 被杀掉
 *  2. 失败自动重试 —— 微软接口偶发抖动时能自愈
 *  3. 内存缓存 —— 相同文本直接返回，话术高度重复，可大幅减少外部调用
 *  4. 并发限流 —— 最多同时跑 3 个合成进程，避免 2 核机器被压垮
 */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const EDGE_TTS = process.env.EDGE_TTS_PATH || '/home/ubuntu/.local/bin/edge-tts';
const VOICE = process.env.EDGE_TTS_VOICE || 'zh-CN-XiaoxiaoNeural'; // 晓晓 — 温柔女声

const TIMEOUT_MS = 45000;             // 单次合成超时
const MAX_RETRY = 2;                  // 失败重试次数
const MAX_CONCURRENT = 3;             // 同时最多几个合成进程
const CACHE_MAX = 200;                // 缓存条数上限
const CACHE_TTL_MS = 30 * 60 * 1000;  // 缓存有效期 30 分钟

const cache = new Map();
let running = 0;
const queue = [];

function getCached(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.buf;
}

function setCache(key, buf) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(key, { buf, at: Date.now() });
}

/** 执行一次 edge-tts 合成 */
function runOnce(text) {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `tts_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`);
    execFile(EDGE_TTS, [
      '--voice', VOICE,
      '--text', text,
      '--write-media', tmpFile,
    ], { timeout: TIMEOUT_MS }, (err) => {
      if (err) {
        try { fs.unlinkSync(tmpFile); } catch (_) {}
        return reject(err);
      }
      try {
        const buf = fs.readFileSync(tmpFile);
        fs.unlinkSync(tmpFile);
        if (buf.length < 100) {
          return reject(new Error(`TTS 返回数据过短 (${buf.length} bytes)`));
        }
        resolve(buf);
      } catch (e) {
        reject(new Error(`TTS 读取失败: ${e.message}`));
      }
    });
  });
}

/** 带重试的合成 */
async function synthesize(text) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      return await runOnce(text);
    } catch (e) {
      lastErr = e;
      console.warn(`[TTS] 第 ${attempt + 1} 次合成失败: ${String(e.message).slice(0, 100)}`);
      if (attempt < MAX_RETRY) {
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

/** 获取并发额度 */
function acquire() {
  return new Promise((resolve) => {
    if (running < MAX_CONCURRENT) {
      running += 1;
      return resolve();
    }
    queue.push(resolve);
  });
}

/** 释放并发额度 */
function release() {
  running -= 1;
  const next = queue.shift();
  if (next) {
    running += 1;
    next();
  }
}

/**
 * 合成语音，返回 mp3 Buffer
 */
async function textToSpeech(text) {
  const trimmed = String(text || '').trim().substring(0, 300);
  if (!trimmed) throw new Error('文本为空');

  const cacheKey = `${VOICE}::${trimmed}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  await acquire();
  try {
    const buf = await synthesize(trimmed);
    setCache(cacheKey, buf);
    return buf;
  } catch (err) {
    throw new Error(`TTS 合成失败: ${err.message}`);
  } finally {
    release();
  }
}

module.exports = { textToSpeech };
