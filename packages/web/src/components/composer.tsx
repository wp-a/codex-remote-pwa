import type { FormEvent } from "react";

type ComposerProps = {
  disabled?: boolean;
  hint?: string;
  message: string;
  onChange: (next: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
};

export function Composer({
  disabled = false,
  hint,
  message,
  onChange,
  onSubmit,
}: ComposerProps) {
  return (
    <form className="composer" onSubmit={onSubmit}>
      <div className={`composer__dock${disabled ? " is-disabled" : ""}`}>
        <label className="composer__field">
          <span className="sr-only">给 Codex 的下一条消息</span>
          <textarea
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            placeholder="继续这个会话，告诉 Codex 你想做什么…"
            rows={1}
            value={message}
          />
        </label>
        <button aria-label="发送" disabled={disabled} type="submit">
          <span aria-hidden="true" className="composer__send-icon">
            ↑
          </span>
          <span className="sr-only">发送</span>
        </button>
      </div>
      <p className={`composer__hint${disabled ? " is-disabled" : ""}`}>
        {hint ?? (disabled ? "先从左上角选择一个会话" : "继续当前会话")}
      </p>
    </form>
  );
}
