const profiles = [
  ['udp-webrtc', false, true, true], ['all-direct', true, true, true],
  ['tcp', true, false, false], ['udp', false, true, false],
  ['webrtc', false, false, true], ['tcp-udp', true, true, false],
  ['tcp-webrtc', true, false, true]
].map(([id, tcpPunch, udpPunch, webrtc]) => ({ id, tcpPunch, udpPunch, webrtc }))

// Rank observed routes without interrupting a working session to benchmark them.
export function rankConnectionProfiles(history = {}, preferred, now = Date.now()) {
  return profiles.map((profile, index) => {
    const h = history[profile.id] || {}
    const successes = Math.max(0, Number(h.successes) || 0)
    const failures = Math.max(0, Number(h.failures) || 0)
    const reliability = (successes + 1) / (successes + failures + 2)
    const recentFailure = Math.max(0, 1 - (now - (h.lastFailure || 0)) / 300000)
    const score = 120 * reliability + (profile.id === preferred && !successes ? 25 : 0)
      + Math.min(20, (h.stableMs || 0) / 3000)
      + Math.min(20, (h.fpsRatio || 0) * 20)
      + (h.delayMs > 0 ? 10 / (1 + h.delayMs / 100) : 0)
      + (h.connectMs > 0 ? 5 / (1 + h.connectMs / 5000) : 0)
      - (h.lastFailure ? 60 * recentFailure : 0)
    return { ...profile, score, index }
  }).sort((a, b) => b.score - a.score || a.index - b.index)
}

