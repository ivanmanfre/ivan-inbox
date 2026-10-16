import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, expect, it } from 'vitest'
let db: PGlite
const user1='11111111-1111-4111-8111-111111111111',user2='22222222-2222-4222-8222-222222222222'
beforeAll(async()=>{
 db=new PGlite()
 await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create function operator_gate_ok(text) returns boolean language sql stable as $$select $1='clientops'$$;
 create function lane_allowed(text) returns boolean language sql stable as $$select $1 in ('ivan','arch')$$;
 select set_config('test.uid','${user1}',false);`)
 await db.exec(readFileSync('db/288_idea_organization.sql','utf8'))
})
afterAll(async()=>{await db?.close()})
const read=async(lane='ivan')=>(await db.query<{r:any}>('select operator_idea_organization($1,$2) r',['clientops',lane])).rows[0].r
const save=async(patch:unknown,lane='ivan')=>(await db.query<{r:any}>('select operator_set_idea_organization($1,$2,$3,$4) r',['clientops',lane,'idea-1',JSON.stringify(patch)])).rows[0].r
it('persists shortlist and topic independently, scoped to the operator and lane',async()=>{
 await save({shortlisted:true});await save({topic:'Content & LinkedIn'})
 expect((await read()).rows).toEqual([{id:'idea-1',shortlisted:true,topic:'Content & LinkedIn'}])
 expect((await read('arch')).rows).toEqual([])
 await db.exec(`select set_config('test.uid','${user2}',false)`)
 expect((await read()).rows).toEqual([])
 await db.exec(`select set_config('test.uid','${user1}',false)`)
 await save({shortlisted:false})
 expect((await read()).rows[0]).toMatchObject({shortlisted:false,topic:'Content & LinkedIn'})
})
it('rejects missing auth, invalid lanes and malformed patches without modifying the saved topic',async()=>{
 await expect(db.query('select operator_set_idea_organization($1,$2,$3,$4)',[null,'ivan','invalid','{"shortlisted":true}'])).rejects.toThrow(/unauthorized/)
 await expect(db.query('select operator_idea_organization($1,$2)',['wrong','ivan'])).rejects.toThrow(/unauthorized/)
 await expect(save({topic:'AI & systems'})).rejects.toThrow(/invalid/)
 await expect(save({shortlisted:'true'})).rejects.toThrow(/invalid/)
 await expect(save({status:'approved'})).rejects.toThrow(/invalid/)
 await expect(read('other')).rejects.toThrow(/unauthorized/)
 await db.exec(`select set_config('test.uid','',false)`)
 await expect(read()).rejects.toThrow(/unauthorized/)
 await db.exec(`select set_config('test.uid','${user1}',false); set role authenticated;`)
 await expect(db.query('select * from content_idea_organization')).rejects.toThrow(/permission denied/)
 await db.exec('reset role')
 expect((await read()).rows[0].topic).toBe('Content & LinkedIn')
})
