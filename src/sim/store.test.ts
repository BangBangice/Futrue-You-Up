import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Store, winRect, live } from './store.ts'
import type { Win } from './store.ts'
import type { World, Patch, TermLine } from '../../shared/types.ts'

// Mock matchMedia if not present or stubbed
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

// Helpers to build dummy world data
function makeWorld(overrides: Partial<World> = {}): World {
  return {
    id: 'test-session-123',
    stage: 'sim',
    level: 'bootcamp',
    background: 'hospital pharmacist',
    ai: 'live',
    aiProblem: null,
    pace: 4,
    simMin: 10,
    lesson: { id: 'ledgerly-day2', title: 'Ledgerly, Day 2', summary: null },
    company: 'Ledgerly',
    workspace: { repo: 'ledgerly', host: 'app.ledgerly.io' },
    calendar: { weekday: 'Mon', date: 'Oct 1', day: 1, start: 540 },
    cast: {
      player: { name: 'Alex Morgan', init: 'AM', color: '#123', email: 'alex@ledgerly.io', title: 'Software Engineer' },
      mentor: { name: 'Daniel Chen', init: 'DC', color: '#456', email: 'daniel@ledgerly.io', title: 'Staff Engineer' },
      sara: { name: 'Sara Connor', init: 'SC', color: '#789', email: 'sara@ledgerly.io', title: 'VP Eng' },
    },
    channels: {
      team: { label: 'Eng Team', topic: 'General engineering discussion', dm: false },
      mentor: { label: 'Daniel Chen', topic: 'Direct message', dm: true },
    },
    player: 'player',
    mentor: 'mentor',
    levels: {},
    deadline: null,
    guide: [],
    impact: { alarmPercent: 0, checks: [], customers: { named: [], otherAccounts: 0, otherPasswordUsers: 0 } },
    emails: [
      { id: 'e1', who: 'sara', subject: 'Welcome to Ledgerly', body: ['Hi Alex!'], folder: 'inbox', time: '1:00 PM', read: false, flagged: false, files: [], thread: [] },
    ],
    chats: {
      team: [{ id: 1, who: 'mentor', text: 'Morning team!', time: '1:01 PM', files: [] }],
    },
    unread: { team: 1 },
    typing: [],
    tickets: [{ id: 'LED-214', title: 'SSO token bug', desc: 'Fix SSO', status: 'progress', pri: 'High', who: 'player', pts: 3, comments: [], activity: [] }],
    docs: [{ id: 'home', title: 'Engineering Home', group: 'Engineering', owner: 'mentor', updated: '1:00 PM', body: 'Welcome', version: 1 }],
    files: ['src/auth/verifySession.ts', 'package.json'],
    code: { branch: 'maya/led-214', head: 'abc1234', subject: 'fix: sso', changes: [], busy: null },
    term: [],
    deploys: [],
    incident: null,
    demo: 'pending',
    timeline: [],
    recap: null,
    ...overrides,
  }
}

// Mock EventSource implementation
class MockEventSource {
  static instances: MockEventSource[] = []
  static OPEN = 1
  static CLOSED = 2

  url: string
  readyState = MockEventSource.OPEN
  listeners: Record<string, ((e: any) => void)[]> = {}
  onerror: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, fn: (e: any) => void) {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type].push(fn)
  }

  removeEventListener(type: string, fn: (e: any) => void) {
    if (this.listeners[type]) {
      this.listeners[type] = this.listeners[type].filter(l => l !== fn)
    }
  }

  emit(type: string, data: any) {
    const e = { type, data: JSON.stringify(data) }
    this.listeners[type]?.forEach(fn => fn(e))
  }

  close() {
    this.readyState = MockEventSource.CLOSED
  }
}

