#!/usr/bin/env node
// Injeta nós E2.1 (signup/verify/resend + init mail) no flows.json e ajusta fnLogin/fnCreateCliente.
const fs = require('fs');
const path = '/opt/xtconect/nodered/data/flows.json';
const flows = JSON.parse(fs.readFileSync(path, 'utf8'));

function findNode(id) {
  const n = flows.find(x => x.id === id);
  if (!n) throw new Error('node not found: ' + id);
  return n;
}
function ensureNew(id) {
  if (flows.some(x => x.id === id)) {
    flows.splice(flows.findIndex(x => x.id === id), 1);
  }
}

// ---------- 1) Patch fnLogin: bloquear login se email_verified=false ----------
{
  const n = findNode('fnLogin');
  if (!/email_not_verified/.test(n.func)) {
    n.func = n.func.replace(
      "if (!u.is_active) { msg.statusCode=403; msg.payload={error:'user inactive'}; return msg; }",
      "if (!u.is_active) { msg.statusCode=403; msg.payload={error:'user inactive'}; return msg; }\n  if (!u.email_verified) { msg.statusCode=403; msg.payload={error:'email_not_verified'}; return msg; }"
    );
    // Garantir que SELECT inclua email_verified
    n.func = n.func.replace(
      "SELECT id,email,password_hash,full_name,role,is_active FROM app_users",
      "SELECT id,email,password_hash,full_name,role,is_active,email_verified FROM app_users"
    );
  }
}

// ---------- 2) Patch fnCreateCliente: enviar e-mail admin-created best-effort ----------
{
  const n = findNode('fnCreateCliente');
  if (!/sendMail.*admin-created/s.test(n.func)) {
    // Inserir antes do `return msg;` final
    const sendBlock = "\n  // Best-effort: enviar e-mail admin-created\n  try {\n    const sendMail = global.get('sendMail');\n    const baseUrl = global.get('mailBaseUrl') || env.get('MAIL_BASE_URL') || 'https://hub.xtconect.online';\n    if (sendMail) {\n      await sendMail({to: email, subject: 'Sua conta XT Connect Hub foi criada', template: 'admin-created', vars: {nome, email, senha: password, link: baseUrl + '/login'}});\n    }\n  } catch(e) { node.warn('admin-created email failed: '+e.message); }\n";
    // Coloca após o set de msg.payload do sucesso, antes do catch
    n.func = n.func.replace(
      "msg.payload = { user: ins.rows[0], senha_temporaria: password, senha_gerada: generated };\n}",
      "msg.payload = { user: ins.rows[0], senha_temporaria: password, senha_gerada: generated };" + sendBlock + "}"
    );
  }
}

// ---------- 3) Adicionar nodemailer libs onde precisa ----------
function ensureLib(node, varName, moduleName) {
  node.libs = node.libs || [];
  if (!node.libs.find(l => l.var === varName)) node.libs.push({ var: varName, module: moduleName });
}

// ---------- 4) Novos nós ----------
const newNodes = [];

// init mail
const initMailFunc = `if (global.get('sendMail')) { node.status({fill:'green',shape:'dot',text:'mail ok'}); return null; }
const passFile = env.get('SMTP_PASSWORD_FILE') || '/data/env/smtp-password';
let pass = '';
try { pass = fs.readFileSync(passFile, 'utf8').trim(); } catch(e) { node.error('cannot read smtp password: '+e.message); node.status({fill:'red',shape:'ring',text:'pass missing'}); return null; }
if (!pass) { node.error('smtp password is empty'); node.status({fill:'red',shape:'ring',text:'pass empty'}); return null; }
const transport = nodemailer.createTransport({
  host: env.get('SMTP_HOST') || 'smtp.hostinger.com',
  port: parseInt(env.get('SMTP_PORT') || '465'),
  secure: (env.get('SMTP_SECURE') || 'true').toLowerCase() === 'true',
  auth: { user: env.get('SMTP_USER'), pass: pass }
});
const from = env.get('MAIL_FROM') || env.get('SMTP_USER');
const baseUrl = env.get('MAIL_BASE_URL') || 'https://hub.xtconect.online';
const templatesDir = '/data/templates/email';
const templates = {};
for (const name of ['signup-verify','signup-welcome','admin-created','password-reset']) {
  try { templates[name] = fs.readFileSync(templatesDir + '/' + name + '.html', 'utf8'); } catch(e) { node.warn('template missing: '+name); }
}
function render(tpl, vars) {
  return Object.entries(vars||{}).reduce(function(s, kv){ return s.split('{{'+kv[0]+'}}').join(String(kv[1])); }, tpl);
}
const sendMail = async function(opts) {
  const html = templates[opts.template] ? render(templates[opts.template], opts.vars) : undefined;
  return transport.sendMail({ from: from, to: opts.to, subject: opts.subject, html: html, text: opts.text });
};
global.set('sendMail', sendMail);
global.set('mailBaseUrl', baseUrl);
node.status({fill:'green',shape:'dot',text:'smtp ready'});
return null;`;

