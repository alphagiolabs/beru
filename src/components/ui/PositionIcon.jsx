import {
  ArrowDown,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  Crosshair,
} from "lucide-react";

const POSITION_ICONS = {
  "top-left": ArrowUpLeft,
  "top-center": ArrowUp,
  "top-right": ArrowUpRight,
  "center-left": ArrowLeft,
  center: Crosshair,
  "center-right": ArrowRight,
  "bottom-left": ArrowDownLeft,
  "bottom-center": ArrowDown,
  "bottom-right": ArrowDownRight,
  tl: ArrowUpLeft,
  tc: ArrowUp,
  tr: ArrowUpRight,
  ml: ArrowLeft,
  cc: Crosshair,
  mr: ArrowRight,
  bl: ArrowDownLeft,
  bc: ArrowDown,
  br: ArrowDownRight,
};

export function PositionIcon({ position, ...props }) {
  const Icon = POSITION_ICONS[position] || Crosshair;
  return <Icon {...props} aria-hidden="true" />;
}
