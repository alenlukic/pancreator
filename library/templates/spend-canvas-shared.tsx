// Shared chart code of the spend canvases. `pan spend --canvas` pastes this
// file in place of the shared marker of spend-report.canvas.tsx and
// spend-trends.canvas.tsx, so it declares no imports: each host template
// imports `Row`, `Stack`, `Text`, `useHostTheme`, and `useState` from
// cursor/canvas.

interface Bracket {
  label: string
  name: string
  start: string
  end: string
  source: string
}

interface DailySeries {
  name: string
  data: number[]
}

const BRACKET_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]
const DAY_MS = 86_400_000

const bracketDay = (iso: string) =>
  `${BRACKET_MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`

/** Every UTC day from the start timestamp's day to the end timestamp's day. */
function utcDays(startIso: string, endIso: string): string[] {
  const days: string[] = []
  const last = Date.parse(`${endIso.slice(0, 10)}T00:00:00.000Z`)

  for (
    let at = Date.parse(`${startIso.slice(0, 10)}T00:00:00.000Z`);
    at <= last;
    at += DAY_MS
  ) {
    days.push(new Date(at).toISOString().slice(0, 10))
  }

  return days
}

/** `Sep 23`, `Aug 10–13`, or `Sep 26 – Oct 8`. */
function bracketSpan(bracket: Bracket): string {
  if (bracket.start === bracket.end) {
    return bracketDay(bracket.start)
  }

  return bracket.start.slice(0, 7) === bracket.end.slice(0, 7)
    ? `${bracketDay(bracket.start)}–${Number(bracket.end.slice(8, 10))}`
    : `${bracketDay(bracket.start)} – ${bracketDay(bracket.end)}`
}

/** Days, cost, and daily rate of each bracket from a cost series over `dates`. */
function bracketStats(
  brackets: Bracket[],
  dates: string[],
  costs: number[],
): Array<{
  bracket: Bracket
  days: number
  cost: number
  perDay: number
  share: number
  lift: number
}> {
  const total = costs.reduce((sum, value) => sum + value, 0)
  const windowRate = dates.length > 0 ? total / dates.length : 0

  return brackets.map((bracket) => {
    const inside = dates
      .map((date, index) => ({ date, cost: costs[index] ?? 0 }))
      .filter(({ date }) => date >= bracket.start && date <= bracket.end)
    const cost = inside.reduce((sum, item) => sum + item.cost, 0)
    const perDay = inside.length > 0 ? cost / inside.length : 0

    return {
      bracket,
      days: inside.length,
      cost,
      perDay,
      share: total > 0 ? cost / total : 0,
      lift: windowRate > 0 ? perDay / windowRate : 0,
    }
  })
}

function niceStep(value: number): number {
  const power = 10 ** Math.floor(Math.log10(value))
  const fraction = value / power
  const nice =
    fraction <= 1
      ? 1
      : fraction <= 2
        ? 2
        : fraction <= 2.5
          ? 2.5
          : fraction <= 5
            ? 5
            : 10

  return nice * power
}

function compactValue(value: number, prefix: string): string {
  if (value >= 1_000_000) {
    return `${prefix}${(value / 1_000_000).toFixed(1).replace(/\.0$/u, '')}M`
  }

  if (value >= 1_000) {
    return `${prefix}${(value / 1_000).toFixed(1).replace(/\.0$/u, '')}k`
  }

  return `${prefix}${Math.round(value)}`
}

interface PlacedBracket {
  bracket: Bracket
  x1: number
  x2: number
  labelX: number
  lane: number
}

// Bracket labels are measured by an average glyph width, because an SVG
// canvas cannot measure text before it renders.
const LABEL_GLYPH_PX = 6.6
const LABEL_FONT_PX = 11

function placeBrackets(
  brackets: Bracket[],
  dates: string[],
  column: (index: number) => { left: number; right: number },
  bounds: { left: number; right: number },
): PlacedBracket[] {
  const laneEnds: number[] = []
  const placed: PlacedBracket[] = []
  const ordered = [...brackets].sort(
    (a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end),
  )

  for (const bracket of ordered) {
    const first = dates.findIndex((date) => date >= bracket.start)
    const after = dates.findIndex((date) => date > bracket.end)
    const lastIndex = (after < 0 ? dates.length : after) - 1

    if (first < 0 || lastIndex < first) {
      continue
    }

    const x1 = column(first).left
    const x2 = column(lastIndex).right
    const halfLabel = (bracket.name.length * LABEL_GLYPH_PX) / 2 + 4
    const labelX = Math.min(
      Math.max((x1 + x2) / 2, bounds.left + halfLabel),
      bounds.right - halfLabel,
    )
    const low = Math.min(x1, labelX - halfLabel)
    const high = Math.max(x2, labelX + halfLabel)
    let lane = laneEnds.findIndex((end) => end + 10 <= low)

    if (lane < 0) {
      lane = laneEnds.length
      laneEnds.push(high)
    } else {
      laneEnds[lane] = high
    }

    placed.push({ bracket, x1, x2, labelX, lane })
  }

  return placed
}

/**
 * Stacked daily bars with red brackets above the plot, one per labeled
 * period. The SVG scales to its container width; overlapping brackets take
 * separate lanes.
 */
