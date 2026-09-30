// A tab keeps the JavaScript it loaded until it reloads, and moving around the app never does. After a deploy it would play
// lessons with old code against a server that sends them in a newer shape (a step list with no steps). The server names its
// build on every API response (X-Build); a tab on another build reloads to get the current one.

/** This tab's build, from vite.config.ts. Empty under Vite's dev server, which is always current. */
declare const __BUILD__: string
const TRIED = 'larp.reloadedFor'

/** Reloads the page if the server is on a newer build, and says whether it did, so the caller stops there. */
export function stale(res: Response): boolean {
  const theirs = res.headers.get('x-build')
  if (!__BUILD__ || !theirs || theirs === __BUILD__) return false
  // Once per build: if the reload still brings this one back (a cache in the way), carry on rather than loop.
  try {
    if (sessionStorage.getItem(TRIED) === theirs) return false
    sessionStorage.setItem(TRIED, theirs)
  } catch { return false }
  location.reload()
  return true
}
