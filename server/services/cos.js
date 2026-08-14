/**
 * 腾讯云 COS 对象存储服务
 * 用于上传风采投稿的图片/视频文件
 */
const COS = require('cos-nodejs-sdk-v5');
const path = require('path');

const SECRET_ID = process.env.COS_SECRET_ID || process.env.TENCENT_SECRET_ID || '';
const SECRET_KEY = process.env.COS_SECRET_KEY || process.env.TENCENT_SECRET_KEY || '';
const BUCKET = process.env.COS_BUCKET || 'dsr-1307167583';
const REGION = process.env.COS_REGION || 'ap-shanghai';
const BASE_FOLDER = '风采投稿';

const cos = new COS({
  SecretId: SECRET_ID,
  SecretKey: SECRET_KEY,
});

const CATEGORY_NAMES = {
  sales_negotiation: '进货谈单实战',
  store_sales: '门店动销实操',
  store_issues: '门店难点处理',
  customer_acquisition: '终端拓客秘籍',
  ai_tools: '数智工具赋能',
  other: '其他经验分享',
};

/**
 * 上传文件到 COS
 * @param {Buffer} buffer - 文件内容
 * @param {string} originalName - 原始文件名
 * @param {string} mimeType - 文件 MIME 类型
 * @param {string} category - 投稿分类
 * @param {string} userName - 投稿人姓名
 * @param {object} [options] - 可选参数
 * @param {string} [options.baseFolder] - 自定义基础文件夹，默认 '风采投稿'
 * @param {number} [options.index] - 多文件序号，用于防止同名冲突
 * @returns {Promise<{url: string, key: string}>}
 */
function uploadToCOS(buffer, originalName, mimeType, category, userName, options = {}) {
  return new Promise((resolve, reject) => {
    if (!SECRET_ID || !SECRET_KEY) {
      return reject(new Error('COS 密钥未配置'));
    }

    const baseFolder = options.baseFolder || BASE_FOLDER;
    const ext = path.extname(originalName) || '.jpg';
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const catName = CATEGORY_NAMES[category] || category || '其他';
    const safeUserName = (userName || 'anonymous').replace(/[\/\\:*?"<>|]/g, '_');
    const ts = Date.now();
    const suffix = options.index !== undefined ? `_${options.index}` : '';
    const filename = `${safeUserName}_${ts}${suffix}${ext}`;
    const key = category
      ? `${baseFolder}/${catName}/${year}/${month}/${filename}`
      : `${baseFolder}/${year}/${month}/${filename}`;

    cos.putObject(
      {
        Bucket: BUCKET,
        Region: REGION,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      },
      (err, data) => {
        if (err) {
          console.error('[COS] 上传失败:', err);
          return reject(err);
        }
        const url = `https://${BUCKET}.cos.${REGION}.myqcloud.com/${key}`;
        console.log('[COS] 上传成功:', url);
        resolve({ url, key });
      }
    );
  });
}

/**
 * 从 COS 删除文件
 * @param {string} key - COS 对象键
 * @returns {Promise<void>}
 */
function deleteFromCOS(key) {
  return new Promise((resolve, reject) => {
    if (!key) return resolve();
    if (!SECRET_ID || !SECRET_KEY) {
      console.warn('[COS] 密钥未配置，跳过删除');
      return resolve();
    }

    cos.deleteObject(
      {
        Bucket: BUCKET,
        Region: REGION,
        Key: key,
      },
      (err, data) => {
        if (err) {
          // 404 表示文件已不存在，不算错误
          if (err.statusCode === 404 || err.code === 'NoSuchKey') {
            console.log('[COS] 文件已不存在，跳过删除:', key);
            return resolve();
          }
          console.error('[COS] 删除失败:', err);
          return reject(err);
        }
        console.log('[COS] 删除成功:', key);
        resolve();
      }
    );
  });
}

module.exports = { uploadToCOS, deleteFromCOS };
