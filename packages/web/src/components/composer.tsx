import type { FormEvent } from "react";

type ComposerProps = {
  disabled?: boolean;
  message: string;
  onChange: (next: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
};

export function Composer({
  disabled = false,
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
        <button disabled={disabled} type="submit">
          发送
        </button>
      </div>
      <p className={`composer__hint${disabled ? " is-disabled" : ""}`}>
        {disabled ? "先从左上角选择一个会话" : "继续当前会话"}
      </p>
    </form>
  );
}
