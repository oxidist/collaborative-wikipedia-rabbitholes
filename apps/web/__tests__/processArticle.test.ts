import { describe, it, expect } from 'vitest'
import { processArticle, extractToc } from '../lib/processArticle'

describe('processArticle', () => {
  it('extracts the title from the first h1', () => {
    const html = '<h1 id="firstHeading">Octopus</h1><p>Some text.</p>'
    const result = processArticle(html, 'Octopus')
    expect(result.title).toBe('Octopus')
  })

  it('strips inner HTML tags from extracted title', () => {
    const html = '<h1><i>Octopus</i></h1><p>Text.</p>'
    const result = processArticle(html, 'Octopus')
    expect(result.title).toBe('Octopus')
  })

  it('falls back to slug-derived title if no h1', () => {
    const result = processArticle('<p>No heading.</p>', 'Six_degrees_of_Wikipedia')
    expect(result.title).toBe('Six degrees of Wikipedia')
  })

  it('rewrites classic /wiki/ links to data-wiki-slug (no href)', () => {
    const html = '<a href="/wiki/Cephalopod">Cephalopod</a>'
    const result = processArticle(html, 'Octopus')
    expect(result.html).toContain('data-wiki-slug="Cephalopod"')
    expect(result.html).not.toContain('href="/wiki/')
    expect(result.html).not.toContain('href="#"')
  })

  it('rewrites Parsoid ./Slug format links (actual Wikipedia API output)', () => {
    const html = '<a href="./Cephalopod">Cephalopod</a>'
    const result = processArticle(html, 'Octopus')
    expect(result.html).toContain('data-wiki-slug="Cephalopod"')
    expect(result.html).not.toContain('href=')
  })

  it('strips fragment from cross-page link slug', () => {
    const html = '<a href="./Cephalopod#Anatomy">Anatomy</a>'
    const result = processArticle(html, 'Octopus')
    expect(result.html).toContain('data-wiki-slug="Cephalopod"')
    expect(result.html).not.toContain('#Anatomy')
  })

  it('preserves same-page fragment as plain href (footnote forward-link)', () => {
    // Wikipedia mobile HTML: footnotes use ./Article#cite_note-X, not bare #cite_note-X
    const html = '<sup><a href="./Octopus#cite_note-1">[1]</a></sup>'
    const result = processArticle(html, 'Octopus')
    expect(result.html).toContain('href="#cite_note-1"')
    expect(result.html).not.toContain('data-wiki-slug')
  })

  it('preserves same-page fragment for /wiki/ format links', () => {
    const html = '<a href="/wiki/Octopus#cite_note-2">[2]</a>'
    const result = processArticle(html, 'Octopus')
    expect(result.html).toContain('href="#cite_note-2"')
    expect(result.html).not.toContain('data-wiki-slug')
  })

  it('decodes percent-encoded slugs in data-wiki-slug', () => {
    const html = '<a href="./Caf%C3%A9">Café</a>'
    const result = processArticle(html, 'Food')
    expect(result.html).toContain('data-wiki-slug="Café"')
  })

  it('does not rewrite external links but adds target=_blank and noopener', () => {
    const html = '<a href="https://example.com">external</a>'
    const result = processArticle(html, 'Octopus')
    expect(result.html).toContain('href="https://example.com"')
    expect(result.html).toContain('target="_blank"')
    expect(result.html).toContain('noopener')
    expect(result.html).toContain('noreferrer')
  })

  it('merges noopener/noreferrer into existing rel on external links', () => {
    const html = '<a href="https://example.com" rel="nofollow">external</a>'
    const result = processArticle(html, 'Octopus')
    expect(result.html).toContain('nofollow')
    expect(result.html).toContain('noopener')
    expect(result.html).toContain('noreferrer')
  })

  it('strips mw-editsection spans and their content', () => {
    const html = '<h2>Section<span class="mw-editsection">[<a href="/w/edit">edit</a>]</span></h2>'
    const result = processArticle(html, 'Octopus')
    expect(result.html).not.toContain('mw-editsection')
    expect(result.html).not.toContain('edit')
  })

  it('strips script tags and their content', () => {
    const html = '<p>Text</p><script>alert("xss")</script>'
    const result = processArticle(html, 'Octopus')
    expect(result.html).not.toContain('<script')
    expect(result.html).not.toContain('alert')
  })

  it('extracts body content from a full HTML document', () => {
    const html = '<html><head><title>ignored</title></head><body><p>content</p></body></html>'
    const result = processArticle(html, 'Test')
    expect(result.html).toContain('content')
    expect(result.html).not.toContain('ignored')
  })

  it('returns the original slug', () => {
    const result = processArticle('<p>text</p>', 'My_Article')
    expect(result.slug).toBe('My_Article')
  })

  it('adds loading=lazy to images that do not have a loading attribute', () => {
    const html = '<img src="https://upload.wikimedia.org/photo.jpg" alt="photo" width="200" height="100">'
    const result = processArticle(html, 'Test')
    expect(result.html).toContain('loading="lazy"')
  })

  it('does not duplicate loading attribute on images that already have one', () => {
    const html = '<img src="https://upload.wikimedia.org/photo.jpg" alt="photo" loading="eager">'
    const result = processArticle(html, 'Test')
    const matches = result.html.match(/loading=/g)
    expect(matches).toHaveLength(1)
    expect(result.html).toContain('loading="lazy"')
  })

  it('strips srcset from images', () => {
    const html = '<img src="https://upload.wikimedia.org/small.jpg" srcset="https://upload.wikimedia.org/large.jpg 2x" alt="photo">'
    const result = processArticle(html, 'Test')
    expect(result.html).not.toContain('srcset')
    expect(result.html).toContain('src="https://upload.wikimedia.org/small.jpg"')
  })

  it('promotes data-src to src for Wikipedia lazy-loaded images', () => {
    const html = '<img src="data:image/gif;base64,R0lGODlh" data-src="https://upload.wikimedia.org/real.jpg" alt="photo">'
    const result = processArticle(html, 'Test')
    expect(result.html).toContain('src="https://upload.wikimedia.org/real.jpg"')
    expect(result.html).not.toContain('data-src')
    expect(result.html).not.toContain('R0lGODlh')
  })

  it('preserves ex-unit width/height/vertical-align style on inline math images', () => {
    const html = '<p>The formula <img src="//wikimedia.org/api/rest_v1/media/math/render/svg/abc" class="mwe-math-fallback-image-inline" style="vertical-align: -0.838ex; width:12.167ex; height:3.009ex;" alt="f(x)"> appears here.</p>'
    const result = processArticle(html, 'Test')
    expect(result.html).toContain('width:12.167ex')
    expect(result.html).toContain('height:3.009ex')
    expect(result.html).toContain('vertical-align:-0.838ex')
  })

  it('strips non-math inline styles from images', () => {
    const html = '<img src="https://upload.wikimedia.org/photo.jpg" style="border: 1px solid red; float: left;" alt="photo">'
    const result = processArticle(html, 'Test')
    expect(result.html).not.toContain('border')
    expect(result.html).not.toContain('float')
  })

  it('converts Wikipedia span placeholders with data-src into img tags', () => {
    const html = '<figure><span data-src="//upload.wikimedia.org/photo.jpg" data-width="500" data-height="300" data-class="mw-file-element"></span></figure>'
    const result = processArticle(html, 'Test')
    expect(result.html).toContain('<img')
    expect(result.html).toContain('src="//upload.wikimedia.org/photo.jpg"')
    expect(result.html).toContain('width="500"')
    expect(result.html).toContain('height="300"')
    expect(result.html).not.toContain('data-src')
  })

  it('preserves the references section (reflist)', () => {
    const html = `
      <p>Text with a footnote.<sup><a href="#cite_note-1">[1]</a></sup></p>
      <div class="reflist">
        <ol>
          <li id="cite_note-1"><a href="#cite_ref-1">↑</a> Smith, J. (2020). <i>A Book</i>.</li>
        </ol>
      </div>
    `
    const result = processArticle(html, 'Test')
    expect(result.html).toContain('id="cite_note-1"')
    expect(result.html).toContain('Smith, J.')
  })

  it('preserves footnote fragment hrefs so jump-to-reference works', () => {
    const html = `<p><sup><a href="#cite_note-1">[1]</a></sup></p>
      <div class="mw-references-wrap"><ol><li id="cite_note-1">Ref text.</li></ol></div>`
    const result = processArticle(html, 'Test')
    expect(result.html).toContain('href="#cite_note-1"')
    expect(result.html).toContain('id="cite_note-1"')
  })

  it('rewrites anonymous pcs-ref-back-link href to cite_ref-N', () => {
    // Real PCS mobile HTML: backlinks use pcs-ref-back-link-cite_note-N hrefs.
    // The <sup id="cite_ref-N"> already exists in the static HTML.
    const html = `
      <p><sup id="cite_ref-1" class="mw-ref reference"><a href="./James_Starley#cite_note-1">[1]</a></sup></p>
      <div class="mw-references-wrap"><ol>
        <li id="cite_note-1"><a href="./James_Starley#pcs-ref-back-link-cite_note-1">↑</a></li>
      </ol></div>
    `
    const result = processArticle(html, 'James_Starley')
    expect(result.html).toContain('href="#cite_ref-1"')
    expect(result.html).not.toContain('pcs-ref-back-link')
  })

  it('rewrites named pcs-ref-back-link href to cite_ref-NAME_N-0', () => {
    // Named ref: cite_note-Bicycle-2 → cite_ref-Bicycle_2-0
    const html = `
      <p><sup id="cite_ref-Bicycle_2-0" class="mw-ref reference"><a href="./James_Starley#cite_note-Bicycle-2">[2]</a></sup></p>
      <div class="mw-references-wrap"><ol>
        <li id="cite_note-Bicycle-2"><a href="./James_Starley#pcs-ref-back-link-cite_note-Bicycle-2">↑</a></li>
      </ol></div>
    `
    const result = processArticle(html, 'James_Starley')
    expect(result.html).toContain('href="#cite_ref-Bicycle_2-0"')
    expect(result.html).not.toContain('pcs-ref-back-link')
  })

  it('does not modify links when no pcs-ref-back-link hrefs are present', () => {
    const html = '<p><sup id="cite_ref-1"><a href="./Test#cite_note-1">[1]</a></sup></p>'
    const result = processArticle(html, 'Test')
    expect(result.html).not.toContain('pcs-ref-back-link')
  })

  it('hoists wh-thumb figures to before the first <p> in a leaf section', () => {
    // Wikipedia mobile HTML puts figures AFTER paragraphs; float only works
    // on content that comes after the float in DOM order.
    const html = '<section><p>Lead text.</p><figure typeof="mw:File/Thumb" class="pcs-widen-image-ancestor"><img src="a.jpg" alt=""><figcaption>Cap</figcaption></figure></section>'
    const result = processArticle(html, 'Test')
    const figIndex = result.html.indexOf('<figure')
    const pIndex = result.html.indexOf('<p>')
    expect(figIndex).toBeGreaterThanOrEqual(0)
    expect(figIndex).toBeLessThan(pIndex)
  })

  it('does not hoist figures in sections that contain nested sections', () => {
    const html = '<section><p>Outer.</p><section><p>Inner.</p></section></section>'
    const result = processArticle(html, 'Test')
    // Should not throw and should produce valid output
    expect(result.html).toContain('Outer.')
    expect(result.html).toContain('Inner.')
  })

  it('adds wh-thumb class to figure[typeof="mw:File/Thumb"] thumbnails', () => {
    const html = '<figure typeof="mw:File/Thumb" class="mw-default-size"><img src="photo.jpg" alt=""><figcaption>Cap</figcaption></figure>'
    const result = processArticle(html, 'Test')
    expect(result.html).toContain('wh-thumb')
    expect(result.html).toContain('mw-default-size')
  })

  it('does not add wh-thumb to non-thumbnail figures', () => {
    const html = '<figure class="mw-gallery"><img src="photo.jpg" alt=""></figure>'
    const result = processArticle(html, 'Test')
    expect(result.html).not.toContain('wh-thumb')
  })

  it('adds wh-thumb and preserves mw-halign-left for left-floating thumbnails', () => {
    const html = '<figure typeof="mw:File/Thumb" class="mw-halign-left pcs-widen-image-ancestor"><img src="photo.jpg" alt=""></figure>'
    const result = processArticle(html, 'Test')
    expect(result.html).toContain('wh-thumb')
    expect(result.html).toContain('mw-halign-left')
  })

  it('hoists infobox out of the lede section, wrapped in wh-infobox-cluster, before all sections', () => {
    const html = [
      '<section><p>Lede.</p><table class="infobox biography"><tr><td>Info</td></tr></table></section>',
      '<section><h2>History</h2><p>More text.</p></section>',
    ].join('')
    const result = processArticle(html, 'Test')
    const clusterIndex = result.html.indexOf('wh-infobox-cluster')
    const firstSectionIndex = result.html.indexOf('<section')
    expect(clusterIndex).toBeGreaterThanOrEqual(0)
    expect(clusterIndex).toBeLessThan(firstSectionIndex)
    expect(result.html).toContain('class="infobox biography"')
  })

  it('removes the infobox from inside the lede section after hoisting', () => {
    const html = '<section><p>Lede.</p><table class="infobox"><tr><td>Info</td></tr></table></section>'
    const result = processArticle(html, 'Test')
    const sectionStart = result.html.indexOf('<section')
    const infoboxInSection = result.html.indexOf('class="infobox"', sectionStart)
    expect(infoboxInSection).toBe(-1)
  })

  it('handles infoboxes with nested tables (depth tracking)', () => {
    const html = [
      '<section><p>Lede.</p>',
      '<table class="infobox"><tr><td><table><tr><td>nested</td></tr></table></td></tr></table>',
      '</section>',
    ].join('')
    const result = processArticle(html, 'Test')
    const clusterIndex = result.html.indexOf('wh-infobox-cluster')
    const sectionIndex = result.html.indexOf('<section')
    expect(clusterIndex).toBeGreaterThanOrEqual(0)
    expect(clusterIndex).toBeLessThan(sectionIndex)
    expect(result.html).toContain('nested')
  })

  it('captures <hr>-split infobox continuation into the same cluster', () => {
    const html = [
      '<section><p>Lede.</p>',
      '<table class="infobox"><tr><td>Image</td></tr></table>',
      '<hr>',
      '<table class="infobox"><tr><td>Born</td></tr></table>',
      '</section>',
    ].join('')
    const result = processArticle(html, 'Test')
    // Both tables and the hr should be inside the cluster, before the section
    const clusterStart = result.html.indexOf('wh-infobox-cluster')
    const clusterEnd = result.html.indexOf('</div>', clusterStart) + 6
    const clusterHtml = result.html.slice(clusterStart, clusterEnd)
    expect(clusterHtml).toContain('Image')
    expect(clusterHtml).toContain('Born')
    // The section should start after the cluster
    expect(result.html.indexOf('<section')).toBeGreaterThan(clusterEnd - 1)
  })

  it('does not hoist when there is no infobox in the lede section', () => {
    const html = '<section><p>Lede.</p></section><section><h2>History</h2></section>'
    const result = processArticle(html, 'Test')
    expect(result.html).not.toContain('wh-infobox-cluster')
    expect(result.html.indexOf('<section')).toBeLessThan(result.html.indexOf('History'))
  })

  it('strips pcs collapsed-table chrome (Quick facts header, Close footer)', () => {
    const html = [
      '<section>',
      '<div class="pcs-collapse-table-container">',
      '<div class="pcs-collapse-table-collapsed-container">',
      '<strong>Quick facts</strong>',
      '<span class="pcs-collapse-table-collapse-text"> Born, Died ...</span>',
      '</div>',
      '<div class="pcs-collapse-table-content">',
      '<table class="infobox"><tr><td>data</td></tr></table>',
      '</div>',
      '<div class="pcs-collapse-table-collapsed-bottom">Close</div>',
      '</div>',
      '</section>',
    ].join('')
    const result = processArticle(html, 'Test')
    expect(result.html).not.toContain('Quick facts')
    expect(result.html).not.toContain('Born, Died')
    expect(result.html).not.toContain('Close')
    // The infobox table itself is preserved
    expect(result.html).toContain('class="infobox"')
  })

  it('strips MathML/LaTeX twin representations, keeps only the rendered img', () => {
    const html = [
      '<p><span class="mwe-math-element mwe-math-element-block">',
      '<span class="mwe-math-mathml-display mwe-math-mathml-a11y" style="display: none;">',
      '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" alttext="{\\displaystyle a^{2}+b^{2}=c^{2}}">',
      '<semantics><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow>',
      '<annotation encoding="application/x-tex">{\\displaystyle a^{2}+b^{2}=c^{2}}</annotation>',
      '</semantics></math>',
      '</span>',
      '<img src="//wikimedia.org/svg/abc.svg" class="mwe-math-fallback-image-display" alt="a^2+b^2=c^2">',
      '</span></p>',
    ].join('')
    const result = processArticle(html, 'Pythagorean_theorem')
    expect(result.html).not.toContain('\\displaystyle')
    expect(result.html).not.toContain('annotation')
    expect(result.html).not.toContain('<mi>')
    expect(result.html).toContain('mwe-math-fallback-image-display')
    expect(result.html).toContain('wikimedia.org/svg/abc.svg')
  })

  it('does not hoist an infobox that appears only in a later section', () => {
    const html = [
      '<section><p>Lede.</p></section>',
      '<section><h2>Stats</h2><table class="infobox"><tr><td>Info</td></tr></table></section>',
    ].join('')
    const result = processArticle(html, 'Test')
    expect(result.html).not.toContain('wh-infobox-cluster')
    const firstSectionIndex = result.html.indexOf('<section')
    const infoboxIndex = result.html.indexOf('class="infobox"')
    expect(infoboxIndex).toBeGreaterThan(firstSectionIndex)
  })

  it('includes toc extracted from h2/h3 headings with ids', () => {
    const html = '<h2 id="History">History</h2><p>text</p><h3 id="Origins">Origins</h3>'
    const result = processArticle(html, 'Test')
    expect(result.toc).toEqual([
      { id: 'History', text: 'History', level: 2 },
      { id: 'Origins', text: 'Origins', level: 3 },
    ])
  })

  it('returns empty toc for articles with no h2/h3 headings', () => {
    const result = processArticle('<p>text only</p>', 'Test')
    expect(result.toc).toEqual([])
  })
})

