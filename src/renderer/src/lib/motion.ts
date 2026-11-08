import { useEffect } from 'react'
import { getSettings, useSettings } from './useSettings'

const systemReduced = matchMedia('(prefers-reduced-motion: reduce)')

// Windows turns "Animation effects" off for the whole desktop, and many players do
// that for speed. The app keeps its own switch so the console feel survives it.
export const reducedMotion = () => {
  const { motion } = getSettings()
  return motion === 'off' || (motion === 'system' && systemReduced.matches)
}

export function useMotionSetting() {
  const { motion } = useSettings()
  useEffect(() => {
    const apply = () => {
      if (reducedMotion()) document.documentElement.dataset.motion = 'reduced'
      else delete document.documentElement.dataset.motion
    }
    apply()
    systemReduced.addEventListener('change', apply)
    return () => systemReduced.removeEventListener('change', apply)
  }, [motion])
}
