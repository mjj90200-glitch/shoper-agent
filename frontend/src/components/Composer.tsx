/**
 * 聊天输入区组件
 * 处理问题输入、发送和停止当前流式请求
 */
import { ArrowUp, Eye, EyeOff, Radio, Square, WandSparkles } from "lucide-react";
import { FormEvent, KeyboardEvent, useEffect, useRef } from "react";
import { cn } from "../lib/format";

type ComposerProps = {
    value: string;
    disabled: boolean;
    isStreaming: boolean;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onStop: () => void;
    showFlow: boolean;
    onToggleFlow: () => void;
    activeStep?: string;
    notice?: string | null;
    focusSignal?: number;
};

export function Composer({
    value,
    disabled,
    isStreaming,
    onChange,
    onSubmit,
    onStop,
    showFlow,
    onToggleFlow,
    activeStep,
    notice,
    focusSignal,
}: ComposerProps) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    useEffect(() => {
        textareaRef.current?.focus();
    }, [focusSignal]);

    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (!disabled) onSubmit();
    };

    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (!disabled) onSubmit();
        }
    };

    return (
        <form
            onSubmit={submit}
            className="border-t border-slate-200/70 bg-white/65 px-4 py-4 backdrop-blur-xl"
        >
            <div className="mx-auto max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-[0_12px_40px_rgba(15,23,42,0.10)] transition focus-within:border-blue-300 focus-within:shadow-[0_16px_48px_rgba(22,136,248,0.14)]">
                <div className="flex min-h-9 items-center justify-between gap-3 border-b border-slate-100 px-3 text-xs">
                    <span className="flex min-w-0 items-center gap-2 text-slate-400" aria-live="polite">
                        {isStreaming ? <Radio className="h-3 w-3 shrink-0 animate-pulse text-brass/65" /> : <WandSparkles className="h-3 w-3 shrink-0 text-moss/55" />}
                        <span className="truncate">{notice || (isStreaming ? `SSE · ${activeStep || "正在连接分析引擎"}` : "描述指标、维度和时间范围，生成洞察与图表")}</span>
                    </span>
                    <button type="button" onClick={onToggleFlow} className={cn(
                        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2 transition hover:bg-slate-100",
                        showFlow ? "text-slate-500" : "bg-blue-50 text-moss",
                    )} aria-pressed={showFlow} title={showFlow ? "隐藏分析流程" : "展开分析流程"}>
                        {showFlow ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                        {showFlow ? "隐藏流程" : "展开流程"}
                    </button>
                </div>
                <div className="flex items-end gap-2 p-2">
                    <textarea
                        ref={textareaRef}
                        value={value}
                        onChange={(event) => onChange(event.target.value)}
                        onKeyDown={onKeyDown}
                        rows={1}
                        placeholder="例如：分析第一季度各地区 GMV 趋势，并找出增长最快的市场"
                        className="max-h-36 min-h-11 flex-1 resize-none bg-transparent px-2 py-3 text-[15px] leading-6 text-ink outline-none placeholder:text-slate-400"
                    />
                    <button
                        type={isStreaming ? "button" : "submit"}
                        onClick={isStreaming ? onStop : undefined}
                        disabled={!isStreaming && disabled}
                        className={cn(
                            "grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white shadow-md transition focus:outline-none focus:ring-2 focus:ring-moss/40 focus:ring-offset-2",
                            isStreaming
                                ? "bg-tomato hover:bg-tomato/90"
                                : "bg-moss hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300",
                        )}
                        title={isStreaming ? "停止" : "发送"}
                        aria-label={isStreaming ? "停止" : "发送"}
                    >
                        {isStreaming ? <Square className="h-4 w-4 fill-current" aria-hidden="true" /> : <ArrowUp className="h-5 w-5" aria-hidden="true" />}
                    </button>
                </div>
            </div>
        </form>
    );
}
