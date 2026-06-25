---
name: visualize-data
description: Create safe, bounded data visualizations for MiWarp chat
category: development
icon: 📊
---

# Visualize Data

Choose the smallest visual that answers the question. Write a short conclusion before the chart and an accessible text summary after it.

## Chart selection

| Question type                                             | Preferred mark | Avoid                        |
| --------------------------------------------------------- | -------------- | ---------------------------- |
| Trend over time (dates, releases, latency)                | `line`         | Pie, 3D, dual y-axes         |
| Compare categories or groups                              | `bar`          | Pie with many slices         |
| Part-of-whole when few segments sum to a meaningful total | `arc` (pie)    | Pie for unrelated counts, 3D |

Default to `bar` or `line`. Use `arc` only when there are at most ~6 segments and the values represent shares of one whole.

## Output contracts

**KPI headline** — use `miwarp-kpi` for a few headline values:

```miwarp-kpi
{"title":"Release health","items":[{"label":"Tests","value":"1,666","trend":"up","detail":"All passing"},{"label":"Build","value":"Pass","status":"success"}]}
```

**Line (time trend)** — ordinal/time on x, quantitative on y; inline `data.values`, explicit `title` and axis labels:

```vega-lite
{"$schema":"https://vega.github.io/schema/vega-lite/v5.json","title":"Latency trend","data":{"values":[{"day":"Mon","ms":120},{"day":"Tue","ms":95}]},"mark":{"type":"line","point":true},"encoding":{"x":{"field":"day","type":"ordinal","title":"Day"},"y":{"field":"ms","type":"quantitative","title":"p95 latency (ms)"}}}
```

**Bar (category comparison)** — nominal x, quantitative y:

```vega-lite
{"$schema":"https://vega.github.io/schema/vega-lite/v5.json","title":"Errors by service","data":{"values":[{"service":"api","count":3},{"service":"worker","count":12}]},"mark":"bar","encoding":{"x":{"field":"service","type":"nominal","title":"Service"},"y":{"field":"count","type":"quantitative","title":"Errors"}}}
```

**Arc / pie (shares)** — only when slices are few and sum to a meaningful whole; prefer `theta` + `color`:

```vega-lite
{"$schema":"https://vega.github.io/schema/vega-lite/v5.json","title":"Traffic share","data":{"values":[{"source":"organic","pct":62},{"source":"paid","pct":38}]},"mark":{"type":"arc","innerRadius":40},"encoding":{"theta":{"field":"pct","type":"quantitative"},"color":{"field":"source","type":"nominal","title":"Source"}}}
```

All Vega-Lite specs must use inline `data` (no remote URLs), include `title`, axis/legend labels, and a written conclusion. Do not invent missing values — state assumptions and gaps in prose.
