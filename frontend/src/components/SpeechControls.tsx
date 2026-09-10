import { LoaderCircle, Pause, Play, RotateCcw, Square, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { synthesizeConclusion } from "../lib/ttsApi";
import { cn } from "../lib/format";

type PlaybackStatus = "idle" | "loading" | "playing" | "paused";
type ActivePlayback = { ownerId: string; stop: () => void };

let activePlayback: ActivePlayback | null = null;

type Props = {
  ownerId: string;
  text: string;
  accessToken: string;
};

export function SpeechControls({ ownerId, text, accessToken }: Props) {
  const [status, setStatus] = useState<PlaybackStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const updateStatus = (next: PlaybackStatus) => {
    if (mountedRef.current) setStatus(next);
  };

  const release = (resetPosition = true) => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      if (resetPosition) audio.currentTime = 0;
      audio.onended = null;
      audio.onerror = null;
    }
    audioRef.current = null;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    if (activePlayback?.ownerId === ownerId) activePlayback = null;
    updateStatus("idle");
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (activePlayback?.ownerId === ownerId) release();
    };
  }, [ownerId]);

  const start = async () => {
    setError(null);
    if (status === "playing") {
      audioRef.current?.pause();
      updateStatus("paused");
      return;
    }
    if (status === "paused" && audioRef.current) {
      await audioRef.current.play();
      updateStatus("playing");
      return;
    }
    if (status === "loading") return;

    activePlayback?.stop();
    const controller = new AbortController();
    controllerRef.current = controller;
    activePlayback = { ownerId, stop: () => release() };
    updateStatus("loading");
    try {
      const blob = await synthesizeConclusion(text, accessToken, controller.signal);
      if (controller.signal.aborted || activePlayback?.ownerId !== ownerId) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      urlRef.current = url;
      audioRef.current = audio;
      audio.onended = () => release(false);
      audio.onerror = () => {
        release();
        if (mountedRef.current) setError("音频播放失败，请重试");
      };
      await audio.play();
      updateStatus("playing");
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      release();
      if (mountedRef.current) {
        setError(reason instanceof Error ? reason.message : "语音生成失败，请稍后重试");
      }
    }
  };

  const label = status === "loading"
    ? "正在生成语音"
    : status === "playing"
      ? "暂停朗读"
      : status === "paused"
        ? "继续朗读"
        : "朗读结论";

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void start()}
        className={cn(
          "inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-xs font-semibold transition",
          status === "playing"
            ? "border-blue-200 bg-blue-50 text-moss"
            : "border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-moss",
        )}
        aria-label={label}
        title="只朗读数据结论，不朗读执行流程和 SQL"
      >
        {status === "loading" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          : status === "playing" ? <Pause className="h-3.5 w-3.5" />
            : status === "paused" ? <Play className="h-3.5 w-3.5" />
              : status === "idle" ? <Volume2 className="h-3.5 w-3.5" />
                : <RotateCcw className="h-3.5 w-3.5" />}
        {label}
      </button>
      {status !== "idle" && (
        <button type="button" onClick={() => release()} className="inline-flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="停止朗读">
          <Square className="h-3 w-3 fill-current" />停止
        </button>
      )}
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </div>
  );
}
