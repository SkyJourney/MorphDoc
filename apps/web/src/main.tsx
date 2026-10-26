import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { APP_WINDOW_TITLE } from "./app-brand";
import { APP_VERSION_LABEL } from "./app-version";
import "./styles.css";

document.title = `${APP_WINDOW_TITLE} ${APP_VERSION_LABEL}`;

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("未找到应用挂载节点");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
