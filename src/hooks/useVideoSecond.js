import { useEffect, useState } from "react";

export default function useVideoSecond(videoRef) {
  const [second, setSecond] = useState(() => Math.floor(videoRef.current?.currentTime || 0));

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const update = () => setSecond(Math.floor(video.currentTime || 0));
    const frameLoop = typeof video.requestVideoFrameCallback === "function";
    let handle = null;
    const onFrame = () => {
      update();
      handle = video.requestVideoFrameCallback(onFrame);
    };
    const start = () => {
      if (frameLoop && handle == null) handle = video.requestVideoFrameCallback(onFrame);
    };
    const stop = () => {
      if (handle != null) video.cancelVideoFrameCallback(handle);
      handle = null;
      update();
    };
    const events = ["timeupdate", "seeked", "seeking", "loadedmetadata"];
    events.forEach((name) => video.addEventListener(name, update));
    video.addEventListener("play", start);
    video.addEventListener("pause", stop);
    update();
    if (!video.paused) start();
    return () => {
      events.forEach((name) => video.removeEventListener(name, update));
      video.removeEventListener("play", start);
      video.removeEventListener("pause", stop);
      if (handle != null) video.cancelVideoFrameCallback(handle);
    };
  }, [videoRef]);

  return second;
}
