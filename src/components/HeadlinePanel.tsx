import type { HeadlineSummary } from '../lib/types'

interface HeadlinePanelProps {
  word: string | null
  headlines: HeadlineSummary[]
  onClose: () => void
}

export function HeadlinePanel({ word, headlines, onClose }: HeadlinePanelProps) {
  if (!word) return null

  return (
    <aside className="fixed right-0 top-0 h-full w-80 overflow-y-auto border-l bg-white p-4 shadow-lg">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">&quot;{word}&quot; 관련 헤드라인</h2>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-900">
          닫기
        </button>
      </div>
      <ul className="space-y-3">
        {headlines.map((headline) => (
          <li key={headline.id}>
            <a
              href={headline.link}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-blue-700 hover:underline"
            >
              {headline.title}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  )
}