describe('extractToc', () => {
  it('extracts an h2 heading with an id', () => {
    expect(extractToc('<h2 id="Career">Career</h2><p>text</p>')).toEqual([
      { id: 'Career', text: 'Career', level: 2 },
    ])
  })

  it('extracts an h3 heading with an id', () => {
    expect(extractToc('<h3 id="Early_work">Early work</h3>')).toEqual([
      { id: 'Early_work', text: 'Early work', level: 3 },
    ])
  })

  it('returns entries in DOM order for mixed h2 and h3', () => {
    const html = '<h2 id="Career">Career</h2><h3 id="Early_work">Early work</h3><h2 id="Legacy">Legacy</h2>'
    expect(extractToc(html)).toEqual([
      { id: 'Career', text: 'Career', level: 2 },
      { id: 'Early_work', text: 'Early work', level: 3 },
      { id: 'Legacy', text: 'Legacy', level: 2 },
    ])
  })

  it('strips inner HTML tags from heading text', () => {
    expect(extractToc('<h2 id="Career"><span class="mw-headline">Career</span></h2>')).toEqual([
      { id: 'Career', text: 'Career', level: 2 },
    ])
  })

  it('skips headings without an id attribute', () => {
    expect(extractToc('<h2>No id here</h2>')).toEqual([])
  })

  it('returns empty array when html has no h2 or h3 headings', () => {
    expect(extractToc('<p>text</p>')).toEqual([])
  })
})