describe('Frontend Logic: src/sim/store.ts', () => {
  let originalEventSource: any
  let originalFetch: any

  beforeEach(() => {
    vi.useFakeTimers()
    sessionStorage.clear()
    MockEventSource.instances = []
    originalEventSource = globalThis.EventSource
    globalThis.EventSource = MockEventSource as any
    originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    globalThis.EventSource = originalEventSource
    globalThis.fetch = originalFetch
  })

  describe('Window clamping & geometry (winRect & fit)', () => {
    const desk = { W: 1280, H: 800 }

    it('clamps regular window within desktop margins when placed normally', () => {
      const w: Win = { open: true, min: false, max: false, x: 100, y: 100, w: 600, h: 400, z: 1 }
      const rect = winRect(w, desk)

      expect(rect).toEqual({
        left: 100,
        top: 100,
        width: 600,
        height: 400,
      })
    })

    it('clamps oversized window to maximum allowable width and height', () => {
      const oversized: Win = { open: true, min: false, max: false, x: 50, y: 50, w: 2000, h: 2000, z: 1 }
      const rect = winRect(oversized, desk)

      // Width clamped to D.W - 20 (1260), height to D.H - 110 (690)
      expect(rect.width).toBe(desk.W - 20)
      expect(rect.height).toBe(desk.H - 110)
    })

    it('clamps window dragged too far left to leave at least 80px visible', () => {
      const w: Win = { open: true, min: false, max: false, x: -1000, y: 100, w: 500, h: 400, z: 1 }
      const rect = winRect(w, desk)

      // Math.max(10 - width + 80, ...) -> 10 - 500 + 80 = -410
      expect(rect.left).toBe(10 - 500 + 80)
    })

    it('clamps window dragged too far right to leave at least 80px visible', () => {
      const w: Win = { open: true, min: false, max: false, x: 2000, y: 100, w: 500, h: 400, z: 1 }
      const rect = winRect(w, desk)

      // Math.min(x, D.W - 80) -> 1280 - 80 = 1200
      expect(rect.left).toBe(desk.W - 80)
    })

    it('clamps window dragged too far up (prevents going under menu bar)', () => {
      const w: Win = { open: true, min: false, max: false, x: 100, y: -50, w: 500, h: 400, z: 1 }
      const rect = winRect(w, desk)

      // Math.max(26, ...)
      expect(rect.top).toBe(26)
    })

    it('clamps window dragged too far down (prevents going under taskbar)', () => {
      const w: Win = { open: true, min: false, max: false, x: 100, y: 1500, w: 500, h: 400, z: 1 }
      const rect = winRect(w, desk)

      // Math.min(y, D.H - 110) -> 800 - 110 = 690
      expect(rect.top).toBe(desk.H - 110)
    })

    it('calculates full-screen geometry when maximized', () => {
      const w: Win = { open: true, min: false, max: true, x: 100, y: 100, w: 500, h: 400, z: 1 }
      const rect = winRect(w, desk)

      expect(rect).toEqual({
        left: 6,
        top: 32,
        width: desk.W - 12,
        height: desk.H - 32 - 90,
      })
    })

    it('Store.fit adjusts all app windows for given desktop dimensions', () => {
      const store = new Store()
      store.fit(1024, 768)

      expect(store.state.desk).toEqual({ W: 1024, H: 768 })
      for (const [, w] of Object.entries(store.state.wins)) {
        expect(w.w).toBeLessThanOrEqual(1024 - 40)
        expect(w.h).toBeLessThanOrEqual(768 - 130)
        expect(w.x).toBeGreaterThanOrEqual(10)
        expect(w.x).toBeLessThanOrEqual(1024 - w.w - 10)
      }
    })

    it('opens and focuses window, managing topZ and focus state', () => {
      const store = new Store()
      const initialZ = store.state.topZ

      store.open('code')
      expect(store.state.wins.code.open).toBe(true)
      expect(store.state.wins.code.min).toBe(false)
      expect(store.state.wins.code.z).toBe(initialZ + 1)
      expect(store.state.topZ).toBe(initialZ + 1)
      expect(store.state.focus).toBe('code')

      // Focusing another window updates topZ and focus
      store.focusWin('chat')
      expect(store.state.focus).toBe('chat')
      expect(store.state.wins.chat.z).toBe(initialZ + 2)

      // Focusing already top window does not increment topZ needlessly
      const zBefore = store.state.topZ
      store.focusWin('chat')
      expect(store.state.topZ).toBe(zBefore)
    })

    it('minimizes, maximizes, and closes windows correctly', () => {
      const store = new Store()
      store.open('mail')
      expect(store.state.focus).toBe('mail')

      // Minimize: min set to true, focus blurred
      store.minWin('mail')
      expect(store.state.wins.mail.min).toBe(true)
      expect(store.state.focus).toBeNull()

      // Maximize toggle
      expect(store.state.wins.mail.max).toBe(false)
      store.maxWin('mail')
      expect(store.state.wins.mail.max).toBe(true)
      store.maxWin('mail')
      expect(store.state.wins.mail.max).toBe(false)

      // Close: open & max set to false, focus blurred
      store.open('mail')
      expect(store.state.focus).toBe('mail')
      store.closeWin('mail')
      expect(store.state.wins.mail.open).toBe(false)
      expect(store.state.wins.mail.max).toBe(false)
      expect(store.state.focus).toBeNull()
    })
  })

  describe('Toast notifications & de-duplication', () => {
    it('creates toast with incrementing ID and automatically dismisses after 6.5s', () => {
      const store = new Store()
      const goMock = vi.fn()

      store.toast({ title: 'Test 1', body: 'First message', go: goMock })
      expect(store.state.toasts).toHaveLength(1)
      const firstId = store.state.toasts[0].id
      expect(store.state.toasts[0].title).toBe('Test 1')

      store.toast({ title: 'Test 2', body: 'Second message', go: goMock })
      expect(store.state.toasts).toHaveLength(2)
      expect(store.state.toasts[1].id).toBeGreaterThan(firstId)

      // Advance time by 6500ms for first toast
      vi.advanceTimersByTime(6500)
      // First toast should be dismissed
      expect(store.state.toasts.find(t => t.id === firstId)).toBeUndefined()
    })

    it('caps maximum active toasts to at most 3', () => {
      const store = new Store()
      const go = vi.fn()

      store.toast({ title: 'T1', body: 'B1', go })
      store.toast({ title: 'T2', body: 'B2', go })
      store.toast({ title: 'T3', body: 'B3', go })
      store.toast({ title: 'T4', body: 'B4', go })

      // Slices last 2 + new one = max 3
      expect(store.state.toasts).toHaveLength(3)
      expect(store.state.toasts.map(t => t.title)).toEqual(['T2', 'T3', 'T4'])
    })

    it('dismissToast manually removes toast by ID', () => {
      const store = new Store()
      store.toast({ title: 'Manual', body: 'Dismiss me', go: () => {} })
      const id = store.state.toasts[0].id

      store.dismissToast(id)
      expect(store.state.toasts).toHaveLength(0)
    })

    it('de-duplicates email toasts across patches', () => {
      const store = new Store()
      // Initialize with snapshot world
      const world = makeWorld()
      store.set({ ...world, online: true, stage: 'sim' })
      // Remember initial emails by passing to private remember via snapshot
      ;(store as any).connect('test-session')
      const stream = MockEventSource.instances[0]
      stream.emit('snapshot', { seq: 1, world })

      expect(store.state.toasts).toHaveLength(0)

      // Receive a patch with a new email from mentor (not player)
      const patch1: Patch = {
        emails: [
          ...world.emails,
          { id: 'e2', who: 'mentor', subject: 'Urgent check', body: ['Please check auth'], folder: 'inbox', time: '1:10 PM', read: false, flagged: false, files: [], thread: [] },
        ],
      }
      stream.emit('patch', { seq: 2, patch: patch1 })

      // A toast should be created for e2
      expect(store.state.toasts).toHaveLength(1)
      expect(store.state.toasts[0].title).toBe('Daniel Chen')
      expect(store.state.toasts[0].body).toBe('Urgent check')

      // Clear toasts to verify de-duplication
      store.set({ toasts: [] })

      // The same email e2 arrives in subsequent patch
      const patch2: Patch = {
        emails: patch1.emails,
      }
      stream.emit('patch', { seq: 3, patch: patch2 })

      // Toast must NOT be duplicated!
      expect(store.state.toasts).toHaveLength(0)
    })

    it('does not toast emails sent by the player', () => {
      const store = new Store()
      const world = makeWorld()
      ;(store as any).connect('test-session')
      const stream = MockEventSource.instances[0]
      stream.emit('snapshot', { seq: 1, world })

      const playerEmailPatch: Patch = {
        emails: [
          ...world.emails,
          { id: 'e_player', who: 'player', subject: 'My reply', body: ['Done'], folder: 'sent', time: '1:15 PM', read: true, flagged: false, files: [], thread: [] },
        ],
      }
      stream.emit('patch', { seq: 2, patch: playerEmailPatch })

      expect(store.state.toasts).toHaveLength(0)
    })

    it('de-duplicates chat toasts and suppresses toast when user is watching the channel in focus', () => {
      const store = new Store()
      const world = makeWorld()
      ;(store as any).connect('test-session')
      const stream = MockEventSource.instances[0]
      stream.emit('snapshot', { seq: 1, world })

      // Case 1: Chat arrives in background (user focusing mail, not chat)
      store.set({ focus: 'mail' })
      const chatPatch1: Patch = {
        chats: {
          team: [
            ...world.chats.team,
            { id: 101, who: 'mentor', text: 'Hey Alex, see this', time: '1:12 PM', files: [] },
          ],
        },
      }
      stream.emit('patch', { seq: 2, patch: chatPatch1 })

      expect(store.state.toasts).toHaveLength(1)
      expect(store.state.toasts[0].title).toBe('Daniel Chen in Eng Team')
      expect(store.state.toasts[0].body).toBe('Hey Alex, see this')

      // Case 2: Same message in next patch is de-duplicated
      store.set({ toasts: [] })
      stream.emit('patch', { seq: 3, patch: chatPatch1 })
      expect(store.state.toasts).toHaveLength(0)

      // Case 3: Message arrives while user is actively watching that channel
      store.set({
        focus: 'chat',
        chan: 'team',
        stage: 'sim',
        wins: {
          ...store.state.wins,
          chat: { ...store.state.wins.chat, open: true, min: false },
        },
        deep: { ...store.state.deep, chat: true },
      })
      const chatPatch2: Patch = {
        chats: {
          team: [
            ...chatPatch1.chats!.team,
            { id: 102, who: 'mentor', text: 'Another message', time: '1:13 PM', files: [] },
          ],
        },
      }
      stream.emit('patch', { seq: 4, patch: chatPatch2 })
      // Suppressed because user is actively watching
      expect(store.state.toasts).toHaveLength(0)
    })
  })

  describe('EventSource reconnection & sequence gaps', () => {
    it('detects sequence gaps in stream and reconnects with fresh EventSource', () => {
      const store = new Store()
      const connectSpy = vi.spyOn(store as any, 'connect')
      ;(store as any).connect('test-session')

      expect(MockEventSource.instances).toHaveLength(1)
      const firstStream = MockEventSource.instances[0]

      // Initial snapshot at seq 10
      firstStream.emit('snapshot', { seq: 10, world: makeWorld() })
      expect(connectSpy).toHaveBeenCalledTimes(1)

      // Valid patch at seq 11
      firstStream.emit('patch', { seq: 11, patch: {} })
      expect(connectSpy).toHaveBeenCalledTimes(1)

      // Gap: seq jumps to 15 (skipped 12, 13, 14)
      firstStream.emit('patch', { seq: 15, patch: {} })

      // Gap should have triggered reconnect!
      expect(connectSpy).toHaveBeenCalledTimes(2)
      expect(connectSpy).toHaveBeenLastCalledWith('test-session')
      expect(firstStream.readyState).toBe(MockEventSource.CLOSED)
      expect(MockEventSource.instances).toHaveLength(2)
    })

    it('reloads page on 401 unauthorized when stream closes', async () => {
      const store = new Store()
      ;(store as any).connect('test-session')
      const stream = MockEventSource.instances[0]

      const reloadMock = vi.fn()
      const origReload = window.location.reload
      Object.defineProperty(window.location, 'reload', {
        configurable: true,
        value: reloadMock,
      })

      try {
        ;(globalThis.fetch as any).mockResolvedValueOnce({ status: 401 })
        stream.close()
        await stream.onerror?.()

        expect(store.state.online).toBe(false)
        expect(reloadMock).toHaveBeenCalled()
      } finally {
        Object.defineProperty(window.location, 'reload', {
          configurable: true,
          value: origReload,
        })
      }
    })

    it('calls replay on 404 session lost when stream closes', async () => {
      const store = new Store()
      ;(store as any).connect('test-session')
      const stream = MockEventSource.instances[0]
      const replaySpy = vi.spyOn(store, 'replay')

      ;(globalThis.fetch as any).mockResolvedValueOnce({ status: 404 })
      stream.close()
      await stream.onerror?.()

      expect(store.state.online).toBe(false)
      expect(replaySpy).toHaveBeenCalled()
    })

    it('schedules retry reconnect in 2s on network or server error when stream closes', async () => {
      const store = new Store()
      ;(store as any).connect('test-session')
      const stream = MockEventSource.instances[0]
      const connectSpy = vi.spyOn(store as any, 'connect')

      ;(globalThis.fetch as any).mockResolvedValueOnce({ status: 500 })
      stream.close()
      const promise = stream.onerror?.()
      await promise

      expect(connectSpy).not.toHaveBeenCalled()
      vi.advanceTimersByTime(2000)
      expect(connectSpy).toHaveBeenCalledWith('test-session')
    })

    it('does not force reconnect if stream is not CLOSED (browser auto-retry)', async () => {
      const store = new Store()
      ;(store as any).connect('test-session')
      const stream = MockEventSource.instances[0]
      const fetchSpy = vi.spyOn(globalThis, 'fetch')

      // readyState is still OPEN
      stream.readyState = MockEventSource.OPEN
      await stream.onerror?.()

      expect(store.state.online).toBe(false)
      // fetch probe should not be called
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('resume reconnects using session from sessionStorage or active run', async () => {
      const store = new Store()
      const connectSpy = vi.spyOn(store as any, 'connect').mockImplementation(() => {})

      // Case 1: sessionStorage has saved KEY
      sessionStorage.setItem('larp.session', 'saved-id-999')
      await store.resume(false)
      expect(connectSpy).toHaveBeenCalledWith('saved-id-999')

      sessionStorage.clear()
      connectSpy.mockClear()

      // Case 2: sessionStorage has no KEY, accounts is true, fetches /api/me/runs
      ;(globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'active-run-123', status: 'active' }],
      })
      await store.resume(true)
      expect(connectSpy).toHaveBeenCalledWith('active-run-123')

      // Case 3: larp.lesson is set (user picked a lesson but didn't start), does not resume
      connectSpy.mockClear()
      sessionStorage.setItem('larp.lesson', 'new-lesson')
      await store.resume(true)
      expect(connectSpy).not.toHaveBeenCalled()
    })
  })

  describe('Buffer dirty tracking, file operations & commands', () => {
    it('tracks dirty buffers and saves them via PUT /file', async () => {
      const store = new Store()
      store.set({ id: 'sess-1', codeFile: 'src/app.ts', tabs: ['src/app.ts'] })
      store.set(s => ({
        buffers: { ...s.buffers, 'src/app.ts': { text: 'const a = 1', saved: 'const a = 1' } },
      }))

      // Edit makes it dirty
      store.edit('src/app.ts', 'const a = 2')
      expect(store.state.buffers['src/app.ts'].text).toBe('const a = 2')
      expect(store.state.buffers['src/app.ts'].saved).toBe('const a = 1')

      // Save sends PUT /file
      ;(globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      })
      await store.save('src/app.ts')

      expect(globalThis.fetch).toHaveBeenCalledWith('/api/sessions/sess-1/file', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'src/app.ts', text: 'const a = 2' }),
      })
      expect(store.state.buffers['src/app.ts'].saved).toBe('const a = 2')
    })

    it('exec and commit automatically save unsaved open buffers before executing', async () => {
      const store = new Store()
      store.set({ id: 'sess-1', tabs: ['src/index.ts'] })
      store.set(s => ({
        buffers: { ...s.buffers, 'src/index.ts': { text: 'modified', saved: 'original' } },
      }))

      ;(globalThis.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
      })

      await store.exec('ls')

      // Check that save was called first
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/sessions/sess-1/file', expect.objectContaining({
        method: 'PUT',
      }))
      // Check that exec act was called
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/sessions/sess-1/act', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ type: 'exec', cmd: 'ls' }),
      }))
    })

    it('marks tested in step guide when running test commands with code changes', async () => {
      const store = new Store()
      store.set({
        id: 'sess-1',
        code: { branch: 'feat', head: '123', subject: 'sub', changes: [{ path: 'modified.ts', status: 'M' }], busy: null },
        deploys: [],
        seen: [],
      })
      ;(globalThis.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
      })

      await store.exec('npm test')
      expect(store.state.seen).toContain('tested@0')
    })

    it('closes file buffer and switches active tab cleanly', () => {
      const store = new Store()
      store.set({
        tabs: ['a.ts', 'b.ts'],
        codeFile: 'b.ts',
        buffers: {
          'a.ts': { text: 'a', saved: 'a' },
          'b.ts': { text: 'b', saved: 'b' },
        },
      })

      store.closeFile('b.ts')
      expect(store.state.tabs).toEqual(['a.ts'])
      expect(store.state.codeFile).toBe('a.ts')
      expect(store.state.buffers['b.ts']).toBeUndefined()
    })
  })

  describe('Guide tracking, spotlights and live status', () => {
    it('mark adds keys to seen list and persists to sessionStorage', () => {
      const store = new Store()
      store.set({ id: 'sess-1', seen: [] })

      store.mark('step-1')
      expect(store.state.seen).toContain('step-1')

      const stored = JSON.parse(sessionStorage.getItem('larp.seen')!)
      expect(stored).toEqual({ id: 'sess-1', seen: ['step-1'] })

      // Duplicate mark does nothing
      store.mark('step-1')
      expect(store.state.seen).toEqual(['step-1'])
    })

    it('spotlight updates spot state with incremented counter', () => {
      const store = new Store()
      store.spotlight(['mail-inbox'], 'fallback-btn')

      expect(store.state.spot).toEqual({
        keys: ['mail-inbox'],
        fallback: 'fallback-btn',
        n: expect.any(Number),
      })
    })

    it('live helper correctly identifies ongoing unresolved incident', () => {
      expect(live({ incident: null })).toBe(false)
      expect(live({ incident: { id: 'inc-1', resolvedAt: 120 } as any })).toBe(false)
      expect(live({ incident: { id: 'inc-1', resolvedAt: null } as any })).toBe(true)
    })
  })

  describe('Shift controls & session management', () => {
    it('setPace updates local state if no id, or dispatches act if session exists', async () => {
      const store = new Store()
      ;(globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => ({}) })

      // No session id: updates local state
      store.setPace(2)
      expect(store.state.pace).toBe(2)

      // With session id: calls act
      store.set({ id: 'sess-1' })
      store.setPace(5)
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/sessions/sess-1/act', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ type: 'pace', pace: 5 }),
      }))
    })

    it('endShift dispatches end act', async () => {
      const store = new Store()
      store.set({ id: 'sess-1' })
      ;(globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => ({}) })

      store.endShift()
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/sessions/sess-1/act', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ type: 'end' }),
      }))
    })

    it('replay resets session state and storage', () => {
      const store = new Store()
      ;(store as any).connect('test-session')
      sessionStorage.setItem('larp.session', 'test-session')
      sessionStorage.setItem('larp.seen', 'seen-data')

      store.replay()

      expect(sessionStorage.getItem('larp.session')).toBeNull()
      expect(sessionStorage.getItem('larp.seen')).toBeNull()
      expect(store.state.id).toBe('')
      expect(store.state.stage).toBe('onboard')
    })

    it('choose and pickUp manage lesson and session storage keys', () => {
      const store = new Store()
      store.choose('lesson-day-2')

      expect(store.state.scenario).toBe('lesson-day-2')
      expect(sessionStorage.getItem('larp.lesson')).toBe('lesson-day-2')

      store.pickUp('sess-456')
      expect(sessionStorage.getItem('larp.lesson')).toBeNull()
      expect(sessionStorage.getItem('larp.session')).toBe('sess-456')
    })
  })

  describe('Mail and Chat interactions', () => {
    it('openMail sets selected mail, resets drafts, marks read and opens mail window', async () => {
      const store = new Store()
      const world = makeWorld()
      store.set({ ...world, id: 'sess-1' })
      ;(globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => ({}) })

      store.openMail('e1')

      expect(store.state.mailSel).toBe('e1')
      expect(store.state.mailFolder).toBe('inbox')
      expect(store.state.wins.mail.open).toBe(true)
      expect(store.state.compose).toBeNull()
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/sessions/sess-1/act', expect.objectContaining({
        body: JSON.stringify({ type: 'mailPatch', id: 'e1', read: true }),
      }))
    })

    it('reply, forward, newMail, and discardMail manipulate compose state', () => {
      const store = new Store()
      const world = makeWorld()
      store.set({ ...world, mailSel: 'e1' })

      store.reply()
      expect(store.state.compose).toEqual({ mode: 'reply', to: '', subject: '' })

      store.forward()
      expect(store.state.compose).toEqual({ mode: 'forward', to: '', subject: 'Fw: Welcome to Ledgerly' })

      store.newMail()
      expect(store.state.compose).toEqual({ mode: 'new', to: '', subject: '' })

      store.discardMail()
      expect(store.state.compose).toBeNull()
    })

    it('sendMail dispatches mail act and restores draft on failure', async () => {
      const store = new Store()
      store.set({
        id: 'sess-1',
        compose: { mode: 'reply', to: 'sara', subject: 'Re: Welcome' },
        mailDraft: 'Thank you!',
        mailFiles: [],
      })

      // Rejecting send restores draft
      ;(globalThis.fetch as any).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Mail rejected' }),
      })

      store.sendMail()
      await vi.runAllTimersAsync()

      // Should have restored draft after failure
      expect(store.state.mailDraft).toBe('Thank you!')
      expect(store.state.compose).toEqual({ mode: 'reply', to: 'sara', subject: 'Re: Welcome' })
    })

    it('sendChat dispatches chat act and restores draft on failure', async () => {
      const store = new Store()
      store.set({
        id: 'sess-1',
        chan: 'team',
        chatDraft: 'Fix is ready',
        chatFiles: [],
      })

      ;(globalThis.fetch as any).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Network error' }),
      })

      store.sendChat()
      await vi.runAllTimersAsync()

      // Should have restored chat draft after failure
      expect(store.state.chatDraft).toBe('Fix is ready')
    })
  })

  describe('Docs, Tracker, and Stream Events', () => {
    it('openTicket, openDoc, and openAttachment navigate to corresponding views', () => {
      const store = new Store()
      store.set(makeWorld())

      store.openTicket('LED-214')
      expect(store.state.ticketSel).toBe('LED-214')
      expect(store.state.wins.tracker.open).toBe(true)

      store.openDoc('home')
      expect(store.state.docPage).toBe('home')
      expect(store.state.wins.docs.open).toBe(true)

      // Test openAttachment
      store.openAttachment({ kind: 'ticket', id: 'LED-214' })
      expect(store.state.ticketSel).toBe('LED-214')

      store.openAttachment({ kind: 'doc', doc: 'home' })
      expect(store.state.docPage).toBe('home')
    })

    it('handles term events: appends output up to 400 lines and clears when clear: true', () => {
      const store = new Store()
      ;(store as any).connect('test-session')
      const stream = MockEventSource.instances[0]
      stream.emit('snapshot', { seq: 1, world: makeWorld() })

      const lines: TermLine[] = Array.from({ length: 50 }, (_, i) => ({ c: 'out', t: `line ${i}` }))
      stream.emit('term', { seq: 2, lines })
      expect(store.state.term).toHaveLength(50)

      // Appending more lines
      stream.emit('term', { seq: 3, lines: Array.from({ length: 400 }, (_, i) => ({ c: 'out', t: `line ${i + 50}` })) })
      // Sliced to last 400
      expect(store.state.term).toHaveLength(400)

      // Clear terminal
      stream.emit('term', { seq: 4, lines: [], clear: true })
      expect(store.state.term).toHaveLength(0)
    })

    it('prunes closed tabs when patch indicates files were deleted', () => {
      const store = new Store()
      ;(store as any).connect('test-session')
      const stream = MockEventSource.instances[0]
      stream.emit('snapshot', { seq: 1, world: makeWorld({ files: ['keep.ts', 'delete.ts'] }) })

      store.set({
        tabs: ['keep.ts', 'delete.ts'],
        codeFile: 'delete.ts',
        files: ['keep.ts', 'delete.ts'],
      })

      stream.emit('patch', { seq: 2, patch: { files: ['keep.ts'] } })

      expect(store.state.tabs).toEqual(['keep.ts'])
      expect(store.state.codeFile).toBe('')
    })
  })
})
