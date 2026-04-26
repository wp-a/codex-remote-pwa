export function compactPath(value: string, depth = 3): string {
  if (!value) {
    return "未设置项目路径";
  }

  if (value.length <= 36) {
    return value;
  }

  const parts = value.split("/").filter(Boolean);
  if (parts.length <= depth) {
    return value;
  }

  return `/.../${parts.slice(-depth).join("/")}`;
}

export function formatRelativeTime(value: string): string {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) {
    return "最近";
  }

  const diff = Date.now() - then;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) {
    return "刚刚";
  }

  if (diff < hour) {
    return `${Math.max(1, Math.round(diff / minute))} 分钟前`;
  }

  if (diff < day) {
    return `${Math.max(1, Math.round(diff / hour))} 小时前`;
  }

  if (diff < 7 * day) {
    return `${Math.max(1, Math.round(diff / day))} 天前`;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
  }).format(then);
}
