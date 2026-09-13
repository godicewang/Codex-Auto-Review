// Minimal DOM/event harness for the actual dashboard script. This exercises
// request targeting; it is not a browser rendering or GUI-injection test.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
export const flush=()=>new Promise(resolve=>setImmediate(resolve));
class Element{
 constructor(){this.dataset={};this.elements={};this.children=[];this.value='';this.hidden=false;this.classList={toggle(){}};}
 append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}
 setAttribute(key,value){this[key]=value;}showModal(){this.open=true;}close(){this.open=false;}
}
export async function dashboard(source=path.resolve('plugins/autoreview/web')){
 const nodes=new Map([...fs.readFileSync(path.join(source,'index.html'),'utf8').matchAll(/id="([^"]+)"/g)].map(([,id])=>[id,new Element()]));
 nodes.get('settings-form').elements={model:new Element(),timeoutSeconds:new Element()};nodes.get('manual-form').elements={requirement:new Element()};
 const project=(id,name)=>({id,name,root:'/fixture/'+name,enabled:true,model:'',timeoutSeconds:300});
 let state={projects:[project('a'.repeat(20),'项目 A'),project('b'.repeat(20),'项目 B')],runs:[],adviceQueue:[],desktopContext:{projectId:'a'.repeat(20),connectedAt:'one'}};
 const requests=[];let stream;
 class Events{constructor(){stream=this;this.listeners={};}addEventListener(name,fn){this.listeners[name]=fn;}}
 const storage=()=>{const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};};
 const context=vm.createContext({URLSearchParams,Date,console,window:{},localStorage:storage(),sessionStorage:storage(),location:{hash:'#token='+'a'.repeat(64),pathname:'/'},history:{replaceState(){}},EventSource:Events,
 document:{documentElement:{},querySelector:selector=>{const node=nodes.get(selector.slice(1));if(!node)throw new Error('Unknown element '+selector);return node;},querySelectorAll:()=>[],createElement:()=>new Element(),createTextNode:text=>({textContent:text})},
 fetch:async(route,options)=>{requests.push({route,method:options.method,body:options.body?JSON.parse(options.body):undefined});return {ok:true,json:async()=>route==='/api/state'?structuredClone(state):{id:'test-review',status:'queued'}};}
 });
 vm.runInContext(fs.readFileSync(path.join(source,'app.js'),'utf8'),context);await flush();stream.onopen();
 return {nodes,requests,async publish(update){state={...state,...update};stream.listeners.state({data:JSON.stringify(state)});await flush();},async switchByAction(index){state.desktopContext={projectId:state.projects[index].id,connectedAt:String(Date.now())+'-'+index};stream.listeners.state({data:JSON.stringify(state)});await flush();},async submit(kind){const form=nodes.get(kind+'-form');form.onsubmit({preventDefault(){},target:form});await flush();},ids:state.projects.map(p=>p.id)};
}
export const nodeText=node=>[node.textContent||'',...(node.children||[]).map(nodeText)].join(' ');