ensureNew('injInitMail');
newNodes.push({
  id: 'injInitMail', type: 'inject', z: 'tabAuth', name: 'init mail (on start)',
  props: [{ p: 'payload' }],
  repeat: '', crontab: '', once: true, onceDelay: '2',
  topic: '', payload: '', payloadType: 'date',
  x: 180, y: 1750, wires: [['fnInitMail']]
});

ensureNew('fnInitMail');
newNodes.push({
  id: 'fnInitMail', type: 'function', z: 'tabAuth', name: 'Criar SMTP transport',
  func: initMailFunc,
  outputs: 1, timeout: '30', noerr: 0, initialize: '', finalize: '',
  libs: [{ var: 'nodemailer', module: 'nodemailer' }, { var: 'fs', module: 'fs' }],
  x: 420, y: 1750, wires: [[]]
});

// /auth/signup
const fnSignupFunc = `const pool = global.get('pgPool');
const sendMail = global.get('sendMail');
const baseUrl = global.get('mailBaseUrl') || env.get('MAIL_BASE_URL') || 'https://hub.xtconect.online';
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }
const body = msg.payload || {};
const email = (body.email||'').toLowerCase().trim();
const password = body.password||'';
const nome = (body.full_name||body.nome||'').trim();
const EMAIL_RE = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
if (!EMAIL_RE.test(email)) { msg.statusCode=400; msg.payload={error:'email invalido'}; return msg; }
if (nome.length < 2) { msg.statusCode=400; msg.payload={error:'nome obrigatorio'}; return msg; }
if (password.length < 8) { msg.statusCode=400; msg.payload={error:'senha deve ter ao menos 8 caracteres'}; return msg; }
try {
  const dup = await pool.query('SELECT id FROM app_users WHERE email=$1 LIMIT 1',[email]);
  if (dup.rowCount > 0) { msg.statusCode=409; msg.payload={error:'email ja cadastrado'}; return msg; }
  const hash = await bcrypt.hash(password, 10);
  const ins = await pool.query(
    "INSERT INTO app_users (email, password_hash, full_name, role, email_verified, is_active) VALUES ($1,$2,$3,'cliente',FALSE,TRUE) RETURNING id",
    [email, hash, nome]
  );
  const userId = ins.rows[0].id;
  const tk = await pool.query(
    "INSERT INTO email_verification_tokens (user_id, purpose, expires_at) VALUES ($1,'signup', now() + interval '24 hours') RETURNING token",
    [userId]
  );
  const link = baseUrl + '/verify?token=' + tk.rows[0].token;
  if (sendMail) {
    try {
      await sendMail({to: email, subject: 'Confirme seu e-mail — XT Connect Hub', template: 'signup-verify', vars: {nome: nome, link: link}});
    } catch(e) { node.warn('signup email failed for '+email+': '+e.message); }
  } else {
    node.warn('signup: sendMail not initialized; usuario criado sem e-mail');
  }
  msg.statusCode = 201;
  msg.payload = { message: 'Verifique seu e-mail para ativar a conta.' };
} catch(e) {
  if (/unique/i.test(e.message) || /duplicate/i.test(e.message)) {
    msg.statusCode=409; msg.payload={error:'email ja cadastrado'};
  } else {
    node.error('signup: '+e.message, msg);
    msg.statusCode = 500; msg.payload = {error:'internal'};
  }
}
return msg;`;

ensureNew('httpSignup');
newNodes.push({
  id: 'httpSignup', type: 'http in', z: 'tabAuth', name: 'POST /auth/signup',
  url: '/auth/signup', method: 'post', upload: false, swaggerDoc: '',
  x: 200, y: 1850, wires: [['fnSignup']]
});

ensureNew('fnSignup');
newNodes.push({
  id: 'fnSignup', type: 'function', z: 'tabAuth', name: 'Signup self-service',
  func: fnSignupFunc,
  outputs: 1, timeout: '', noerr: 0, initialize: '', finalize: '',
  libs: [{ var: 'bcrypt', module: 'bcryptjs' }],
  x: 420, y: 1850, wires: [['respSignup']]
});

ensureNew('respSignup');
newNodes.push({
  id: 'respSignup', type: 'http response', z: 'tabAuth', name: '',
  statusCode: '', headers: { 'Content-Type': 'application/json' },
  x: 680, y: 1850, wires: []
});

