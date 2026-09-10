import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { FiArrowRight, FiCalendar, FiCopy, FiMail, FiSearch, FiShare2, FiX } from "react-icons/fi"
import { api } from "./api"
import type { NewsRelease } from "./types"

interface NewsResponse { releases: NewsRelease[]; total: number; kinds: string[]; limit: number; offset: number }
const published = (value: string) => new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
const categoryLabel = (value: string) => value.replaceAll("_", " ")

function ReleaseCard({ release, compact = false }: { release: NewsRelease; compact?: boolean }) {
  return <article className={compact ? "news-card compact" : "news-card"}>
    {release.hero_image_url && <Link className="news-card-image" to={`/news/${release.slug}`}><img src={release.hero_image_url} alt="airDash fleet and network news artwork" /></Link>}
    <div className="news-card-copy"><span className="news-category">{categoryLabel(release.kind)}</span><h3><Link to={`/news/${release.slug}`}>{release.title}</Link></h3><p>{release.summary}</p><small><FiCalendar /> {published(release.published_at)}</small><Link className="news-read-link" to={`/news/${release.slug}`}>Read release <FiArrowRight /></Link></div>
  </article>
}

export function LatestNews() {
  const [releases, setReleases] = useState<NewsRelease[]>([])
  useEffect(() => { api<NewsResponse>("/news?limit=3").then(value => setReleases(value.releases)).catch(() => {}) }, [])
  if (!releases.length) return null
  return <section className="home-section home-news">
    <header><span className="eyebrow"><FiShare2 /> latest from airDash</span><h2>Newsroom</h2><Link to="/news">Open the News Hub <FiArrowRight /></Link></header>
    <div className="home-news-grid"><ReleaseCard release={releases[0]} />{releases.length > 1 && <div className="home-news-secondary">{releases.slice(1).map(release => <ReleaseCard key={release.id} release={release} compact />)}</div>}</div>
  </section>
}

export function NewsHub() {
  const [releases, setReleases] = useState<NewsRelease[]>([])
  const [total, setTotal] = useState(0)
  const [kinds, setKinds] = useState<string[]>([])
  const [query, setQuery] = useState("")
  const [kind, setKind] = useState("")
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const requestId = useRef(0)
  const pageSize = 12

  const load = async (offset: number, append: boolean) => {
    const id = ++requestId.current; setLoading(true)
    const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) })
    if (query.trim()) params.set("q", query.trim())
    if (kind) params.set("kind", kind)
    try {
      const value = await api<NewsResponse>(`/news?${params}`)
      if (id !== requestId.current) return
      setReleases(current => append ? [...current, ...value.releases] : value.releases)
      setTotal(value.total); setKinds(value.kinds); setLoaded(true)
    } catch {
      if (id === requestId.current) { setReleases([]); setTotal(0); setLoaded(true) }
    } finally { if (id === requestId.current) setLoading(false) }
  }

  useEffect(() => { const timer = window.setTimeout(() => { void load(0, false) }, query ? 250 : 0); return () => window.clearTimeout(timer) }, [query, kind])

  return <div className="news-hub-page">
    <header className="news-hub-hero"><span className="eyebrow">airDash newsroom</span><h1>News Hub</h1><p>Fleet investments, network development, operating announcements, and stories from across airDash.</p></header>
    <div className="news-hub-toolbar"><div className="news-search"><FiSearch /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search airDash news" aria-label="Search news" />{query && <button onClick={() => setQuery("")} aria-label="Clear news search"><FiX /></button>}</div><label>Category<select value={kind} onChange={event => setKind(event.target.value)}><option value="">All categories</option>{kinds.map(value => <option key={value} value={value}>{categoryLabel(value)}</option>)}</select></label></div>
    <div className="news-hub-count">{loading && !loaded ? "Loading newsroom" : `${total} published release${total === 1 ? "" : "s"}`}</div>
    {!loaded && loading ? <div className="news-loading">Loading releases…</div> : releases.length ? <div className="news-hub-grid">{releases.map(release => <ReleaseCard key={release.id} release={release} />)}</div> : <div className="news-empty"><FiSearch /><h2>No matching releases</h2><p>Change the search or category to continue browsing the newsroom.</p></div>}
    {releases.length < total && <div className="news-load-more"><button onClick={() => void load(releases.length, true)} disabled={loading}>{loading ? "Loading…" : `Load more · ${total - releases.length} remaining`}</button></div>}
  </div>
}

export function NewsArticle() {
  const { slug = "" } = useParams()
  const [release, setRelease] = useState<NewsRelease | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => { setRelease(null); setNotFound(false); api<{ release: NewsRelease }>(`/news/${encodeURIComponent(slug)}`).then(value => setRelease(value.release)).catch(() => setNotFound(true)) }, [slug])
  useEffect(() => {
    if (!release) return
    document.title = `${release.title} | airDash`
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    if (description) description.content = release.summary
  }, [release])
  const url = typeof window === "undefined" ? "" : window.location.href
  const shares = useMemo(() => release ? {
    email: `mailto:?subject=${encodeURIComponent(release.title)}&body=${encodeURIComponent(`${release.summary}\n\n${url}`)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
    x: `https://x.com/intent/post?text=${encodeURIComponent(release.title)}&url=${encodeURIComponent(url)}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
  } : null, [release, url])

  if (notFound) return <div className="news-article-state"><h1>Press release not found</h1><p>This release is unavailable or has not been published.</p><Link to="/news">Return to News Hub</Link></div>
  if (!release || !shares) return <div className="news-article-state">Loading press release…</div>
  const paragraphs = (release.body ?? "").split(/\n{2,}/).map(value => value.trim()).filter(Boolean)
  return <article className="news-article-page">
    <nav className="news-breadcrumb"><Link to="/">Home</Link><FiArrowRight /><Link to="/news">News Hub</Link><FiArrowRight /><span>{categoryLabel(release.kind)}</span></nav>
    <header className="news-article-header"><span className="news-category">{categoryLabel(release.kind)}</span><h1>{release.title}</h1><p>{release.summary}</p><div className="news-byline"><strong>{release.author_name}</strong><span><FiCalendar /> {published(release.published_at)}</span></div></header>
    <div className="news-share-bar"><span><FiShare2 /> Share</span><a href={shares.email}><FiMail /> Email</a><a href={shares.facebook} target="_blank" rel="noreferrer">Facebook</a><a href={shares.x} target="_blank" rel="noreferrer">X</a><a href={shares.linkedin} target="_blank" rel="noreferrer">LinkedIn</a><button onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 1800) }}><FiCopy /> {copied ? "Copied" : "Copy link"}</button></div>
    {release.hero_image_url && <figure className="news-hero-image"><img src={release.hero_image_url} alt="airDash fleet and network news artwork" /></figure>}
    <div className="news-article-body">{paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
    <footer className="news-article-footer"><span>About airDash</span><p>airDash is an Airbus A220-300 virtual airline operating a growing North American and Caribbean network.</p><Link to="/news">More from the News Hub <FiArrowRight /></Link></footer>
  </article>
}
