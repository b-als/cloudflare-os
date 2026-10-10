import { describe, expect, it } from 'vitest'

// Guards the BA Studio charter's budgets (docs/ba-studio-charter.md). Raising a limit here needs a
// decision-log entry in the charter first; Phase 4's interview surface is the only planned raise.
const MAX_BA_ROUTES = 3
const METHOD_NAMES = /\b(BABOK|SIPOC|RACI|MoSCoW|BPMN|DMN|SMART)\b/

const routes = Object.keys(import.meta.glob('../routes/*.tsx'))
const baRoutes = routes.filter((path) => path.startsWith('../routes/ba-projects'))
const uiSources = import.meta.glob<string>(
  ['./*.{ts,tsx}', '!./*.test.{ts,tsx}', '../routes/ba-projects*.tsx'],
  { query: '?raw', import: 'default', eager: true },
)

// Comments may explain the craft; only what a person can read on screen is UI copy.
const withoutComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('BA Studio surface budget', () => {
  it(`has at most ${MAX_BA_ROUTES} routes: Start, Session and Stakeholder interview`, () => {
    expect(baRoutes.length).toBeGreaterThan(0)
    expect(baRoutes.length).toBeLessThanOrEqual(MAX_BA_ROUTES)
    expect(routes).not.toContain('../routes/workflow-studio.tsx')
  })

  it('keeps method names out of what people read', () => {
    expect(Object.keys(uiSources).length).toBeGreaterThan(baRoutes.length)
    const offenders = Object.entries(uiSources)
      .filter(([, code]) => METHOD_NAMES.test(withoutComments(code)))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })
})
