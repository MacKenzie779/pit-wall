import type { ReactNode } from "react";

export function Panel(props: { title: string; right?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`panel ${props.className ?? ""}`}>
      <header className="panel-head">
        <span className="panel-title">▌{props.title}</span>
        {props.right && <span className="panel-right">{props.right}</span>}
      </header>
      <div className="panel-body">{props.children}</div>
    </section>
  );
}
