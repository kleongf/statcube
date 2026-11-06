export default function LoadError({ onRetry }) {
  return (
    <div
      role="alert"
      className="mb-5 flex items-center gap-3 rounded-lg border border-red-900 bg-red-950/40 px-4 py-2 text-sm text-red-300"
    >
      <span>Couldn't load team stats.</span>
      <button
        onClick={onRetry}
        className="rounded-md bg-red-900/60 px-3 py-1 font-medium text-red-100 hover:bg-red-900"
      >
        Retry
      </button>
    </div>
  )
}
