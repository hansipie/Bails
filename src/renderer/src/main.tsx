import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { UsageView } from "./UsageView";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UsageView />
  </StrictMode>
);
