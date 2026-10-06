import type { BaBaseline, BaBaselineContent } from '@gadgets/gatekeeper-process/types'

/** Serialize actual project content and its optional account-authorized review record. */
export function projectPackage(content: BaBaselineContent, baseline?: BaBaseline): string {
  return JSON.stringify({
    schemaVersion: 'ba-project/v1',
    status: baseline?.review?.decision ?? 'draft',
    baselineId: baseline?.id,
    review: baseline?.review,
    content: baseline?.content ?? content,
    infrastructure: {
      authority: 'Cloudflare Workers and SQLite Durable Objects',
      execution: 'Not deployed by this export',
      telemetry: 'Only sourced measurements recorded in content are included',
    },
  }, null, 2)
}

/** Download a live draft or a captured baseline, never a prototype or generated sample. */
export function downloadProjectPackage(content: BaBaselineContent, baseline?: BaBaseline): void {
  const blob = new Blob([projectPackage(content, baseline)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `ba-${content.projectId}-${baseline?.id ?? 'draft'}.json`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
