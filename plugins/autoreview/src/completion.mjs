import {withControl} from './control.mjs';

// Read lifecycle metadata only. Never resume a task, load its messages, or pass
// its conversation to the isolated reviewer. Missing evidence is not completion.
export async function isTurnComplete(run,{control=withControl,signal,timeoutMs}={}) {
  if(run.sessionId==='manual')return true;
  return control(async call=>{
    let cursor;
    for(let page=0;page<4;page++) {
      const result=await call('thread/turns/list',{threadId:run.sessionId,itemsView:'notLoaded',limit:25,sortDirection:'desc',...(cursor?{cursor}:{})});
      const turn=result.data?.find(item=>item.id===run.turnId);
      if(turn)return turn.status==='completed';
      if(!result.nextCursor)return false;
      cursor=result.nextCursor;
    }
    return false;
  },{signal,timeoutMs});
}
