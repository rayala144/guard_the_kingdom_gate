import { describe, it, expect } from 'vitest'
import App from './App.jsx'

describe('project smoke', () => {
  it('exports the root component', () => {
    expect(App).toBeTypeOf('function')
  })
})
