import { describe, it, expect } from 'vitest'
import { plan, preview } from '../../shared/guide.ts'
import type { Facts, Phase } from '../../shared/guide.ts'

const facts = (over: Partial<Facts> = {}): Facts => ({
  emails: [], tickets: [], chats: {}, unread: {}, code: { branch: 'main', changes: [], head: null } as unknown as Facts['code'], deploys: [], player: 'player', seen: [],
  mentor: 'mentor', cast: { mentor: { name: 'Daniel Chen', init: 'DC', color: '#456', email: 'd@x.io', title: 'Staff Engineer' } } as Facts['cast'],
  ...over,
})

const phases: Phase[] = [
  { id: 'fix', title: 'Fix it', sub: '', steps: [
    { id: 'read', text: 'Read the ticket', doneWhen: { mailRead: 'm1' } },
    { id: 'wiki', text: 'Read the wiki', levels: ['newgrad'], doneWhen: { openedDoc: 'auth' } },
    { id: 'deploy', text: 'Deploy', doneWhen: { deployed: true } },
  ] },
  { id: 'down', title: 'Production is down', sub: 'Restore service before the {{deadline}} demo.', when: { incident: 'live' }, optional: true, happened: { incident: 'opened' }, steps: [
    { id: 'rollback', text: 'Roll back', doneWhen: { incident: 'rolled-back' } },
  ] },
  { id: 'after', title: 'Service is back', sub: '', when: { incident: 'resolved' }, optional: true, steps: [
    { id: 'mentor', text: 'Read {{mentor}}’s message', if: { posted: { chan: 'mentor', who: 'mentor' } }, doneWhen: { channelRead: 'mentor' } },
    { id: 'pm', text: 'Send {{from}} a short postmortem', each: { mail: ['pm'] } },
    { id: 'tell', text: 'Tell {{mentor}} it is fixed', hideDone: true, doneWhen: { posted: { chan: 'team', who: 'player' } } },
  ] },
  { id: 'shipped', title: 'Shipped', sub: '', when: { deployed: true }, steps: [{ id: 'finish', text: 'Finish', if: { stepsDone: true }, doneWhen: { ended: true }, showMe: { finish: true } }] },
]

describe('preview', () => {
  it('fills in a phase’s steps for this level, without ticks', () => {
    expect(preview(facts(), phases, 'bootcamp', 'fix')?.steps).toEqual([{ id: 'read', text: 'Read the ticket' }, { id: 'deploy', text: 'Deploy' }])
    expect(preview(facts(), phases, 'newgrad', 'fix')?.steps.map(x => x.id)).toEqual(['read', 'wiki', 'deploy'])
  })
  it('leaves out steps that wait on something, and shows an each step once, for whoever it turns out to be', () => {
    expect(preview(facts(), phases, 'bootcamp', 'after')?.steps).toEqual([
      { id: 'pm', text: 'Send someone a short postmortem' },
      { id: 'tell', text: 'Tell Daniel it is fixed' },
    ])
    expect(preview(facts(), phases, 'bootcamp', 'shipped')?.steps).toEqual([])
  })
  it('says what the phase is about', () => {
    expect(preview(facts({ deadline: 900 }), phases, 'bootcamp', 'down')?.sub).toBe('Restore service before the 3:00 PM demo.')
  })
  it('is null for a phase the lesson does not have', () => {
    expect(preview(facts(), phases, 'bootcamp', 'nope')).toBeNull()
  })
  it('previews the same steps whether the phase is past, current or still to come', () => {
    const at = facts({ deploys: [{ sha: 'a', by: 'player', kind: 'deploy' }] as Facts['deploys'] })
    expect(plan(at, phases, 'bootcamp').map.map(x => x.state)).toEqual(['past', 'skipped', 'skipped', 'current'])
    expect(preview(at, phases, 'bootcamp', 'fix')).toEqual(preview(facts(), phases, 'bootcamp', 'fix'))
  })
})
