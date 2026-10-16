import useHistoryGesture from "../hooks/useHistoryGesture.js";

export default function HistoryRange({ owner, onValueChange, ...props }) {
  const gesture = useHistoryGesture(owner);
  return (
    <input
      {...props}
      type="range"
      onChange={(event) =>
        gesture.apply((options) => onValueChange(Number(event.target.value), options))
      }
      onPointerUp={gesture.end}
      onKeyUp={gesture.end}
      onBlur={gesture.end}
    />
  );
}
