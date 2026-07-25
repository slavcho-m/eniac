import styles from "./LinkList.module.css";

interface LinkListItem {
  label: string;
  onClick?: () => void;
}

interface LinkListProps {
  items: LinkListItem[];
}

export function LinkList({ items }: LinkListProps) {
  return (
    <div className={styles.list}>
      {items.map((item) => (
        <button key={item.label} type="button" className={styles.link} onClick={item.onClick}>
          {item.label}
        </button>
      ))}
    </div>
  );
}