// /auth/verify
const fnVerifyFunc = `const pool = global.get('pgPool');
const baseUrl = global.get('mailBaseUrl') || env.get('MAIL_BASE_URL') || 'https://hub.xtconect.online';
function redirect(suffix) {
  msg.statusCode = 302;
  msg.headers = { Location: baseUrl + '/login?verified=' + suffix };
  msg.payload = '';
  return msg;
}
if (!pool) return redirect('error');
const token = (msg.req.query && msg.req.query.token) || '';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(token)) return redirect('invalid');
try {
  const r = await pool.query(
    "SELECT user_id, used_at, expires_at FROM email_verification_tokens WHERE token=$1 AND purpose='signup'",
    [token]
  );
  if (r.rowCount === 0) return redirect('notfound');
  const row = r.rows[0];
  if (row.used_at) return redirect('used');
  if (new Date(row.expires_at).getTime() < Date.now()) return redirect('expired');
  await pool.query('UPDATE app_users SET email_verified=TRUE WHERE id=$1', [row.user_id]);
  await pool.query('UPDATE email_verification_tokens SET used_at=now() WHERE token=$1', [token]);
  return redirect('true');
} catch(e) {
  node.error('verify: '+e.message, msg);
  return redirect('error');
}`;

ensureNew('httpVerify');
newNodes.push({
  id: 'httpVerify', type: 'http in', z: 'tabAuth', name: 'GET /auth/verify',
  url: '/auth/verify', method: 'get', upload: false, swaggerDoc: '',
  x: 200, y: 1950, wires: [['fnVerify']]
});

ensureNew('fnVerify');
newNodes.push({
  id: 'fnVerify', type: 'function', z: 'tabAuth', name: 'Verificar token',
  func: fnVerifyFunc,
  outputs: 1, timeout: '', noerr: 0, initialize: '', finalize: '',
  libs: [],
  x: 420, y: 1950, wires: [['respVerify']]
});

ensureNew('respVerify');
newNodes.push({
  id: 'respVerify', type: 'http response', z: 'tabAuth', name: '',
  statusCode: '', headers: {},
  x: 680, y: 1950, wires: []
});

// /auth/resend
const fnResendFunc = `const pool = global.get('pgPool');
const sendMail = global.get('sendMail');
const baseUrl = global.get('mailBaseUrl') || env.get('MAIL_BASE_URL') || 'https://hub.xtconect.online';
const okResp = { message: 'Se houver uma conta com este e-mail nao verificada, um novo link foi enviado.' };
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }
const body = msg.payload || {};
const email = (body.email||'').toLowerCase().trim();
if (!email) { msg.statusCode=200; msg.payload=okResp; return msg; }
try {
  const r = await pool.query('SELECT id, email_verified, full_name FROM app_users WHERE email=$1 LIMIT 1', [email]);
  if (r.rowCount === 0 || r.rows[0].email_verified) { msg.statusCode=200; msg.payload=okResp; return msg; }
  const u = r.rows[0];
  await pool.query("UPDATE email_verification_tokens SET used_at=now() WHERE user_id=$1 AND purpose='signup' AND used_at IS NULL", [u.id]);
  const tk = await pool.query(
    "INSERT INTO email_verification_tokens (user_id, purpose, expires_at) VALUES ($1,'signup', now()+interval '24 hours') RETURNING token",
    [u.id]
  );
  if (sendMail) {
    try {
      await sendMail({to: email, subject: 'Confirme seu e-mail — XT Connect Hub', template: 'signup-verify', vars: {nome: u.full_name || email, link: baseUrl + '/verify?token=' + tk.rows[0].token}});
    } catch(e) { node.warn('resend mail failed: '+e.message); }
  }
  msg.statusCode = 200; msg.payload = okResp;
} catch(e) {
  node.error('resend: '+e.message, msg);
  msg.statusCode = 200; msg.payload = okResp;
}
return msg;`;

ensureNew('httpResend');
newNodes.push({
  id: 'httpResend', type: 'http in', z: 'tabAuth', name: 'POST /auth/resend',
  url: '/auth/resend', method: 'post', upload: false, swaggerDoc: '',
  x: 200, y: 2050, wires: [['fnResend']]
});

ensureNew('fnResend');
newNodes.push({
  id: 'fnResend', type: 'function', z: 'tabAuth', name: 'Reenviar verificacao',
  func: fnResendFunc,
  outputs: 1, timeout: '', noerr: 0, initialize: '', finalize: '',
  libs: [],
  x: 420, y: 2050, wires: [['respResend']]
});

ensureNew('respResend');
newNodes.push({
  id: 'respResend', type: 'http response', z: 'tabAuth', name: '',
  statusCode: '', headers: { 'Content-Type': 'application/json' },
  x: 680, y: 2050, wires: []
});

flows.push(...newNodes);

fs.writeFileSync(path, JSON.stringify(flows, null, 4) + '\n');
console.log('OK: flows.json updated. Added/replaced ' + newNodes.length + ' nodes.');
console.log('Total nodes now: ' + flows.length);
