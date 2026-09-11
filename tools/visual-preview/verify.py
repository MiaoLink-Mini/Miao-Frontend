from pathlib import Path
import json, time
from playwright.sync_api import sync_playwright
import argparse
parser=argparse.ArgumentParser(description="Offline WXML/WXSS browser approximation; not native WeChat acceptance.")
parser.add_argument('--html',type=Path,required=True)
parser.add_argument('--output',type=Path,required=True)
parser.add_argument('--chromium',default=None,help="Optional installed Chromium executable")
args=parser.parse_args()
html=args.html.read_text()
out=args.output;out.mkdir(parents=True,exist_ok=True)
checks=[]
def check(name,ok,detail=None):
 checks.append({'name':name,'passed':bool(ok),'detail':detail})
 if not ok:print('FAIL',name,detail)
def content(query):return html.replace('<head>','<head><script>window.__PREVIEW_QUERY='+json.dumps(query)+';</script>',1)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 context=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=2)
 page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 def show(query):
  page.set_content(content(query));page.wait_for_function('window.__preview && window.__preview.ready');page.wait_for_timeout(50)
  check(query+' expressions',page.evaluate('window.__preview.expressionErrors.length')==0,page.evaluate('window.__preview.expressionErrors')[:3])
 show('?page=session&theme=ember')
 for theme in ['ember','paper','ocean','iris','forest','mono']:
  page.evaluate('(id)=>window.__preview.setTheme(id)',theme);page.wait_for_timeout(380)
  check('live theme '+theme,page.locator('.app-surface').first.evaluate('(e,id)=>e.classList.contains(id)',theme))
  check('theme width '+theme,page.evaluate('document.body.scrollWidth')<=390)
  page.screenshot(path=str(out/f'coding-{theme}.png'))
 page.evaluate('window.__preview.setTheme("ember");window.__preview.showThemes()');page.wait_for_timeout(400)
 page.screenshot(path=str(out/'themes-ember.png'))
 page.locator('theme-switcher [data-id="paper"]').click();page.wait_for_timeout(360)
 check('theme choice button',page.locator('.app-surface').first.evaluate('(e)=>e.classList.contains("paper")'))
 # Actual component tap toggles motion and is reflected in live CSS.
 page.evaluate('window.__preview.setMotion("off")');page.wait_for_timeout(150)
 check('off removes all active animations',page.evaluate('document.getAnimations().filter(a=>a.playState==="running").length')==0)
 page.evaluate('window.__preview.setMotion("reduced")');page.wait_for_timeout(170)
 check('reduced ends repeating animation',page.evaluate('document.getAnimations().filter(a=>a.playState==="running"&&a.effect.getTiming().iterations===Infinity).length')==0)
 show('?page=session&theme=ember')
 page.locator('event-card .tool-heading').first.click();page.wait_for_timeout(100)
 check('tool expands',page.locator('.tool-expanded').count()==1)
 page.locator('.tool-expanded .terminal-action').last.click()
 check('tool copies full output','export function' in page.evaluate('window.__preview.clipboard'))
 page.locator('event-card .tool-heading').first.click();page.wait_for_timeout(100)
 check('tool collapses',page.locator('.tool-expanded').count()==0)
 page.locator('.diff-summary').click();page.wait_for_timeout(100)
 check('diff card opens actual panel handler',page.evaluate('window.__preview.route')=='pages/panel/index')
 show('?page=panel&theme=paper')
 check('diff metadata initially compact',page.locator('.diff-meta.meta').count()==0)
 page.locator('.diff-tools button').first.click();page.wait_for_timeout(100)
 check('diff metadata can be expanded',page.locator('.diff-meta.meta').count()>=3)
 page.locator('.diff-tools button').first.click();page.locator('.diff-tools button').nth(1).click();page.wait_for_timeout(100)
 check('diff line wrap',page.locator('.code-diff.wrapped').count()==1)
 page.locator('.diff-tools button').last.click()
 check('diff copy includes hidden headers',page.evaluate('window.__preview.clipboard.startsWith("diff --git ")'))
 check('diff inline replacement visible',page.locator('.inline-change').count()>=2)
 page.screenshot(path=str(out/'diff-paper-wrapped.png'),full_page=True)
 show('?page=guide&theme=ocean')
 page.locator('.primary').click();page.wait_for_timeout(100)
 check('guide advances',page.evaluate('window.__preview.root().data.step')==1)
 page.locator('.primary').click();page.wait_for_timeout(100)
 check('guide final step',page.evaluate('window.__preview.root().data.step')==2)
 page.screenshot(path=str(out/'guide-ocean-last.png'))
 page.locator('.primary').click();page.wait_for_timeout(100)
 check('guide finishes to home',page.evaluate('window.__preview.route')=='pages/home/index')
 show('?page=share&theme=iris')
 check('sharing defaults read-only',page.evaluate('window.__preview.root().data.permission')=='read')
 page.locator('[data-id="control"]').click();page.wait_for_timeout(60)
 check('control selected explicitly',page.evaluate('window.__preview.root().data.permission')=='control')
 page.locator('.ttl').last.click();page.wait_for_timeout(60)
 check('custom TTL opens input',page.locator('.custom-ttl input').count()==1)
 page.locator('.custom-ttl input').fill('90');page.wait_for_timeout(60)
 check('custom TTL actual handler',page.evaluate('window.__preview.root().data.minutes')=='90')
 page.locator('.primary').first.click();page.wait_for_timeout(100)
 check('control sharing needs explicit confirmation',page.locator('dialog').count()==1)
 # Compact, normal share screen for delivery.
 show('?page=share&theme=iris');page.wait_for_timeout(380);page.screenshot(path=str(out/'share-iris.png'),full_page=True)
 # Empty/new/stale routes must still render without a horizontal page overflow.
 routes=json.loads((Path(__file__).resolve().parents[2]/'miniprogram/app.json').read_text())['pages']
 for width,height in [(320,700),(390,844),(430,932)]:
  page.set_viewport_size({'width':width,'height':height})
  for route in routes:
   name=route.split('/')[1]
   page.set_content(content('?page='+name+'&theme=paper'));page.wait_for_function('window.__preview && window.__preview.ready');page.wait_for_timeout(20)
   check(f'{name} width {width}',page.evaluate('document.body.scrollWidth')<=width,{'width':page.evaluate('document.body.scrollWidth'),'expressions':page.evaluate('window.__preview.expressionErrors')[:2]})
   check(f'{name} expressions {width}',not page.evaluate('window.__preview.expressionErrors'),page.evaluate('window.__preview.expressionErrors')[:2])
 # Selected screenshots at common mobile viewport.
 page.set_viewport_size({'width':390,'height':844})
 for name,theme in [('home','ember'),('sessions','paper'),('guide','ocean'),('shared','forest'),('me','ember'),('request','ember')]:
  show('?page='+name+'&theme='+theme);page.wait_for_timeout(350);page.screenshot(path=str(out/f'{name}-{theme}.png'),full_page=name not in ['home','sessions'])
 check('no uncaught JS errors',not errors,errors)
 context.close();browser.close()
result={'mode':'In-memory offline HTML approximation of native WXML/WXSS; fictional fixtures; NOT WeChat compiler/device or live backend acceptance.','checks':checks,'passed':sum(c['passed'] for c in checks),'failed':sum(not c['passed'] for c in checks)}
(out/'qa-report.json').write_text(json.dumps(result,indent=2,ensure_ascii=False))
print('CHECKS',len(checks),'PASS',result['passed'],'FAIL',result['failed'])

if result['failed']:raise SystemExit(1)
