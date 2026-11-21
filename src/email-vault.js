'use strict';
// Optional, scoped protection for SMTP passwords. Other settings, session
// files and backups are not encrypted by this module.
const crypto=require('node:crypto');
const MARKER_AAD='raqifluz:email-vault:check:v1', MARKER_TEXT='raqifluz-email-key-check-v1';
const LOCKED='Email credential key is missing, incorrect or damaged. No email was started; see EMAIL-CREDENTIAL-PROTECTION.md.';
function keyFrom(raw){
  if(typeof raw!=='string'||! /^[A-Za-z0-9+/]{43}=$/.test(raw))throw Error(LOCKED);
  const b=Buffer.from(raw,'base64');if(b.length!==32||b.toString('base64')!==raw){b.fill(0);throw Error(LOCKED);}return b;
}
function seal(key,text,aad){
  if(typeof text!=='string'||!text||text.length>4096)throw Error('Email credential data is invalid; no changes were made.');
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv,{authTagLength:16});cipher.setAAD(Buffer.from(aad,'utf8'));
  const ciphertext=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);return ['v1',iv.toString('base64url'),ciphertext.toString('base64url'),cipher.getAuthTag().toString('base64url')].join('.');
}
function open(key,value,aad){
  try{
    if(typeof value!=='string'||value.length>8192)throw Error();const parts=value.split('.');if(parts.length!==4||parts[0]!=='v1'||!parts.slice(1).every(x=>/^[A-Za-z0-9_-]+$/.test(x)))throw Error();
    const [iv,ciphertext,tag]=parts.slice(1).map(x=>Buffer.from(x,'base64url'));
    if(iv.length!==12||tag.length!==16||!ciphertext.length||parts.slice(1).some((x,i)=>[iv,ciphertext,tag][i].toString('base64url')!==x))throw Error();
    const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv,{authTagLength:16});decipher.setAAD(Buffer.from(aad,'utf8'));decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext),decipher.final()]).toString('utf8');
  }catch{throw Error(LOCKED);}
}
const aad=id=>'raqifluz:email-account:v1:'+id;
const createMarker=key=>seal(key,MARKER_TEXT,MARKER_AAD);
function verifyMarker(key,marker){if(open(key,marker,MARKER_AAD)!==MARKER_TEXT)throw Error(LOCKED);}
function validateEntries(list,key,marker){
  if(marker)verifyMarker(key,marker);
  for(const acc of list)if(acc && acc.pass_enc){if(typeof acc.id!=='string'||!acc.id)throw Error(LOCKED);open(key,acc.pass_enc,aad(acc.id));}
}
function marker(){return require('./db').S.get('email.secret_key_check','');}
function withKey(fn){const key=keyFrom(process.env.RAQ_SECRETS_KEY);try{return fn(key)}finally{key.fill(0)}}
function passwordFor(acc){
  const check=marker();
  if(acc.pass_enc||check)return withKey(key=>{if(check)verifyMarker(key,check);return acc.pass_enc?open(key,acc.pass_enc,aad(acc.id)):String(acc.pass||'');});
  return String(acc.pass||'');
}
function newCredential(list,id,password){
  const check=marker(),needsKey=Boolean(check||list.some(a=>a.pass_enc));
  if(!process.env.RAQ_SECRETS_KEY){if(needsKey)throw Error(LOCKED);return {pass:password};}
  return withKey(key=>{validateEntries(list,key,check);return {pass_enc:seal(key,password,aad(id)),marker:check||createMarker(key)};});
}
function status(list){
  const encrypted=list.filter(a=>Boolean(a.pass_enc)).length,plaintext=list.filter(a=>!a.pass_enc&&Boolean(a.pass)).length,check=marker();
  if(!check&&!encrypted&&!process.env.RAQ_SECRETS_KEY)return {mode:'plaintext',encrypted,plaintext};
  try{withKey(key=>validateEntries(list,key,check));return {mode:plaintext?'mixed':'protected',encrypted,plaintext};}catch{return {mode:'locked',encrypted,plaintext};}
}
module.exports={LOCKED,keyFrom,seal,open,aad,createMarker,verifyMarker,validateEntries,passwordFor,newCredential,status};
