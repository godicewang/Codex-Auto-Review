import fs from 'node:fs';
import path from 'node:path';
import { ROOT, safeRelative } from './util.mjs';
import { requirementDiff } from './snapshot.mjs';
export const reviewerInstructions = fs.readFileSync(path.join(ROOT,'prompts/reviewer.md'),'utf8');
export const languageOf = prompt => /\p{Script=Han}/u.test(prompt) ? 'zh' : 'en';
export function buildAuditInput(run, store) {
  const recent = run.requirements.slice(-12);
  let remaining=48000, truncated=run.historyTruncated || run.requirements.length>12;
  const requirements=[];
  for (const prompt of [...recent].reverse()) {
    if (!remaining) {truncated=true;break;}
    const text=prompt.slice(0,remaining); if(text.length<prompt.length)truncated=true;
    requirements.unshift(text); remaining-=text.length;
  }
  return JSON.stringify({
    outputLanguage:run.language,scope:run.sessionId==='manual'?'当前快照':'本轮变更及直接受影响行为',
    changeAttribution:run.attribution||'manual_snapshot',attributionBoundary:'自动审计范围仅限已记录的 Codex 写入工具变更。其他文件仅供调用关系核对，不得将人工修改或无来源证据的变化作为本轮 Bug。工具执行期间同一文件的外部并发写入无法完全归因。',
    latestRequirement:run.prompt,requirements,historyTruncated:truncated,
    changedFiles:run.changedPaths,snapshotOmissions:run.snapshot.omitted,evidenceExclusions:run.config?.ignore||[],
    beforeAfterEvidence:requirementDiff(run.before,run.snapshot,store,70000),
    sourceLocation:'当前工作目录；回合结束时冻结的只读隔离副本。主项目后续变化与本次审计无关。',
    finalOutput:'仅输出高置信度问题及修改建议；完整 JSON 不超过 6000 字符。标题≤80、证据≤260、影响≤160、建议≤260 字符；中文自然语言力争≤1600字。无需过程说明，不要改文件。'
  });
}
export function validateReport(report, run, store) {
  if (!report || typeof report.summary!=='string' || !Array.isArray(report.findings) || report.findings.length>10 || !Array.isArray(report.limitations) || report.limitations.length>5) throw new Error('审计报告格式不完整。');
  const fields=['title','evidence','impact','suggestion'];
  for (const f of report.findings) {
    if (!f || f.confidence!=='high' || !['P0','P1','P2'].includes(f.severity) || !safeRelative(f.file) || !run.snapshot.files[f.file] || fields.some(k=>typeof f[k]!=='string'||!f[k].trim()||f[k].length>({title:80,evidence:260,impact:160,suggestion:260}[k]))) throw new Error('审计问题缺少可信定位、证据或建议。');
    const lines=store.bytes(run.snapshot.files[f.file].hash).toString('utf8').split('\n').length;
    if (!Number.isInteger(f.line)||!Number.isInteger(f.endLine)||f.line<1||f.endLine<f.line||f.endLine>lines||f.endLine-f.line>20) throw new Error('审计问题行号无效或范围过大。');
    if (run.language==='zh' && fields.some(k=>!/[\p{Script=Han}]/u.test(f[k]))) throw new Error('审计者未按要求用中文回复。');
  }
  if (report.limitations.some(x=>typeof x!=='string'||x.length>240||(run.language==='zh'&&!/\p{Script=Han}/u.test(x)))) throw new Error('审计局限的格式或语言不符合要求。');
  return {...report,summary:report.findings.length?(run.language==='zh'?`发现 ${report.findings.length} 个有充分证据的问题。`:`Found ${report.findings.length} substantiated issue(s).`):(run.language==='zh'?'未发现有充分证据的 Bug。':'No bugs with sufficient evidence found.')};
}
