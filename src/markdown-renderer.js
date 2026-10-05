(() => {
  const imageCache = new Map()
  let revision = 0
  window.floadeMarkdown = {
    async render(content, target, directoryURL) {
      const current = ++revision
      const fragment = DOMPurify.sanitize(marked.parse(content, { gfm: true }), {
        RETURN_DOM_FRAGMENT: true, USE_PROFILES: { html: true },
        FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'video', 'audio'],
        FORBID_ATTR: ['style', 'id', 'name', 'srcset']
      })
      for (const input of fragment.querySelectorAll('input')) {
        if (input.type !== 'checkbox') input.remove()
        else input.disabled = true
      }
      await Promise.all([...fragment.querySelectorAll('img')].map(async img => {
        const source = img.getAttribute('src') || ''
        img.removeAttribute('src')
        img.loading = 'lazy'
        try {
          const url = new URL(source, directoryURL)
          if (url.protocol === 'file:') {
            if (!imageCache.has(url.href)) imageCache.set(url.href, window.floadePreview.resolveImage(url.href))
            const safe = await imageCache.get(url.href)
            if (safe) img.src = safe
          } else if (['https:', 'http:'].includes(url.protocol) || /^data:image\/(png|jpeg|gif|webp|bmp|avif);base64,/i.test(source)) img.src = url.href
        } catch {}
      }))
      for (const link of fragment.querySelectorAll('a')) {
        const href = link.getAttribute('href') || ''
        link.removeAttribute('href')
        try {
          const url = new URL(href, directoryURL)
          if (['http:', 'https:', 'file:'].includes(url.protocol)) {
            link.href = url.href
            link.addEventListener('click', event => { event.preventDefault(); void window.floadePreview.openLink(url.href) })
          }
        } catch {}
      }
      if (current !== revision) return
      const scroll = target.scrollTop
      target.replaceChildren(fragment)
      target.scrollTop = scroll
    }
  }
})()
