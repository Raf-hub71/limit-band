import type { Register } from 'claude-code'

const NAMES: Record<string, string> = {
  five_hour: '5-Std-Limit',
  seven_day: 'Wochenlimit',
}

const bar = (pct: number, width = 12) => {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0')
// Farbverlauf grün (0) -> gelb (50) -> rot (100)
const grad = (t: number) => {
  const x = Math.max(0, Math.min(1, t))
  const r = x < 0.5 ? 60 + (230 - 60) * (x / 0.5) : 230 + (220 - 230) * ((x - 0.5) / 0.5)
  const g = x < 0.5 ? 190 + (200 - 190) * (x / 0.5) : 200 + (60 - 200) * ((x - 0.5) / 0.5)
  const b = x < 0.5 ? 80 + (60 - 80) * (x / 0.5) : 60 + (60 - 60) * ((x - 0.5) / 0.5)
  return `#${hex(r)}${hex(g)}${hex(b)}`
}
const cells = (pct: number, width = 14) => {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  return Array.from({ length: width }, (_, i) => ({ on: i < filled, color: grad((i + 0.5) / width) }))
}

const until = (iso: string | undefined, now: number) => {
  if (!iso) return ''
  const ms = Date.parse(iso) - now
  if (Number.isNaN(ms) || ms <= 0) return ' · gleich zurück'
  const min = Math.round(ms / 60000)
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  if (d > 0) return ` · zurück in ${d} T ${h} Std`
  if (h > 0) return ` · zurück in ${h} Std ${m} Min`
  return ` · zurück in ${m} Min`
}

export const register: Register = on => {
  const warned = new Set<string>()

  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'limits',
      description:
        'Zeigt, wie viel vom 5-Stunden-Limit und vom Wochenlimit des Abos verbraucht und noch übrig ist, mit Zeit bis zum Zurücksetzen. Aufrufen, wenn der Nutzer nach seinem Limit, Verbrauch oder Rest in Prozent fragt.',
      isDeferred: false,
    })
    return next(e)
  })

  on('tool.call', { tool: 'mcp__limit-band__limits' }, async ($, e, next) => {
    const usage = await $.session.usage()
    const now = await $.clock.now()
    const limits = usage.rateLimits.filter(r => NAMES[r.kind])
    const text =
      limits.length === 0
        ? 'Noch kein Limit-Messwert vorhanden (kommt nach der nächsten Antwort oder das Abo meldet keine Limits).'
        : limits
            .map(
              r =>
                `${NAMES[r.kind]}: ${r.percentUsed} % verbraucht, ${Math.max(0, Math.round((100 - r.percentUsed) * 10) / 10)} % übrig${until(r.resetsAt, now)}`,
            )
            .join('\n')
    return { result: text }
  })

  on('session.measure', async ($, e, next) => {
    const parts = (e.rateLimits ?? [])
      .filter(r => NAMES[r.kind])
      .map(r => `${NAMES[r.kind]} ${Math.round(100 - r.percentUsed)} % übrig`)
    if (parts.length > 0) $.ui.status(parts.join(' | '))
    for (const r of e.rateLimits ?? []) {
      const name = NAMES[r.kind] ?? r.kind
      for (const step of [95, 80]) {
        const key = `${r.kind}-${step}`
        if (r.percentUsed >= step && !warned.has(key)) {
          warned.add(key)
          $.ui.toast(`${name}: ${Math.round(r.percentUsed)} % verbraucht, ${Math.round(100 - r.percentUsed)} % übrig`)
          break
        }
      }
      if (r.percentUsed < 70) {
        warned.delete(`${r.kind}-80`)
        warned.delete(`${r.kind}-95`)
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const usage = await $.session.usage()
    const now = await $.clock.now()
    const limits = usage.rateLimits.filter(r => NAMES[r.kind])

    if (limits.length === 0) {
      return (
        <Box>
          <Text dimColor>Limit: noch kein Messwert (kommt nach der nächsten Antwort)</Text>
        </Box>
      )
    }

    return (
      <Box>
        <Text>
          {limits.map((r, idx) => {
            const left = Math.max(0, 100 - r.percentUsed)
            const c = grad(r.percentUsed / 100)
            return (
              <Text key={r.kind}>
                {idx > 0 ? '   |   ' : ''}
                {NAMES[r.kind]}{' '}
                {cells(r.percentUsed).map((cell, i) => (
                  <Text key={i} color={cell.on ? cell.color : '#555555'}>
                    {cell.on ? '█' : '░'}
                  </Text>
                ))}{' '}
                <Text color={c} bold>{Math.round(left)} % übrig</Text>
                {until(r.resetsAt, now)}
              </Text>
            )
          })}
        </Text>
      </Box>
    )
  })
}
