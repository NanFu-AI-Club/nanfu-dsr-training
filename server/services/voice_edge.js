/**
 * 微软 Edge TTS — 通过 Python edge-tts 调用
 * 免费、无需 API Key、音质好
 */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const EDGE_TTS = '/home/ubuntu/.local/bin/edge-tts';
const VOICE = 'zh-CN-XiaoxiaoNeural'; // 晓晓 — 温柔女声

/**
 * 合成语音，返回 mp3 Buffer
 */
function textToSpeech(text) {
  const trimmed = text.trim().substring(0, 300);
  if (!trimmed) throw new Error('文本为空');

  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `tts_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`);

    const child = execFile(EDGE_TTS, [
      '--voice', VOICE,
      '--text', trimmed,
      '--write-media', tmpFile,
    ], { timeout: 15000 }, (err) => {
      if (err) {
        try { fs.unlinkSync(tmpFile); } catch (_) {}
        return reject(new Error(`TTS 合成失败: ${err.message}`));
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

module.exports = { textToSpeech };
