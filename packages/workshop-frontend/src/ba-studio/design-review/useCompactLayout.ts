import { useSyncExternalStore } from 'react'

const COMPACT_QUERY = '(width < 80rem)'
const isCompactLayout = () => window.matchMedia(COMPACT_QUERY).matches
const subscribeLayout = (onChange: () => void) => {
  const query = window.matchMedia(COMPACT_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/** True below the width that fits conversation, map and the right-hand context side by side. */
export const useCompactLayout = () => useSyncExternalStore(subscribeLayout, isCompactLayout, () => false)
