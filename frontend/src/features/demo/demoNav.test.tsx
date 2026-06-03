import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Spy on react-router's useNavigate so we can assert the resolved destination.
const navigateSpy = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateSpy,
}))

import { DemoModeProvider } from './DemoContext'
import { DEMO_PREFIX, useAppNavigate, useDemoPath, withDemoPrefix } from './demoNav'

const demoWrapper = ({ children }: { children: ReactNode }) => (
  <DemoModeProvider>{children}</DemoModeProvider>
)

afterEach(() => navigateSpy.mockClear())

describe('withDemoPrefix', () => {
  it('prefixes absolute app paths', () => {
    expect(withDemoPrefix('/books')).toBe('/demo/books')
    expect(withDemoPrefix('/books/new')).toBe('/demo/books/new')
  })

  it('preserves query strings', () => {
    expect(withDemoPrefix('/bookshelf?tab=locations')).toBe('/demo/bookshelf?tab=locations')
  })

  it('is idempotent — never double-prefixes', () => {
    expect(withDemoPrefix('/demo/books')).toBe('/demo/books')
    expect(withDemoPrefix(DEMO_PREFIX)).toBe(DEMO_PREFIX)
  })

  it('tolerates a missing leading slash', () => {
    expect(withDemoPrefix('books')).toBe('/demo/books')
  })
})

describe('useDemoPath', () => {
  it('rewrites paths inside the demo', () => {
    const { result } = renderHook(() => useDemoPath(), { wrapper: demoWrapper })
    expect(result.current('/books')).toBe('/demo/books')
  })

  it('is an identity outside the demo', () => {
    const { result } = renderHook(() => useDemoPath())
    expect(result.current('/books')).toBe('/books')
  })
})

describe('useAppNavigate', () => {
  it('rewrites string destinations to the demo subtree', () => {
    const { result } = renderHook(() => useAppNavigate(), { wrapper: demoWrapper })
    result.current('/books')
    expect(navigateSpy).toHaveBeenCalledWith('/demo/books', undefined)
  })

  it('passes numeric history deltas through unchanged', () => {
    const { result } = renderHook(() => useAppNavigate(), { wrapper: demoWrapper })
    result.current(-1)
    expect(navigateSpy).toHaveBeenCalledWith(-1)
  })

  it('leaves destinations untouched outside the demo', () => {
    const { result } = renderHook(() => useAppNavigate())
    result.current('/books')
    expect(navigateSpy).toHaveBeenCalledWith('/books', undefined)
  })
})
