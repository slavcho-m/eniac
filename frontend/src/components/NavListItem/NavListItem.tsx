import type { ReactNode } from "react";
import styles from "./NavListItem.module.css";

interface NavListItemProps {
  icon: ReactNode;
  label: string;
  meta?: string;
  active?: boolean;
  onClick?: () => void;
}

export function NavListItem({ icon, label, meta, active = false, onClick }: NavListItemProps) {
  return (
    <div className={[styles.item, active ? styles.active : ""].filter(Boolean).join(" ")} onClick={onClick}>
      <span className={styles.icon}>{icon}</span>
      <span className={styles.label}>{label}</span>
      {meta && <span className={styles.meta}>{meta}</span>}
    </div>
  );
}
