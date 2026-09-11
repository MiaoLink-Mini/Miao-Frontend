// Original GoLink Outline icons. One 24-unit grid, 1.75-unit round strokes.
// Geometry is shared by the mini-program and reproducible native-tab PNG build.
// No fonts, third-party icon paths, network fetches or platform glyph substitution.
const line=(x1,y1,x2,y2)=>({type:'line',x1,y1,x2,y2});
const circle=(cx,cy,r,fill=false)=>({type:'circle',cx,cy,r,fill});
const poly=points=>points.slice(1).map((p,i)=>line(...points[i],...p));
function arc(cx,cy,r,start,end,steps=8){const points=[];for(let i=0;i<=steps;i++){const a=(start+(end-start)*i/steps)*Math.PI/180;points.push([+(cx+r*Math.cos(a)).toFixed(3),+(cy+r*Math.sin(a)).toFixed(3)]);}return poly(points);}
function rect(x,y,w,h,r=1.5){return [line(x+r,y,x+w-r,y),...arc(x+w-r,y+r,r,-90,0,4),line(x+w,y+r,x+w,y+h-r),...arc(x+w-r,y+h-r,r,0,90,4),line(x+w-r,y+h,x+r,y+h),...arc(x+r,y+h-r,r,90,180,4),line(x,y+h-r,x,y+r),...arc(x+r,y+r,r,180,270,4)];}
const icons={
 home:[...rect(3.5,3.5,6,6,1.3),...rect(14.5,3.5,6,6,1.3),...rect(3.5,14.5,6,6,1.3),...rect(14.5,14.5,6,6,1.3)],
 sessions:[...rect(3,4,18,16,2),...poly([[6.5,8],[9.5,11],[6.5,14]]),line(12,14,17,14)],
 inbox:[...poly([[3,14],[6,5],[18,5],[21,14],[21,19],[3,19],[3,14],[8,14],[10,16.5],[14,16.5],[16,14],[21,14]])],
 me:[circle(12,7.5,3.5),...arc(12,20,7,180,360,16),line(5,20,19,20)],
 terminal:[...rect(3,4,18,16,2),...poly([[6.5,8],[9.5,11],[6.5,14]]),line(12,14,17,14)],
 plus:[line(12,5,12,19),line(5,12,19,12)],
 minus:[line(5,12,19,12)],
 arrow:[line(4,12,20,12),...poly([[14,6],[20,12],[14,18]])],
 shield:[...poly([[12,3],[20,6],[19,14],[16,18.5],[12,21],[8,18.5],[5,14],[4,6],[12,3]]),...poly([[8,12],[11,15],[16,9]])],
 mark:[...poly([[3,5],[7,19],[12,10],[17,19],[21,5]])],
 monitor:[...rect(3,4,18,13,1.6),line(9,21,15,21),line(12,17,12,21)],
 laptop:[...rect(5,4,14,12,1.5),...poly([[5,16],[2.5,20],[21.5,20],[19,16]])],
 server:[...rect(3.5,3.5,17,7,1.5),...rect(3.5,13.5,17,7,1.5),circle(7,7,.65, true),circle(7,17,.65,true),line(13,7,17,7),line(13,17,17,17)],
 phone:[...rect(6,2.5,12,19,2),line(10,5,14,5),line(11,18.5,13,18.5)],
 folder:[...poly([[3,8],[3,5],[9,5],[12,8],[21,8],[21,20],[3,20],[3,8]])],
 branch:[circle(7,5,2),circle(17,6,2),circle(7,19,2),line(7,7,7,17),...poly([[17,8],[17,10],[15,12],[7,12]])],
 'chevron-right':poly([[9,5],[16,12],[9,19]]),
 'chevron-left':poly([[15,5],[8,12],[15,19]]),
 'chevron-down':poly([[5,9],[12,16],[19,9]]),
 'chevron-up':poly([[5,15],[12,8],[19,15]]),
 'arrow-up':[line(12,20,12,4),...poly([[5,11],[12,4],[19,11]])],
 'arrow-down':[line(12,4,12,20),...poly([[5,13],[12,20],[19,13]])],
 'arrow-left':[line(20,12,4,12),...poly([[10,6],[4,12],[10,18]])],
 'arrow-up-right':[...poly([[6,18],[18,6],[7,6]]),line(18,6,18,17)],
 close:[line(6,6,18,18),line(6,18,18,6)],
 check:poly([[4,12],[9,17],[20,6]]),
 'check-circle':[circle(12,12,9),...poly([[7,12],[10.5,15.5],[17,8.5]])],
 search:[circle(10.5,10.5,6.5),line(15.2,15.2,21,21)],
 filter:[line(3,6,21,6),line(6,12,18,12),line(9,18,15,18)],
 sliders:[line(3,6,6,6),line(10,6,21,6),circle(8,6,2),line(3,12,14,12),line(18,12,21,12),circle(16,12,2),line(3,18,6,18),line(10,18,21,18),circle(8,18,2)],
 palette:[circle(12,12,9),circle(8,8,1,true),circle(15,7,1,true),circle(18,13,1,true),...arc(10,17,3,-100,120,8)],
 share:[circle(6,12,2.5),circle(18,5,2.5),circle(18,19,2.5),line(8.2,10.7,15.8,6.3),line(8.2,13.3,15.8,17.7)],
 more:[circle(5,12,1,true),circle(12,12,1,true),circle(19,12,1,true)],
 clock:[circle(12,12,9),...poly([[12,6],[12,12],[16,14]])],
 refresh:[...arc(12,12,8,-65,110,14),...arc(12,12,8,115,290,14),...poly([[19,3],[19,8],[14,8]]),...poly([[5,21],[5,16],[10,16]])],
 link:[...arc(8,15,4.2,40,315,16),...arc(16,9,4.2,220,495,16),line(8,16,16,8)],
 unlink:[...arc(7,16,4,0,270,14),...arc(17,8,4,180,450,14),line(3,3,21,21)],
 lock:[...rect(5,10,14,11,1.5),...arc(12,9,4,180,360,10),line(8,9,8,10),line(16,9,16,10),line(12,14,12,17)],
 bell:[...arc(12,9,6,180,360,12),...poly([[6,9],[6,15],[4,18],[20,18],[18,15],[18,9]]),...arc(12,19,2,0,180,8)],
 help:[circle(12,12,9),...arc(12,9,3,180,480,14),line(12,12,12,14),circle(12,17,0.55,true)],
 info:[circle(12,12,9),circle(12,7,.6,true),line(12,11,12,17)],
 warning:[...poly([[12,3],[22,20],[2,20],[12,3]]),line(12,8,12,13),circle(12,17,.6,true)],
 stop:rect(6,6,12,12,1.5),
 play:poly([[7,4],[20,12],[7,20],[7,4]]),
 prompt:poly([[7,5],[14,12],[7,19]]),
 enter:[...poly([[19,5],[19,13],[5,13]]),...poly([[10,8],[5,13],[10,18]])],
 copy:[...rect(8,8,12,13,1.5),...poly([[15,5],[15,3],[3,3],[3,16],[5,16]])],
 quote:[...poly([[10,7],[5,7],[5,13],[10,13],[9,17],[5,19]]),...poly([[20,7],[15,7],[15,13],[20,13],[19,17],[15,19]])],
 file:[...poly([[14,3],[4,3],[4,21],[20,21],[20,9],[14,3],[14,9],[20,9]]),line(8,13,16,13),line(8,17,14,17)],
 code:[...poly([[8,6],[2,12],[8,18]]),...poly([[16,6],[22,12],[16,18]]),line(14,4,10,20)],
 diff:[...poly([[4,3],[20,3],[20,21],[4,21],[4,3]]),line(8,8,16,8),line(12,5,12,11),line(8,16,16,16)],
 plan:[...poly([[3,6],[4.5,7.5],[7,4.5]]),line(10,6,21,6),...poly([[3,12],[4.5,13.5],[7,10.5]]),line(10,12,21,12),circle(5,18,1.5),line(10,18,18,18)],
 queue:[line(3,5,17,5),line(3,11,17,11),line(3,17,12,17),...poly([[17,15],[21,18],[17,21]])],
 pin:[...poly([[8,3],[16,3],[15,9],[19,13],[19,15],[5,15],[5,13],[9,9],[8,3]]),line(12,15,12,22)],
 archive:[...rect(3,3,18,5,1),...poly([[5,8],[5,21],[19,21],[19,8]]),line(9,12,15,12)],
 history:[...arc(12,12,8,-130,180,24),...poly([[3,4],[3,9],[8,9]]),...poly([[12,7],[12,12],[16,14]])],
 download:[...poly([[4,16],[4,21],[20,21],[20,16]]),line(12,3,12,15),...poly([[7,10],[12,15],[17,10]])],
 upload:[...poly([[4,16],[4,21],[20,21],[20,16]]),line(12,3,12,15),...poly([[7,8],[12,3],[17,8]])],
 attachment:[...arc(15,8,5,180,360,12),line(20,8,20,15),...arc(13,15,7,0,180,16),line(6,15,6,8),...arc(10,8,4,180,360,12),line(14,8,14,15),...arc(11,15,3,0,180,8),line(8,15,8,9)],
 image:[...rect(3,3,18,18,2),circle(8,8,2),...poly([[4,18],[10,12],[14,16],[17,12],[20,16]])],
 extension:[...rect(3,4,7,7,1.3),...rect(3,14,7,7,1.3),...rect(14,14,7,7,1.3),...poly([[17.5,2.5],[22,7],[17.5,11.5],[13,7],[17.5,2.5]])],
 settings:[circle(12,12,3.2),...poly([[9,3],[15,3],[15,5],[18,7],[20,7],[22,11],[20,13],[19,16],[20,18],[16,21],[14,19],[10,19],[8,21],[4,18],[5,16],[4,13],[2,11],[4,7],[6,7],[9,5],[9,3]])],
 activity:[...poly([[2,12],[6,12],[9,4],[14,20],[18,12],[22,12]])],
 logout:[...poly([[10,3],[4,3],[4,21],[10,21]]),line(9,12,21,12),...poly([[16,7],[21,12],[16,17]])],
 scan:[...poly([[3,9],[3,3],[9,3]]),...poly([[15,3],[21,3],[21,9]]),...poly([[21,15],[21,21],[15,21]]),...poly([[9,21],[3,21],[3,15]]),line(7,12,17,12)],
 spark:[...poly([[12,3],[14.5,9.5],[21,12],[14.5,14.5],[12,21],[9.5,14.5],[3,12],[9.5,9.5],[12,3]])],
 eye:[...arc(12,14,9,210,330,16),...arc(12,10,9,30,150,16),circle(12,12,3)],
 task:[...rect(5,4,14,17,1.5),...rect(9,2,6,4,1),...poly([[8,13],[11,16],[16,10]])],
 trash:[line(5,6,19,6),...poly([[10,6],[10,3],[14,3],[14,6]]),...poly([[7.5,6],[8.5,20],[15.5,20],[16.5,6]]),line(11,10,11,16),line(13,10,13,16)]
};
const STROKE=1.75;
function svg(name,color){
 if(!Object.prototype.hasOwnProperty.call(icons,name))throw Error('Unknown UI icon: '+name);
 if(!/^#[0-9a-fA-F]{6}$/.test(color))throw Error('Icon color must be a six-digit hex value');
 const elements=[];let d='',last=null;
 function flush(){if(d)elements.push('<path d="'+d+'"/>');d='';last=null;}
 for(const shape of icons[name]){
  if(shape.type==='circle'){flush();elements.push('<circle cx="'+shape.cx+'" cy="'+shape.cy+'" r="'+shape.r+'"'+(shape.fill?' fill="'+color+'" stroke="none"':'')+'/>');continue;}
  if(!last||last[0]!==shape.x1||last[1]!==shape.y1)d+='M'+shape.x1+' '+shape.y1;
  d+='L'+shape.x2+' '+shape.y2;last=[shape.x2,shape.y2];
 }
 flush();const body=elements.join('');
 return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="'+color+'" stroke-width="'+STROKE+'" stroke-linecap="round" stroke-linejoin="round">'+body+'</svg>';
}
module.exports={icons,STROKE,svg};
