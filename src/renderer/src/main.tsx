import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { UsageView } from "./UsageView";
import { HistoryView } from "./HistoryView";
import "./styles.css";

// History windows load the same page with "#history=<providerId>".
const historyProvider = new URLSearchParams(window.location.hash.slice(1)).get("history");

createRoot(document.getElementById("root")!).render(
  <StrictMode>{historyProvider ? <HistoryView provider={historyProvider} /> : <UsageView />}</StrictMode>
);
