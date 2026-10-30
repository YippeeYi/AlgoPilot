// Preparation check only: serial WASM SQL. This never substitutes for native connections/locks.
import {it,expect,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {database,query,alice} from '../evaluation/database';
import {nativeHistorySql} from '../../scripts/native-node-audit';
vi.mock('server-only',()=>({}));
it('the exact native 013 history query executes on 001–012 and detects changes while migration preserves rows',async()=>{
  const db=await database('202610270012');
  try{
    const id=randomUUID();
    // Administrative fixture seed represents a pre-006 legacy row, not a newly allowed custom API.
    await db.query('insert into public.training_sessions(id,user_id,create_request_id) values($1,$2,$3)',[id,alice,randomUUID()]);
    await query(db,"select public.save_training_draft($1,'thought','synthetic old draft',0)",[id]);
    await query(db,"select public.append_training_thought($1,'synthetic immutable note',1,$2)",[id,randomUUID()]);
    const before=(await db.query(nativeHistorySql)).rows;
    await db.exec(await readFile('supabase/migrations/202610280013_recommendation_training_feedback.sql','utf8'));
    expect((await db.query(nativeHistorySql)).rows).toEqual(before);
    expect((await db.query('select count(*)::int n from algopilot_private.recommendation_trials')).rows).toEqual([{n:0}]);
    await query(db,"select public.save_training_draft($1,'thought','synthetic changed draft',2)",[id]);
    expect((await db.query(nativeHistorySql)).rows).not.toEqual(before);
  }finally{await db.close();}
},30000);
