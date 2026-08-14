/**
 * 腾讯云 ASR（一句话识别）服务
 * API: https://cloud.tencent.com/document/product/1093/35646
 * 签名方法: TC3-HMAC-SHA256
 */
const crypto = require('crypto');
const https = require('https');

const SECRET_ID = process.env.TENCENT_SECRET_ID || '';
const SECRET_KEY = process.env.TENCENT_SECRET_KEY || '';

function sha256(data, encoding = 'hex') {
  return crypto.createHash('sha256').update(data).digest(encoding);
}

function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function iso8601(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}:${s}Z`;
}

/**
 * 腾讯云一句话识别
 * @param {Buffer} audioData - 音频数据 (16kHz/16bit/mono WAV 或 PCM)
 * @param {string} [voiceFormat='wav'] - 音频格式 wav / pcm
 * @param {string} [engSerViceType='16k_zh'] - 引擎模型
 * @returns {{ text: string, requestId?: string }}
 */
async function sentenceRecognition(audioData, voiceFormat, engSerViceType) {
  if (!SECRET_ID || !SECRET_KEY) {
    throw new Error('请配置 TENCENT_SECRET_ID 和 TENCENT_SECRET_KEY 环境变量');
  }

  const service = 'asr';
  const host = 'asr.tencentcloudapi.com';
  const region = 'ap-guangzhou';
  const action = 'SentenceRecognition';
  const version = '2019-06-14';
  const fmt = voiceFormat || 'wav';
  const engineType = engSerViceType || '16k_zh';
  const timestamp = Math.floor(Date.now() / 1000);
  const date = iso8601(new Date());

  // 请求体
  const payload = JSON.stringify({
    EngSerViceType: engineType,
    SourceType: 1,          // 1 = 语音数据(body), 0 = URL
    VoiceFormat: fmt,
    Data: audioData.toString('base64'),
    DataLen: audioData.length,
  });

  // ======== 签名 v3 ========
  const hashedRequestPayload = sha256(payload);
  const httpRequestMethod = 'POST';
  const canonicalUri = '/';
  const canonicalQueryString = '';
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';
  const canonicalRequest =
    httpRequestMethod + '\n' +
    canonicalUri + '\n' +
    canonicalQueryString + '\n' +
    canonicalHeaders + '\n' +
    signedHeaders + '\n' +
    hashedRequestPayload;

  const algorithm = 'TC3-HMAC-SHA256';
  const credentialScope = `${date.split('T')[0]}/${service}/tc3_request`;
  const hashedCanonicalRequest = sha256(canonicalRequest);
  const stringToSign =
    algorithm + '\n' +
    String(timestamp) + '\n' +
    credentialScope + '\n' +
    hashedCanonicalRequest;

  const secretDate = hmacSha256(Buffer.from('TC3' + SECRET_KEY), date.split('T')[0]);
  const secretService = hmacSha256(secretDate, service);
  const secretSigning = hmacSha256(secretService, 'tc3_request');
  const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign).digest('hex');

  const authorization =
    `${algorithm} Credential=${SECRET_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  // 发送请求
  const options = {
    hostname: host,
    port: 443,
    path: '/',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Host': host,
      'X-TC-Action': action,
      'X-TC-Version': version,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': region,
      'Authorization': authorization,
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.Response.Error) {
            reject(new Error(`腾讯云ASR错误: ${json.Response.Error.Code} - ${json.Response.Error.Message}`));
          } else {
            resolve({
              text: json.Response.Result || '',
              requestId: json.Response.RequestId,
            });
          }
        } catch (e) {
          reject(new Error(`腾讯云ASR响应解析失败: ${body.substring(0, 200)}`));
        }
      });
    });
    req.on('error', (err) => reject(new Error(`腾讯云ASR请求失败: ${err.message}`)));
    req.write(payload);
    req.end();
  });
}

module.exports = { sentenceRecognition };
