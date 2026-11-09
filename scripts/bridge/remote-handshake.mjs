#!/usr/bin/env node
/**
 * Opt-in read-only public metadata parity check. No private profile, health,
 * identity, geolocation or content data may be sent by Replit's response.
 * Only reports contract version parity; it does NOT prove UX/functional parity.
 */
import { fingerprint, loadProject } from './check-contract.mjs';

export function verifyPayload(remote, contract) {
  if (!remote || typeof remote !== 'object' || Array.isArray(remote)) throw new Error('Invalid bridge status object');
  if (remote.contractId!==contract.contractId) throw new Error('Mismatched bridge contract identity');
  if (remote.schemaVersion!==contract.schemaVersion) throw new Error('Mismatched bridge contract schema');
  const expected=fingerprint(contract);
  if(remote.contractSha256!==expected) throw new Error('Contract version drift: local and Replit fingerprints differ');
  return {result:'contract-metadata-parity-only',fingerprint:expected,sourceRevision:typeof remote.sourceRevision==='string'?remote.sourceRevision:'unverified',accessibility:'not verified',dataSync:'not performed'};
}
export async function checkRemote(urlText, contract, fetchImpl=fetch) {
  const url=new URL(urlText);
  const hostname=url.hostname.toLowerCase();
  if(url.protocol!=='https:' || (hostname!=='replit.dev' && !hostname.endsWith('.replit.dev') && hostname!=='replit.app' && !hostname.endsWith('.replit.app'))) throw new Error('Only HTTPS URLs on replit.dev or replit.app are permitted');
  if(url.username||url.password||url.hash) throw new Error('Credentials/fragments prohibited in bridge URLs');
  const response=await fetchImpl(url.toString(),{redirect:'error',signal:AbortSignal.timeout(8000),headers:{accept:'application/json'}});
  if(!response.ok) throw new Error(`Remote returned HTTP ${response.status}`);
  if(!String(response.headers.get('content-type')||'').toLowerCase().includes('application/json')) throw new Error('Remote status is not JSON');
  const bytes=Number(response.headers.get('content-length')||0);
  if(bytes>4096) throw new Error('Remote metadata response too large');
  const raw=await response.text();
  if(raw.length>4096) throw new Error('Remote metadata response too large');
  return verifyPayload(JSON.parse(raw),contract);
}
if (process.argv[1] && process.argv[1].endsWith('/remote-handshake.mjs')) {
  const url=process.env.CRIPSQUARE_REPLIT_UX_STATUS_URL;
  if(!url){console.log('SKIPPED: no Replit bridge status URL configured. Remote parity remains UNVERIFIED.');process.exit(0);}
  const {contract}=loadProject();
  checkRemote(url,contract).then(report=>console.log(JSON.stringify(report,null,2))).catch(e=>{console.error('Remote bridge handshake failed:',e.message);process.exitCode=1;});
}
