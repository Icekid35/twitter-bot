import test from 'node:test';
import assert from 'node:assert/strict';
import { validatedReply } from '../server/ai/reply.js';
const response = (text: string, finishReason = 'STOP') => ({ candidates: [{finishReason, content: {parts: [{text}]}}] });
test('rejects the reported checklist and truncated responses', () => {
  assert.throws(() => validatedReply(response(JSON.stringify({reply:'Constraint Checklist:\n * Plain text only? Yes.\n * No'})), 180));
  assert.throws(() => validatedReply(response(JSON.stringify({reply:'Finally, an honest job posting.'}), 'MAX_TOKENS'),180));
  assert.throws(() => validatedReply(response(JSON.stringify({reply:'This is basically the unedited mission statement of every'})),180));
});
test('only accepts a complete structured reply, excluding thought parts', () => {
  const r=response(JSON.stringify({reply:'That job interview is definitely being recorded.'}));
  r.candidates[0].content.parts.unshift({text:'Constraint Checklist:',thought:true} as any);
  assert.equal(validatedReply(r,180),'That job interview is definitely being recorded.');
  assert.throws(()=>validatedReply(response('Here is your reply: hello.'),180));
  assert.throws(()=>validatedReply(response(JSON.stringify({reply:'Final answer: hello.'})),180));
  assert.throws(()=>validatedReply(response(JSON.stringify({reply:'x'.repeat(180)+'.'})),180));
});

import { mock } from 'node:test';
import { GoogleGenAI, GenerateContentResponse } from '@google/genai';
import { Gemini } from '../server/ai/gemini.js';
import type { Store } from '../server/database/store.js';
const fixtureStore = {settings:()=>({model:'gemini-3.5-flash',timeout:1000,replyLength:'short',prompt:'Write a reply.'}),secret:()=> 'fixture-key',state:{actions:[]}} as unknown as Store;
const fixturePost = {id:'1',author:'alice',url:'https://x.com/alice/status/1',text:'Testing an idea.',media:[],type:'original' as const,publishedAt:new Date().toISOString()};
test('generation retries truncated output once and returns only validated final reply', async () => {
  const api = new GoogleGenAI({apiKey:'fixture-key'});
  let calls=0;
  const stub=mock.method(api.models,'generateContent',async (request:any)=> {
    calls++;
    assert.equal(request.config.responseMimeType,'application/json');
    assert.ok(request.config.maxOutputTokens>=4096);
    return Object.assign(new GenerateContentResponse(),response(JSON.stringify({reply:calls===1?'Constraint Checklist:':'That interview is definitely being recorded.'}),calls===1?'MAX_TOKENS':'STOP'));
  });
  try {
    const generated=await new Gemini(fixtureStore, () => api).generate(fixturePost);
    assert.equal(calls,2);
    assert.equal(generated.text,'That interview is definitely being recorded.');
  } finally {stub.mock.restore();}
});
test('two invalid outputs fail generation without returning publishable text', async () => {
  const api = new GoogleGenAI({apiKey:'fixture-key'});
  let calls=0;
  const stub=mock.method(api.models,'generateContent',async ()=> {
    calls++;
    return Object.assign(new GenerateContentResponse(),response(JSON.stringify({reply:'Constraint Checklist: Plain text only? Yes.'})));
  });
  try {
    await assert.rejects(new Gemini(fixtureStore, () => api).generate(fixturePost),/drafting notes/);
    assert.equal(calls,2);
  } finally {stub.mock.restore();}
});
