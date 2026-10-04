(() => {
  const codes = ['zh-TW', 'zh-CN', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'it', 'ru', 'vi', 'th', 'id',
    'ms', 'tl', 'ar', 'hi', 'bn', 'ur', 'tr', 'nl', 'pl', 'uk', 'cs', 'sv', 'da', 'no', 'fi', 'el', 'he',
    'ro', 'hu', 'bg', 'sk', 'hr', 'sr', 'sl', 'et', 'lv', 'lt', 'fa', 'sw', 'ta', 'te', 'mr', 'gu', 'pa',
    'ne', 'si', 'my', 'km', 'lo', 'mn', 'af']
  const week = 7 * 24 * 60 * 60 * 1000

  function entry(usage, code, now) {
    const value = usage?.[code]
    return {
      count: Number.isFinite(value?.count) ? Math.max(0, Math.min(1_000_000, Math.floor(value.count))) : 0,
      lastUsed: Number.isFinite(value?.lastUsed) ? Math.max(0, Math.min(now, value.lastUsed)) : 0
    }
  }

  function rank(usage, locale, now = Date.now()) {
    const defaults = locale === 'zh-TW' ? ['zh-TW', 'en', 'ja', 'ko', 'zh-CN', 'es'] : ['en', 'zh-TW', 'ja', 'ko', 'es', 'fr']
    const score = code => {
      const value = entry(usage, code, now)
      return value.count ? Math.log2(value.count + 1) + 3 / (1 + (now - value.lastUsed) / week) : 0
    }
    const baseline = code => defaults.includes(code) ? defaults.indexOf(code) : defaults.length + codes.indexOf(code)
    const ordered = [...codes].sort((a, b) => score(b) - score(a) || baseline(a) - baseline(b))
    const frequent = ordered.slice(0, 6)
    return { frequent, other: codes.filter(code => !frequent.includes(code)) }
  }

  function record(usage, languages, now = Date.now()) {
    const next = {}
    for (const code of codes) {
      const value = entry(usage, code, now)
      if (value.count) next[code] = value
    }
    for (const code of new Set(languages)) {
      if (!codes.includes(code)) continue
      const value = entry(next, code, now)
      next[code] = { count: Math.min(1_000_000, value.count + 1), lastUsed: now }
    }
    return next
  }

  globalThis.floadeLanguages = { codes, rank, record }
})()
