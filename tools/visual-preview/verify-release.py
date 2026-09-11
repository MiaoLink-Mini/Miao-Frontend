"""Geometry regression for the restored icon/alignment work. Not a WeChat renderer."""
from pathlib import Path
import argparse, json, hashlib
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--html',type=Path,required=True)
p.add_argument('--output',type=Path,required=True)
p.add_argument('--chromium',required=True)
p.add_argument('--part',choices=['widths','themes','edges'],required=True)
a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
html=a.html.read_text();checks=[];errors=[]
routes=json.loads((Path(__file__).resolve().parents[2]/'miniprogram/app.json').read_text())['pages']
def check(name,ok,detail=None):
    checks.append({'name':name,'passed':bool(ok),'detail':detail})
    if not ok:print('FAIL',name,detail,flush=True)
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=a.chromium,args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':390,'height':844},device_scale_factor=1)
    page.on('pageerror',lambda error:errors.append(str(error)))
    def show(name,theme='ember'):
        boot='<script>window.__PREVIEW_QUERY='+json.dumps('?page='+name+'&theme='+theme)+';</script>'
        page.set_content(html.replace('<head>','<head>'+boot,1),wait_until='load')
        page.wait_for_function('window.__preview&&window.__preview.ready')
        page.evaluate('window.__preview.setMotion("off")');page.evaluate('document.fonts.ready')
        page.wait_for_timeout(25)
    geometry="""() => {
      function shown(e){for(let p=e;p;p=p.parentElement){const c=getComputedStyle(p);if(c.display==='none'||c.visibility==='hidden')return false;}return true;}
      const bad=[],hidden=[];
      for(const e of document.querySelectorAll('ui-icon img')){
        if(!shown(e)){hidden.push(e.parentElement.getAttribute('name'));continue;}
        const r=e.getBoundingClientRect();if(r.width<=0||r.height<=0||!e.complete||!e.naturalWidth)bad.push({name:e.parentElement.getAttribute('name'),width:r.width,height:r.height});
      }
      return {overflow:document.documentElement.scrollWidth>innerWidth+1,badIcons:bad,hiddenIcons:hidden,expressions:window.__preview.expressionErrors};
    }"""
    if a.part=='widths':
        for width,height in [(320,700),(360,780),(390,844),(430,932)]:
            print('WIDTH',width,flush=True)
            page.set_viewport_size({'width':width,'height':height})
            for route in routes:
                name=route.split('/')[1];show(name)
                g=page.evaluate(geometry)
                check(name+' geometry '+str(width),not g['overflow'] and not g['badIcons'] and not g['expressions'],g)
    if a.part=='themes':
        page.set_viewport_size({'width':390,'height':844})
        for route in routes:
            name=route.split('/')[1];show(name)
            print('THEMES',name,flush=True)
            for theme in ['ember','paper','ocean','iris','forest','mono']:
                page.evaluate('(theme)=>window.__preview.setTheme(theme)',theme)
                page.wait_for_timeout(30)
                g=page.evaluate(geometry)
                check(name+' theme '+theme,not g['overflow'] and not g['badIcons'] and not g['expressions'],g)
    if a.part=='edges':
        # The three decorative arrows are intentionally display:none <=350px.
        # Assert that exact design AND full tile hit targets, instead of treating
        # every hidden image's zero-sized rectangle as a visible layout failure.
        page.set_viewport_size({'width':320,'height':700});show('home')
        hidden=page.locator('.metric-label ui-icon').evaluate_all('(items)=>items.map(e=>getComputedStyle(e).display)')
        tiles=page.locator('.metric-tile').evaluate_all('(items)=>items.map(e=>({height:e.getBoundingClientRect().height,text:e.innerText}))')
        check('320px home hides exactly three decorative metric arrows',hidden==['none','none','none'],hidden)
        check('320px home metric labels and touch targets remain visible',len(tiles)==3 and all(t['height']>=44 and len(t['text'])>1 for t in tiles),tiles)
        for width in [320,360,390,430]:
            page.set_viewport_size({'width':width,'height':844});show('home')
            rows=page.locator('.surface-list .row-button').evaluate_all("""items=>items.map(e=>{const r=e.getBoundingClientRect(),i=e.querySelector('.row').getBoundingClientRect(),c=getComputedStyle(e);const tail=e.querySelector('.state-label,.chevron').getBoundingClientRect();return{contentWidth:r.width-parseFloat(c.paddingLeft)-parseFloat(c.paddingRight)-parseFloat(c.borderLeftWidth)-parseFloat(c.borderRightWidth),rowWidth:i.width,rightGap:i.right-tail.right};})""")
            check('device/project trailing slots fill row at '+str(width),len(rows)==5 and all(abs(r['contentWidth']-r['rowWidth'])<1.1 and abs(r['rightGap'])<1.1 for r in rows),rows)
            for index in range(4):
                page.locator('.tab-item').nth(index).click();page.wait_for_timeout(50)
                result=page.evaluate("""()=>{const a=document.querySelector('.tab-slider').getBoundingClientRect(),b=document.querySelector('.tab-item.current').getBoundingClientRect();return {dx:Math.abs((a.left+a.right-b.left-b.right)/2),height:b.height};}""")
                check('tab slider '+str(index)+' / '+str(width),result['dx']<1.1 and result['height']>=44,result)
        page.set_viewport_size({'width':320,'height':480});show('home');page.evaluate('window.__preview.showThemes()');page.wait_for_timeout(70)
        modal=page.locator('.theme-sheet').bounding_box();close=page.locator('.theme-sheet .sheet-close').bounding_box()
        check('short-screen theme sheet and close button stay accessible',modal['y']>=-1 and close['y']>=0 and close['y']+close['height']<=480,{'sheet':modal,'close':close})
        page.screenshot(path=str(a.output/'theme-short.png'))
        page.set_viewport_size({'width':390,'height':844});show('home')
        # Long labels must remain bounded while status stays in its reserved slot.
        page.evaluate("""()=>{const rt=window.__preview.runtime;rt.gateway.data.nodes[0].name='A-very-long-host-name-'.repeat(9);rt.gateway.data.projects[0].name='A-long-project-'.repeat(9);rt.gateway.data.projects[0].branch='feature/long-branch-'.repeat(9);window.__preview.root().refresh();}""")
        page.wait_for_timeout(50);g=page.evaluate(geometry);check('long host project branch names do not overflow',not g['overflow'] and not g['badIcons'],g)
        page.screenshot(path=str(a.output/'home-long.png'),full_page=True)
    check('no uncaught browser errors',not errors,errors)
    browser.close()
result={'preview_sha256':hashlib.sha256(a.html.read_bytes()).hexdigest(),'mode':'Offline WXML/WXSS approximation; no live service or native renderer acceptance','passed':sum(c['passed'] for c in checks),'failed':sum(not c['passed'] for c in checks),'checks':checks}
(a.output/('qa-release-'+a.part+'.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print('CHECKS',len(checks),'PASS',result['passed'],'FAIL',result['failed'])
raise SystemExit(1 if result['failed'] else 0)
