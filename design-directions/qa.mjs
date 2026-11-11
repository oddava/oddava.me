import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir).filter((f) =>
  /^(margin|parts|atlas)-(home|note)\.html$/.test(f),
);
assert.equal(files.length, 6);
const html = Object.fromEntries(
  files.map((f) => [f, readFileSync(resolve(dir, f), 'utf8')]),
);
const targets = Object.fromEntries(
  Object.entries(html).map(([f, text]) => [
    f,
    [...text.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]),
  ]),
);
targets['index.html'] = [];
const notesDir = resolve(dir, '../src/content/notes');
const noteCount = readdirSync(notesDir, { recursive: true }).filter((f) =>
  f.endsWith('.md'),
).length;
assert.equal(noteCount, 15);
for (const [file, text] of Object.entries(html)) {
  assert(
    !/<(?:img|script|iframe)[^>]+src=["']https?:/i.test(text),
    file + ': remote asset',
  );
  assert(!/url\(["']?https?:/i.test(text), file + ': remote font/image');
  assert(
    text.includes('data:font/ttf;base64,'),
    file + ': embedded free primary font',
  );
  assert(
    text.includes('data-pref="theme"') && text.includes('data-reset'),
    file + ': preferences',
  );
  assert(
    !/\b(?:100vh|100dvh)\b/.test(text),
    file + ': content height must not depend on renderer height',
  );
  for (const [, href] of text.matchAll(/\bhref="([^"]+)"/g)) {
    if (/^(?:https?:|mailto:|data:)/.test(href)) continue;
    const [path, hash] = href.split('#');
    const target = path || file;
    assert(target in targets, file + ': missing local file ' + target);
    assert(
      !hash || targets[target].includes(hash),
      file + ': missing anchor ' + href,
    );
  }
  if (file.endsWith('note.html')) {
    assert(
      text.includes(
        'The suprachiasmatic nucleus communicates its repeating cycle',
      ),
      file + ': real text',
    );
    assert(
      text.includes('Traveling east is harder than west'),
      file + ': full second section',
    );
  }
}
mkdirSync(resolve(dir, 'qa-pages'), { recursive: true });
const check = String.raw`
<script>
(async()=>{
  await document.fonts.ready;
  const output={file:FILE,width:innerWidth,errors:[],checks:{}};
  const ensure=(name,value)=>{output.checks[name]=!!value;if(!value)output.errors.push(name);};
  const control=name=>document.querySelector('[data-pref="'+name+'"]');
  const set=(name,value)=>{control(name).value=value;control(name).dispatchEvent(new Event('change',{bubbles:true}));};
  const visible=el=>el.checkVisibility() && el.getBoundingClientRect().bottom>0;
  const rgb=s=>s.match(/[\d.]+/g)?.map(Number);
  const lum=c=>c.slice(0,3).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((a,x,i)=>a+x*[.2126,.7152,.0722][i],0);
  const bg=el=>{for(let p=el;p;p=p.parentElement){const c=rgb(getComputedStyle(p).backgroundColor);if(c&&(c.length===3||c[3]===1))return c;}return[255,255,255];};
  const contrast=()=>{const failures=[];let min=100;for(const el of document.querySelectorAll('body *')){if(['SCRIPT','STYLE','OPTION','SVG','PATH','TEXT'].includes(el.tagName)||!visible(el)||![...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))continue;const s=getComputedStyle(el),fg=rgb(s.color);if(!fg)continue;const a=lum(fg),b=lum(bg(el)),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05),large=parseFloat(s.fontSize)>=24||(parseFloat(s.fontSize)>=18.66&&parseInt(s.fontWeight)>=700);min=Math.min(min,ratio);if(ratio<(large?3:4.5))failures.push({text:el.textContent.trim().slice(0,65),ratio:+ratio.toFixed(2),fontSize:s.fontSize});}return{min:+min.toFixed(2),failures};};
  ensure('no horizontal overflow',document.documentElement.scrollWidth<=innerWidth);
  output.fonts=[...document.fonts].map(f=>({family:f.family,status:f.status}));
  if(!FILE.startsWith('atlas'))ensure('Public Sans loaded',[...document.fonts].some(f=>f.family==='PublicSans'&&f.status==='loaded'));
  if(FILE.startsWith('atlas'))ensure('Rounded loaded',[...document.fonts].some(f=>f.family==='Rounded'&&f.status==='loaded'));
  const skip=document.querySelector('.skip');skip.focus({preventScroll:true});ensure('skip focus and visible outline',document.activeElement===skip&&getComputedStyle(skip).outlineStyle==='solid');skip.blur();
  output.contrast={};
  for(const theme of ['light','dark'])for(const accent of ['default','blue','green']){set('theme',theme);set('accent',accent);const result=contrast();output.contrast[theme+'-'+accent]=result;ensure('contrast '+theme+' '+accent,result.failures.length===0);}
  set('font','serif');await document.fonts.load('19px Lora');ensure('free serif loaded',[...document.fonts].some(f=>f.family==='Lora'&&f.status==='loaded'));
  if(document.querySelector('.reading'))ensure('serif reading type applied',getComputedStyle(document.querySelector('.reading')).fontFamily.startsWith('Lora'));
  set('size','large');ensure('large reading size',!document.querySelector('.reading')||getComputedStyle(document.querySelector('.reading')).fontSize==='23px');
  set('density','compact');ensure('compact preference applied',document.documentElement.dataset.density==='compact'&&getComputedStyle(document.documentElement).getPropertyValue('--space').trim()==='20px');
  set('motion','reduced');ensure('reduced motion',getComputedStyle(document.documentElement).scrollBehavior==='auto');
  ensure('preference combination no overflow',document.documentElement.scrollWidth<=innerWidth);
  let stored;try{stored=JSON.parse(localStorage.getItem('oddava-directions-preferences-v1'));}catch{}
  output.storageAvailable=!!stored;ensure('preferences persisted or storage limitation announced',stored?.motion==='reduced'||document.querySelector('[data-pref-status]').textContent.includes('Storage unavailable'));
  const details=document.querySelector('.preferences');details.open=true;ensure('preference panel no overflow',document.documentElement.scrollWidth<=innerWidth);details.open=false;
  if(document.querySelector('[data-filter="work"]')){document.querySelector('[data-filter="work"]').click();ensure('day job filter', [...document.querySelectorAll('[data-project]')].filter(e=>!e.hidden).length===1);document.querySelector('[data-filter="side"]').click();ensure('side project filter',[...document.querySelectorAll('[data-project]')].filter(e=>!e.hidden).length===3);document.querySelector('[data-filter="all"]').click();}
  document.querySelector('[data-reset]').click();ensure('reset',document.documentElement.dataset.theme==='auto'&&document.documentElement.dataset.font==='sans'&&document.documentElement.dataset.size==='standard');
  document.querySelector('[data-pref-status]').textContent='';
  output.networkAssetRequests=performance.getEntriesByType('resource').filter(e=>/^https?:/.test(e.name)).map(e=>e.name);
  ensure('no network assets',output.networkAssetRequests.length===0);
  window.scrollTo(0,0);
  console.log('ODDAVA_RESULT '+JSON.stringify({file:output.file,width:output.width,errors:output.errors,checks:Object.keys(output.checks).length,storage:output.storageAvailable,networkAssets:output.networkAssetRequests.length}));
  console.log('ODDAVA_CONTRAST '+JSON.stringify(Object.fromEntries(Object.entries(output.contrast).map(([name,result])=>[name,{minimum:result.min,failures:result.failures}]))));
  console.log('ODDAVA_FONTS '+JSON.stringify(output.fonts));
})();
</script>`;
for (const [file, text] of Object.entries(html)) {
  writeFileSync(
    resolve(dir, 'qa-pages', file),
    text.replace(
      '</body>',
      check
        .replace('FILE', JSON.stringify(file))
        .replaceAll('FILE', JSON.stringify(file)) + '</body>',
    ),
  );
}
writeFileSync(
  resolve(dir, 'static-qa.json'),
  JSON.stringify(
    {
      noteCount,
      mockCount: files.length,
      localLinksAndAnchors: 'pass',
      embeddedFonts: 'pass',
      remoteAssets: 'none',
      source: 'node design-directions/qa.mjs',
    },
    null,
    2,
  ),
);
console.log(
  'Static QA passed; instrumented copies generated for sanctioned HTML renderer.',
);
