import {
  BadgeCheck,
  Boxes,
  BrainCircuit,
  Clapperboard,
  ClipboardCheck,
  ImagePlus,
  PlayCircle,
  ScanSearch,
  Scissors,
  ShieldCheck,
  SlidersHorizontal,
  UploadCloud,
  type LucideIcon,
} from 'lucide-react'
import type { IconName } from './types'

export const iconMap: Record<IconName, LucideIcon> = {
  sliders: SlidersHorizontal,
  upload: UploadCloud,
  scan: ScanSearch,
  brain: BrainCircuit,
  clipboard: ClipboardCheck,
  boxes: Boxes,
  image: ImagePlus,
  shield: ShieldCheck,
  clapper: Clapperboard,
  play: PlayCircle,
  scissors: Scissors,
  badge: BadgeCheck,
}
