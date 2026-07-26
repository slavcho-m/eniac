/** Joins class names, dropping falsy values. `cn(styles.item, active && styles.active)`. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
