/*
 * Typst-malen for tilstandsrapporten (ADR 0016 punkt 4, docs/funksjoner/fase2a-pdf-badet-design.md).
 * Fast kode i repoet, aldri bygget av rapporttekst. Dataene kommer som JSON i `sys.inputs.data`
 * (modellen fra `layout.ts`) og settes bare som tekstverdier: ingen `eval`, ingen `@preview`-pakker,
 * ingen `read`. Bilder og logo finnes under `/assets/` som byte fra `render.ts`.
 *
 * Malen tegner bare det `layout.ts` har bestemt. Reglene for sideskift (design avsnitt 3):
 * overskrifter holdes sammen med det som følger (sticky), avvikskort holdes samlet når de får plass
 * på en side, og deles ellers bare mellom radene, med «… avvik, fortsetter» øverst på neste side.
 * Kostnad, TG-merker, tall og oppdragsnummer er udelelige. Topplinje, bunntekst og vannmerke ligger
 * i sidens topp, bunn og bakgrunn, som den taggede PDF-en merker som gjenstander (artifacts).
 */
export const REPORT_PDF_TEMPLATE = String.raw`
#let d = json(bytes(sys.inputs.data))
#let col = d.colors
#let c(hex) = rgb(hex)
#let made = d.meta.date

#set document(
  title: d.meta.title,
  author: (),
  keywords: (),
  date: datetime(
    year: made.at(0), month: made.at(1), day: made.at(2),
    hour: made.at(3), minute: made.at(4), second: made.at(5),
  ),
)

// --- Skrift og avsnitt (design 1.1) ---
#set text(
  lang: "nb", font: d.fonts.body, size: 10pt, fill: c(col.text),
  hyphenate: true, top-edge: 0.8em, bottom-edge: -0.2em,
)
#set par(justify: false, leading: 4.5pt, spacing: 8pt)
#set heading(numbering: none)
#show heading: set text(font: d.fonts.heading, hyphenate: false)
#show heading.where(level: 1): set text(size: 20pt, weight: 700)
#show heading.where(level: 1): set block(above: 0pt, below: 12pt)
#show heading.where(level: 2): set text(size: 13.5pt, weight: 600)
#show heading.where(level: 2): set block(above: 0pt, below: 0pt)
#show link: set text(fill: c(col.link))

// Udelelig tekst: aldri orddeling og aldri linjeskift inni.
#let keep(body) = box(text(hyphenate: false, body))

// --- Merker (design 1.2) ---
#let badge(b) = {
  if b == none { return none }
  let stroke = if b.style == "not_set" {
    (paint: c(b.color), thickness: 1pt, dash: "dashed")
  } else { none }
  box(
    fill: c(b.background), stroke: stroke, radius: 8pt, inset: (x: 6pt), height: 16pt,
    align(horizon, text(size: 9pt, weight: 600, fill: c(b.color), hyphenate: false, b.text)),
  )
}

#let draft-link(l) = {
  if l == none { return none }
  link(l.url, box(height: 24pt, inset: (x: 2pt), align(horizon, text(
    size: 9pt, weight: 500, fill: c(col.link), hyphenate: false,
    underline(d.texts.draftLink),
  ))))
}

#let note-line(n) = block(
  breakable: false, width: 100%,
  stroke: (left: 3pt + (if n.kind == "missing" { c(col.text) } else { c(col.rule) })),
  inset: (left: 8pt, y: 3pt),
  grid(
    columns: (1fr, auto), column-gutter: 8pt, align: (left + horizon, right + horizon),
    text(size: 9.5pt, weight: if n.kind == "missing" { 600 } else { 400 }, n.text),
    draft-link(n.link),
  ),
)

#let notes(list) = for n in list { note-line(n) }

// --- Usynlige merker for sidekartet (bare når oppsettet har pageMap: true) ---
// Et merke er metadata uten mål, så det flytter aldri linje- eller sideskift. Uten sidekart er
// alle merkene none, og malen tegner det samme som før.
#let page-mark(edge, pm) = if pm != none {
  [#metadata((edge: edge, anchor: pm.anchor, mark: pm.mark)) <pdf-page-mark>]
}
#let pm-of(marks, key) = if marks == none { none } else { marks.at(key) }

// Fast tabell med etikett og verdi. En rad deles aldri. Med merker (ett per rad) står start-
// merket øverst i etiketten; raden slutter der neste rad begynner, og den siste etter tabellen.
#let rows(items, label-width, marks: none) = {
  if items.len() == 0 { return none }
  if marks == none {
    grid(
      columns: (label-width, 1fr), column-gutter: 8pt, row-gutter: 4pt,
      ..items.map(r => (
        text(size: 9.5pt, weight: 500, fill: c(col.muted), hyphenate: false, r.label),
        text(r.value),
      )).flatten(),
    )
  } else {
    grid(
      columns: (label-width, 1fr), column-gutter: 8pt, row-gutter: 4pt,
      ..items.enumerate().map(((i, r)) => (
        {
          if i > 0 { page-mark("end", marks.at(i - 1)) }
          page-mark("start", marks.at(i))
          text(size: 9.5pt, weight: 500, fill: c(col.muted), hyphenate: false, r.label)
        },
        text(r.value),
      )).flatten(),
    )
    page-mark("end", marks.at(items.len() - 1))
  }
}

// --- Bilder med markering som vektorlag (design 2.4) ---
// Mål fra oppsettet er for en ramme på 84 mm. k skalerer ned når kortet er smalere.
#let marking(m, k) = {
  let u = k * 1mm
  let shape(s, paint) = {
    if m.type == "circle" {
      place(top + left, dx: (m.cx - m.r) * u, dy: (m.cy - m.r) * u,
        circle(radius: m.r * u, stroke: s))
    } else if m.type == "rectangle" {
      place(top + left, dx: m.x * u, dy: m.y * u,
        rect(width: m.width * u, height: m.height * u, stroke: s))
    } else {
      let dx = m.x2 - m.x1
      let dy = m.y2 - m.y1
      let len = calc.max(calc.sqrt(dx * dx + dy * dy), 0.001)
      let ux = dx / len
      let uy = dy / len
      let head = calc.min(3.5, len / 2)
      let bx = m.x2 - ux * head
      let by = m.y2 - uy * head
      place(top + left, line(start: (m.x1 * u, m.y1 * u), end: (bx * u, by * u), stroke: s))
      place(top + left, polygon(
        stroke: s, fill: paint,
        (m.x2 * u, m.y2 * u),
        ((bx - uy * head * 0.6) * u, (by + ux * head * 0.6) * u),
        ((bx + uy * head * 0.6) * u, (by - ux * head * 0.6) * u),
      ))
    }
  }
  // Hvit kant på 1 pt rundt streken på 2 pt, så markeringen synes på lyse og mørke bilder.
  shape(4pt + white, white)
  shape(2pt + c(col.marking), c(col.marking))
}

#let photo(img, k) = block(breakable: false, width: 84mm * k, {
  box(width: img.widthMm * k * 1mm, height: img.heightMm * k * 1mm, {
    image(img.path, width: img.widthMm * k * 1mm, height: img.heightMm * k * 1mm, alt: img.alt)
    for m in img.markings { place(top + left, marking(m, k)) }
  })
  if img.caption != none {
    v(3pt, weak: true)
    text(size: 8.5pt, fill: c(col.muted), img.caption)
  }
})

// To bilder per rad, 6 mm mellom. Rammen er 84 mm, eller mindre når kortet er smalere.
#let photo-rows(image-rows) = layout(size => {
  let frame = calc.min(84mm, (size.width - 6mm) / 2)
  let k = frame / 84mm
  for r in image-rows {
    block(breakable: false, above: 8pt, below: 0pt, grid(
      columns: (frame, frame), column-gutter: 6mm,
      ..r.map(img => photo(img, k)),
    ))
  }
})

// --- Avvikskort (design 2.4 og 3) ---
#let card-row(label, body) = block(breakable: true, width: 100%, above: 6pt, below: 0pt, grid(
  columns: (32mm, 1fr), column-gutter: 8pt,
  text(weight: 600, hyphenate: false, label),
  body,
))

#let deviation-body(dev) = {
  let pm = dev.pageMarks
  [#metadata((id: dev.anchor, text: dev.continued)) <pdf-card-start>]
  page-mark("start", pm-of(pm, "deviation"))
  block(sticky: true, below: 6pt, grid(
    columns: (1fr, auto), align: (left + horizon, right + horizon),
    badge(dev.badge), draft-link(dev.link),
  ))
  notes(dev.notes)
  if dev.text != none {
    page-mark("start", pm-of(pm, "text"))
    block(above: 6pt, below: 0pt, par(dev.text))
    page-mark("end", pm-of(pm, "text"))
  }
  if dev.cause != none {
    page-mark("start", pm-of(pm, "cause"))
    card-row(d.texts.cause, dev.cause)
    page-mark("end", pm-of(pm, "cause"))
  }
  if dev.consequence != none {
    page-mark("start", pm-of(pm, "consequence"))
    card-row(d.texts.consequence, dev.consequence)
    page-mark("end", pm-of(pm, "consequence"))
  }
  if dev.measures.len() > 0 {
    page-mark("start", pm-of(pm, "measures"))
    card-row(d.texts.measures, enum(tight: true, spacing: 4pt, ..dev.measures.map(m => [#m])))
    page-mark("end", pm-of(pm, "measures"))
  }
  if dev.cost != none {
    page-mark("start", pm-of(pm, "cost"))
    card-row(d.texts.cost, {
      if dev.cost.display != none { keep(dev.cost.display) }
      if dev.cost.display != none and dev.cost.text != none { linebreak() }
      if dev.cost.text != none { dev.cost.text }
    })
    page-mark("end", pm-of(pm, "cost"))
  }
  photo-rows(dev.imageRows)
  page-mark("end", pm-of(pm, "deviation"))
  [#metadata(dev.anchor) <pdf-card-end>]
}

#let deviation-card(dev) = {
  let body = deviation-body(dev)
  let frame(breakable, inner) = block(
    breakable: breakable, width: 100%, above: 10pt, below: 0pt,
    fill: c(col.page), radius: 9pt, clip: false,
    stroke: (left: 3pt + c(dev.stroke), rest: 0.75pt + c(col.rule)),
    inset: (left: 12pt, rest: 12pt),
    inner,
  )
  // Holdes samlet når kortet får plass på én side; ellers deles det mellom radene.
  layout(size => {
    let height = measure(frame(false, body), width: size.width).height
    frame(height > size.height, body)
  })
}

// --- TGIU (design 2.4) ---
#let tgiu-panel(t) = block(
  breakable: false, width: 100%, above: 10pt, below: 0pt,
  fill: c(col.panel), radius: 9pt, inset: 12pt, {
    badge(t.badge)
    v(6pt, weak: true)
    rows(t.rows, 45mm)
    if t.ownerInformedText != none {
      v(6pt, weak: true)
      par(t.ownerInformedText)
    }
  },
)

// --- Kontrollpunkt ---
#let checkpoint(cp, first) = {
  if not first {
    block(above: 18pt, below: 12pt, line(length: 100%, stroke: 0.5pt + c(col.rule)))
  }
  let pm = cp.pageMarks
  page-mark("start", pm-of(pm, "checkpoint"))
  block(sticky: true, below: 4pt, grid(
    columns: (1fr, auto), column-gutter: 8pt, align: (left + top, right + top),
    [#heading(level: 2, cp.title)#label(cp.anchor)],
    badge(cp.badge),
  ))
  if cp.link != none { block(sticky: true, above: 0pt, below: 4pt, draft-link(cp.link)) }
  notes(cp.notes)
  if cp.description != none {
    page-mark("start", pm-of(pm, "description"))
    block(above: 6pt, below: 0pt, par(cp.description))
    page-mark("end", pm-of(pm, "description"))
  }
  if cp.answers.len() > 0 {
    block(above: 8pt, below: 0pt, rows(cp.answers, 60mm, marks: pm-of(pm, "answers")))
  }
  for dev in cp.deviations { deviation-card(dev) }
  if cp.tgiu != none {
    page-mark("start", pm-of(pm, "tgiu"))
    tgiu-panel(cp.tgiu)
    page-mark("end", pm-of(pm, "tgiu"))
  }
  page-mark("end", pm-of(pm, "checkpoint"))
}

// --- Sidene ---
#let footer-part(p) = {
  if p.kind == "legal_company" {
    if p.missing { text(fill: c(col.text), weight: 600, p.text) } else { p.text }
  } else if p.kind == "assignment_number" {
    keep(p.text)
  } else {
    keep(p.prefix + " " + str(here().page()) + " " + p.middle + " " + str(counter(page).final().first()))
  }
}

#let footer-columns(n) = if n == 3 { (1fr, 34mm, 40mm) } else { (1fr,) * calc.max(n, 1) }
#let footer-align(i, n) = if n == 1 { left } else if i == 0 { left } else if i == n - 1 { right } else { center }

#set page(
  paper: "a4",
  flipped: d.page.flipped,
  margin: (top: 18mm, bottom: 22mm, left: 18mm, right: 18mm),
  fill: c(col.page),
  header-ascent: 35%,
  header: context {
    set text(size: 8.5pt, hyphenate: false)
    let here-page = here().page()
    let starts = query(<pdf-card-start>)
    let ends = query(<pdf-card-end>)
    let continued = ()
    for s in starts {
      let e = ends.find(x => x.value == s.value.id)
      if e != none and s.location().page() < here-page and e.location().page() >= here-page {
        continued.push(s.value.text)
      }
    }
    grid(
      columns: (auto, 1fr), column-gutter: 12pt, align: (left, right),
      if d.draft != none { text(weight: 700, fill: c(col.text), d.draft.banner) },
      if continued.len() > 0 { text(fill: c(col.muted), continued.last()) },
    )
  },
  footer-descent: 30%,
  footer: context {
    set text(size: 8.5pt, fill: c(col.muted), hyphenate: false)
    line(length: 100%, stroke: 0.5pt + c(col.rule))
    v(6pt, weak: true)
    let n = d.footer.len()
    grid(
      columns: footer-columns(n),
      ..d.footer.enumerate().map(((i, p)) => align(footer-align(i, n), footer-part(p))),
    )
  },
  background: context {
    if d.draft != none and here().page() > 1 {
      place(center + horizon, rotate(-45deg, reflow: false, text(
        font: d.fonts.heading, weight: 700, size: 110pt, fill: c(col.watermark),
        hyphenate: false, d.draft.watermark,
      )))
    }
  },
)

#let section-start(first) = if not first { pagebreak(weak: true) }

#for (index, s) in d.sections.enumerate() {
  section-start(index == 0)
  if s.kind == "cover" {
    if s.logo != none { image(s.logo.path, height: 14mm, alt: s.logo.alt) }
    v(60mm)
    block(below: 10pt, text(font: d.fonts.heading, weight: 700, size: 32pt, hyphenate: false, s.title))
    for a in s.addressLines { block(above: 0pt, below: 4pt, text(size: 16pt, a)) }
    if s.cadastralText != none { block(above: 4pt, below: 0pt, text(size: 11pt, fill: c(col.muted), s.cadastralText)) }
    block(above: 14pt, below: 24pt, line(length: 40mm, stroke: 2pt + c(col.accent)))
    block(breakable: false, width: 100%, fill: c(col.panel), radius: 9pt, inset: 12pt, grid(
      columns: (45mm, 1fr), row-gutter: 8pt,
      ..s.facts.map(f => (
        text(size: 9.5pt, fill: c(col.muted), hyphenate: false, f.label),
        keep(text(size: 11pt, weight: 600, f.value)),
      )).flatten(),
    ))
  } else if s.kind == "toc" {
    show link: set text(fill: c(col.text))
    heading(level: 1, outlined: false, bookmarked: false, s.heading)
    for e in d.toc {
      context {
        let target = query(label(e.anchor)).first().location()
        let page-number = counter(page).at(target).first()
        link(target, block(breakable: false, width: 100%, above: 6pt, below: 0pt, grid(
          columns: (auto, 1fr, auto, 12mm), column-gutter: 4pt, align: (left + bottom, left + bottom, right + horizon, right + bottom),
          pad(left: if e.level == 2 { 12pt } else { 0pt },
            text(weight: if e.level == 1 { 600 } else { 400 }, hyphenate: false, e.text)),
          box(width: 1fr, repeat(text(fill: c(col.rule), "."))),
          if e.tg != none { badge(e.tg) },
          keep(str(page-number)),
        )))
      }
    }
  } else if s.kind == "tg_explanation" {
    block(breakable: false, {
      [#heading(level: 1, s.heading)#label(s.anchor)]
      for (i, item) in s.items.enumerate() {
        block(above: 0pt, below: 0pt, inset: (y: 8pt), width: 100%,
          stroke: if i > 0 { (top: 0.5pt + c(col.rule)) } else { none },
          grid(columns: (62mm, 1fr), column-gutter: 8pt, badge(item.badge), par(item.text)))
      }
      block(above: 10pt, par(s.hmsText))
    })
  } else if s.kind == "room" {
    [#heading(level: 1, s.heading)#label(s.anchor)]
    if s.answers.len() > 0 { block(below: 12pt, rows(s.answers, 60mm)) }
    for (i, cp) in s.checkpoints.enumerate() { checkpoint(cp, i == 0) }
  } else if s.kind == "missing" {
    [#heading(level: 1, s.heading)#label(s.anchor)]
    par(s.intro)
    notes(s.reportNotes)
    if s.emptyHeading != none {
      block(above: 16pt, below: 8pt, sticky: true, heading(level: 2, s.emptyHeading))
      for e in s.empty {
        page-mark("start", e.pageMark)
        block(breakable: false, width: 100%, above: 4pt, below: 0pt, grid(
          columns: (1fr, auto), column-gutter: 8pt, align: (left + horizon, right + horizon),
          e.label, draft-link(e.link),
        ))
        page-mark("end", e.pageMark)
      }
    }
  }
}

#context [#metadata(counter(page).final().first()) <pdf-page-count>]
#if d.pageMap {
  context [#metadata(query(<pdf-page-mark>).map(m => {
    let p = m.location().position()
    (..m.value, page: p.page, x: p.x / 1pt, y: p.y / 1pt)
  })) <pdf-page-marks>]
}
`;
