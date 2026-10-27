import React, { useState } from "react";

/**
 * กล่องพาเนลแบบ Premiere: มีแถบแท็บด้านบน สลับแท็บได้
 * children เป็น function (activeTab) => ReactNode หรือ node ธรรมดา
 */
export default function PanelGroup({ tabs, defaultTab, children, className = "" }) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]);
  return (
    <div className={`panel ${className}`}>
      <div className="panel-header">
        {tabs.map((tab) => (
          <span
            key={tab}
            className={`panel-tab ${active === tab ? "active" : ""}`}
            onClick={() => setActive(tab)}
          >
            {tab}
          </span>
        ))}
      </div>
      {typeof children === "function" ? children(active) : children}
    </div>
  );
}
