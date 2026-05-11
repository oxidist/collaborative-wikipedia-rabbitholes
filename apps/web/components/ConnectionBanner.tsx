interface ConnectionBannerProps {
  onRetry: () => void
}

export function ConnectionBanner({ onRetry }: ConnectionBannerProps) {
  return (
    <div role="alert" className="connection-banner">
      <span>Connection lost.</span>
      <button onClick={onRetry}>Retry</button>
    </div>
  )
}
