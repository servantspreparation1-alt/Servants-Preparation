/* Run only on a trusted admin computer, with the service-account JSON path in GOOGLE_APPLICATION_CREDENTIALS. Never upload the key into the repository. */
const admin=require('firebase-admin'),crypto=require('node:crypto'),P=require('../lib/policy.cjs');
(async()=>{
 if(process.argv[2]!=='--confirm-owner-reset')throw Error('Usage: node scripts/recover-owner.cjs --confirm-owner-reset');
 if(!process.env.GOOGLE_APPLICATION_CREDENTIALS)throw Error('Set GOOGLE_APPLICATION_CREDENTIALS to the local private JSON file path first.');
 admin.initializeApp({credential:admin.credential.applicationDefault(),databaseURL:'https://servants-preparation-108f3-default-rtdb.europe-west1.firebasedatabase.app'});
 const db=admin.database(),uid=(await db.ref('secureV8/config/ownerUid').get()).val();if(!uid)throw Error('Migration not initialized');
 const pass=crypto.randomBytes(20).toString('base64url'),hash=P.passwordHash(pass);
 await db.ref('secureV8').transaction(root=>{const a=root?.accounts?.[uid];if(!a?.owner)throw Error('Owner config mismatch');root.credentials[uid]=hash;a.sessionVersion=(a.sessionVersion||1)+1;a.active=true;const id=crypto.randomUUID();root.audit=root.audit||{};root.audit[id]={id,at:Date.now(),actorId:uid,actorName:'Trusted admin recovery',action:'owner_recovery'};return root;},undefined,false);
 console.log('New owner password (store securely, do not share):\n'+pass);await admin.app().delete();
})().catch(e=>{console.error(e.message);process.exitCode=1;});
