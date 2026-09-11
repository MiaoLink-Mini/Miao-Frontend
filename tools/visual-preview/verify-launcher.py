"""Standalone preview launcher checks, without a native WeChat runtime."""
from pathlib import Path
import argparse,json
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--html',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--chromium',required=True);a=p.parse_args()
a.output.mkdir(parents=True,exist_ok=True);checks=[];errors=[]
def check(name,ok):
 checks.append({'name':name,'passed':bool(ok)})
 if not ok:print('FAIL',name,flush=True)
with sync_playwright() as pw:
 b=pw.chromium.launch(executable_path=a.chromium,args=['--no-sandbox','--disable-dev-shm-usage'])
 page=b.new_page(viewport={'width':1120,'height':1080});page.on('pageerror',lambda e:errors.append(str(e)))
 page.route('https://**',lambda route:route.abort());page.set_content(a.html.read_text(),wait_until='load');f=page.frame_locator('#preview')
 f.locator('.app-surface').first.wait_for();check('default Coding page',f.locator('.session-screen').count()==1)
 check('24 registered page choices',page.locator('#page option').count()==24)
 check('six themes',page.locator('#theme option').count()==6)
 check('three motion modes',page.locator('#motion option').count()==3)
 page.select_option('#page','home');f.locator('.metric-tile').first.wait_for();check('select overview',f.locator('.metric-tile').count()==3)
 page.select_option('#theme','paper');f.locator('.app-surface.paper').first.wait_for();check('switch theme',f.locator('.app-surface.paper').count()==1)
 page.select_option('#motion','off');f.locator('.app-surface').first.wait_for();check('motion disabled',f.locator('.app-surface').first.evaluate('(e)=>e.classList.contains("motion-off")'))
 page.select_option('#width','320');f.locator('.metric-tile').first.wait_for();check('320px viewport',page.locator('#preview').evaluate('(e)=>Math.round(e.getBoundingClientRect().width)')==320)
 page.set_viewport_size({'width':360,'height':800});check('outer mobile layout does not overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
 check('iframe denies parent same-origin access',page.locator('#preview').get_attribute('sandbox')=='allow-scripts')
 check('no uncaught browser errors',not errors)
 page.screenshot(path=str(a.output/'launcher-mobile.png'))
 b.close()
result={'passed':sum(c['passed'] for c in checks),'failed':sum(not c['passed'] for c in checks),'checks':checks,'errors':errors,'native_wechat':False}
(a.output/'qa-launcher.json').write_text(json.dumps(result,indent=2));print(result)
raise SystemExit(1 if result['failed'] else 0)
