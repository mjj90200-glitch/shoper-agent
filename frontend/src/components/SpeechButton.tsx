import { CircleStop, LoaderCircle, Pause, Play, RotateCcw, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { synthesizeSpeech } from "../lib/ttsApi";
import { cn } from "../lib/format";

type PlaybackState = "idle" | "loading" | "playing" | "paused" | "ended" | "error";

type Props = {
  text: string;
  accessToken: string;
  label?: string;
  inverted?: boolean;
  compact?: boolean;
};

let stopActivePlayback: (() => void) | null = null;

export function SpeechButton({ text, accessToken, label = "播放", inverted = false, compact = false }: Props) {
  const [state, setState] = useState<PlaybackState>("idle");
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const cleanup = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setState("idle");
    if (stopActivePlayback === cleanup) stopActivePlayback = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const play = async () => {
    setError(null);
    if (state === "playing") {
      audioRef.current?.pause();
      setState("paused");
      return;
    }
    if (audioRef.current) {
      if (state === "ended") audioRef.current.currentTime = 0;
      await audioRef.current.play();
      setState("playing");
      return;
    }

    stopActivePlayback?.();
    stopActivePlayback = cleanup;
    const controller = new AbortController();
    requestRef.current = controller;
    setState("loading");
    try {
      const blob = await synthesizeSpeech(text, accessToken, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      urlRef.current = url;
      audioRef.current = audio;
      audio.onended = () => setState("ended");
      audio.onerror = () => {
        setError("浏览器无法播放这段语音");
        setState("error");
      };
      await audio.play();
      setState("playing");
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "语音播放失败");
      setState("error");
      if (stopActivePlayback === cleanup) stopActivePlayback = null;
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  const Icon = state === "loading"
    ? LoaderCircle
    : state === "playing"
      ? Pause
      : state === "ended"
        ? RotateCcw
        : state === "idle"
          ? Volume2
          : Play;
  const buttonLabel = state === "loading"
    ? "合成中"
    : state === "playing"
      ? "暂停"
      : state === "paused"
        ? "继续"
        : state === "ended"
          ? "重播"
          : label;

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <div className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={() => void play()}
          disabled={!text.trim() || state === "loading"}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition disabled:opacity-50",
            compact ? "h-8 px-2.5" : "h-9 px-3",
            inverted
              ? "border border-white/25 bg-white/10 text-white hover:bg-white/20"
              : "border border-slate-200 bg-white text-slate-600 hover:border-moss hover:text-moss",
          )}
          title={buttonLabel}
        >
          <Icon className={cn("h-3.5 w-3.5", state === "loading" && "animate-spin")} />
          {!compact && buttonLabel}
        </button>
        {(state === "playing" || state === "paused" || state === "ended") && (
          <button
            type="button"
            onClick={cleanup}
            className={cn(
              "grid h-8 w-8 place-items-center rounded-lg transition",
              inverted ? "text-white/75 hover:bg-white/15" : "text-slate-400 hover:bg-slate-100",
            )}
            title="停止"
            aria-label="停止语音"
          >
            <CircleStop className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {error && <span className={cn("max-w-56 text-[11px]", inverted ? "text-rose-100" : "text-rose-600")}>{error}</span>}
    </div>
  );
}