export function createAutoConnector({ call, settings, remember, recover, metrics }) {
  let job
  let timer
  let busy = false
  const snapshot = () => job ? {
    deviceId: job.deviceId, windowId: job.windowId, state: job.state,
    profile: job.profile?.id, attempt: job.attempt, total: profiles.length,
    score: job.profile?.score, locked: job.state === 'connected',
    attempts: job.attempts.map(attempt => ({ ...attempt })), reason: job.reason, nextRetryAt: job.nextRetryAt
  } : null
  const terminal = state => ['cancelled', 'exhausted', 'user-action', 'engine-error'].includes(state)
  function cancel() {
    clearTimeout(timer)
    if (job) { job.state = 'cancelled'; job.password = undefined }
  }
  function schedule(current) {
    if (job !== current || terminal(current.state)) return
    timer = setTimeout(() => void poll(current), 1500)
    timer.unref?.()
  }
  function retry(current, state, reason) {
    current.failures = (current.failures || 0) + 1
    current.state = state
    current.reason = reason
    current.stableAt = undefined
    current.nextRetryAt = Date.now() + [15000, 30000, 60000][Math.min(current.failures - 1, 2)]
  }
  const ranked = current => rankConnectionProfiles(current.history, current.preferred)
  async function record(current, failed = false) {
    const previous = current.history[current.profile.id] || {}
    const now = Date.now()
    const next = { ...previous,
      successes: (previous.successes || 0) + (!failed && !current.recorded ? 1 : 0),
      failures: (previous.failures || 0) + (failed ? 1 : 0),
      stableMs: Math.max(previous.stableMs || 0, current.stableAt ? now - current.stableAt : 0) }
    if (failed) next.lastFailure = now
    else {
      next.lastSuccess = now
      next.connectMs = current.readyAt - current.startedAt
      // The automatic controller owns the only outgoing window. Reject old,
      // indirect or ambiguous samples rather than assign another session's FPS.
      try {
        const samples = (await metrics?.() || []).filter(sample => sample.fresh && sample.direct === true && sample.sample_unix_ms >= current.startedAt && sample.sample_unix_ms <= now)
        if (samples.length === 1 && samples[0].sample_unix_ms !== current.sampleAt) {
          const sample = samples[0]
          const fps = Object.values(sample.presented_fps || {}).filter(value => Number.isFinite(value) && value >= 0)
          const smooth = (old, value) => Number.isFinite(old) ? old * 0.7 + value * 0.3 : value
          if (fps.length) next.fpsRatio = smooth(previous.fpsRatio, Math.min(1, Math.min(...fps) / settings().fps))
          if (Number.isFinite(sample.shared_path_delay_ms) && sample.shared_path_delay_ms > 0) next.delayMs = smooth(previous.delayMs, sample.shared_path_delay_ms)
          current.sampleAt = sample.sample_unix_ms
        }
      } catch { /* Missing performance samples never invalidate a direct route. */ }
    }
    if (job !== current || terminal(current.state)) return
    current.history[current.profile.id] = next
    await remember(current.deviceId, current.profile.id, current.history, current.mode)
    if (!failed) current.recorded = true
    current.recordAt = now
  }
  async function prepare(current) {
    if (!recover) return
    const native = await recover()
    if (job !== current || terminal(current.state)) return
    if (!native.autoConnectStatus) throw Object.assign(Error('Update the native engine and Windows service for automatic connections.'), { apiCode: 'REMOTE_ENGINE_UPDATE_REQUIRED' })
    if (native.windows?.length && !native.windows.includes(current.windowId)) throw Object.assign(Error('Close existing remote windows before starting automatic connections.'), { apiCode: 'REMOTE_BUSY' })
    return native
  }
  async function attempt(current) {
    const profile = current.remaining.shift()
    if (!profile) {
      retry(current, 'waiting', 'NO_DIRECT_ROUTE')
      return
    }
    current.profile = profile
    current.attempt++
    current.state = 'connecting'; current.reason = undefined; current.nextRetryAt = undefined
    current.startedAt = Date.now(); current.stableAt = undefined; current.authAt = undefined
    current.readyAt = undefined; current.errorAt = undefined; current.recorded = false; current.sampleAt = undefined
    current.attempts.push({ profile: profile.id, state: 'connecting' })
    current.attempts = current.attempts.slice(-21)
    // Transport switches are engine-local and are read at session creation.
    const options = { ...settings(), tcpPunch: profile.tcpPunch, udpPunch: profile.udpPunch, webrtc: profile.webrtc, forceRelay: false, relayServer: '' }
    await call('apply', { settings: options })
    if (job !== current || terminal(current.state)) return
    const result = await call('connect', { deviceId: current.deviceId, password: current.password, mode: current.mode, settings: options })
    current.windowId = result.windowId
    if (job !== current || terminal(current.state)) {
      if (Number.isInteger(result.windowId)) await call('disconnect', { windowId: result.windowId })
      return
    }
    if (!Number.isInteger(result.windowId) || result.windowId <= 0) throw Error('ENGINE_SESSION_UNAVAILABLE')
    return result
  }
  async function poll(current) {
    if (job !== current || terminal(current.state)) return
    busy = true
    try {
      if (current.state === 'recovering-engine') {
        if (Date.now() < current.nextRetryAt) return
        const native = await prepare(current)
        if (job !== current || terminal(current.state)) return
        if (!native?.windows?.includes(current.windowId)) {
          if (current.windowId && current.enginePid && native?.pid === current.enginePid) { cancel(); return }
          current.enginePid = native?.pid
          current.windowId = undefined
          if (current.profile) current.remaining = [current.profile, ...current.remaining.filter(profile => profile.id !== current.profile.id)]
          await attempt(current)
          return
        }
        current.enginePid = native?.pid
        current.state = 'connecting'
      }
      if (current.state === 'waiting') {
        if (current.windowId) {
          const status = await call('sessionStatus', { windowId: current.windowId, deviceId: current.deviceId })
          if (job !== current || terminal(current.state)) return
          if (status.state === 'closed') { cancel(); return }
          if (['connected', 'authenticating', 'user-action'].includes(status.state)) { current.state = 'connecting'; current.nextRetryAt = undefined; current.startedAt = Date.now(); current.readyAt = undefined; current.errorAt = undefined }
        }
        if (current.state === 'waiting') {
        if (Date.now() < current.nextRetryAt) return
        if (current.windowId) await call('disconnect', { windowId: current.windowId })
        if (job !== current || terminal(current.state)) return
        current.windowId = undefined
        current.remaining = ranked(current)
        current.attempt = 0
        await attempt(current)
        return
        }
      }
      const observed = await call('sessionStatus', { windowId: current.windowId, deviceId: current.deviceId })
      if (job !== current || terminal(current.state)) return
      if (observed.state === 'closed') { cancel(); return }
      if (observed.state === 'network-unavailable') { retry(current, 'waiting', 'NETWORK_UNAVAILABLE'); return }
      if (observed.state === 'user-action') {
        current.state = 'user-action'; current.reason = 'CHECK_AUTHENTICATION_OR_PERMISSION'; current.password = undefined
        return
      }
      const ready = observed.state === 'connected' && observed.direct === true && (current.mode === 'files' || observed.video === true)
      if (ready) {
        current.errorAt = undefined; current.reason = undefined
        current.stableAt ??= Date.now()
        current.readyAt ??= Date.now()
        if (Date.now() - current.stableAt >= 15000 && current.state !== 'connected') {
          await record(current)
          if (job !== current || terminal(current.state)) return
          current.state = 'connected'
          current.failures = 0
          current.attempts.at(-1).state = 'connected'
          current.remaining = ranked(current).filter(profile => profile.id !== current.profile.id)
          current.attempt = 1
        }
        if (current.state === 'connected' && Date.now() - current.recordAt >= 30000) await record(current)
      } else {
        if (current.state !== 'connected') current.stableAt = undefined
        if (observed.state === 'authenticating') {
          // A password/approval dialog belongs to the user, never to network retries.
          current.authAt ??= Date.now()
          if (Date.now() - current.authAt >= 45000) {
            current.state = 'user-action'; current.reason = 'CHECK_AUTHENTICATION_OR_PERMISSION'; current.password = undefined
            return
          }
        } else current.authAt = undefined
        const timedOut = observed.state !== 'authenticating' && Date.now() - current.startedAt >= 45000 && current.state !== 'connected'
        const failed = observed.state === 'network-error' || observed.direct === false || timedOut
        if (failed) {
          // Keep the native window through short outages. Only a persistent error
          // may invalidate the selected route; FPS/delay changes never switch it.
          current.errorAt ??= Date.now()
          current.reason = 'WAITING_FOR_RECOVERY'
          if (observed.direct !== false && !timedOut && Date.now() - current.errorAt < 15000) return
          await record(current, true)
          if (job !== current || terminal(current.state)) return
          current.attempts.at(-1).state = 'failed'
          current.attempts.at(-1).reason = observed.direct === false ? 'DIRECT_REQUIRED' : 'NETWORK_OR_TIMEOUT'
          await call('disconnect', { windowId: current.windowId })
          current.windowId = undefined
          if (job !== current || terminal(current.state)) return
          current.authAt = undefined
          const remaining = new Set(current.remaining.map(profile => profile.id))
          current.remaining = ranked(current).filter(profile => remaining.has(profile.id))
          await attempt(current)
        } else { current.errorAt = undefined; current.reason = undefined }
      }
    } catch (error) {
      if (job === current && !terminal(current.state)) {
        if (recover && !['REMOTE_ENGINE_UPDATE_REQUIRED', 'REMOTE_BUSY'].includes(error.apiCode)) retry(current, 'recovering-engine', 'REMOTE_ENGINE_UNAVAILABLE')
        else { current.state = 'engine-error'; current.reason = 'REMOTE_ENGINE_UNAVAILABLE'; current.password = undefined }
      }
    } finally {
      busy = false
      schedule(current)
    }
  }
  return {
    snapshot, cancel,
    get active() { return busy || (job && !terminal(job.state)) },
    async connect({ deviceId, password, mode, preferred, history = {} }) {
      if (busy || (job && !terminal(job.state))) throw Object.assign(Error('An automatic connection is already active; stop it before opening another session.'), { apiCode: 'REMOTE_BUSY' })
      busy = true
      const remaining = rankConnectionProfiles(history, preferred)
      const current = { deviceId, password, mode, preferred, history: structuredClone(history), remaining, attempt: 0, attempts: [], state: 'connecting' }
      job = current
      try {
        const native = await prepare(current)
        current.enginePid = native?.pid
        if (job !== current || terminal(current.state)) return { automatic: snapshot() }
        const result = await attempt(current)
        schedule(current)
        return { ...result, automatic: snapshot() }
      } catch (error) {
        if (recover && ['REMOTE_NOT_RUNNING', 'REMOTE_START_FAILED'].includes(error.apiCode) && job === current && !terminal(current.state)) {
          retry(current, 'recovering-engine', 'REMOTE_ENGINE_UNAVAILABLE')
          schedule(current)
          return { automatic: snapshot() }
        }
        cancel()
        throw error
      } finally { busy = false }
    }
  }
}
