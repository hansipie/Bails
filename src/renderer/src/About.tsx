import { useEffect, useRef } from "react";
import iconUrl from "./assets/icon.svg";

export function About({ onClose }: { onClose: () => void }) {
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="about-backdrop" onClick={onClose}>
      <div
        className="about"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onClick={(e) => e.stopPropagation()}
      >
        <img className="about-icon" src={iconUrl} alt="" />
        <h2 id="about-title">BAILS</h2>
        <span className="tagline">TOKEN WATCH</span>
        <p className="about-version">v{__APP_VERSION__}</p>
        <p className="about-by">by ansicode</p>
        <button ref={okRef} type="button" className="btn" onClick={onClose}>
          OK
        </button>
      </div>
    </div>
  );
}
