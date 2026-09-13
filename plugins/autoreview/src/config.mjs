import path from 'node:path';
import { sha, now } from './util.mjs';
export function projectConfig(root, options = {}) {
  return updateConfig({id:sha(root).slice(0,20),root,name:path.basename(root),enabled:false,model:'',timeoutSeconds:300,ignore:[],createdAt:now()},options);
}
export function validateConfig(value) {
  if (typeof value.enabled !== 'boolean') throw new Error('enabled 必须为布尔值。');
  if (typeof value.model !== 'string' || value.model.length > 150) throw new Error('无效的模型设置。');
  if (!Number.isInteger(value.timeoutSeconds) || value.timeoutSeconds < 5 || value.timeoutSeconds > 3600) throw new Error('审计超时必须为 5–3600 秒。');
  if (!Array.isArray(value.ignore) || value.ignore.some(s=>typeof s!=='string'||s.includes('..')||path.isAbsolute(s))) throw new Error('ignore 必须为项目相对路径前缀。');
  return value;
}
export function updateConfig(project, options) {
  if (Object.keys(options).some(key=>!['enabled','model','timeoutSeconds','ignore'].includes(key))) throw new Error('不支持的设置。AutoReview 现在仅提供只读审计。');
  return validateConfig({...project,...options});
}
