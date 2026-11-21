'use strict';
// Isolated SQLite and mocked AI/WhatsApp. No credentials, external provider or real account.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'raq-editor-test-'));
const cfg=require('../src/config');cfg.config.paths.database=path.join(root,'db.sqlite');cfg.config.paths.sessions=path.join(root,'sessions');cfg.config.paths.media=path.join(root,'media');
const db=require('../src/db'), d=db.open(), {S,CH,P}=db, ai=require('../src/ai'), editor=require('../src/ai-editor'), wa=require('../src/wa'),pipeline=require('../src/pipeline'),pace=require('../src/pace');
let n=0;const ok=(v,m)=>{assert.ok(v,m);n++;console.log('✓ '+m)};
const rawCallFor=ai.callFor;
(async()=>{
 ok(!editor.settings().enabled && !editor.settings().semantic && !editor.settings().skipAds && !editor.settings().cleanContacts,'AI editor and example shortcuts are off by default');
 await assert.rejects(()=>rawCallFor('match','secret test'),/sharing is off/i);ok(true,'external AI content sharing requires opt-in');
 assert.throws(()=>editor.save({timezone:'Not/AZone',enabled:true}),/time zone/);ok(!editor.settings().enabled,'invalid settings do not change enabled state');
 editor.save({enabled:true,semantic:true,skipAds:true,cleanContacts:true,instruction:'Keep facts',footer:'Call +923001234567\nhttps://example.org/channel',domains:'official.edu.pk',timezone:'Asia/Karachi'});
 ok(editor.settings().instruction==='Keep facts','custom instruction persists');
 // At 2026-09-16 00:30 Pakistan time, 18:59 UTC is still the previous day.
 for(const [id,at,body] of [['old','2026-09-15 18:59:00','Previous day only'],['today','2026-09-15 19:05:00','Today story'],['delayed','2026-09-14 09:00:00','Published today after queue']]) {
  P.mark('test@newsletter',id,'published','',body);let pid=P.postId('test@newsletter',id);
  d.prepare('UPDATE posts SET created_at=? WHERE id=?').run(at,pid);
  if(id==='delayed')d.prepare('INSERT INTO post_keys(post_id,target_jid,msg_id,at) VALUES(?,?,?,?)').run(pid,'target@newsletter','abc','2026-09-15 19:15:00');
 }
 let rows=editor.todaysPublished('Asia/Karachi',new Date('2026-09-15T19:30:00Z'));
 ok(rows.length===2 && rows.some(r=>r.body==='Published today after queue') && !rows.some(r=>r.body==='Previous day only'),'same-day comparison uses local midnight and actual accepted time');
 const todayId=rows.find(r=>r.body==='Today story').id;
 let seen='';ai.callFor=async(feature,prompt)=>{seen+=prompt;if(feature==='match')return JSON.stringify({duplicate_id:todayId,confidence:.97});throw Error('unexpected');};
 let r=await editor.analyze('Same story in different words',{now:new Date('2026-09-15T19:30:00Z')});
 ok(r.decision==='skip'&&r.duplicateId===todayId,'AI semantic duplicate skips only a matched same-day post');
 ok(!seen.includes('Previous day only'),'yesterday is not sent as same-day history');
 editor.save({semantic:false,instruction:'Skip same-day duplicate stories regardless of wording.'}); seen='';
 r=await editor.analyze('Paraphrase of today',{now:new Date('2026-09-15T19:30:00Z')});
 ok(r.decision==='skip' && seen.includes('Skip same-day duplicate stories') && seen.includes('semanticDuplicateShortcut'), 'natural-language instruction gets same-day history with shortcut off');
 editor.save({semantic:true,instruction:'Keep facts'});
 ai.callFor=async()=>JSON.stringify({duplicate_id:todayId,confidence:.5});r=await editor.analyze('Possibly same story',{now:new Date('2026-09-15T19:30:00Z')});ok(r.decision==='review','uncertain duplicate requires review');
 // Real-world migration cases: empty bodies, very long bodies, and >200 posts
 // must not force every new post into review. Available history is still checked.
 d.prepare('DELETE FROM post_keys').run();d.prepare('DELETE FROM posts').run();
 for (let i=0;i<225;i++) {
   P.mark('legacy@newsletter','legacy-'+i,'published','',i===224 ? 'Long announcement '+ 'x'.repeat(7000) : i%12===0 ? '' : 'Past announcement '+i);
   const pid=P.postId('legacy@newsletter','legacy-'+i);d.prepare('UPDATE posts SET created_at=? WHERE id=?').run('2026-09-15 19:10:00',pid);
 }
 let compared=0, largest=0, matchCalls=0;
 ai.callFor=async(feature,prompt)=>{
   if(feature==='match'){const data=JSON.parse(prompt.split('DATA: ').pop());compared+=data.published.length;matchCalls++;largest=Math.max(largest,...data.published.map(x=>x.text.length));return JSON.stringify({duplicate_id:null,confidence:1});}
   return JSON.stringify({decision:'publish',reason:'new story',text:'New legitimate post',promotion:''});
 };
 r=await editor.analyze('Fresh original content',{now:new Date('2026-09-15T19:30:00Z')});
 ok(r.decision==='publish' && compared===100 && matchCalls===10 && largest<=2000,'missing, long and over-200 history does not block publishing; comparison is bounded');
 ok(/no saved text/.test(r.historyWarning) && /comparison limit/.test(r.historyWarning) && /excerpts/.test(r.historyWarning),'incomplete duplicate history is explicitly reported');
 d.prepare('DELETE FROM post_keys').run();d.prepare('DELETE FROM posts').run();

 ai.callFor=async()=>JSON.stringify({decision:'publish',reason:'legitimate',text:'Apply at https://official.edu.pk/apply',promotion:'Follow for more updates'});
 r=await editor.analyze('Admissions https://official.edu.pk/apply');ok(r.decision==='publish'&&r.footer.includes('+923001234567')&&r.text.includes('official.edu.pk'),'official link survives and exact owner footer is included');
 ai.callFor=async()=>JSON.stringify({decision:'publish',reason:'ok',text:'Apply now',promotion:''});r=await editor.analyze('Apply https://official.edu.pk/apply');ok(r.decision==='review','removing configured official link requires review');
 ai.callFor=async()=>JSON.stringify({decision:'publish',reason:'ok',text:'See https://invented.example/a',promotion:''});r=await editor.analyze('Apply here');ok(r.decision==='review','invented URL cannot auto-publish');
 ai.callFor=async()=>JSON.stringify({decision:'skip',reason:'Private academy class advertisement',text:'',promotion:''});r=await editor.analyze('PPSC academy classes: pay to enroll');ok(r.decision==='skip' && /advertisement/.test(r.reason),'AI-classified commercial advertisement is skipped');
 ai.callFor=async()=>JSON.stringify({decision:'publish',reason:'jobs announcement',text:'Apply at https://official.edu.pk/apply',promotion:''});r=await editor.analyze('Jobs apply https://official.edu.pk/apply. Call 03001234567 or visit https://ad.example');ok(r.decision==='publish'&&!r.text.includes('03001234567')&&!r.text.includes('ad.example'),'AI can remove third-party promotions while retaining official links');
 ok(editor.lostOfficialLink('Apply https://official.edu.pk/a','No link','official.edu.pk'),'later formatting removing official link is detectable');
 editor.save({footerMode:'adaptive',instruction:'Make it friendly, add my channel details with a relevant invitation.'});
 let editorialPrompt='';ai.callFor=async(_feature,prompt)=>{editorialPrompt=prompt;return JSON.stringify({decision:'publish',reason:'owner style',text:'Admission update. Join us: https://example.org/channel',promotion:''})};
 r=await editor.analyze('Admissions information');
 ok(r.decision==='publish' && r.text.endsWith('https://example.org/channel') && !r.footer && editorialPrompt.includes('Make it friendly'),'adaptive footer is composed by AI from owner instructions and authorized details');
 ok(!editorialPrompt.includes('PPSC') && editorialPrompt.includes('skipPrivateAdvertisingShortcut'),'user examples are not hardcoded editorial rules');
 editor.save({footerMode:'fixed',instruction:'Keep facts'});
 ai.callFor=async()=>'{broken';r=await editor.analyze('A sample post');ok(r.decision==='review','invalid provider output requires review');
 // The real pipeline serializes two incoming source posts; second sees first acceptance.
 CH.addSource('feed@rss','Feed');CH.addTarget('target@newsletter','Target');wa.getSocket=()=>({});wa.getStatus=()=>({status:'open'});pace.gapMin=()=>0;
 let sent=[];wa.sendToChannel=async(_sock,jid,content)=>{sent.push({jid,content});return 'provider-'+sent.length};
 ai.callFor=async(feature,prompt)=>{
  if(feature==='match'){const payload=JSON.parse(prompt.split('DATA: ').pop());return JSON.stringify({duplicate_id:payload.published[0]?.id ?? null,confidence:.99});}
  return JSON.stringify({decision:'publish',reason:'keep',text:'Real announcement',promotion:'Follow for more updates'});
 };
 await Promise.all(['first','second'].map(id=>pipeline.intakeRss({jid:'feed@rss',id,text:'A real announcement for applicants',ts:Date.now()})));
 ok(sent.length===1,'parallel paraphrases do not both send in a single process');
 ok(d.prepare("SELECT COUNT(*) n FROM posts WHERE status='skipped' AND reason LIKE '%same-day%'").get().n===1,'duplicate skip recorded');
 ok(sent[0].content.text.includes('Call +923001234567') && sent[0].content.text.endsWith('https://example.org/channel'),'owner footer is at the end of published text');
 // User instructions control final format, even with legacy formatting enabled.
 editor.save({semantic:false,instruction:'Use a concise custom heading',footerMode:'adaptive'});S.set('power.signature.on','1');S.set('power.signature.text','LEGACY SIGNATURE');
 ai.callFor=async(feature)=>feature==='match'? JSON.stringify({duplicate_id:null,confidence:1}) : JSON.stringify({decision:'publish',reason:'owner style',text:'*Custom heading*\nThe facts\nJoin: https://example.org/channel'});
 await pipeline.intakeRss({jid:'feed@rss',id:'custom-style',text:'A different original announcement',ts:Date.now()});
 ok(sent.length===2 && sent[1].content.text==='*Custom heading*\nThe facts\nJoin: https://example.org/channel','AI instructions own layout instead of legacy signature');S.set('power.signature.on','0');editor.save({semantic:true,instruction:'Keep facts',footerMode:'fixed'});

 S.set('power.queue.on','0');ai.callFor=async()=>{throw Error('provider down')};
 await pipeline.intakeRss({jid:'feed@rss',id:'unavailable',text:'An original important announcement',ts:Date.now()});
 const held=d.prepare("SELECT * FROM approvals WHERE source_msg_id='unavailable'").get();
 ok(held && held.status==='pending' && held.text==='An original important announcement' && /AI editor review/.test(held.note),'unavailable AI holds original text for explicit review even if queue automation is off');
 ok(sent.length===2,'unavailable AI never publishes unchecked content');
 // Assistant tool returns a review action rather than silently queuing when queue is off.
 // Media-only posts are held with the media intact for human review.
 CH.addSource('photo@newsletter','Photo feed');const fetchBefore=global.fetch;global.fetch=async()=>({ok:true,arrayBuffer:async()=>Buffer.from('mock-image')});
 await pipeline.intake({key:{remoteJid:'photo@newsletter',id:'media-only',fromMe:false},messageTimestamp:Math.floor(Date.now()/1000),message:{imageMessage:{url:'https://mock.invalid/image',mimetype:'image/jpeg'}}});global.fetch=fetchBefore;
 const mediaRow=d.prepare("SELECT * FROM approvals WHERE source_msg_id='media-only'").get();
 ok(mediaRow && mediaRow.status==='pending' && /media-only/.test(mediaRow.note) && Boolean(mediaRow.media_path),'media-only post is held with media retained');
 editor.save({enabled:false});
 ai.callFor=async()=>{throw Error('should not call AI')};
 await pipeline.intakeRss({jid:'feed@rss',id:'disabled',text:'Unchanged original post',ts:Date.now()});
 ok(sent.length===3 && sent[2].content.text==='Unchanged original post','editor disabled preserves normal source publishing');
 S.set('ai.key.openrouter','test-only');S.set('privacy.ai.content','1');require('../src/aicontrol').setControl(true);
 let round=0;ai.callFor=async(feature)=>{ if(feature!=='assistant') throw Error('unexpected AI'); round++;return JSON.stringify({tool:'post_text',args:{text:'Assistant post'}}); };
 let badEcho; // mock deliberately parrots the request
 ai.callFor=async()=>JSON.stringify({tool:'post_text',args:{text:'make post'}});
 const countBeforeEcho=sent.length;badEcho=await require('../src/aicontrol').chat('make post');
 ok(sent.length===countBeforeEcho && /post topic/.test(badEcho.reply),'generic request is not posted verbatim as content');
 ai.callFor=async(feature)=>{ if(feature!=='assistant') throw Error('unexpected AI'); round++;return JSON.stringify({tool:'post_text',args:{text:'Assistant post'}}); };round=0;
 const before=d.prepare('SELECT COUNT(*) n FROM approvals').get().n;let chat=await require('../src/aicontrol').chat('Publish a post');
 ok(!chat.actions[0].result.queued && chat.actions[0].result.published && sent.length===4,'assistant publishes directly when queue is off');
 ok(round===1 && d.prepare('SELECT COUNT(*) n FROM approvals').get().n===before && /provider accepted/i.test(chat.reply),'one direct send, no queue or second model tool call');
 S.set('power.queue.on','1');round=0;chat=await require('../src/aicontrol').chat('Publish another post');
 ok(chat.actions[0].result.queued && d.prepare('SELECT COUNT(*) n FROM approvals').get().n===before+1 && sent.length===4,'assistant uses approval queue when on');
 S.set('power.queue.on','0');S.set('panic.on','1');chat=await require('../src/aicontrol').chat('Publish');
 ok(!chat.actions[0].ok && sent.length===4,'panic stops direct assistant posting');S.set('panic.on','0');
 S.set('blocklist.words','forbidden');ai.callFor=async()=>JSON.stringify({tool:'post_text',args:{text:'forbidden'}});chat=await require('../src/aicontrol').chat('Publish');
 ok(!chat.actions[0].ok && /blocklist/i.test(chat.actions[0].error) && sent.length===4,'blocklist stops direct assistant posting');S.set('blocklist.words','');
 S.set('guard.maxperhour','3');chat=await require('../src/aicontrol').chat('Publish');ok(!chat.actions[0].ok && /rate guard/i.test(chat.actions[0].error),'rate guard applies to assistant posts');S.set('guard.maxperhour','30');
 CH.addTarget('other@newsletter','Other');wa.sendToChannel=async(_sock,jid,content)=>{if(jid==='other@newsletter')throw Error('connection lost');sent.push({jid,content});return 'accepted-'+sent.length};
 chat=await require('../src/aicontrol').chat('Publish');ok(!chat.actions[0].result.published && chat.actions[0].result.sent===1 && /incomplete or uncertain/i.test(chat.reply),'partial assistant delivery is reported honestly');
 // Editor errors do not auto-queue when assistant queue switch is off.
 editor.save({enabled:true});ai.callFor=async(feature)=>feature==='assistant' ? JSON.stringify({tool:'post_text',args:{text:'Fresh assistant post'}}) : Promise.reject(Error('AI offline'));
 const beforeFailure=d.prepare('SELECT COUNT(*) n FROM approvals').get().n;chat=await require('../src/aicontrol').chat('Publish');
 ok(!chat.actions[0].result.published && !chat.actions[0].result.queued && /nothing was sent or queued/i.test(chat.reply) && d.prepare('SELECT COUNT(*) n FROM approvals').get().n===beforeFailure,'editor failure does not silently queue or send assistant post');
 editor.save({enabled:true,semantic:false,instruction:'Make it concise and include my channel link',footerMode:'adaptive'});
 P.mark('old-channel@newsletter','old-empty','published','','');
 wa.sendToChannel=async(_sock,jid,content)=>{sent.push({jid,content});return 'successful-'+sent.length};
 ai.callFor=async(feature)=>feature==='assistant' ? JSON.stringify({tool:'post_text',args:{text:'New job post',target:'Target'}}) : feature==='match' ? JSON.stringify({duplicate_id:null,confidence:1}) : JSON.stringify({decision:'publish',reason:'styled',text:'A concise job post\nJoin: https://example.org/channel'});
 chat=await require('../src/aicontrol').chat('Publish a job post to Target');
 ok(chat.actions[0].result.published && !chat.actions[0].result.queued && sent.at(-1).content.text.includes('https://example.org/channel'),'queue-off assistant directly publishes AI-edited text with adaptive footer');
 ok(/no saved text/.test(chat.reply),'assistant reports incomplete saved history without blocking the post');
 let calls=0;const ownerChat=require('../src/aicontrol');
 ai.callFor=async()=>{calls++;return JSON.stringify({tool:'set_editor_policy',args:{instruction:'Use concise Urdu and a friendly closing.',mode:'append'}})};
 const previous=editor.settings().instruction;chat=await ownerChat.chat('From now on use concise Urdu and a friendly closing.');
 ok(editor.settings().instruction.includes(previous) && editor.settings().instruction.endsWith('Use concise Urdu and a friendly closing.') && calls===1,'chat appends natural-language post instructions without repeating tool actions');
 ai.callFor=async()=>JSON.stringify({tool:'set_editor_policy',args:{instruction:'Use my number.',ownerDetails:'+923001112222',footerMode:'adaptive'}});
 chat=await ownerChat.chat('Use my number +923001112222');ok(editor.settings().footer==='+923001112222' && editor.settings().footerMode==='adaptive','chat accepts exact owner-provided details');
 ai.callFor=async()=>JSON.stringify({tool:'set_editor_policy',args:{instruction:'Use my number.',ownerDetails:'+923009999999'}});
 chat=await ownerChat.chat('Use my number');ok(!chat.actions[0].ok && editor.settings().footer==='+923001112222','chat refuses invented contact details');
 console.log(`PASS: ${n} AI editor and assistant checks`);
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{ai.callFor=rawCallFor;d.close();fs.rmSync(root,{recursive:true,force:true});});
