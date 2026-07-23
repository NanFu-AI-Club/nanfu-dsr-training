/**
 * 火山引擎语音服务 — ASR（语音识别）+ TTS（语音合成）
 * 豆包流式语音识别模型2.0
 */

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ==================== 配置 ====================
const ASR_APP_ID = process.env.VOLC_ASR_APP_ID || '1986340910';
const ASR_ACCESS_TOKEN = process.env.VOLC_ASR_ACCESS_TOKEN || 'Nk2Iu6YGRkTcp060uE3L3c1ORnevpj9S';

const OUTPUT_DIR = path.join(__dirname, '..', 'output');

// 确保输出目录存在
try { fs.mkdirSync(OUTPUT_DIR, { recursive: true }); } catch (_) {}

// ==================== HTTP 请求辅助 ====================
function httpsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const data = Buffer.concat(chunks);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, data, headers: res.headers });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.toString('utf-8').slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Request timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

// ==================== ASR：语音识别（语音 → 文字） ====================

/**
 * 火山引擎一句话识别（HTTP v1，JSON body + base64 音频）
 */
async function speechToText(audioBuffer) {
  const reqid = crypto.randomBytes(8).toString('hex');

  const body = JSON.stringify({
    app: { appid: String(ASR_APP_ID), token: ASR_ACCESS_TOKEN, cluster: 'volcengine_input_common' },
    user: { uid: 'nanfu-dsr' },
    audio: {
      format: 'wav',
      rate: 16000,
      bits: 16,
      channel: 1,
      language: 'zh-CN',
      data: audioBuffer.toString('base64'),
    },
    request: {
      reqid,
      sequence: 1,
      model_name: 'bigmodel',
      enable_itn: true,
      enable_punc: true,
    },
  });

  const { data } = await httpsRequest(
    'https://openspeech.bytedance.com/api/v1/asr',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer; ${ASR_ACCESS_TOKEN}`,
        'Content-Length': Buffer.byteLength(body),
      },
    },
    body
  );

  const result = JSON.parse(data.toString('utf-8'));

  // code 1000 = 成功
  if (result.code !== 1000 && result.code !== 0) {
    throw new Error(`ASR error code=${result.code}: ${result.message || JSON.stringify(result)}`);
  }

  const text = result?.result?.text || result?.text || '';
  return text;
}

// ==================== TTS：语音合成（文字 → 语音） ====================

// vivi 2.0 音色
const TTS_SPEAKER_VIVI = 'BV700_streaming';

/**
 * 豆包语音合成模型2.0 — vivi 2.0 音色
 */
async function textToSpeech(text) {
  const reqid = crypto.randomBytes(8).toString('hex');

  // 尝试用 Bearer Token 鉴权 + vivi 音色
  const body = JSON.stringify({
    app: { appid: String(ASR_APP_ID), token: ASR_ACCESS_TOKEN, cluster: 'volcengine_tts' },
    user: { uid: 'nanfu-dsr' },
    audio: {
      voice_type: TTS_SPEAKER_VIVI,
      encoding: 'mp3',
      speed_ratio: 1.0,
      volume_ratio: 1.0,
      pitch_ratio: 1.0,
      sample_rate: 24000,
    },
    request: { reqid, text, text_type: 'plain', operation: 'query' },
  });

  const { data } = await httpsRequest(
    'https://openspeech.bytedance.com/api/v1/tts',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer; ${ASR_ACCESS_TOKEN}`,
        'Content-Length': Buffer.byteLength(body),
      },
    },
    body
  );

  const result = JSON.parse(data.toString('utf-8'));

  // 如果 vivi 音色不可用，尝试通用女声
  if (result.code === 3001 && result.message && result.message.includes('voice')) {
    // 降级尝试常用音色
    body2 = JSON.stringify({
      app: { appid: String(ASR_APP_ID), token: ASR_ACCESS_TOKEN, cluster: 'volcengine_tts' },
      user: { uid: 'nanfu-dsr' },
      audio: {
        voice_type: 'BV001_streaming',
        encoding: 'mp3',
        speed_ratio: 1.0,
        volume_ratio: 1.0,
        pitch_ratio: 1.0,
        sample_rate: 24000,
      },
      request: { reqid: crypto.randomBytes(8).toString('hex'), text, text_type: 'plain', operation: 'query' },
    });
    const res2 = await httpsRequest('https://openspeech.bytedance.com/api/v1/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer; ${ASR_ACCESS_TOKEN}`, 'Content-Length': Buffer.byteLength(body2) },
    }, body2);
    const r2 = JSON.parse(res2.data.toString('utf-8'));
    if (r2.code !== 3000 && r2.code !== 0) {
      throw new Error(`TTS error code=${r2.code}: ${r2.message || JSON.stringify(r2)}`);
    }
    const audioBase64 = r2.data || r2.audio || '';
    return Buffer.from(audioBase64, 'base64');
  }

  if (result.code !== 3000 && result.code !== 0) {
    throw new Error(`TTS error code=${result.code}: ${result.message || JSON.stringify(result)}`);
  }

  const audioBase64 = result.data || result.audio || '';
  if (!audioBase64) throw new Error('TTS returned empty audio');

  return Buffer.from(audioBase64, 'base64');
}

// ==================== 导出 ====================
module.exports = { speechToText, textToSpeech };
