/** 按条件拼接 class：省略空值，保留静态写法可读性。 */
export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}
