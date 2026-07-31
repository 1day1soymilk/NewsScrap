// src/App.tsx
import { useEffect, useState } from 'react'
import { CategoryTabs } from './components/CategoryTabs'
import { HeadlinePanel } from './components/HeadlinePanel'
import { WordCloud } from './components/WordCloud'
import {
  fetchAvailableDates,
  fetchCategories,
  fetchHeadlinesForWord,
  fetchWordCounts,
} from './lib/queries'
import type { Category, HeadlineSummary, WordCount } from './lib/types'

function todayInSeoul(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}

function App() {
  const [categories, setCategories] = useState<Category[]>([])
  const [availableDates, setAvailableDates] = useState<string[]>([])
  const [selectedDate, setSelectedDate] = useState(todayInSeoul())
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [wordCounts, setWordCounts] = useState<WordCount[]>([])
  const [selectedWord, setSelectedWord] = useState<string | null>(null)
  const [headlinesForWord, setHeadlinesForWord] = useState<HeadlineSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchCategories().then(setCategories).catch((e) => setError(String(e)))
    fetchAvailableDates().then(setAvailableDates).catch((e) => setError(String(e)))
  }, [])

  function loadWordCounts() {
    setLoading(true)
    setError(null)
    fetchWordCounts(selectedDate, selectedCategory)
      .then(setWordCounts)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(loadWordCounts, [selectedDate, selectedCategory])

  useEffect(() => {
    if (!selectedWord) {
      setHeadlinesForWord([])
      return
    }
    fetchHeadlinesForWord(selectedDate, selectedCategory, selectedWord)
      .then(setHeadlinesForWord)
      .catch((e) => setError(String(e)))
  }, [selectedWord, selectedDate, selectedCategory])

  return (
    <div className="min-h-svh p-6">
      <h1 className="mb-6 text-center text-4xl font-semibold">오늘의 주요 뉴스 스크랩</h1>

      <div className="mx-auto mb-6 flex max-w-3xl flex-col items-center gap-4">
        <input
          type="date"
          value={selectedDate}
          min={availableDates[availableDates.length - 1]}
          max={availableDates[0]}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="rounded border px-3 py-1"
        />
        <CategoryTabs categories={categories} selected={selectedCategory} onSelect={setSelectedCategory} />
      </div>

      {error && (
        <div className="text-center">
          <p className="mb-2 text-red-600">{error}</p>
          <button onClick={loadWordCounts} className="rounded border px-3 py-1 text-sm hover:bg-gray-100">
            다시 시도
          </button>
        </div>
      )}
      {!error && loading && <p className="text-center text-gray-500">불러오는 중...</p>}
      {!error && !loading && (
        <WordCloud words={wordCounts} onWordClick={setSelectedWord} />
      )}

      <HeadlinePanel word={selectedWord} headlines={headlinesForWord} onClose={() => setSelectedWord(null)} />
    </div>
  )
}

export default App
