import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CategoryTabs } from './CategoryTabs'

const categories = [
  { id: '1', slug: 'politics', label: '정치' },
  { id: '2', slug: 'economy', label: '경제' },
]

describe('CategoryTabs', () => {
  it('renders an entry for every category plus "전체"', () => {
    render(<CategoryTabs categories={categories} selected={null} onSelect={vi.fn()} />)
    expect(screen.getByText('전체')).toBeInTheDocument()
    expect(screen.getByText('정치')).toBeInTheDocument()
    expect(screen.getByText('경제')).toBeInTheDocument()
  })

  it('calls onSelect with the category slug when clicked', () => {
    const onSelect = vi.fn()
    render(<CategoryTabs categories={categories} selected={null} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('경제'))
    expect(onSelect).toHaveBeenCalledWith('economy')
  })

  it('calls onSelect with null when "전체" is clicked', () => {
    const onSelect = vi.fn()
    render(<CategoryTabs categories={categories} selected="economy" onSelect={onSelect} />)
    fireEvent.click(screen.getByText('전체'))
    expect(onSelect).toHaveBeenCalledWith(null)
  })
})
