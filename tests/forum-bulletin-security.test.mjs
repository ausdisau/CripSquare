import assert from 'node:assert/strict';
import test from 'node:test';
import {isAllowedForumWrite, safeForumAuthor} from '../shared/forum-bulletin-security-policy.ts';

const expected='https://cripsquare.au';
const accepted={method:'POST',origin:expected,configuredOrigin:expected,fetchSite:'same-origin',production:true};

test('same-origin browser mutations pass the origin gate',()=>{
  assert.equal(isAllowedForumWrite(accepted),true);
  assert.equal(isAllowedForumWrite({...accepted,method:'PATCH'}),true);
  assert.equal(isAllowedForumWrite({...accepted,method:'DELETE'}),true);
});
test('read-only methods are not rejected by the origin gate',()=>{
  for(const method of ['GET','HEAD','OPTIONS']) assert.equal(isAllowedForumWrite({method}),true);
});
test('missing or malicious origins fail closed',()=>{
  for(const origin of [undefined,null,'null','https://evil.example','https://cripsquare.au.attacker.test',
    'https://cripsquare.au/path','https://cripsquare.au?bad=true','https://user@cripsquare.au',
    'http://cripsquare.au','HTTPS://cripsquare.au']) {
      assert.equal(isAllowedForumWrite({...accepted,origin}),false,String(origin));
  }
});
test('missing or invalid configured origin fails closed',()=>{
  for(const configuredOrigin of [undefined,'','https://cripsquare.au/path','http://cripsquare.au']) {
    assert.equal(isAllowedForumWrite({...accepted,configuredOrigin}),false,String(configuredOrigin));
  }
});
test('cross-site and same-site browser mutations are refused',()=>{
  for(const fetchSite of ['same-site','cross-site','none'])
    assert.equal(isAllowedForumWrite({...accepted,fetchSite}),false,fetchSite);
});
test('older same-origin browsers without Fetch Metadata can submit',()=>{
  assert.equal(isAllowedForumWrite({...accepted,fetchSite:undefined}),true);
});
test('localhost HTTP is development only',()=>{
  const local={method:'POST',origin:'http://localhost:5000',configuredOrigin:'http://localhost:5000'};
  assert.equal(isAllowedForumWrite({...local,production:false}),true);
  assert.equal(isAllowedForumWrite({...local,production:true}),false);
});
test('author projection does not disclose account, email or health fields',()=>{
  const author={id:'auth0|123',firstName:'Ada',lastName:'M',profileImageUrl:null,
    email:'private@example.com',isAdmin:true,isActive:false,diagnosis:'do not share',
    deactivationNotice:'private note',createdAt:new Date()};
  const safe=safeForumAuthor(author);
  assert.deepEqual(safe,{id:'auth0|123',firstName:'Ada',lastName:'M',profileImageUrl:null});
  assert.equal(JSON.stringify(safe).includes('private@example.com'),false);
  assert.equal(JSON.stringify(safe).includes('diagnosis'),false);
});
test('invalid author objects produce no identity',()=>{
  assert.equal(safeForumAuthor(null),null);
  assert.equal(safeForumAuthor({email:'private@example.com'}),null);
  assert.equal(safeForumAuthor(['private']),null);
});
