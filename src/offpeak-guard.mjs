// 译价 / Off-Peak Guard — DeepSeek 峰谷时段 + 推理强度 双维度成本守卫（DSH patch-layer 插件）
//
// 功能：
//  1) agent/pre-step 守卫：北京峰时（周一至周五 9-12 / 14-18，不含法定节假日）在每一轮
//     用户请求开始时注入一条提醒——峰时不启动翻译/批量子代理，只做便宜活；谷时不注入（零开销）。
//  2) Web GUI 徽标：可拖动、点击展开的浮层，显示当前窗口（峰/谷 + 倍率 + 倒计时）、
//     成本三口径对比、缓存命中率、峰谷调用占比、最近 5 天按天费用。
//  3) 后台成本扫描：定期拉起外部运行时 node 运行 scan.cjs，汇总会话日志 token 用量并写
//     status.json（供徽标与 cost_report.js 共用）。任何失败都被吞掉，绝不影响主程序。
//
// 注入 UI 用的是官方 webserver/index-inject 事件（不要用 tapIndex——它只作用于原始 markup，
// 常拿到重定向页）。扫描走外部 node，因此与 DSH 内嵌 Node 版本解耦。
export const name = 'offpeak-guard'

import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const TZ_OFFSET_MS = 8 * 3600 * 1000
const SCAN_INTERVAL_MS = 30 * 60 * 1000   // 全量重扫较重，后台 30 分钟一次；要新鲜数据用 cost_report.js --refresh
const HOME = os.homedir()
const GUARD_DIR = path.join(HOME, '.dsh', 'offpeak-guard')
const STATUS_JSON = path.join(GUARD_DIR, 'status.json')
const SCAN_SCRIPT = path.join(GUARD_DIR, 'scan.cjs')
const SESSIONS_ROOT = path.join(HOME, '.dsh', 'sessions')

function beijing(ms) { return new Date((ms == null ? Date.now() : ms) + TZ_OFFSET_MS) }
function loadHolidays() {
  const s = process.env.DSH_HOLIDAYS || ''
  const set = new Set()
  for (let h of s.replace(/;/g, ',').split(',')) { h = h.trim(); if (h) set.add(h) }
  return set
}
const HOLIDAYS = loadHolidays()

