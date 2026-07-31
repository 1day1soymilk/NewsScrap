import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HeadlinePanel } from './HeadlinePanel'

describe('HeadlinePanel', () => {
  it('renders nothing when no word is selected', () => {
    const { container } = render(<HeadlinePanel word={null} headlines={[]} onClose={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders headline titles as links to the original article', () => {
    render(
      <HeadlinePanel
        word="예산안"
        headlines={[{ id: 'h1', title: '여야 예산안 처리', link: 'https://example.com/a' }]}
        onClose={vi.fn()}
      />,
    )
    const link = screen.getByRole('link', { name: '여야 예산안 처리' })
    expect(link).toHaveAttribute('href', 'https://example.com/a')
  })

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    render(<HeadlinePanel word="예산안" headlines={[]} onClose={onClose} />)
    fireEvent.click(screen.getByText('닫기'))
    expect(onClose).toHaveBeenCalled()
  })
})
