'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert'),{spawnSync}=require('node:child_process');
const guard=require('../src/web-baseline-guard');const root=fs.mkdtempSync(path.join(os.tmpdir(),'raq-source-guard-'));let n=0;
function ok(v,label){assert.ok(v,label);n++;console.log('✓ '+label)}
try{
 const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
 const a=path.join(root,'file-a'),b=path.join(root,'file-b');fs.writeFileSync(a,'new-a');fs.writeFileSync(b,'new-b');
 const fixture={'file-a':digest('old-a'),'file-b':digest('old-b')};
 ok(guard.check(root,fixture).ok,'different current files pass known-old signature check');
 fs.writeFileSync(a,'old-a');let result=guard.check(root,fixture);ok(!result.ok&&result.stale.join()==='file-a'&&fs.readFileSync(a,'utf8')==='old-a','known-old file is reported without modifying it');
 fs.unlinkSync(b);result=guard.check(root,fixture);ok(!result.ok&&result.missing.join()==='file-b','missing required source is reported');
 ok(Object.keys(guard.KNOWN_OLD).length===6&&guard.check(path.resolve(__dirname,'..')).ok,'current tree does not contain the six known stale files');
 fs.writeFileSync(a,'second-old');ok(!guard.check(root,{'file-a':[digest('old-a'),digest('second-old')]}).ok,'each known stale signature is detected without restoring files');
 ok(Object.keys(guard.CHECKPOINT_36).length===6,'older checkpoint mixed into a newer tree is also guarded');
 const app=path.resolve(__dirname,'..'),manifest=JSON.parse(fs.readFileSync(path.join(app,'src/web-integrity.json'),'utf8'));
 ok(manifest.version===1&&guard.checkIntegrity(app,manifest.files).ok,'reviewed manifest matches all current critical dashboard files');
 const modified={...manifest.files,[relativeFake()]:digest('unexpected')};function relativeFake(){return Object.keys(manifest.files)[0]}
 ok(!guard.checkIntegrity(app,modified).ok,'arbitrary changed dashboard bytes fail the manifest check');
 ok(!guard.checkIntegrity(app,{}).ok,'missing manifest entries cannot silently weaken verification');
 // Assemble a private synthetic source tree and substitute one test signature.
 // The real entrypoint must fail before creating any configured state directory.
 const project=path.join(root,'project');fs.mkdirSync(path.join(project,'src'),{recursive:true});
 for(const f of ['index.js','config.js'])fs.copyFileSync(path.join(__dirname,'../src',f),path.join(project,'src',f));
 let code=fs.readFileSync(require.resolve('../src/web-baseline-guard'),'utf8');const [relative,hash]=Object.entries(guard.KNOWN_OLD)[0];code=code.replace(hash,digest('known-stale-fixture'));
 fs.writeFileSync(path.join(project,'src/web-baseline-guard.js'),code);fs.symlinkSync(path.resolve(__dirname,'../node_modules'),path.join(project,'node_modules'),'dir');
 for(const f of Object.keys(guard.KNOWN_OLD)){let target=path.join(project,f);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,f===relative?'known-stale-fixture':'new-content');}
 const state=path.join(root,'must-not-be-created');const p=spawnSync(process.execPath,[path.join(project,'src/index.js')],{env:{...process.env,RAQ_STATE_DIR:state},encoding:'utf8',timeout:10000});
 ok(p.status===1 && /known stale workspace snapshot/.test(p.stderr),'actual entrypoint rejects a synthetic known-stale dashboard');
 ok(!fs.existsSync(state),'stale-source startup stops before creating configured state');
 const files={};for(const f of Object.keys(guard.KNOWN_OLD)){const target=path.join(project,f);fs.writeFileSync(target,'reviewed-'+f);files[f]=digest('reviewed-'+f)}
 fs.writeFileSync(path.join(project,'src/web-integrity.json'),JSON.stringify({version:1,files}));fs.writeFileSync(path.join(project,relative),'unexpected newer or corrupted contents');
 const mismatchState=path.join(root,'mismatch-must-not-be-created');const mismatch=spawnSync(process.execPath,[path.join(project,'src/index.js')],{env:{...process.env,RAQ_STATE_DIR:mismatchState},encoding:'utf8',timeout:10000});
 ok(mismatch.status===1&&/differ from the reviewed integrity manifest/.test(mismatch.stderr)&&!fs.existsSync(mismatchState),'actual entrypoint refuses arbitrary manifest mismatch before touching state');
 console.log('PASS: '+n+' workspace source-guard checks');
}finally{fs.rmSync(root,{recursive:true,force:true})}
