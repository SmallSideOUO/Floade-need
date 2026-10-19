const retryable = error => ['REMOTE_NOT_RUNNING', 'REMOTE_START_FAILED'].includes(error.apiCode)

export function createEngineSupervisor({ start, probe }) {
  let pending, timer, abort
  let enabled = false
  let state = { state: 'stopped', attempt: 0 }
  function schedule(delay = 5000) {
    clearTimeout(timer)
    if (!enabled) return
    timer = setTimeout(async () => {
      try {
        await probe()
        if (!enabled) return
        state = { state: 'ready', attempt: 0 }
        schedule()
      } catch { if (enabled) void ensure().catch(() => {}) }
    }, delay)
    timer.unref?.()
  }
  function stop() {
    enabled = false
    clearTimeout(timer)
    abort?.abort()
    state = { state: 'stopped', attempt: 0 }
  }
  function ensure() {
    enabled = true
    clearTimeout(timer)
    if (pending) return pending
    const controller = new AbortController()
    abort = controller
    pending = (async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (controller.signal.aborted) throw Object.assign(Error('Remote startup cancelled.'), { apiCode: 'REMOTE_START_CANCELLED' })
        state = { state: attempt === 1 ? 'starting' : 'recovering', attempt }
        try {
          const result = await start(controller.signal)
          if (controller.signal.aborted) throw Object.assign(Error('Remote startup cancelled.'), { apiCode: 'REMOTE_START_CANCELLED' })
          state = { state: 'ready', attempt }
          return result
        } catch (error) {
          if (controller.signal.aborted || !retryable(error) || attempt === 3) {
            if (!controller.signal.aborted) state = { state: retryable(error) ? 'waiting' : 'blocked', attempt, reason: error.apiCode, nextRetryAt: Date.now() + 30000 }
            throw error
          }
          await new Promise(resolve => {
            const delay = setTimeout(done, attempt * 1000)
            function done() { clearTimeout(delay); controller.signal.removeEventListener('abort', done); resolve() }
            controller.signal.addEventListener('abort', done, { once: true })
          })
        }
      }
    })().finally(() => {
      pending = undefined
      if (abort === controller) abort = undefined
      schedule(state.state === 'ready' ? 5000 : 30000)
    })
    return pending
  }
  return { ensure, stop, snapshot: () => ({ ...state }) }
}
