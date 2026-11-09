#!/usr/bin/env node
/**
 * CripSquare UX bridge: offline, dependency-free contract and route regression gate.
 * Never accesses participant data, databases, networks, keys or deployment state.
 * A passing result means only that inspected/committed snapshots match the draft
 * UX contract. It never certifies WCAG compliance or live Replit parity.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const validStatus = new Set(['present','absent']);
const validParity = new Set(['aligned','accepted-difference','known-gap','planned-both']);
const platforms = ['github','replit'];

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function fingerprint(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}
export function parseReactRoutes(source) {
  // Deliberately bounded to literal Wouter <Route path="..."> definitions.
  // Dynamic/generated routes require manual review and must not pass as verified.
  return new Set([...source.matchAll(/<Route\s+path\s*=\s*["']([^"']+)["']/g)].map(m => m[1]));
}
export function validateContract(contract) {
  const problems = [];
  if (contract.schemaVersion !== '1.0.0') problems.push('Unsupported schemaVersion.');
  if (!contract.contractId || typeof contract.contractId !== 'string') problems.push('Missing contractId.');
  if (!Array.isArray(contract.journeys) || contract.journeys.length < 2) problems.push('Missing journey catalogue.');
  const seen = new Set();
  for (const j of contract.journeys || []) {
    if (!j.id || seen.has(j.id)) problems.push(`Missing or duplicate journey ID: ${j.id}`);
    seen.add(j.id);
    if (!validParity.has(j.parity)) problems.push(`Invalid parity for ${j.id}.`);
    if (!Array.isArray(j.acceptance) || !j.acceptance.length) problems.push(`Missing accessibility acceptance: ${j.id}.`);
    for (const platform of platforms) {
      const ref=j.expected?.[platform];
      if (!ref || !validStatus.has(ref.status)) problems.push(`Missing or invalid ${platform} status: ${j.id}.`);
      if (ref?.status==='present' && typeof ref.route !== 'string' && ref.interaction !== 'accessible-overlay') problems.push(`Present ${platform} route unspecified: ${j.id}.`);
    }
  }
  return problems;
}
export function checkSnapshots(contract, snapshots, githubRouteText) {
  const errors=validateContract(contract);
  const issues=[];
  const routes=githubRouteText === null ? null : parseReactRoutes(githubRouteText);
  for(const platform of platforms){
    const snap=snapshots[platform];
    if(snap?.platform!==platform) errors.push(`Missing or wrong ${platform} snapshot.`);
    if(!snap?.sourceCommit) errors.push(`Missing provenance revision in ${platform} snapshot.`);
    if(!snap?.capturedAt) errors.push(`Missing observation date in ${platform} snapshot.`);
  }
  for(const j of contract.journeys||[]) {
    for(const platform of platforms) {
      const expected=j.expected?.[platform];
      const actual=snapshots[platform]?.journeys?.[j.id];
      if(!validStatus.has(actual)) {
        errors.push(`Snapshot missing ${platform} / ${j.id}.`);
        continue;
      }
      if(expected?.status!==actual) errors.push(`Drift: ${platform} / ${j.id} expected ${expected?.status} but snapshot says ${actual}.`);
      if(platform==='github' && routes && expected?.route){
        const present=routes.has(expected.route);
        if(expected.status==='present' && !present) errors.push(`Route regression: ${j.id} is missing GitHub client route ${expected.route}.`);
        if(expected.status==='absent' && present) errors.push(`Route changed: ${j.id} is now present in GitHub; refresh contract and snapshot with review.`);
      }
    }
    if(j.parity==='known-gap') issues.push({id:j.id,severity:'gap',message:`Known gap: ${j.title}`});
    if(j.parity==='planned-both') issues.push({id:j.id,severity:'planned',message:`Not delivered: ${j.title}`});
    if(j.parity==='accepted-difference') issues.push({id:j.id,severity:'difference',message:`Review implementation differences: ${j.title}`});
  }
  return {contractId:contract.contractId,version:contract.schemaVersion,contractSha256:fingerprint(contract),errors,issues,verifiedRouteInventory:routes!==null,sourceRevisions:Object.fromEntries(platforms.map(p=>[p,snapshots[p]?.sourceCommit||null])),assurance:'snapshot and optional local route check only; live Replit and assistive-technology parity unverified'};
}
export function toMarkdown(report) {
  const verdict=report.errors.length?'FAIL: material drift':'PASS: captured baseline consistent';
  return [
    '# CripSquare UX development bridge report','',`**Result:** ${verdict}`,'',
    `**Contract:** ${report.contractId} (v${report.version})`,
    `**Fingerprint:** \`${report.contractSha256}\``,'',
    '**Evidence boundary:** '+report.assurance,'',
    '## Revisions inspected','',
    `- GitHub reference: \`${report.sourceRevisions.github}\``,
    `- Replit reference: \`${report.sourceRevisions.replit}\``,'',
    '## Errors','',...(report.errors.length?report.errors.map(x=>`- ${x}`):['- None in committed snapshots.']),
    '', '## Open UX gaps and accepted differences','',
    ...(report.issues.length?report.issues.map(x=>`- **${x.severity}:** ${x.message}`):['- None.']),
    '', '## Human release gates','',
    '- Do not infer Git parity, published build parity or WCAG conformance from this report.',
    '- Verify keyboard, screen reader, AAC, 200-400% zoom and reduced motion on real devices.',
    '- Verify participant consent, evidence retention, server-side moderation and accessible complaints.',
    '- Treat unknown, disputed, stale and unreviewed accessibility evidence as Unknown.',
    '- Keep production/authentication/identity migrations unapproved until separate review.',''
  ].join('\n');
}
export function loadProject(checkout=root) {
  const docs=path.join(checkout,'docs','bridge');
  const read=name=>JSON.parse(fs.readFileSync(path.join(docs,name),'utf8'));
  return {contract:read('ux-contract.v1.json'),snapshots:{github:read('snapshots/github-baseline.json'),replit:read('snapshots/replit-baseline.json')}};
}
function parseArgs(args) {
  const options={repo:root,strict:false,out:null,json:null,fingerprint:false};
  for(let i=0;i<args.length;i++){
    const a=args[i];
    if(a==='--repo') options.repo=path.resolve(args[++i]);
    else if(a==='--out') options.out=path.resolve(args[++i]);
    else if(a==='--json') options.json=path.resolve(args[++i]);
    else if(a==='--strict') options.strict=true;
    else if(a==='--fingerprint') options.fingerprint=true;
    else throw new Error(`Unknown argument ${a}`);
  }
  return options;
}
export function main(args=process.argv.slice(2)) {
  const options=parseArgs(args);
  const {contract,snapshots}=loadProject(options.repo);
  if(options.fingerprint){console.log(fingerprint(contract));return 0;}
  const client=path.join(options.repo,'client','src','App.tsx');
  const app=fs.existsSync(client)?fs.readFileSync(client,'utf8'):null;
  const report=checkSnapshots(contract,snapshots,app);
  const markdown=toMarkdown(report);
  if(options.out){fs.mkdirSync(path.dirname(options.out),{recursive:true});fs.writeFileSync(options.out,markdown);}
  if(options.json){fs.mkdirSync(path.dirname(options.json),{recursive:true});fs.writeFileSync(options.json,JSON.stringify(report,null,2)+'\n');}
  console.log(markdown);
  return report.errors.length&&options.strict ? 1:0;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {process.exitCode=main();} catch(e){console.error('Bridge check failed:',e.message);process.exitCode=1;}
}