function isPeak(ms) {
  const d = beijing(ms)
  if (HOLIDAYS.has(d.toISOString().slice(0, 10))) return false
  const dow = d.getUTCDay()
  if (dow === 0 || dow === 6) return false
  const h = d.getUTCHours()
  return (h >= 9 && h < 12) || (h >= 14 && h < 18)
}
function nextChange(ms) {
  const cur = isPeak(ms)
  let probe = beijing(ms).setSeconds(0, 0) + 60000
  for (let i = 0; i < 8 * 24 * 60; i++, probe += 60000) {
    if (isPeak(probe) !== cur) return probe - TZ_OFFSET_MS
  }
  return probe - TZ_OFFSET_MS
}
function fmtCountdown(ms) {
  const m = Math.max(0, Math.round((ms - Date.now()) / 60000))
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60
  if (d > 0) return `${d}天${h}小时`
  if (h > 0) return `${h}小时${mm}分`
  return `${mm}分钟`
}
function pad(n) { return String(n).padStart(2, '0') }
function beijingHM(ms) { const d = beijing(ms); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` }

// ---- external node discovery (for the background scanner) ----
function findNode() {
  const cands = []
  try {
    const rt = path.join(HOME, '.dsh', 'dsh-runtimes')
    for (const d of fs.readdirSync(rt)) {
      cands.push(path.join(rt, d, 'dependencies', 'node', 'bin', 'node.exe'))
    }
  } catch (e) {}
  for (const c of cands) { try { if (fs.existsSync(c)) return c } catch (e) {} }
  return null
}

let scanTimer = null
function runScan() {
  try {
    const node = findNode()
    if (!node || !fs.existsSync(SCAN_SCRIPT) || !fs.existsSync(SESSIONS_ROOT)) return
    const child = spawn(node, [SCAN_SCRIPT, SESSIONS_ROOT, STATUS_JSON], {
      env: { ...process.env, DSH_HOLIDAYS: process.env.DSH_HOLIDAYS || '' },
      detached: true, stdio: 'ignore',
    })
    child.on('error', () => {})
    child.unref()
  } catch (e) {}
}
function startScanner() {
  try { fs.mkdirSync(GUARD_DIR, { recursive: true }) } catch (e) {}
  setTimeout(runScan, 3000)
  scanTimer = setInterval(runScan, SCAN_INTERVAL_MS)
  if (scanTimer.unref) scanTimer.unref()
}

function readStatus() {
  try { return JSON.parse(fs.readFileSync(STATUS_JSON, 'utf8')) } catch (e) { return null }
}

// ---- 1) peak guard via agent/pre-step ----
let lastUserSig = null
function lastUserMessage(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    const role = m && (m.role || (m.source && m.source.kind))
    if (role === 'user') return m
  }
  return null
}
function userSig(m) {
  if (!m) return null
  if (m.id) return 'id:' + m.id
  const txt = Array.isArray(m.content) ? m.content.map(c => (c && c.text) || '').join('') : String(m.content || '')
  return 't:' + txt.length + ':' + txt.slice(0, 80)
}
function guardMessage() {
  const now = Date.now()
  const peak = isPeak(now)
  if (!peak) return null                    // 谷时不注入，零开销
  const flip = nextChange(now)
  const when = beijingHM(flip)
  const cd = fmtCountdown(flip)
  const text =
    `[成本守卫] 当前北京时间 ${beijingHM(now)} 为峰时（周一至周五 9-12 / 14-18 点，1× 价格；${when} 后转谷时，约 ${cd}）。` +
    `按汉化工作流约定：峰时不启动翻译/批处理类子代理，只做读写文件、跑脚本、校验等开销低的工作；` +
    `如确需现在跑批量任务，请先向用户确认。挪到谷时可省 50%。`
  return { source: { kind: 'plugin', plugin: 'offpeak-guard', form: 'window-guard' }, content: [{ type: 'text', text }] }
}

// ---- 2) web badge via webserver/index-inject ----
// 收起态：一行摘要（峰/谷 + 倒计时 + 实付）。点击展开面板，含：
//   窗口详情 / 成本三口径对比 / 峰谷调用占比 / 按天明细 / 计价规则与档位建议。
// 面板状态存 localStorage，刷新页面后保持。
const BADGE_JS = String.raw`(function(){
if(window.__DSH_COST_GUARD__)return;window.__DSH_COST_GUARD__=1;
function cfg(){try{return (window.__CG_BOOT__&&window.__CG_BOOT__())||{holidays:[],status:null};}catch(e){return {holidays:[],status:null};}}
function bj(ms){return new Date((ms==null?Date.now():ms)+8*3600e3);}
function hol(d){return (cfg().holidays||[]).indexOf(d)>=0;}
function isPeak(ms){var d=bj(ms),w=d.getUTCDay(),h=d.getUTCHours();if(w===0||w===6)return false;if(hol(d.toISOString().slice(0,10)))return false;return (h>=9&&h<12)||(h>=14&&h<18);}
function next(ms){var cur=isPeak(ms),p=bj(ms);p.setSeconds(0,0);p=p.getTime()+6e4;for(var i=0;i<8*24*60;i++,p+=6e4){if(isPeak(p)!==cur)return p-8*3600e3;}return p-8*3600e3;}
function cd(ms){var m=Math.max(0,Math.round((ms-Date.now())/6e4)),d=Math.floor(m/1440),h=Math.floor(m%1440/60),mm=m%60;return d>0?d+'天'+h+'小时':(h>0?h+'小时'+mm+'分':mm+'分钟');}
function p2(n){return (n<10?'0':'')+n;}
function hm(ms){var d=bj(ms);return p2(d.getUTCHours())+':'+p2(d.getUTCMinutes());}
function ymd(ms){var d=bj(ms);return p2(d.getUTCMonth()+1)+'-'+p2(d.getUTCDate());}
function mt(n){n=n||0;if(n<1e3)return n;if(n<1e6)return (n/1e3).toFixed(1)+'K';return (n/1e6).toFixed(2)+'M';}
function yuan(n){return '¥'+Number(n||0).toFixed(2);}
var OPEN_KEY='offpeak-guard-open';
var POS_KEY='offpeak-guard-pos';
function isOpen(){try{return localStorage.getItem(OPEN_KEY)==='1';}catch(e){return false;}}
function setOpen(v){try{localStorage.setItem(OPEN_KEY,v?'1':'0');}catch(e){}}
function getPos(){try{var s=localStorage.getItem(POS_KEY);if(!s)return null;var p=JSON.parse(s);return (typeof p.x==='number'&&typeof p.y==='number')?p:null;}catch(e){return null;}}
function setPos(x,y){try{localStorage.setItem(POS_KEY,JSON.stringify({x:Math.round(x),y:Math.round(y)}));}catch(e){}}
function clampPos(x,y,w,h){
  var vw=window.innerWidth||1200,vh=window.innerHeight||800;
  var nx=Math.max(0,Math.min(x,vw-w)),ny=Math.max(0,Math.min(y,vh-h));
  return {x:nx,y:ny};
}
// 检查一个矩形是否与页面上"有价值"的元素重叠（按钮/输入框/链接等），用于自动避让。
function overlapsUI(r){
  try{
    var pts=[[r.x+r.w-6,r.y+6],[r.x+6,r.y+6],[r.x+r.w-6,r.y+r.h-6],[r.x+6,r.y+r.h-6]];
    for(var i=0;i<pts.length;i++){
      var el=document.elementFromPoint(pts[i][0],pts[i][1]);
      if(!el)continue;
      if(el.closest&&el.closest('#offpeak-guard-badge'))continue;
      if(el.closest&&el.closest('button,a,input,textarea,select,[role="button"],[contenteditable="true"]'))return true;
    }
  }catch(e){}
  return false;
}
function mk(tag,sty,txt){var e=document.createElement(tag);if(sty)e.style.cssText=sty;if(txt!=null)e.textContent=txt;return e;}
function row(t,label,val,em){var r=mk('div','display:flex;justify-content:space-between;gap:10px;padding:2px 0;');
  r.appendChild(mk('span','opacity:.8',label));
  var v=mk('span',(em?'font-weight:700':'')+';font-variant-numeric:tabular-nums',val);r.appendChild(v);t.appendChild(r);return r;}
function detail(st,now,peak,flip){
  var d=mk('div','margin-top:7px;padding-top:7px;border-top:1px solid rgba(255,255,255,.28);text-align:left;');
  if(!st||!st.cost){d.appendChild(mk('div','opacity:.8','成本快照不可用（后台扫描尚未完成）'));return d;}
  var c=st.cost,t=st.totals||{};
  d.appendChild(mk('div','font-weight:700;margin-bottom:3px','成本（'+st.model+'）'));
  row(d,'实际（混合时段）',yuan(c.actualMixed),true);
  row(d,'若全部谷时',yuan(c.allIdle)+'（省 '+yuan(c.actualMixed-c.allIdle)+'）');
  row(d,'若全部高峰',yuan(c.allPeak));
  row(d,'v4-pro 全谷 / 全峰',yuan(c.proIdle)+' / '+yuan(c.proPeak));
  d.appendChild(mk('div','opacity:.8;margin:6px 0 3px','用量'));
  row(d,'调用次数',String(st.calls||0));
  row(d,'输入·未命中',mt(t.miss));
  row(d,'输入·缓存命中',mt(t.hit));
  row(d,'输出（含思考）',mt(t.out));
  var tot=(t.hit||0)+(t.miss||0);
  row(d,'缓存命中率',tot?((t.hit/tot*100).toFixed(1)+'%'):'—');
  var pc=(st.peakT&&st.peakT.calls)||0,ic=(st.idleT&&st.idleT.calls)||0,ac=pc+ic;
  row(d,'峰/谷调用占比',ac?((pc/ac*100).toFixed(0)+'% / '+(ic/ac*100).toFixed(0)+'%'):'—');
  if(st.perDay){
    var days=Object.keys(st.perDay).sort().slice(-5);
    if(days.length){
      d.appendChild(mk('div','opacity:.8;margin:6px 0 3px','最近 5 天'));
      var F=(st.pricing&&st.pricing['deepseek-flash'])||null;
      for(var i=0;i<days.length;i++){
        var k=days[i],x=st.perDay[k],fee='—';
        if(F){
          var M=1e6;
          fee=yuan((x.pkMiss||0)/M*F.peak.miss+(x.pkHit||0)/M*F.peak.hit+(x.pkOut||0)/M*F.peak.out
                 +((x.miss-(x.pkMiss||0))/M*F.idle.miss)+((x.hit-(x.pkHit||0))/M*F.idle.hit)+((x.out-(x.pkOut||0))/M*F.idle.out));
        }
        row(d,k+'  '+x.calls+' 次',fee);
      }
    }
  }
  d.appendChild(mk('div','opacity:.8;margin:6px 0 3px','规则'));
  d.appendChild(mk('div','font-size:10px;opacity:.85;line-height:1.45',
    '峰时=周一至周五（不含法定节假日）09-12 / 14-18，其余含周末节假日全天为谷时（0.5×）。'+
    '推理强度：批量首翻 off、术语/审校 low、疑难句 high；思考内容按输出计费。'));
  if(st.generatedAt){
    d.appendChild(mk('div','font-size:10px;opacity:.7;margin-top:5px','快照 '+ymd(Date.parse(st.generatedAt))+' '+hm(Date.parse(st.generatedAt))+' · 刷新页面更新'));
  }
  return d;
}
function render(){
  var old=document.getElementById('offpeak-guard-badge');if(old)old.remove();
  var now=Date.now(),peak=isPeak(now),flip=next(now),st=cfg().status,open=isOpen();
  var box=mk('div',null,null);box.id='offpeak-guard-badge';
  box.style.cssText='position:fixed;z-index:2147483000;font:12px/1.5 system-ui,sans-serif;color:#fff;'+
    'padding:6px 9px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.35);max-width:300px;'+
    'text-align:right;cursor:grab;user-select:none;transition:background .2s;opacity:.96;';
  box.style.background=peak?'#c0392b':'#1e8449';
  box.title='点击展开详情 · 按住可拖动到别处';

  var head=mk('div','display:flex;align-items:center;justify-content:flex-end;gap:6px;');
  head.appendChild(mk('span','font-weight:700',(peak?'🔴 峰时 1×':'🟢 谷时 0.5×')));
  head.appendChild(mk('span','opacity:.9','北京 '+hm(now)));
  head.appendChild(mk('span','opacity:.65;font-size:10px',open?'▾':'▸'));
  box.appendChild(head);
  box.appendChild(mk('div','opacity:.92;font-size:11px','下次切换 '+hm(flip)+'（约 '+cd(flip)+'）'));
  if(st&&st.cost){
    box.appendChild(mk('div','opacity:.92;font-size:11px','实付 '+yuan(st.cost.actualMixed)+' · 全谷 '+yuan(st.cost.allIdle)+' · 全峰 '+yuan(st.cost.allPeak)));
    if(!open)box.appendChild(mk('div','opacity:.65;font-size:10px','点击展开 · 可拖动'));
  }else{
    box.appendChild(mk('div','opacity:.75;font-size:10px','成本快照不可用'));
  }
  if(open)box.appendChild(detail(st,now,peak,flip));

  // 先挂到 body 以便量尺寸，再定位
  (document.body||document.documentElement).appendChild(box);
  positionBox(box);

  // ---- 拖动：按住拖动，松开记住位置（拖动阈值 4px，避免把点击误判为拖动） ----
  // document 级监听器在每次 mousedown 时挂载、手势结束时卸掉；
  // 用 window.__CG_DRAG_CLEANUP__ 记录当前手势的清理函数，render() 重建元素前后都能兜底。
  if(window.__CG_DRAG_CLEANUP__){try{window.__CG_DRAG_CLEANUP__();}catch(e){}window.__CG_DRAG_CLEANUP__=null;}
  var drag=null,onMove=null,onUp=null;
  function cleanup(){
    if(onMove)document.removeEventListener('mousemove',onMove,true);
    if(onUp)document.removeEventListener('mouseup',onUp,true);
    onMove=onUp=null;drag=null;
    if(window.__CG_DRAG_CLEANUP__===cleanup)window.__CG_DRAG_CLEANUP__=null;
  }
  box.addEventListener('mousedown',function(ev){
    ev.stopPropagation();
    if(ev.button!==0)return;
    cleanup();                                   // 清掉上一个可能残留的手势
    var r=box.getBoundingClientRect();
    drag={sx:ev.clientX,sy:ev.clientY,ox:r.left,oy:r.top,moved:false};
    box.style.cursor='grabbing';box.style.transition='none';
    ev.preventDefault();

    onMove=function(e){
      if(!drag)return;
      var dx=e.clientX-drag.sx,dy=e.clientY-drag.sy;
      if(!drag.moved&&Math.abs(dx)<4&&Math.abs(dy)<4)return;
      drag.moved=true;
      var rr=box.getBoundingClientRect();
      var p=clampPos(drag.ox+dx,drag.oy+dy,rr.width,rr.height);
      box.style.left=p.x+'px';box.style.top=p.y+'px';box.style.right='auto';
    };
    onUp=function(){
      if(!drag)return;
      var moved=drag.moved;
      var rr=box.getBoundingClientRect();
      var pos=clampPos(rr.left,rr.top,rr.width,rr.height);
      cleanup();
      box.style.cursor='grab';
      if(moved){
        setPos(pos.x,pos.y);                     // 拖动：只记位置，不切换展开
      }else{
        setOpen(!isOpen());render();             // 未移动 = 点击，切换展开
      }
    };
    document.addEventListener('mousemove',onMove,true);
    document.addEventListener('mouseup',onUp,true);
    window.__CG_DRAG_CLEANUP__=cleanup;
  });
  box.addEventListener('click',function(ev){ev.stopPropagation();});  // 展开由 mouseup 处理
}
// 计算并应用位置：优先用已保存位置；否则放到左下角，并避开已有控件。
function positionBox(box){
  var r=box.getBoundingClientRect();
  var w=r.width||300,h=r.height||60;
  var saved=getPos();
  var vw=window.innerWidth||1200,vh=window.innerHeight||800;
  if(saved){
    var p=clampPos(saved.x,saved.y,w,h);
    box.style.left=p.x+'px';box.style.top=p.y+'px';box.style.right='auto';box.style.bottom='auto';
    return;
  }
  // 候选：左下 → 右下 → 左上 → 右上（均留 12px 边距），选第一个不压控件的
  var cands=[
    {x:12,y:vh-h-12},
    {x:vw-w-12,y:vh-h-12},
    {x:12,y:12},
    {x:vw-w-12,y:12},
  ];
  var pick=cands[0];
  for(var i=0;i<cands.length;i++){
    var c=clampPos(cands[i].x,cands[i].y,w,h);
    if(!overlapsUI({x:c.x,y:c.y,w:w,h:h})){pick=c;break;}
  }
  pick=clampPos(pick.x,pick.y,w,h);
  box.style.left=pick.x+'px';box.style.top=pick.y+'px';box.style.right='auto';box.style.bottom='auto';
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',render);else render();
setInterval(function(){
  var b=document.getElementById('offpeak-guard-badge');
  if(!b)return;
  if(!getPos())positionBox(b);          // 未手动定位时跟随窗口尺寸变化
  else{var r=b.getBoundingClientRect();var p=clampPos(r.left,r.top,r.width,r.height);b.style.left=p.x+'px';b.style.top=p.y+'px';}
},30000);
})();`

// global 行的 value 必须是字符串（会被渲染成赋值表达式），返回一个惰性 IIFE 供页面取用。
function badgeGlobalScript() {
  const st = readStatus()
  const hol = JSON.stringify([...HOLIDAYS])
  const status = st ? JSON.stringify(st).replace(/</g, '\\u003c') : 'null'
  return '(function(){var H=' + hol + ';var S=' + status + ';return function(){return {holidays:H,status:S};};})()'
}

// ---- apply ----
// 诊断日志：写到 ~/\.dsh/offpeak-guard/guard.log，用来确认插件被加载、各钩子是否注册成功。
const LOG_FILE = path.join(GUARD_DIR, 'guard.log')
function log(msg) {
  try {
    fs.mkdirSync(GUARD_DIR, { recursive: true })
    fs.appendFileSync(LOG_FILE, new Date().toISOString() + '  ' + msg + '\n', 'utf8')
  } catch (e) {}
}

export function apply(ctx) {
  log('apply() entered; pid=' + process.pid)
  try { startScanner(); log('scanner started (node=' + (findNode() || 'MISSING') + ')') }
  catch (e) { log('scanner FAILED: ' + (e && e.message)) }

  try {
    ctx.on('agent/pre-step', async ({ messages }, next) => {
      try {
        const decision = await next()
        if (!decision || decision.kind === 'reject') return decision
        if (!Array.isArray(decision.messages)) return decision
        const um = lastUserMessage(decision.messages)
        const sig = userSig(um)
        if (!sig || sig === lastUserSig) return decision
        const gm = guardMessage()               // 仅峰时返回提醒；谷时返回 null
        if (!gm) { lastUserSig = sig; return decision }
        lastUserSig = sig
        return { ...decision, messages: [...decision.messages, gm] }
      } catch (e) {
        try { return await next() } catch (e2) { throw e2 }
      }
    })
    log('agent/pre-step hook registered')
  } catch (e) {
    log('pre-step hook FAILED: ' + (e && e.message))
  }

  // 徽标注入：官方机制是 webServer 的 'webserver/index-inject' 事件。
  // 每次渲染 index 时投递一张 row 表，插件往里 push；行 schema（见 boots 实现）：
  //   { kind:'script', placement:'head', text }  内联脚本
  //   { kind:'global', name, value }             渲染成 window 赋值
  // 比 tapIndex 可靠（tapIndex 只作用于原始 markup，可能拿到重定向页）。
  try {
    ctx.inject(['webServer'], (webCtx) => {
      webCtx.effect(
        () => webCtx.on('webserver/index-inject', (table) => {
          try {
            table.push({ kind: 'global', name: '__CG_BOOT__', value: badgeGlobalScript() })
            table.push({ kind: 'script', placement: 'head', text: BADGE_JS })
            log('index-inject rows pushed (table=' + table.length + ')')
          } catch (e) { log('index-inject push FAILED: ' + (e && e.message)) }
        }),
        'offpeak-guard: index badge rows',
      )
      log('webserver/index-inject subscriber registered')
    })
    log('webServer inject requested')
  } catch (e) {
    log('web badge FAILED: ' + (e && e.message))
  }
  log('apply() done')
}
