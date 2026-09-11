import { useEffect, useRef, useState } from "react"
import { FiChevronLeft, FiChevronRight, FiPause, FiPlay, FiVideo } from "react-icons/fi"

const screenshots = Array.from({ length: 9 }, (_, index) => `/assets/home-showcase/screenshot-${String(index + 1).padStart(2, "0")}.webp`)
const SLIDE_DURATION = 6500
const slides = [{ kind: "video" as const, src: "/assets/home-showcase/landing.webm", poster: "/assets/home-showcase/landing-poster.jpg" }, ...screenshots.map(src => ({ kind: "image" as const, src }))]

export function HomeHeroShowcase() {
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)
  const [progress, setProgress] = useState(0)
  const [videoDuration, setVideoDuration] = useState(41.778)
  const videoRef = useRef<HTMLVideoElement>(null)
  const advance = (direction: number) => { setProgress(0); setActive(current => (current + direction + slides.length) % slides.length) }
  const select = (index: number) => { setProgress(0); if (index === 0 && videoRef.current) videoRef.current.currentTime = 0; setActive(index) }
  useEffect(() => {
    if (active === 0) {
      const video = videoRef.current
      if (video && !paused) void video.play().catch(() => {})
      if (video && paused) video.pause()
      return
    }
    videoRef.current?.pause()
    if (paused) return
    const startingProgress = progress
    const remaining = Math.max(0, (1 - startingProgress) * SLIDE_DURATION)
    const started = performance.now()
    const ticker = window.setInterval(() => setProgress(Math.min(1, startingProgress + (performance.now() - started) / SLIDE_DURATION)), 80)
    const timer = window.setTimeout(() => advance(1), remaining)
    return () => { window.clearInterval(ticker); window.clearTimeout(timer) }
  }, [active, paused])
  const secondsLeft = Math.max(0, Math.ceil(((active === 0 ? videoDuration : SLIDE_DURATION / 1000) * (1 - progress))))
  return <div className="home-showcase-bg" aria-label="airDash visual gallery">
    <div className="home-showcase-images" aria-live="polite">{slides.map((slide, index) => slide.kind === "video" ? <video key={slide.src} ref={index === 0 ? videoRef : undefined} className={index === active ? "active" : ""} src={slide.src} poster={slide.poster} muted playsInline preload="metadata" onLoadedMetadata={event => setVideoDuration(event.currentTarget.duration || 41.778)} onTimeUpdate={event => { if (index === active && event.currentTarget.duration) setProgress(event.currentTarget.currentTime / event.currentTarget.duration) }} onEnded={() => { setProgress(1); advance(1) }} aria-label="airDash landing video" /> : <img key={slide.src} className={index === active ? "active" : ""} src={slide.src} alt={index === active ? `airDash gallery image ${index} of ${slides.length - 1}` : ""} aria-hidden={index !== active} />)}</div>
    <div className="home-showcase-shade" />
    <div className="home-showcase-controls">
      <button type="button" className="home-showcase-arrow" onClick={() => advance(-1)} aria-label="Previous media"><FiChevronLeft /></button>
      <div className="home-showcase-dots">{slides.map((slide, index) => <button type="button" key={slide.src} className={index === active ? "active" : ""} onClick={() => select(index)} aria-label={index === 0 ? "Show landing video" : `Show gallery image ${index}`} aria-current={index === active}>{index === 0 ? <FiVideo /> : index}</button>)}</div>
      <span className="home-showcase-timing">{active === 0 ? "Film" : `Image ${active}/9`} · {secondsLeft}s</span>
      <button type="button" className="home-showcase-arrow" onClick={() => advance(1)} aria-label="Next media"><FiChevronRight /></button>
      <button type="button" className="home-showcase-pause" onClick={() => setPaused(current => !current)} aria-label={paused ? "Resume media" : "Pause media"}>{paused ? <FiPlay /> : <FiPause />}</button>
    </div>
    <div className={`home-showcase-progress${paused ? " paused" : ""}`}><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
  </div>
}
