"use client";

import { useState } from "react";

export type FaqItem = { id: string; question: string; answer: string };

/** Accordion: each question is a button with aria-expanded; every answer is in the initial HTML, just collapsed. Items open independently. */
export default function FaqAccordion({ items }: { items: readonly FaqItem[] }) {
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) => setOpenIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return (
    <div className="faq-list">
      {items.map((item) => {
        const open = openIds.has(item.id);
        return (
          <div key={item.id} className="faq-item">
            <h3 className="faq-question">
              <button type="button" id={`${item.id}-button`} aria-expanded={open} aria-controls={`${item.id}-panel`} onClick={() => toggle(item.id)}>
                <span>{item.question}</span>
                <span className="faq-mark" aria-hidden="true" />
              </button>
            </h3>
            <div id={`${item.id}-panel`} role="region" aria-labelledby={`${item.id}-button`} hidden={!open} className="faq-answer">
              <p>{item.answer}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