function BracketedDailyChart({
  dates,
  categories,
  series,
  brackets,
  valuePrefix = '$',
  height = 240,
}: {
  dates: string[]
  categories: string[]
  series: DailySeries[]
  brackets: Bracket[]
  valuePrefix?: string
  height?: number
}) {
  const theme = useHostTheme()
  const [hovered, setHovered] = useState<number | null>(null)
  const red = theme.category.red
  const colors = theme.chart.sequence
  const width = 1000
  const left = 56
  const right = 12
  const laneHeight = 22
  const band = (width - left - right) / Math.max(dates.length, 1)
  const gap = Math.min(band * 0.2, 6)
  const column = (index: number) => ({
    left: left + index * band + gap / 2,
    right: left + (index + 1) * band - gap / 2,
  })
  const placed = placeBrackets(brackets, dates, column, {
    left,
    right: width - right,
  })
  const lanes = placed.reduce((most, item) => Math.max(most, item.lane + 1), 0)
  const plotTop = lanes * laneHeight + (lanes > 0 ? 12 : 6)
  const plotBottom = plotTop + height
  const totalHeight = plotBottom + 24
  const totals = dates.map((_, index) =>
    series.reduce((sum, item) => sum + (item.data[index] ?? 0), 0),
  )
  const step = niceStep(Math.max(...totals, 1) / 4)
  const top = step * Math.max(1, Math.ceil(Math.max(...totals, 1) / step))
  const y = (value: number) => plotBottom - (value / top) * height
  const ticks = Array.from(
    { length: Math.round(top / step) + 1 },
    (_, index) => index * step,
  )
  const labelEvery = Math.max(1, Math.ceil(52 / band))
  const money = (value: number) =>
    `${valuePrefix}${Math.round(value).toLocaleString('en-US')}`
  const inBrackets = (date: string) =>
    brackets
      .filter((bracket) => date >= bracket.start && date <= bracket.end)
      .map((bracket) => bracket.name)
  const readout =
    hovered === null
      ? null
      : [
          `${categories[hovered]} · ${money(totals[hovered] ?? 0)}`,
          ...series
            .filter((item) => (item.data[hovered] ?? 0) > 0)
            .map((item) => `${item.name} ${money(item.data[hovered] ?? 0)}`),
          ...inBrackets(dates[hovered] ?? ''),
        ].join(' · ')

  return (
    <Stack gap={8}>
      <svg
        viewBox={`0 0 ${width} ${totalHeight}`}
        width="100%"
        role="img"
        aria-label="Daily charged cost with labeled periods"
        style={{ display: 'block', fontFamily: theme.typography.fontFamily }}
        onMouseLeave={() => setHovered(null)}
      >
        {hovered !== null && (
          <rect
            x={left + hovered * band}
            y={plotTop}
            width={band}
            height={height}
            fill={theme.fill.tertiary}
          />
        )}
        {placed.map(({ bracket, x1, x2 }) => (
          <rect
            key={`band-${bracket.label}`}
            x={x1}
            y={plotTop}
            width={x2 - x1}
            height={height}
            fill={red}
            opacity={0.07}
          />
        ))}
        {ticks.map((tick) => (
          <g key={`tick-${tick}`}>
            <line
              x1={left}
              x2={width - right}
              y1={y(tick)}
              y2={y(tick)}
              stroke={theme.stroke.tertiary}
              strokeWidth={1}
            />
            <text
              x={left - 8}
              y={y(tick) + 3.5}
              textAnchor="end"
              fontSize={10}
              fill={theme.text.tertiary}
            >
              {compactValue(tick, valuePrefix)}
            </text>
          </g>
        ))}
        {dates.map((date, index) => {
          const { left: x, right: x2 } = column(index)
          let base = 0

          return (
            <g key={date}>
              {series.map((item, seriesIndex) => {
                const value = item.data[index] ?? 0
                const y1 = y(base + value)
                const y0 = y(base)

                base += value

                return value > 0 ? (
                  <rect
                    key={item.name}
                    x={x}
                    y={y1}
                    width={Math.max(x2 - x, 1)}
                    height={Math.max(y0 - y1, 0.5)}
                    fill={colors[seriesIndex % colors.length]}
                  />
                ) : null
              })}
              {(index === dates.length - 1 ||
                (index % labelEvery === 0 &&
                  dates.length - 1 - index >= labelEvery / 2)) && (
                <text
                  x={(x + x2) / 2}
                  y={plotBottom + 15}
                  textAnchor="middle"
                  fontSize={10}
                  fill={theme.text.tertiary}
                >
                  {categories[index]}
                </text>
              )}
              <rect
                x={left + index * band}
                y={plotTop}
                width={band}
                height={height}
                fill="transparent"
                onMouseEnter={() => setHovered(index)}
              />
            </g>
          )
        })}
        <line
          x1={left}
          x2={width - right}
          y1={plotBottom}
          y2={plotBottom}
          stroke={theme.stroke.secondary}
          strokeWidth={1}
        />
        {placed.map(({ bracket, x1, x2, labelX, lane }) => {
          const lineY = plotTop - 8 - lane * laneHeight

          return (
            <g key={`bracket-${bracket.label}`}>
              <title>{`${bracket.name} · ${bracketSpan(bracket)} · from ${bracket.source}`}</title>
              <path
                d={`M ${x1} ${lineY + 6} V ${lineY} H ${x2} V ${lineY + 6}`}
                fill="none"
                stroke={red}
                strokeWidth={1.75}
                strokeLinejoin="round"
              />
              <text
                x={labelX}
                y={lineY - 4}
                textAnchor="middle"
                fontSize={LABEL_FONT_PX}
                fontWeight={600}
                fill={red}
              >
                {bracket.name}
              </text>
            </g>
          )
        })}
      </svg>
      <Text size="small" tone={readout === null ? 'quaternary' : 'secondary'}>
        {readout ?? 'Hover a day for its cost breakdown.'}
      </Text>
      {series.length > 1 && (
        <Row gap={16} wrap>
          {series.map((item, index) => (
            <Row key={item.name} gap={6} align="center">
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: colors[index % colors.length],
                }}
              />
              <Text size="small" tone="secondary">
                {item.name}
              </Text>
            </Row>
          ))}
        </Row>
      )}
    </Stack>
  )
}
