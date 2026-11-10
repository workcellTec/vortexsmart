// Firebase simulado para o teste no emulador: árvore em memória + ouvintes, sem rede e sem login.
// O servidor (servidor.js) entrega estes módulos no lugar dos de https://www.gstatic.com/firebasejs/.
// Firebase falso, só pra rodar o app de verdade no Chromium sem rede. Árvore em memória + ouvintes.
const DB = `
const T = window.__T = window.__T || {};
window.__LOG = window.__LOG || [];
const L = new Set();
const parts = p => String(p).split('/').filter(Boolean);
const getAt = p => parts(p).reduce((o,k)=> (o==null?undefined:o[k]), T);
const setAt = (p, v) => { const ks = parts(p); let o = T; ks.slice(0,-1).forEach(k=>{ if(typeof o[k]!=='object'||o[k]===null) o[k]={}; o=o[k]; }); const last=ks[ks.length-1]; if (v===null||v===undefined) delete o[last]; else o[last]=v; };
const snap = (p) => { const v = getAt(p); const c = v===undefined? null : JSON.parse(JSON.stringify(v)); return { val:()=>c, exists:()=>c!==null, key: parts(p).pop()||null, forEach(fn){ if(c&&typeof c==='object') Object.keys(c).forEach(k=>fn({key:k,val:()=>c[k],exists:()=>true})); }, hasChildren:()=>!!c&&typeof c==='object'&&Object.keys(c).length>0, numChildren:()=>c&&typeof c==='object'?Object.keys(c).length:0 }; };
const notify = (changed) => { L.forEach(l => { if (l.p===changed || changed.startsWith(l.p+'/') || l.p.startsWith(changed+'/') || l.p==='') setTimeout(()=>{ if(L.has(l)) l.cb(snap(l.p)); }, 0); }); };
export const getDatabase = () => ({});
export const ref = (db, p) => ({ p: parts(p||'').join('/'), toString(){return this.p;} });
export const onValue = (r, cb) => { window.__LOG.push('onValue '+r.p); const l={p:r.p,cb}; L.add(l); setTimeout(()=>cb(snap(r.p)),0); return ()=>L.delete(l); };
export const off = () => {};
export const get = async r => { window.__LOG.push('get '+r.p); return snap(r.p); };
export const update = async (r, obj) => { Object.keys(obj).forEach(k => setAt(r.p+'/'+k, obj[k])); notify(r.p); };
export const push = (r, v) => { const id = '-N'+Math.random().toString(36).slice(2,10); const rr = ref(null, r.p+'/'+id); rr.key=id; const pr = (v===undefined? Promise.resolve(rr) : (setAt(rr.p, v), notify(r.p), Promise.resolve(rr))); pr.key=id; pr.p=rr.p; return pr; };
export const remove = async r => { setAt(r.p, null); notify(r.p); };
export const runTransaction = async (r, fn) => { const nv = fn(getAt(r.p)); if (nv!==undefined) { setAt(r.p,nv); notify(r.p);} return { committed:true, snapshot: snap(r.p) }; };
export const query = r => r; export const orderByChild = () => 0; export const equalTo = () => 0; export const limitToLast = () => 0; export const startAt = () => 0; export const endAt = () => 0;
`;
const MODS = {
 'firebase-app.js': `export const initializeApp = c => ({c});`,
 'firebase-auth.js': `const user = { uid:'u1', email:'t@t.com', getIdToken: async()=>'tok', getIdTokenResult: async()=>({claims:{lojaId:'L1'}}) };
  const auth = { currentUser: user };
  export const getAuth = () => auth;
  export const onAuthStateChanged = (a, cb) => { setTimeout(()=>cb(user),0); return ()=>{}; };
  export const signInWithEmailAndPassword = async()=>({user}); export const signOut = async()=>{}; export const updatePassword = async()=>{}; export const reauthenticateWithCredential = async()=>{};
  export const EmailAuthProvider = { credential: ()=>({}) };`,
 'firebase-database.js': DB,
 'firebase-functions.js': `export const getFunctions = () => ({}); export const httpsCallable = () => async () => ({data:{}});`,
 'firebase-storage.js': `export const getStorage = () => ({}); export const ref = () => ({}); export const uploadBytes = async()=>({}); export const getDownloadURL = async()=>'data:,'; export const deleteObject = async()=>{};`,
 'firebase-messaging.js': `export const getMessaging = () => ({}); export const getToken = async()=>null; export const onMessage = () => {}; export const isSupported = async () => false;`,
};
module.exports = MODS;
