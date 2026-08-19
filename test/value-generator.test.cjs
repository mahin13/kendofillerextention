global.window = {};
require(require('path').join(__dirname,'..','src','content','value-generator.js'));
const V = global.window.__KENDO_FILLER__.values;
let fail = 0;
const t = (name, cond, extra) => { console.log((cond?'PASS  ':'FAIL  ')+name+(extra!==undefined?'  -> '+extra:'')); if(!cond) fail++; };

let ok=true, sample=[];
for (let i=0;i<400;i++){ const v=V.numeric({min:10,max:20,step:2}); sample.push(v);
  if(!Number.isInteger(v)||v<10||v>20||((v-10)%2!==0)) ok=false; }
t('numeric respects min/max/step + integer', ok, 'e.g. '+sample.slice(0,6).join(','));

ok=true; for(let i=0;i<200;i++){const v=V.numeric({}); if(!Number.isInteger(v)||v<1||v>999) ok=false;}
t('numeric default range 1-999', ok);

ok=true; for(let i=0;i<200;i++){const v=V.numeric({min:5,max:5}); if(v!==5) ok=false;}
t('numeric with min===max', ok);

ok=true; sample=[];
for(let i=0;i<400;i++){const v=V.decimal({min:0,max:5,decimals:3}); sample.push(v);
  const dp=(String(v).split('.')[1]||'').length;
  if(!isFinite(v)||v<0||v>5||dp>3) ok=false;}
t('decimal respects min/max/precision(3)', ok, 'e.g. '+sample.slice(0,5).join(','));

ok=true; sample=[];
for(let i=0;i<300;i++){const v=V.decimal({}); sample.push(v); const dp=(String(v).split('.')[1]||'').length; if(dp>2||v<1||v>999) ok=false;}
t('decimal default 2dp within 1-999', ok, 'e.g. '+sample.slice(0,5).join(','));

t('text = label + random number', /^Portfolio Name \d{5}$/.test(V.text('Portfolio Name')), V.text('Portfolio Name'));
t('text strips asterisk from label', !V.text('Client Reference *').includes('*'), V.text('Client Reference *'));
const short = V.text('Extremely Long Descriptive Label For A Tiny Field',{maxLength:10});
t('text honours maxlength=10', short.length<=10, JSON.stringify(short));
const minv = V.text('Client Code',{minLength:20,maxLength:24});
t('text honours minlength=20', minv.length>=20, JSON.stringify(minv));
t('email is syntactically valid', /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(V.email()), V.email());
t('url is valid', /^https:\/\/example\.com\/test\/\d{5}$/.test(V.url()), V.url());
t('tel is plausible', /^\+1\d{10}$/.test(V.tel()), V.tel());

const d = V.date({min:new Date('2026-08-01'), max:new Date('2026-08-10')});
t('date inside min/max window', d>=new Date('2026-08-01') && d<=new Date('2026-08-11'), V.isoDate(d));
t('isoDate format', /^\d{4}-\d{2}-\d{2}$/.test(V.isoDate(new Date('2026-08-19'))), V.isoDate(new Date('2026-08-19')));
t('isoTime format', /^\d{2}:\d{2}$/.test(V.isoTime(V.time({}))), V.isoTime(V.time({})));
t('isoWeek format', /^\d{4}-W\d{2}$/.test(V.isoWeek(new Date('2026-08-19'))), V.isoWeek(new Date('2026-08-19')));
t('no NaN/Infinity ever', [V.numeric({min:NaN,max:Infinity}), V.decimal({min:NaN,max:NaN,decimals:2})].every(Number.isFinite));

console.log(fail? '\n'+fail+' CHECK(S) FAILED' : '\nAll value-generation checks passed.');
process.exit(fail?1:0);
