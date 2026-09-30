// Runs the scenario's scripted triggers: checks a trigger's condition, fills in its text and carries out its actions.
import { clock, dur, firstName, minutes, shortName } from '../shared/types.ts'
import type { Cond, EVENTS, Trigger, VARS } from '../shared/scenario.ts'
import type { Session } from './world.ts'

export type EngineEvent = typeof EVENTS[number]

export const vars = (s: Session): Record<typeof VARS[number], string> => {
  const live = s.world.deploys.at(-1)!, due = s.scenario.clock.deadline, { story, customers } = s.scenario
  // The schema refuses {{timeToDemo}} without a deadline. A lesson with a goal has no client, so those are empty there.
  const client = s.world.cast[story.client], customer = customers.named.find(c => c.name === story.customer)
  return {
    now: s.now, deployTime: clock(live.at), deployTimePlus1: clock(live.at + 1), timeToDemo: due ? dur(Math.max(0, minutes(due) - s.world.simMin)) : '', player: firstName(s.world.cast[s.world.player]),
    client: client ? firstName(client) : '', customer: customer ? shortName(customer) : '',
  }
}
export const render = (text: string, v: Record<string, string>) => text.replace(/\{\{(.*?)\}\}/g, (_, k: string) => v[k])

/** `inc` is the incident whose opening scheduled the trigger, if any. */
export function holds(s: Session, c: Cond, inc?: string): boolean {
  if (c.all) return c.all.every(x => holds(s, x, inc))
  if (c.any) return c.any.some(x => holds(s, x, inc))
  if (c.not) return !holds(s, c.not, inc)
  if (c.flag) return (s.priv.f[c.flag] !== undefined) === c.set
  if (c.incident) return !!s.world.incident && s.world.incident.resolvedAt === null && s.world.incident.id === inc
  if (c.shipped !== undefined) return s.world.deploys.some(d => d.by === s.world.player) === c.shipped
  return s.world.demo === c.demo
}

export function schedule(s: Session, triggers: Trigger[], on: EngineEvent, inc?: string) {
  for (const t of triggers) if (t.when.on === on) s.at(t.when.after, t.id, inc)
}

export function fire(s: Session, t: Trigger, inc?: string) {
  if (t.if && !holds(s, t.if, inc)) return
  const v = vars(s)
  for (const a of t.do) {
    if (a.flag) s.priv.f[a.flag] = s.world.simMin
    else if (a.post) s.post(a.post.chan, a.post.who, render(a.post.text, v), a.post.files ? { files: structuredClone(a.post.files) } : {})
    else if (a.mail) {
      const { subject, body, toName, ...rest } = structuredClone(a.mail)
      s.mail({ ...rest, subject: render(subject, v), body: body.map(b => render(b, v)), ...(toName !== undefined && { toName: render(toName, v) }) })
    }
  }
}
