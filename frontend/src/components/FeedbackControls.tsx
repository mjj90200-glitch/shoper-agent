import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { submitAuditFeedback } from "../lib/auditApi";

type FeedbackControlsProps = {
  auditId: string;
  accessToken: string;
  initialScore?: "up" | "down";
  onSaved: (score: "up" | "down") => void;
};

export function FeedbackControls({
  auditId,
  accessToken,
  initialScore,
  onSaved,
}: FeedbackControlsProps) {
  const [score, setScore] = useState(initialScore);
  const [comment, setComment] = useState("");
  const [showComment, setShowComment] = useState(initialScore === "down");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async (nextScore: "up" | "down", nextComment = comment) => {
    setSaving(true);
    setError("");
    try {
      await submitAuditFeedback(auditId, accessToken, nextScore, nextComment);
      setScore(nextScore);
      onSaved(nextScore);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "反馈保存失败。 ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
      <div className="flex items-center gap-2">
        <span>本次回答有帮助吗？</span>
        <button
          type="button"
          disabled={saving}
          onClick={() => void save("up")}
          className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 transition hover:bg-blue-50 disabled:opacity-50 ${score === "up" ? "bg-blue-50 text-moss" : ""}`}
          aria-label="有帮助"
        >
          <ThumbsUp className="h-3.5 w-3.5" />有帮助
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => { setShowComment(true); void save("down"); }}
          className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 transition hover:bg-tomato/10 disabled:opacity-50 ${score === "down" ? "bg-tomato/10 text-tomato" : ""}`}
          aria-label="需要改进"
        >
          <ThumbsDown className="h-3.5 w-3.5" />需改进
        </button>
      </div>
      {showComment && (
        <div className="mt-2 flex gap-2">
          <input
            value={comment}
            maxLength={500}
            onChange={(event) => setComment(event.target.value)}
            placeholder="可补充原因，例如指标口径不符合预期"
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 outline-none focus:border-moss"
          />
          <button type="button" disabled={saving} onClick={() => void save("down")} className="rounded-lg border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            保存
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-tomato">{error}</p>}
    </section>
  );
}
